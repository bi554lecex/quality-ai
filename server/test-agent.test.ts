import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import type { AgentDecisionProvider } from './test-agent'
import { TestAgent } from './test-agent'
import { PageObserver } from './page-observer'
import { SingleActionExecutor } from './single-action-executor'
import { agentTestGoalSchema } from '../shared/contracts'

test('runs an observe-decide-execute loop and requires declared assertions before finish', async testContext => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'quality-ai-agent-'))
  testContext.after(() => rm(artifactDirectory, { recursive: true, force: true }))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <label for="name">学生姓名</label><input id="name">
      <button onclick="document.querySelector('#result').textContent='保存成功'">保存</button>
      <div id="result"></div>
    `)
    const goal = agentTestGoalSchema.parse({
      name: '保存学生',
      targetUrl: 'http://localhost:5173/students',
      objective: '填写学生姓名并确认保存成功',
      requiredAssertions: [{ id: 'saved', description: '页面出现保存成功' }],
    })
    let turn = 0
    const decisionProvider: AgentDecisionProvider = {
      async decide({ snapshot }) {
        turn += 1
        if (turn === 1) return {
          type: 'action', snapshotId: snapshot.snapshotId,
          action: { action: 'fill', elementRef: snapshot.elements.find(item => item.name === '学生姓名')?.ref ?? '' , value: '张三' },
          reason: '填写学生姓名',
        }
        if (turn === 2) return {
          type: 'action', snapshotId: snapshot.snapshotId,
          action: { action: 'click', elementRef: snapshot.elements.find(item => item.name === '保存')?.ref ?? '' },
          reason: '提交表单',
        }
        if (turn === 3) return {
          type: 'action', snapshotId: snapshot.snapshotId,
          action: { action: 'expectText', text: '保存成功', assertionId: 'saved' },
          reason: '验证保存结果',
        }
        return { type: 'finish', summary: '保存流程和结果验证完成' }
      },
    }
    const observer = new PageObserver()
    const executor = new SingleActionExecutor(page, observer.registry, goal.targetUrl, artifactDirectory)
    const result = await new TestAgent(goal, observer, executor, decisionProvider).run(page)
    assert.equal(result.status, 'passed')
    assert.equal(result.executedSteps, 3)
    assert.deepEqual(result.passedAssertions, ['saved'])
    assert.equal(await page.locator('#name').inputValue(), '张三')
  } finally {
    await browser.close()
  }
})

test('rejects finish when a required assertion has not passed', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<button>保存</button>')
    const goal = agentTestGoalSchema.parse({
      name: '保存学生', targetUrl: 'http://localhost:5173', objective: '保存',
      requiredAssertions: [{ id: 'saved', description: '保存成功' }],
    })
    const provider: AgentDecisionProvider = { async decide() { return { type: 'finish', summary: '完成' } } }
    const observer = new PageObserver()
    const executor = new SingleActionExecutor(page, observer.registry, goal.targetUrl, tmpdir())
    const result = await new TestAgent(goal, observer, executor, provider).run(page)
    assert.equal(result.status, 'failed')
    assert.match(result.summary, /必要断言尚未完成/)
  } finally {
    await browser.close()
  }
})
