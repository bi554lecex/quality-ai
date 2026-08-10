import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, type Locator, type Page } from 'playwright'
import { automationPlanSchema, type AutomationPlan, type ExecutionResult } from '../shared/contracts'

function locatorFor(page: Page, locator: { by: string; value: string; name?: string }): Locator {
  if (locator.by === 'role') return page.getByRole(locator.value as never, locator.name ? { name: locator.name } : undefined)
  if (locator.by === 'label') return page.getByLabel(locator.value)
  if (locator.by === 'text') return page.getByText(locator.value)
  return page.locator(locator.value)
}

export async function runAutomationPlan(input: unknown): Promise<ExecutionResult> {
  const plan: AutomationPlan = automationPlanSchema.parse(input)
  const baseUrl = new URL(plan.targetUrl)
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('测试地址只允许 HTTP 或 HTTPS')
  const id = randomUUID()
  const startedAt = new Date()
  const artifactDirectory = resolve('data/artifacts', id)
  await mkdir(artifactDirectory, { recursive: true })
  const screenshots: string[] = []
  const stepResults: ExecutionResult['steps'] = []
  const browser = await chromium.launch({ headless: true })
  let executionError: string | undefined

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    for (const [index, step] of plan.steps.entries()) {
      const stepStart = Date.now()
      try {
        if (step.action === 'goto') {
          const destination = new URL(step.path, baseUrl)
          if (destination.origin !== baseUrl.origin) throw new Error('步骤不能跳转到测试环境之外')
          await page.goto(destination.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } else if (step.action === 'click') {
          await locatorFor(page, step.locator).click({ timeout: 10_000 })
        } else if (step.action === 'fill') {
          await locatorFor(page, step.locator).fill(step.value, { timeout: 10_000 })
        } else if (step.action === 'expectText') {
          await page.getByText(step.text).first().waitFor({ state: 'visible', timeout: 10_000 })
        } else {
          const filePath = resolve(artifactDirectory, `${String(index + 1).padStart(2, '0')}-${step.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}.png`)
          await page.screenshot({ path: filePath, fullPage: true })
          screenshots.push(filePath)
        }
        stepResults.push({ index, action: step.action, status: 'passed', durationMs: Date.now() - stepStart })
      } catch (error) {
        executionError = error instanceof Error ? error.message : String(error)
        stepResults.push({ index, action: step.action, status: 'failed', durationMs: Date.now() - stepStart, error: executionError })
        const failurePath = resolve(artifactDirectory, 'failure.png')
        await page.screenshot({ path: failurePath, fullPage: true }).catch(() => undefined)
        screenshots.push(failurePath)
        break
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }

  const finishedAt = new Date()
  return {
    id,
    name: plan.name,
    targetUrl: plan.targetUrl,
    status: executionError ? 'failed' : 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    steps: stepResults,
    screenshots,
    error: executionError,
  }
}
