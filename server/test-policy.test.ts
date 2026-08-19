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

test('guards new element actions and still detects repeated page scrolls', () => {
  const goal = agentTestGoalSchema.parse({
    name: '表单状态', targetUrl: 'http://localhost:5173', objective: '验证表单状态',
    requiredAssertions: [{ id: 'disabled', description: '提交按钮不可用' }],
  })
  const policy = new TestPolicy(goal)
  const state: AgentRuntimeState = {
    startedAt: Date.now(), executedSteps: 0, projectContextRequests: 0,
    passedAssertions: new Set(), recentActionFingerprints: [],
  }
  const snapshot = {
    snapshotId: 'f3980fe3-e6e5-4057-9dfe-4984bba475cc',
    elements: [{ ref: 'e1', enabled: false }],
  } as PageSnapshot

  assert.throws(() => policy.validate({
    type: 'action', snapshotId: snapshot.snapshotId,
    action: { action: 'press', elementRef: 'e1', key: 'Enter' }, reason: '提交',
  }, snapshot, state), /元素当前不可用/)
  assert.doesNotThrow(() => policy.validate({
    type: 'action', snapshotId: snapshot.snapshotId,
    action: { action: 'hover', elementRef: 'e1' }, reason: '查看禁用原因',
  }, snapshot, state))

  const scroll = { action: 'scroll' as const, deltaX: 0, deltaY: 600 }
  state.recentActionFingerprints = [JSON.stringify(scroll), JSON.stringify(scroll)]
  assert.throws(() => policy.validate({
    type: 'action', snapshotId: snapshot.snapshotId, action: scroll, reason: '继续滚动',
  }, snapshot, state), /连续重复动作/)
})
