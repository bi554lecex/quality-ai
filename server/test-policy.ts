import type { AgentAction, AgentDecision, AgentTestGoal, PageSnapshot } from '../shared/contracts'

export interface AgentRuntimeState {
  startedAt: number
  executedSteps: number
  projectContextRequests: number
  passedAssertions: Set<string>
  recentActionFingerprints: string[]
}

interface TestPolicyOptions {
  maxSteps?: number
  maxDurationMs?: number
  maxProjectContextRequests?: number
  maxRepeatedActions?: number
}

const elementActions = new Set<AgentAction['action']>([
  'click', 'fill', 'selectOption', 'check', 'uncheck', 'expectVisible', 'expectValue',
])

export class TestPolicy {
  readonly maxSteps: number
  private readonly maxDurationMs: number
  private readonly maxProjectContextRequests: number
  private readonly maxRepeatedActions: number

  constructor(private readonly goal: AgentTestGoal, options: TestPolicyOptions = {}) {
    this.maxSteps = options.maxSteps ?? 30
    this.maxDurationMs = options.maxDurationMs ?? 5 * 60_000
    this.maxProjectContextRequests = options.maxProjectContextRequests ?? 2
    this.maxRepeatedActions = options.maxRepeatedActions ?? 2
  }

  validate(decision: AgentDecision, snapshot: PageSnapshot, state: AgentRuntimeState) {
    if (Date.now() - state.startedAt > this.maxDurationMs) throw new Error('测试执行超过时间预算')
    if (decision.type === 'need_project_context') {
      if (state.projectContextRequests >= this.maxProjectContextRequests) throw new Error('项目源码上下文请求超过预算')
      return
    }
    if (decision.type === 'blocked') return
    if (decision.type === 'finish') {
      const missing = this.goal.requiredAssertions.filter(assertion => !state.passedAssertions.has(assertion.id))
      if (missing.length) throw new Error(`必要断言尚未完成：${missing.map(item => item.id).join('、')}`)
      return
    }
    if (state.executedSteps >= this.maxSteps) throw new Error(`测试步骤超过上限 ${this.maxSteps}`)
    if (decision.snapshotId !== snapshot.snapshotId) throw new Error(`动作引用了过期页面快照：${decision.snapshotId}`)
    const action = decision.action
    if (action.action === 'goto') {
      const destination = new URL(action.path, this.goal.targetUrl)
      if (destination.origin !== new URL(this.goal.targetUrl).origin) throw new Error('动作不能跳转到测试环境之外')
    }
    if (elementActions.has(action.action)) {
      const elementRef = 'elementRef' in action ? action.elementRef : ''
      const element = snapshot.elements.find(item => item.ref === elementRef)
      if (!element) throw new Error(`当前页面不存在元素引用：${elementRef}`)
      if (['click', 'fill', 'selectOption', 'check', 'uncheck'].includes(action.action) && !element.enabled) {
        throw new Error(`元素当前不可用：${elementRef}`)
      }
    }
    if ('assertionId' in action && !this.goal.requiredAssertions.some(assertion => assertion.id === action.assertionId)) {
      throw new Error(`断言不在测试目标中：${action.assertionId}`)
    }
    const fingerprint = JSON.stringify(action)
    let repeated = 0
    for (let index = state.recentActionFingerprints.length - 1; index >= 0; index -= 1) {
      if (state.recentActionFingerprints[index] !== fingerprint) break
      repeated += 1
    }
    if (repeated >= this.maxRepeatedActions) throw new Error('检测到连续重复动作，已停止执行')
  }
}
