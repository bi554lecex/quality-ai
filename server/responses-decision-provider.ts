import { jsonrepair } from 'jsonrepair'
import { agentDecisionSchema, type AgentDecision } from '../shared/contracts'
import type { AgentDecisionInput, AgentDecisionProvider } from './test-agent'
import { getModelConfig, type ModelConfig } from './model-config'
import { ResponsesModelClient, type ModelMessage } from './model-client'

interface ResponsesDecisionProviderOptions extends Partial<ModelConfig> {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const decisionSystemPrompt = `你是 B 端网页自动化测试的单步决策器。你只能根据当前测试目标、当前语义 DOM、最近轨迹和可选源码上下文决定下一步，输出一个严格 JSON 对象，不输出 Markdown。

规则：
1. 每轮最多提出一个动作，禁止生成完整脚本或多个动作。
2. 页面元素只能使用当前 snapshotId 中存在的 elementRef，禁止编造 CSS、XPath 或元素引用。
3. 页面变化后必须基于新快照重新决策，不得沿用旧 elementRef。
4. DOM 足够时直接行动；确实无法判断时才请求项目源码，源码结论必须回到真实 DOM 验证。
5. requiredAssertions 中的每一项都必须通过带对应 assertionId 的 expect 动作验证。没有全部验证前禁止 finish。
6. 产品结果不符合预期时应执行断言并让测试失败，不得弱化或删除断言。
7. 无法安全继续时返回 blocked，不猜测账号、业务数据或不存在的页面状态。

允许的决策：
- action：goto、click、fill、selectOption、check、uncheck、expectVisible、expectValue、expectText、waitFor、screenshot
- need_project_context：resolve_route、search_source、inspect_files
- finish
- blocked

action 示例：
{"type":"action","snapshotId":"当前 UUID","action":{"action":"click","elementRef":"e3"},"reason":"点击当前弹窗的保存按钮"}
源码请求示例：
{"type":"need_project_context","request":{"operation":"search_source","query":"编辑学生","scopes":["page","component"]},"reason":"DOM 中存在多个同名操作，需确认业务组件"}
完成示例：
{"type":"finish","summary":"所有必要操作和断言已完成"}`

function compactInput(input: AgentDecisionInput) {
  return {
    goal: input.goal,
    currentSnapshot: input.snapshot,
    recentTrajectory: input.trajectory.slice(-8).map(item => ({ iteration: item.iteration, decision: item.decision, result: item.result })),
    projectContexts: input.projectContexts.slice(-2),
  }
}

function cleanJsonOutput(output: string) {
  return output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export class ResponsesDecisionProvider implements AgentDecisionProvider {
  private readonly client: ResponsesModelClient

  constructor(options: ResponsesDecisionProviderOptions = {}) {
    this.client = new ResponsesModelClient(getModelConfig(options), options.fetchImpl, options.timeoutMs ?? 60_000)
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecision> {
    const messages: ModelMessage[] = [
      { role: 'system', content: decisionSystemPrompt },
      { role: 'user', content: `请决定下一步。当前输入：\n${JSON.stringify(compactInput(input))}` },
    ]
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await this.client.generateText({ messages, maxOutputTokens: 1200 })
        try {
          return agentDecisionSchema.parse(JSON.parse(jsonrepair(cleanJsonOutput(output))))
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          if (attempt === 0) {
            messages.push({ role: 'assistant', content: output.slice(0, 8_000) })
            messages.push({ role: 'user', content: `上一个 JSON 未通过 AgentDecision Schema 校验：${lastError.message.slice(0, 2_000)}。请只修复结构和字段，仍然只输出一个 JSON 对象。` })
            continue
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    throw new Error(`单步决策失败：${lastError?.message ?? '未知错误'}`)
  }
}
