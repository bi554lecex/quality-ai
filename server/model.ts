import { automationPlanSchema, prdAnalysisSchema, type AutomationPlan, type PrdAnalysis } from '../shared/contracts'
import { jsonrepair } from 'jsonrepair'

interface ModelConfig {
  apiKey: string
  baseUrl: string
  model: string
}

interface CompletionResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>
  error?: { message?: string }
}

const systemPrompt = `你是一名资深 B 端前端测试架构师。请阅读用户提供的 PRD，并输出严格 JSON。
目标不是复述文档，而是把需求转成可评审、可测试、未来可映射到 Playwright 的结构。
必须：
1. 按独立前端需求拆分 requirements。
2. 业务规则必须包含原文证据，不能杜撰。
3. pageStates 使用“触发条件、页面初始状态、用户交互、预期结果”描述。
4. questions 只记录文档无法唯一确定、会影响实现或测试的事项，并给出保守建议。
5. testCases 覆盖主流程、分支、边界、异常、回归、交互、空数据和数据契约中适用的类型，每个需求生成 6-12 条关键用例。
6. blockedByQuestion 表示用例是否依赖未确认问题。

输出 JSON 结构示例：
{
  "versionName": "版本名称",
  "productName": "产品名称",
  "overview": "版本概览",
  "requirements": [{
    "title": "需求标题",
    "summary": "需求摘要",
    "risk": "高风险|中风险|低风险",
    "riskReason": "风险原因",
    "businessRules": [{"description":"规则","evidence":"PRD 原文依据"}],
    "pageStates": [{"trigger":"条件","initialState":"初始状态","interaction":"操作","expectedResult":"结果"}],
    "questions": [{"title":"问题","reason":"为什么要确认","suggestion":"建议口径"}],
    "testCases": [{
      "title":"用例标题",
      "type":"主流程|分支|边界|异常|回归|交互|空数据|数据契约",
      "priority":"P0|P1|P2",
      "preconditions":["前置条件"],
      "steps":["操作步骤"],
      "expectedResult":"预期结果",
      "blockedByQuestion":false
    }]
  }]
}`

function getConfig(): ModelConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置')
  return {
    apiKey,
    baseUrl: (process.env.MODEL_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.MODEL_NAME ?? 'deepseek-v4-flash',
  }
}

export interface SourceDocument {
  fileName: string
  role: 'prd' | 'interface'
  content: string
}

export async function analyzePrd(documents: SourceDocument[]): Promise<{ result: PrdAnalysis; model: string }> {
  const config = getConfig()
  let lastError: Error | null = null
  const documentText = documents.map(document => {
    const roleName = document.role === 'prd' ? '主 PRD' : '补充接口/技术文档'
    return `【${roleName}：${document.fileName}】\n${document.content}`
  }).join('\n\n--- 文档分隔线 ---\n\n')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `以下是本版本的需求材料。主 PRD 决定业务目标；接口或技术文档只用于补充字段、枚举、接口契约和异常分支。如果材料冲突，必须生成待确认问题，不能擅自选择。\n\n${documentText}` },
          ],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' },
          temperature: 0.1,
          max_tokens: 12000,
          stream: false,
        }),
        signal: AbortSignal.timeout(180_000),
      })

      const payload = await response.json() as CompletionResponse
      if (!response.ok) throw new Error(payload.error?.message ?? `模型请求失败（HTTP ${response.status}）`)
      const choice = payload.choices?.[0]
      if (choice?.finish_reason === 'length') throw new Error('模型输出超过长度限制')
      const output = choice?.message?.content?.trim()
      if (!output) throw new Error('模型返回了空内容')
      const jsonText = output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      return { result: prdAnalysisSchema.parse(JSON.parse(jsonrepair(jsonText))), model: config.model }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError ?? new Error('模型解析失败')
}

export async function generateAutomationPlan(targetUrl: string, testCases: PrdAnalysis['requirements'][number]['testCases']): Promise<AutomationPlan> {
  const config = getConfig()
  const prompt = `你是 Playwright 自动化测试规划器。将测试用例转换为严格 JSON 的受控步骤，不输出 JavaScript。
允许动作只有：
- {"action":"goto","path":"/相对路径"}
- {"action":"click","locator":{"by":"role|label|text|css","value":"值","name":"可选名称"}}
- {"action":"fill","locator":{"by":"role|label|text|css","value":"值","name":"可选名称"},"value":"输入内容"}
- {"action":"expectText","text":"预期可见文本"}
- {"action":"screenshot","name":"证据名称"}
优先使用 role、label、text，只有材料明确提供稳定选择器时才用 css。不得跳转到目标域名之外。无法从用例确定的登录、账号或数据准备不要杜撰，只从进入目标首页后的可执行步骤开始。最后必须截图。
JSON 格式：{"name":"计划名称","targetUrl":"${targetUrl}","steps":[]}
目标地址：${targetUrl}
测试用例：${JSON.stringify(testCases)}`
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, temperature: 0.1, max_tokens: 6000, stream: false }),
    signal: AbortSignal.timeout(180_000),
  })
  const payload = await response.json() as CompletionResponse
  if (!response.ok) throw new Error(payload.error?.message ?? `模型请求失败（HTTP ${response.status}）`)
  const output = payload.choices?.[0]?.message?.content?.trim()
  if (!output) throw new Error('模型未生成自动化计划')
  return automationPlanSchema.parse(JSON.parse(jsonrepair(output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))))
}
