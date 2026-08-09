<script setup lang="ts">
import { computed, ref } from 'vue'

type RequirementKey = 'school' | 'year'
type Tab = 'overview' | 'states' | 'questions' | 'cases'

const requirements = {
  school: { code: 'REQ-0825-01', title: '上传试卷学校改为教研学校', risk: '高风险', rules: 8, questions: 5, cases: 15, summary: '高中阶段上传或编辑试卷时，学校字段切换为教研学校口径；小学、初中保持现状，并兼容历史在读学校数据。' },
  year: { code: 'REQ-0825-02', title: '修复已毕业年级录入成绩时学年计算问题', risk: '中风险', rules: 3, questions: 2, cases: 8, summary: '注册年级为 17 的毕业生录入成绩时，按高三毕业口径计算学年，并覆盖 7 月 1 日的学年边界。' }
}

const stateSets = {
  school: [
    ['小学 / 初中', '回显在读或历史学校', '原省市区 · 原学校列表', 'schoolBizType = 0'],
    ['高中 · 有历史教研校', '优先回显历史教研学校', '教研云省市区 · 教研学校', 'schoolBizType = 1'],
    ['高中 · 历史为在读校', '忽略历史值，读取默认教研校', '教研云省市区 · 教研学校', 'schoolBizType = 1'],
    ['高中 · 无教研校', '预填注册地区，学校为空', '加载对应地区学校枚举', '选择学校后保存']
  ],
  year: [
    ['注册年级 ≠ 17', '沿用原学年公式', '当前日期 · 注册年级 · 录入年级', '结果保持一致'],
    ['注册年级 = 17 · 7月前', '按常数 13 参与计算', '当前年份 - 1 - 差值', '返回上一学年'],
    ['注册年级 = 17 · 7月起', '按常数 13 参与计算', '当前年份 - 差值', '返回正确学年']
  ]
}

const questionSets = {
  school: [
    ['历史数据规则存在双重表述', '新增试卷应忽略历史在读学校；编辑历史试卷是否原样展示？', '新增与编辑拆成两套规则'],
    ['无教研学校时如何兜底', '只预填注册分校省市区，还是同时回显注册分校名称？', '学校留空，要求从枚举选择'],
    ['是否允许手动输入学校', 'PRD 要求学校枚举，但现有页面支持自由输入。', '高中只能选择教研学校枚举'],
    ['高中判断口径不唯一', '材料同时出现 gradeId 与 gradeTypeId。', 'gradeTypeId 主判，gradeId 兼容校验'],
    ['教研接口失败是否降级', '回退在读学校会重新引入脏数据。', '不降级，保留表单并支持重试']
  ],
  year: [
    ['7 月 1 日边界时区', '应以服务端时区还是用户端时区判断？', '统一使用 Asia/Shanghai'],
    ['常数 13 的业务含义', '文案称按高三处理，公式却使用 13。', '产品确认后固化为业务规则']
  ]
}

const caseSets = {
  school: [
    ['TC-001', '小学上传试卷保持原学校逻辑', '回归', 'P1', '已就绪'],
    ['TC-002', '高中有历史教研学校时优先回显', '主流程', 'P0', '已就绪'],
    ['TC-003', '高中历史为在读学校时忽略历史值', '分支', 'P0', '待确认'],
    ['TC-004', '高中无历史时回显默认教研学校', '主流程', 'P0', '已就绪'],
    ['TC-005', '高中无教研学校时预填注册地区', '空数据', 'P0', '待确认'],
    ['TC-006', '初三切换高一后清空在读学校', '状态切换', 'P0', '已就绪'],
    ['TC-007', '高一切换初三后恢复在读学校源', '状态切换', 'P1', '已就绪'],
    ['TC-008', '修改地区后清空已选择学校', '交互', 'P1', '已就绪'],
    ['TC-009', '高中保存携带 schoolBizType=1', '数据契约', 'P0', '已就绪'],
    ['TC-010', '教研接口失败时保留表单并重试', '异常', 'P0', '待确认']
  ],
  year: [
    ['TC-101', '毕业生在 6 月 30 日录入高三成绩', '边界', 'P0', '已就绪'],
    ['TC-102', '毕业生在 7 月 1 日录入高三成绩', '边界', 'P0', '待确认'],
    ['TC-103', '毕业生在 8 月录入高二成绩', '分支', 'P1', '已就绪'],
    ['TC-104', '正常高三学生沿用原公式', '回归', 'P1', '已就绪']
  ]
}

const activeRequirement = ref<RequirementKey>('school')
const activeTab = ref<Tab>('overview')
const confirmed = ref<Record<string, boolean>>({})
const selectedCases = ref<Record<string, boolean>>({ 'TC-001': true, 'TC-002': true, 'TC-004': true })
const notice = ref('')
const requirement = computed(() => requirements[activeRequirement.value])
const states = computed(() => stateSets[activeRequirement.value])
const questions = computed(() => questionSets[activeRequirement.value])
const cases = computed(() => caseSets[activeRequirement.value])
const confirmedCount = computed(() => questions.value.filter((_, index) => confirmed.value[`${activeRequirement.value}-${index}`]).length)
const selectedCount = computed(() => cases.value.filter(item => selectedCases.value[item[0]]).length)

function chooseRequirement(key: RequirementKey) { activeRequirement.value = key; activeTab.value = 'overview' }
function toast(message: string) { notice.value = message; window.setTimeout(() => notice.value = '', 3000) }
function importPrd(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) toast(`已导入 ${file.name}，模型接入后将执行真实解析`) }
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span>知</span><div><strong>知测 AI</strong><small>测试工作台</small></div></div>
      <nav>
        <button class="active"><i>版</i>版本中心</button><button><i>需</i>需求中心<em>2</em></button><button><i>例</i>用例资产</button><button><i>执</i>执行中心</button><button><i>忆</i>质量记忆</button>
      </nav>
      <div class="side-bottom"><div class="memory"><b></b><p><strong>质量记忆已启用</strong><small>本版本命中 3 条经验</small></p></div><div class="user"><span>TX</span><p><strong>测试小组</strong><small>前端质量空间</small></p></div></div>
    </aside>

    <main>
      <header class="topbar"><div><span>版本中心</span><b>/</b><strong>0825 版本</strong></div><label class="import"><input type="file" accept=".md,.doc,.docx,.pdf" @change="importPrd" />＋ 导入 PRD</label></header>
      <div class="workspace">
        <section class="heading"><div><small><i></i>进行中 · 计划 08/25 发布</small><h1>错题本 · 0825 版本</h1><p>以 PRD 为入口，完成需求澄清、测试设计和自动化准备。</p></div><div><button>分享评审</button><button class="primary" @click="activeTab='cases';toast('测试建议已刷新')">生成测试建议</button></div></section>
        <section class="metrics"><article><i class="purple">需</i><p><span>前端需求</span><strong>2</strong><small>已全部解析</small></p></article><article><i class="amber">?</i><p><span>待确认问题</span><strong>7</strong><small>3 项阻塞用例</small></p></article><article><i class="blue">例</i><p><span>测试用例</span><strong>23</strong><small>18 条可执行</small></p></article><article><i class="green">✓</i><p><span>需求覆盖度</span><strong>78%</strong><small>确认后继续提升</small></p></article></section>

        <section class="content-grid">
          <aside class="requirements"><div class="section-title"><span>版本需求</span><b>2 项</b></div>
            <button :class="['req-card',{active:activeRequirement==='school'}]" @click="chooseRequirement('school')"><small><span>REQ-0825-01</span><b>高风险</b></small><strong>上传试卷学校改为教研学校</strong><p>高中学校字段切换为教研学校口径</p><div><i style="width:82%"></i></div></button>
            <button :class="['req-card',{active:activeRequirement==='year'}]" @click="chooseRequirement('year')"><small><span>REQ-0825-02</span><b class="medium">中风险</b></small><strong>修复毕业年级学年计算问题</strong><p>注册年级 17 按高三毕业口径计算</p><div><i style="width:68%"></i></div></button>
            <div class="sources"><span>需求材料</span><div><i>MD</i><p><strong>错题本_0825版本需求</strong><small>产品需求 · 已解析</small></p><b>✓</b></div><div><i class="api">API</i><p><strong>老师平台技术方案</strong><small>增强材料 · 已关联</small></p><b>✓</b></div></div>
          </aside>

          <section class="detail"><div class="detail-head"><small><span>{{ requirement.code }}</span><b>{{ requirement.risk }}</b></small><h2>{{ requirement.title }}</h2><p>{{ requirement.summary }}</p><div><span>◉ 前端 · 错题本</span><span>规则 {{ requirement.rules }}</span><span>问题 {{ requirement.questions }}</span><span>用例 {{ requirement.cases }}</span></div></div>
            <div class="tabs"><button :class="{active:activeTab==='overview'}" @click="activeTab='overview'">需求概览</button><button :class="{active:activeTab==='states'}" @click="activeTab='states'">页面状态</button><button :class="{active:activeTab==='questions'}" @click="activeTab='questions'">待确认问题 <em>{{ questions.length-confirmedCount }}</em></button><button :class="{active:activeTab==='cases'}" @click="activeTab='cases'">测试用例</button></div>
            <div class="tab-content">
              <template v-if="activeTab==='overview'"><article class="ai-insight"><small><b>AI</b> 需求理解</small><h3>{{ activeRequirement==='school'?'本次不是修改一个文案，而是切换学校数据口径':'本次核心是修复毕业生学年计算的特殊分支' }}</h3><p>{{ activeRequirement==='school'?'页面外观变化很小，但默认回显、数据源、年级切换、历史兼容和保存契约都发生了变化。':'不同日期、注册年级和录入年级组合会改变最终学年，必须使用边界矩阵验证。' }}</p><button @click="activeTab='states'">查看页面状态 →</button></article><div class="rule-block"><header><h3>提取的业务规则</h3><span>{{ requirement.rules }} 条规则</span></header><div v-for="(state,index) in states" :key="state[0]"><span>BR-{{ String(index+1).padStart(2,'0') }}</span><p>{{ state[1] }}</p><b>已提取</b></div></div></template>
              <template v-else-if="activeTab==='states'"><header class="subhead"><div><h3>页面状态模型</h3><p>由 PRD 规则反推出用户可见状态与系统结果</p></div><span>{{ states.length }} 个关键状态</span></header><div class="flow"><span>进入页面</span><i>→</i><span>判断条件</span><i>→</i><span>回显 / 选择</span><i>→</i><span>保存校验</span></div><div class="state-table"><header><span>触发条件</span><span>页面初始状态</span><span>数据与交互</span><span>提交结果</span></header><div v-for="state in states" :key="state[0]"><strong>{{ state[0] }}</strong><span>{{ state[1] }}</span><span>{{ state[2] }}</span><span>{{ state[3] }}</span></div></div><div class="warning"><b>!</b><p><strong>发现一个关键状态冲突</strong><span>历史数据规则需要按新增与编辑入口拆分确认。</span></p><button @click="activeTab='questions'">去确认</button></div></template>
              <template v-else-if="activeTab==='questions'"><header class="subhead"><div><h3>待产品确认</h3><p>确认结果将自动写回业务规则和测试用例</p></div><span>{{ confirmedCount }}/{{ questions.length }} 已确认</span></header><div class="question-list"><article v-for="(q,index) in questions" :key="q[0]" :class="{done:confirmed[`${activeRequirement}-${index}`]}"><i>{{ confirmed[`${activeRequirement}-${index}`]?'✓':index+1 }}</i><div><h4>{{ q[0] }}</h4><p>{{ q[1] }}</p><small><b>AI 建议</b>{{ q[2] }}</small></div><button @click="confirmed[`${activeRequirement}-${index}`]=!confirmed[`${activeRequirement}-${index}`]">{{ confirmed[`${activeRequirement}-${index}`]?'已确认':'采纳建议' }}</button></article></div></template>
              <template v-else><header class="case-toolbar"><div><h3>测试用例</h3><p>从业务规则、页面状态和历史风险生成</p></div><span>已选 {{ selectedCount }}/{{ cases.length }}</span></header><div class="case-table"><header><span></span><span>用例</span><span>类型</span><span>优先级</span><span>状态</span></header><label v-for="item in cases" :key="item[0]"><input v-model="selectedCases[item[0]]" type="checkbox"/><span><b>{{ item[0] }}</b><strong>{{ item[1] }}</strong></span><span>{{ item[2] }}</span><i :class="item[3].toLowerCase()">{{ item[3] }}</i><em :class="item[4]==='已就绪'?'ready':'pending'">{{ item[4] }}</em></label></div><div class="automation"><div><b>✦</b><p><strong>{{ selectedCount }} 条用例已准备生成自动化任务</strong><span>模型和 Playwright 接入后可直接进入执行。</span></p></div><button :disabled="!selectedCount" @click="toast(`已保存 ${selectedCount} 条自动化任务草稿，等待执行器接入`)">生成任务草稿</button></div></template>
            </div>
          </section>
        </section>
      </div>
    </main>
    <Transition name="toast"><div v-if="notice" class="toast"><b>✓</b>{{ notice }}</div></Transition>
  </div>
</template>
