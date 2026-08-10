<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ExecutionResult, PrdAnalysis, SavedAnalysis, SavedAutomationPlan } from '../shared/contracts'

type Tab = 'overview' | 'states' | 'questions' | 'cases'

const sampleAnalysis: PrdAnalysis = {
  versionName: '0825 版本',
  productName: '错题本',
  overview: '以 PRD 为入口，完成需求澄清、测试设计和自动化准备。',
  requirements: [
    {
      title: '上传试卷学校改为教研学校',
      summary: '高中阶段上传或编辑试卷时，学校字段切换为教研学校口径；小学、初中保持现状，并兼容历史在读学校数据。',
      risk: '高风险',
      riskReason: '涉及默认回显、数据源切换、历史数据兼容和保存契约。',
      businessRules: [
        { description: '小学、初中继续使用原学校数据源', evidence: '小学、初中学校逻辑保持不变' },
        { description: '高中学校切换为教研学校数据源', evidence: '高中阶段学校字段改为教研学校' },
        { description: '高中保存时携带教研学校业务类型', evidence: 'schoolBizType = 1' },
      ],
      pageStates: [
        { trigger: '小学 / 初中', initialState: '回显在读或历史学校', interaction: '使用原省市区与学校列表', expectedResult: 'schoolBizType = 0' },
        { trigger: '高中 · 有历史教研校', initialState: '优先回显历史教研学校', interaction: '使用教研云省市区与学校枚举', expectedResult: 'schoolBizType = 1' },
        { trigger: '高中 · 历史为在读校', initialState: '忽略历史值，读取默认教研校', interaction: '重新选择教研学校', expectedResult: 'schoolBizType = 1' },
        { trigger: '高中 · 无教研校', initialState: '预填注册地区，学校为空', interaction: '加载地区对应学校枚举', expectedResult: '选择学校后保存' },
      ],
      questions: [
        { title: '历史数据规则存在双重表述', reason: '新增试卷应忽略历史在读学校；编辑历史试卷是否原样展示？', suggestion: '新增与编辑拆成两套规则' },
        { title: '无教研学校时如何兜底', reason: '只预填注册分校省市区，还是同时回显注册分校名称？', suggestion: '学校留空，要求从枚举选择' },
      ],
      testCases: [
        { title: '小学上传试卷保持原学校逻辑', type: '回归', priority: 'P1', preconditions: ['小学账号'], steps: ['进入上传试卷页面', '查看学校字段'], expectedResult: '使用原学校数据源', blockedByQuestion: false },
        { title: '高中有历史教研学校时优先回显', type: '主流程', priority: 'P0', preconditions: ['高中账号存在历史教研学校'], steps: ['进入上传试卷页面'], expectedResult: '回显历史教研学校', blockedByQuestion: false },
        { title: '高中历史为在读学校时忽略历史值', type: '分支', priority: 'P0', preconditions: ['历史数据为在读学校'], steps: ['进入上传试卷页面'], expectedResult: '不回显在读学校', blockedByQuestion: true },
      ],
    },
    {
      title: '修复已毕业年级录入成绩时学年计算问题',
      summary: '注册年级为 17 的毕业生录入成绩时，按高三毕业口径计算学年，并覆盖 7 月 1 日的学年边界。',
      risk: '中风险',
      riskReason: '日期边界和特殊年级组合会影响历史成绩归属。',
      businessRules: [{ description: '注册年级 17 使用毕业生特殊计算分支', evidence: '注册年级为 17 时按高三毕业处理' }],
      pageStates: [
        { trigger: '注册年级 ≠ 17', initialState: '沿用原学年公式', interaction: '录入成绩', expectedResult: '结果保持一致' },
        { trigger: '注册年级 = 17 · 7月前', initialState: '按毕业口径计算', interaction: '录入成绩', expectedResult: '返回上一学年' },
        { trigger: '注册年级 = 17 · 7月起', initialState: '按毕业口径计算', interaction: '录入成绩', expectedResult: '返回正确学年' },
      ],
      questions: [{ title: '7 月 1 日边界时区', reason: '应以服务端时区还是用户端时区判断？', suggestion: '统一使用 Asia/Shanghai' }],
      testCases: [
        { title: '毕业生在 6 月 30 日录入高三成绩', type: '边界', priority: 'P0', preconditions: ['注册年级为 17'], steps: ['将日期设为 6 月 30 日', '录入高三成绩'], expectedResult: '成绩归入上一学年', blockedByQuestion: false },
        { title: '毕业生在 7 月 1 日录入高三成绩', type: '边界', priority: 'P0', preconditions: ['注册年级为 17'], steps: ['将日期设为 7 月 1 日', '录入高三成绩'], expectedResult: '成绩归入新学年', blockedByQuestion: true },
      ],
    },
  ],
}

const savedAnalysis = ref<SavedAnalysis | null>(null)
const apiConfigured = ref(false)
const activeRequirement = ref(0)
const activeTab = ref<Tab>('overview')
const confirmed = ref<Record<string, boolean>>({})
const selectedCases = ref<Record<string, boolean>>({})
const notice = ref('')
const analyzing = ref(false)
const reviewSaving = ref(false)
const executionRunning = ref(false)
const latestExecution = ref<ExecutionResult | null>(null)
const latestAutomationPlan = ref<SavedAutomationPlan | null>(null)
const targetUrl = ref('')

const analysis = computed(() => savedAnalysis.value?.result ?? sampleAnalysis)
const requirements = computed(() => analysis.value.requirements)
const requirement = computed(() => requirements.value[activeRequirement.value] ?? requirements.value[0])
const states = computed(() => requirement.value?.pageStates ?? [])
const questions = computed(() => requirement.value?.questions ?? [])
const cases = computed(() => requirement.value?.testCases ?? [])
const totalQuestions = computed(() => requirements.value.reduce((sum, item) => sum + item.questions.length, 0))
const totalCases = computed(() => requirements.value.reduce((sum, item) => sum + item.testCases.length, 0))
const readyCases = computed(() => requirements.value.reduce((sum, item) => sum + item.testCases.filter(test => !test.blockedByQuestion).length, 0))
const confirmedCount = computed(() => questions.value.filter((_, index) => confirmed.value[questionKey(index)]).length)
const selectedCount = computed(() => cases.value.filter((_, index) => selectedCases.value[caseKey(index)]).length)
const coverage = computed(() => totalCases.value ? Math.round((readyCases.value / totalCases.value) * 100) : 0)
const sourceFileNames = computed(() => savedAnalysis.value?.fileNames?.length ? savedAnalysis.value.fileNames : [savedAnalysis.value?.fileName ?? '错题本_0825版本需求.md'])

function requirementCode(index: number) { return `REQ-${String(index + 1).padStart(3, '0')}` }
function questionKey(index: number) { return `${activeRequirement.value}-Q-${index}` }
function caseKey(index: number) { return `${activeRequirement.value}-TC-${index}` }
function caseCode(index: number) { return `TC-${String(index + 1).padStart(3, '0')}` }
function chooseRequirement(index: number) { activeRequirement.value = index; activeTab.value = 'overview' }
function toast(message: string) { notice.value = message; window.setTimeout(() => notice.value = '', 4500) }

function prepareDocumentText(content: string) {
  return content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[图片数据已省略]')
}

function applyReview(analysisValue: SavedAnalysis) {
  confirmed.value = Object.fromEntries((analysisValue.review?.confirmedQuestions ?? []).map(key => [key, true]))
  selectedCases.value = Object.fromEntries((analysisValue.review?.selectedCases ?? []).map(key => [key, true]))
}

async function saveCurrentReview() {
  if (!savedAnalysis.value || reviewSaving.value) return
  reviewSaving.value = true
  try {
    const response = await fetch(`/api/analyses/${encodeURIComponent(savedAnalysis.value.id)}/review`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmedQuestions: Object.keys(confirmed.value).filter(key => confirmed.value[key]),
        selectedCases: Object.keys(selectedCases.value).filter(key => selectedCases.value[key]),
      }),
    })
    const payload = await response.json() as { review?: SavedAnalysis['review']; error?: string }
    if (!response.ok || !payload.review) throw new Error(payload.error ?? '保存失败')
    savedAnalysis.value.review = payload.review
  } catch (error) {
    toast(`评审状态保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    reviewSaving.value = false
  }
}

function toggleQuestion(index: number) {
  confirmed.value[questionKey(index)] = !confirmed.value[questionKey(index)]
  void saveCurrentReview()
}

async function loadSavedAnalysis() {
  try {
    const [healthResponse, latestResponse, executionResponse] = await Promise.all([fetch('/api/health'), fetch('/api/analyses/latest'), fetch('/api/executions/latest')])
    if (healthResponse.ok) apiConfigured.value = Boolean((await healthResponse.json()).configured)
    if (latestResponse.ok) {
      const payload = await latestResponse.json() as { analysis: SavedAnalysis | null }
      if (payload.analysis) {
        savedAnalysis.value = payload.analysis
        applyReview(payload.analysis)
      }
    }
    if (executionResponse.ok) latestExecution.value = (await executionResponse.json() as { execution: ExecutionResult | null }).execution
  } catch {
    apiConfigured.value = false
  }
}

async function verifyPlaywright() {
  executionRunning.value = true
  notice.value = '正在启动 Chromium 执行真实浏览器测试…'
  try {
    const response = await fetch('/api/automation/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '知测 AI 本地冒烟测试',
        targetUrl: window.location.origin,
        steps: [
          { action: 'goto', path: '/' },
          { action: 'expectText', text: '知测 AI' },
          { action: 'expectText', text: analysis.value.productName },
          { action: 'screenshot', name: '工作台首页' },
        ],
      }),
    })
    const payload = await response.json() as { execution?: ExecutionResult; error?: string }
    if (!payload.execution) throw new Error(payload.error ?? '执行失败')
    latestExecution.value = payload.execution
    toast(`Playwright 执行${payload.execution.status === 'passed' ? '通过' : '失败'}，共 ${payload.execution.steps.length} 个步骤`)
  } catch (error) {
    toast(`Playwright 执行失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    executionRunning.value = false
  }
}

async function generateAndRun() {
  if (!savedAnalysis.value || !selectedCount.value || !targetUrl.value) return toast('请先选择用例并填写测试环境地址')
  executionRunning.value = true
  notice.value = 'DeepSeek 正在生成受控 Playwright 计划…'
  try {
    const generateResponse = await fetch('/api/automation/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analysisId: savedAnalysis.value.id, targetUrl: targetUrl.value, caseKeys: Object.keys(selectedCases.value).filter(key => selectedCases.value[key]) }),
    })
    const generated = await generateResponse.json() as { automationPlan?: SavedAutomationPlan; error?: string }
    if (!generateResponse.ok || !generated.automationPlan) throw new Error(generated.error ?? '计划生成失败')
    latestAutomationPlan.value = generated.automationPlan
    notice.value = `已生成 ${generated.automationPlan.plan.steps.length} 个步骤，正在启动 Chromium…`
    const runResponse = await fetch('/api/automation/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(generated.automationPlan.plan) })
    const runPayload = await runResponse.json() as { execution?: ExecutionResult; error?: string }
    if (!runPayload.execution) throw new Error(runPayload.error ?? '执行失败')
    latestExecution.value = runPayload.execution
    toast(`AI 计划执行${runPayload.execution.status === 'passed' ? '通过' : '失败'}：${runPayload.execution.steps.length} 步`)
  } catch (error) {
    toast(`自动化失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally { executionRunning.value = false }
}

async function importPrd(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return
  if (files.some(file => !/\.(md|markdown|txt)$/i.test(file.name))) {
    toast('当前支持 Markdown 和 TXT 文件')
    input.value = ''
    return
  }

  analyzing.value = true
  notice.value = `正在联合解析 ${files.length} 份需求材料，请稍候…`
  try {
    const documents = await Promise.all(files.map(async file => ({
      fileName: file.name,
      content: prepareDocumentText(await file.text()),
      role: /接口|技术方案|api/i.test(file.name) ? 'interface' : 'prd',
    })))
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: documents }),
    })
    const payload = await response.json() as { analysis?: SavedAnalysis; error?: string }
    if (!response.ok || !payload.analysis) throw new Error(payload.error ?? '解析失败')
    savedAnalysis.value = payload.analysis
    activeRequirement.value = 0
    activeTab.value = 'overview'
    confirmed.value = {}
    selectedCases.value = {}
    toast(`DeepSeek 已联合解析 ${files.length} 份材料，提取 ${payload.analysis.result.requirements.length} 个需求`)
  } catch (error) {
    toast(`解析失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    analyzing.value = false
    input.value = ''
  }
}

onMounted(loadSavedAnalysis)
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span>知</span><div><strong>知测 AI</strong><small>测试工作台</small></div></div>
      <nav>
        <button class="active"><i>版</i>版本中心</button><button><i>需</i>需求中心<em>{{ requirements.length }}</em></button><button><i>例</i>用例资产</button><button><i>执</i>执行中心</button><button><i>忆</i>质量记忆</button>
      </nav>
      <div class="side-bottom"><div class="memory"><b :class="{offline:!apiConfigured}"></b><p><strong>{{ apiConfigured ? 'DeepSeek 已连接' : '模型服务未连接' }}</strong><small>{{ savedAnalysis ? `${savedAnalysis.model} · 已持久化` : '当前显示示例数据' }}</small></p></div><div class="user"><span>TX</span><p><strong>测试小组</strong><small>前端质量空间</small></p></div></div>
    </aside>

    <main>
      <header class="topbar"><div><span>版本中心</span><b>/</b><strong>{{ analysis.versionName }}</strong></div><label :class="['import',{disabled:analyzing}]"><input :disabled="analyzing" multiple type="file" accept=".md,.markdown,.txt" @change="importPrd" />{{ analyzing ? 'AI 解析中…' : '＋ 导入需求材料' }}</label></header>
      <div class="workspace">
        <section class="heading"><div><small><i></i>{{ savedAnalysis ? `真实解析 · ${savedAnalysis.provider}` : '示例模式 · 等待导入 PRD' }}</small><h1>{{ analysis.productName }} · {{ analysis.versionName }}</h1><p>{{ analysis.overview }}</p></div><div><button>分享评审</button><button class="primary" @click="activeTab='cases';toast('已切换到当前测试用例')">查看测试建议</button></div></section>
        <section class="metrics"><article><i class="purple">需</i><p><span>前端需求</span><strong>{{ requirements.length }}</strong><small>{{ savedAnalysis ? 'DeepSeek 已解析' : '当前为示例数据' }}</small></p></article><article><i class="amber">?</i><p><span>待确认问题</span><strong>{{ totalQuestions }}</strong><small>影响规则与用例</small></p></article><article><i class="blue">例</i><p><span>测试用例</span><strong>{{ totalCases }}</strong><small>{{ readyCases }} 条可执行</small></p></article><article><i class="green">✓</i><p><span>当前可执行率</span><strong>{{ coverage }}%</strong><small>确认后继续提升</small></p></article></section>

        <section class="content-grid">
          <aside class="requirements"><div class="section-title"><span>版本需求</span><b>{{ requirements.length }} 项</b></div>
            <button v-for="(item,index) in requirements" :key="`${item.title}-${index}`" :class="['req-card',{active:activeRequirement===index}]" @click="chooseRequirement(index)"><small><span>{{ requirementCode(index) }}</span><b :class="{medium:item.risk==='中风险',low:item.risk==='低风险'}">{{ item.risk }}</b></small><strong>{{ item.title }}</strong><p>{{ item.summary }}</p><div><i :style="{width:`${Math.round((item.testCases.filter(test => !test.blockedByQuestion).length / item.testCases.length) * 100)}%`}"></i></div></button>
            <div class="sources"><span>需求材料</span><div v-for="fileName in sourceFileNames" :key="fileName"><i :class="{api:/接口|技术方案|api/i.test(fileName)}">{{ /接口|技术方案|api/i.test(fileName) ? 'API' : 'MD' }}</i><p><strong>{{ fileName }}</strong><small>{{ savedAnalysis ? `${/接口|技术方案|api/i.test(fileName) ? '增强材料' : '产品需求'} · 已联合解析` : '示例材料 · 等待真实导入' }}</small></p><b>{{ savedAnalysis ? '✓' : '○' }}</b></div></div>
          </aside>

          <section v-if="requirement" class="detail"><div class="detail-head"><small><span>{{ requirementCode(activeRequirement) }}</span><b>{{ requirement.risk }}</b></small><h2>{{ requirement.title }}</h2><p>{{ requirement.summary }}</p><div><span>◉ 前端需求</span><span>规则 {{ requirement.businessRules.length }}</span><span>问题 {{ requirement.questions.length }}</span><span>用例 {{ requirement.testCases.length }}</span></div></div>
            <div class="tabs"><button :class="{active:activeTab==='overview'}" @click="activeTab='overview'">需求概览</button><button :class="{active:activeTab==='states'}" @click="activeTab='states'">页面状态</button><button :class="{active:activeTab==='questions'}" @click="activeTab='questions'">待确认问题 <em>{{ questions.length-confirmedCount }}</em></button><button :class="{active:activeTab==='cases'}" @click="activeTab='cases'">测试用例</button></div>
            <div class="tab-content">
              <template v-if="activeTab==='overview'"><article class="ai-insight"><small><b>AI</b> 需求理解</small><h3>{{ requirement.riskReason }}</h3><p>{{ requirement.summary }}</p><button @click="activeTab='states'">查看页面状态 →</button></article><div class="rule-block"><header><h3>提取的业务规则</h3><span>{{ requirement.businessRules.length }} 条规则</span></header><div v-for="(rule,index) in requirement.businessRules" :key="`${rule.description}-${index}`"><span>BR-{{ String(index+1).padStart(2,'0') }}</span><p><strong>{{ rule.description }}</strong><small>{{ rule.evidence }}</small></p><b>有依据</b></div></div></template>
              <template v-else-if="activeTab==='states'"><header class="subhead"><div><h3>页面状态模型</h3><p>由 PRD 规则反推出用户可见状态与系统结果</p></div><span>{{ states.length }} 个关键状态</span></header><div class="flow"><span>进入页面</span><i>→</i><span>判断条件</span><i>→</i><span>回显 / 选择</span><i>→</i><span>保存校验</span></div><div class="state-table"><header><span>触发条件</span><span>页面初始状态</span><span>数据与交互</span><span>提交结果</span></header><div v-for="(state,index) in states" :key="`${state.trigger}-${index}`"><strong>{{ state.trigger }}</strong><span>{{ state.initialState }}</span><span>{{ state.interaction }}</span><span>{{ state.expectedResult }}</span></div></div><div v-if="questions.length" class="warning"><b>!</b><p><strong>存在 {{ questions.length }} 个待确认问题</strong><span>确认后才能稳定生成对应自动化任务。</span></p><button @click="activeTab='questions'">去确认</button></div></template>
              <template v-else-if="activeTab==='questions'"><header class="subhead"><div><h3>待产品确认</h3><p>确认结果会立即保存，刷新页面不会丢失</p></div><span>{{ reviewSaving ? '保存中…' : `${confirmedCount}/${questions.length} 已确认` }}</span></header><div class="question-list"><article v-for="(q,index) in questions" :key="`${q.title}-${index}`" :class="{done:confirmed[questionKey(index)]}"><i>{{ confirmed[questionKey(index)]?'✓':index+1 }}</i><div><h4>{{ q.title }}</h4><p>{{ q.reason }}</p><small><b>AI 建议</b>{{ q.suggestion }}</small></div><button @click="toggleQuestion(index)">{{ confirmed[questionKey(index)]?'已确认':'采纳建议' }}</button></article><div v-if="!questions.length" class="empty">模型未发现需要产品确认的问题</div></div></template>
              <template v-else><header class="case-toolbar"><div><h3>测试用例</h3><p>由当前真实业务规则和页面状态生成</p></div><span>{{ reviewSaving ? '保存中…' : `已选 ${selectedCount}/${cases.length}` }}</span></header><div class="case-table"><header><span></span><span>用例</span><span>类型</span><span>优先级</span><span>状态</span></header><label v-for="(item,index) in cases" :key="`${item.title}-${index}`"><input v-model="selectedCases[caseKey(index)]" type="checkbox" @change="saveCurrentReview"/><span><b>{{ caseCode(index) }}</b><strong>{{ item.title }}</strong></span><span>{{ item.type }}</span><i :class="item.priority.toLowerCase()">{{ item.priority }}</i><em :class="item.blockedByQuestion?'pending':'ready'">{{ item.blockedByQuestion ? '待确认' : '已就绪' }}</em></label></div><div class="target-config"><input v-model="targetUrl" type="url" placeholder="测试环境地址，例如 https://test.example.com"/><button :disabled="executionRunning || !selectedCount || !targetUrl" @click="generateAndRun">{{ executionRunning ? '生成并执行中…' : 'AI 生成并执行' }}</button></div><div class="automation"><div><b>✦</b><p><strong>Playwright 真实执行器</strong><span v-if="latestExecution">最近执行：{{ latestExecution.status === 'passed' ? '通过' : '失败' }} · {{ latestExecution.durationMs }}ms · {{ latestExecution.steps.length }} 步</span><span v-else>尚未执行浏览器测试</span></p></div><button :disabled="executionRunning" @click="verifyPlaywright">验证执行器</button></div></template>
            </div>
          </section>
        </section>
      </div>
    </main>
    <Transition name="toast"><div v-if="notice" class="toast"><b>{{ analyzing ? 'AI' : '✓' }}</b>{{ notice }}</div></Transition>
  </div>
</template>
