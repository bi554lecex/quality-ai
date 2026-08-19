import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageSnapshot } from '../shared/contracts'
import { agentTestGoalSchema } from '../shared/contracts'
import { TestPolicy, type AgentRuntimeState } from './test-policy'

test('allows a bounded four-step project context exploration', () => {
  const goal = agentTestGoalSchema.parse({
    name: '批量生成报告', targetUrl: 'http://localhost:5173', objective: '验证报告筛选',
    requiredAssertions: [{ id: 'visible', description: '页面展示筛选结果' }],
  })
  const policy = new TestPolicy(goal)
  const state: AgentRuntimeState = {
    startedAt: Date.now(), executedSteps: 0, projectContextRequests: 3,
    passedAssertions: new Set(), recentActionFingerprints: [],
  }
  const decision = {
    type: 'need_project_context' as const,
    request: { operation: 'search_source' as const, query: '批量生成报告' },
    reason: '定位页面组件',
  }

  assert.doesNotThrow(() => policy.validate(decision, {} as PageSnapshot, state))
  state.projectContextRequests = 4
  assert.throws(() => policy.validate(decision, {} as PageSnapshot, state), /超过预算/)
})
