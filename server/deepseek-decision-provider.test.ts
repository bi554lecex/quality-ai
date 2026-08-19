import assert from 'node:assert/strict'
import test from 'node:test'
import { agentTestGoalSchema, pageSnapshotSchema } from '../shared/contracts'
import { DeepSeekDecisionProvider } from './deepseek-decision-provider'

function decisionInput() {
  return {
    goal: agentTestGoalSchema.parse({
      name: '查询学生',
      targetUrl: 'http://localhost:5173/students',
      objective: '输入姓名并查询',
      requiredAssertions: [{ id: 'student-visible', description: '列表显示张三' }],
    }),
    snapshot: pageSnapshotSchema.parse({
      snapshotId: '7aa1e1de-dcc0-4aa5-8182-c647d615c96a',
      observedAt: new Date().toISOString(),
      url: 'http://localhost:5173/students',
      title: '学生管理',
      loading: false,
      elements: [{ ref: 'e1', tag: 'input', role: 'textbox', name: '学生姓名', visible: true, enabled: true }],
      dialogs: [], tables: [], messages: [],
      stats: { discoveredElements: 1, returnedElements: 1, truncated: false },
    }),
    trajectory: [],
    projectContexts: [],
  }
}

test('converts DeepSeek JSON into a validated single action decision', async () => {
  const requests: Array<{ body?: BodyInit | null }> = []
  const provider = new DeepSeekDecisionProvider({
    apiKey: 'test-key', baseUrl: 'https://model.test', model: 'test-model',
    fetchImpl: async (_input, init) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        type: 'action', snapshotId: decisionInput().snapshot.snapshotId,
        action: { action: 'fill', elementRef: 'e1', value: '张三' }, reason: '填写查询条件',
      }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const decision = await provider.decide(decisionInput())
  assert.equal(decision.type, 'action')
  assert.equal(requests.length, 1)
  const body = JSON.parse(String(requests[0].body)) as { messages: Array<{ content: string }> }
  assert.match(body.messages[1].content, /学生姓名/)
  assert.match(body.messages[1].content, /student-visible/)
})

test('uses validation feedback to repair an invalid first response', async () => {
  const requestBodies: string[] = []
  let call = 0
  const provider = new DeepSeekDecisionProvider({
    apiKey: 'test-key', baseUrl: 'https://model.test', model: 'test-model',
    fetchImpl: async (_input, init) => {
      requestBodies.push(String(init?.body))
      call += 1
      const content = call === 1
        ? '{"type":"action","snapshotId":"invalid","action":{"action":"click","elementRef":"e1"},"reason":"查询"}'
        : '{"type":"blocked","reason":"缺少可安全执行的信息"}'
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    },
  })
  const decision = await provider.decide(decisionInput())
  assert.deepEqual(decision, { type: 'blocked', reason: '缺少可安全执行的信息' })
  assert.equal(requestBodies.length, 2)
  assert.match(requestBodies[1], /未通过 AgentDecision Schema 校验/)
})

test('surfaces model HTTP errors without returning an unvalidated fallback', async () => {
  const provider = new DeepSeekDecisionProvider({
    apiKey: 'test-key', baseUrl: 'https://model.test', model: 'test-model',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
  })
  await assert.rejects(provider.decide(decisionInput()), /rate limited/)
})
