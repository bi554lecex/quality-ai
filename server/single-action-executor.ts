import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Page } from 'playwright'
import { toolResultSchema, type AgentAction, type ToolResult } from '../shared/contracts'
import type { ElementRegistry } from './element-registry'

function safeArtifactName(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 80) || 'screenshot'
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const retryable = lower.includes('timeout') || lower.includes('detached') || lower.includes('not visible') || lower.includes('intercepts pointer')
  return { message, retryable, code: retryable ? 'technical_action_failed' : 'action_failed' }
}

export class SingleActionExecutor {
  constructor(
    private readonly page: Page,
    private readonly registry: ElementRegistry,
    private readonly baseUrl: string,
    private readonly artifactDirectory: string,
  ) {}

  async execute(snapshotId: string, action: AgentAction): Promise<ToolResult> {
    const startedAt = Date.now()
    const previousUrl = this.page.url()
    try {
      let screenshotPath: string | undefined
      if (action.action === 'goto') {
        const destination = new URL(action.path, this.baseUrl)
        await this.page.goto(destination.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      } else if (action.action === 'click') {
        await this.registry.resolve(snapshotId, action.elementRef).click({ timeout: 10_000 })
      } else if (action.action === 'fill') {
        await this.registry.resolve(snapshotId, action.elementRef).fill(action.value, { timeout: 10_000 })
      } else if (action.action === 'selectOption') {
        await this.registry.resolve(snapshotId, action.elementRef).selectOption(action.value, { timeout: 10_000 })
      } else if (action.action === 'check') {
        await this.registry.resolve(snapshotId, action.elementRef).check({ timeout: 10_000 })
      } else if (action.action === 'uncheck') {
        await this.registry.resolve(snapshotId, action.elementRef).uncheck({ timeout: 10_000 })
      } else if (action.action === 'expectVisible') {
        await this.registry.resolve(snapshotId, action.elementRef).waitFor({ state: 'visible', timeout: 10_000 })
      } else if (action.action === 'expectValue') {
        const actual = await this.registry.resolve(snapshotId, action.elementRef).inputValue({ timeout: 10_000 })
        if (actual !== action.value) throw new Error(`值断言失败：预期“${action.value}”，实际“${actual}”`)
      } else if (action.action === 'expectText') {
        await this.page.getByText(action.text, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 })
      } else if (action.action === 'waitFor') {
        await this.page.waitForTimeout(action.durationMs)
      } else {
        await mkdir(this.artifactDirectory, { recursive: true })
        screenshotPath = resolve(this.artifactDirectory, `${safeArtifactName(action.name)}.png`)
        await this.page.screenshot({ path: screenshotPath, fullPage: true })
      }
      const pageChanged = previousUrl !== this.page.url() || ['goto', 'click', 'fill', 'selectOption', 'check', 'uncheck'].includes(action.action)
      return toolResultSchema.parse({
        ok: true,
        code: 'ok',
        retryable: false,
        message: '动作执行成功',
        durationMs: Date.now() - startedAt,
        pageChanged,
        screenshotPath,
      })
    } catch (error) {
      const classified = classifyError(error)
      return toolResultSchema.parse({
        ok: false,
        ...classified,
        durationMs: Date.now() - startedAt,
        pageChanged: previousUrl !== this.page.url(),
      })
    }
  }
}
