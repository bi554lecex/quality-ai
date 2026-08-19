import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { analyzePrd } from './model'
import { getAnalysisById, getAutomationPlanById, getEnvironmentById, getExecutionById, getLatestAnalysis, getLatestAutomationPlan, getLatestEnvironment, getLatestExecution, listAnalyses, listExecutions, saveAnalysis, saveAutomationPlan, saveEnvironment, saveExecution, saveReview, setEnvironmentStorageState } from './database'
import { runAutomationPlan } from './playwright-runner'
import { generateAutomationPlan } from './model'
import { automationPlanSchema, storageStateSchema } from '../shared/contracts'
import { getProjectProvider, getProjectProviderRegistry } from './project-knowledge/registry'
import type { SourceScope } from './project-knowledge/types'

const port = Number(process.env.API_PORT ?? 8787)
const maxBodySize = 10 * 1024 * 1024
const sourceScopes = new Set<SourceScope>(['route', 'page', 'component', 'api'])

function sanitizePrd(content: string) {
  return content
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[图片数据已省略]')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBodySize) throw new Error('需求材料合计不能超过 10MB')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/health') {
      return json(response, 200, {
        ok: true,
        provider: 'deepseek',
        model: process.env.MODEL_NAME ?? 'deepseek-v4-flash',
        configured: Boolean(process.env.DEEPSEEK_API_KEY),
      })
    }

    if (request.method === 'GET' && request.url === '/api/projects') {
      const providers = [...(await getProjectProviderRegistry()).values()]
      return json(response, 200, { projects: await Promise.all(providers.map(provider => provider.getProjectInfo())) })
    }

    const validateProjectMatch = request.url?.match(/^\/api\/projects\/([a-z0-9-]+)\/validate$/)
    if (request.method === 'POST' && validateProjectMatch) {
      const project = await (await getProjectProvider(validateProjectMatch[1])).getProjectInfo()
      return json(response, project.connected ? 200 : 422, { project })
    }

    const resolveRouteMatch = request.url?.match(/^\/api\/projects\/([a-z0-9-]+)\/resolve-route$/)
    if (request.method === 'POST' && resolveRouteMatch) {
      const body = await readJson(request)
      const url = typeof body.url === 'string' ? body.url.trim() : ''
      if (!url) return json(response, 400, { error: '页面 URL 不能为空' })
      const route = await (await getProjectProvider(resolveRouteMatch[1])).resolveRoute({ url })
      return json(response, 200, { route })
    }

    const searchSourceMatch = request.url?.match(/^\/api\/projects\/([a-z0-9-]+)\/search-source$/)
    if (request.method === 'POST' && searchSourceMatch) {
      const body = await readJson(request)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      const invalidScope = Array.isArray(body.scopes)
        && body.scopes.some(scope => typeof scope !== 'string' || !sourceScopes.has(scope as SourceScope))
      if (invalidScope) return json(response, 400, { error: '源码搜索范围不合法' })
      const scopes = Array.isArray(body.scopes)
        ? body.scopes.filter((scope): scope is SourceScope => typeof scope === 'string' && sourceScopes.has(scope as SourceScope))
        : undefined
      const limit = typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0 ? body.limit : undefined
      if (!query) return json(response, 400, { error: '源码搜索词不能为空' })
      const matches = await (await getProjectProvider(searchSourceMatch[1])).searchSource({ query, scopes, limit })
      return json(response, 200, { matches })
    }

    const inspectSourceMatch = request.url?.match(/^\/api\/projects\/([a-z0-9-]+)\/inspect-source$/)
    if (request.method === 'POST' && inspectSourceMatch) {
      const body = await readJson(request)
      const paths = Array.isArray(body.paths) && body.paths.every(path => typeof path === 'string') ? body.paths : []
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!paths.length || !reason) return json(response, 400, { error: '源码文件和读取原因不能为空' })
      const context = await (await getProjectProvider(inspectSourceMatch[1])).inspectFiles({ paths, reason })
      return json(response, 200, { context })
    }

    if (request.method === 'GET' && request.url === '/api/analyses/latest') {
      return json(response, 200, { analysis: getLatestAnalysis() })
    }

    if (request.method === 'GET' && request.url === '/api/analyses') {
      return json(response, 200, { analyses: listAnalyses() })
    }

    const analysisMatch = request.url?.match(/^\/api\/analyses\/([a-f0-9-]+)$/i)
    if (request.method === 'GET' && analysisMatch) {
      const analysis = getAnalysisById(analysisMatch[1])
      return analysis ? json(response, 200, { analysis }) : json(response, 404, { error: '版本不存在' })
    }

    if (request.method === 'GET' && request.url === '/api/executions/latest') {
      return json(response, 200, { execution: getLatestExecution() })
    }

    if (request.method === 'GET' && request.url === '/api/executions') {
      return json(response, 200, { executions: listExecutions() })
    }

    const executionMatch = request.url?.match(/^\/api\/executions\/([a-f0-9-]+)$/i)
    if (request.method === 'GET' && executionMatch) {
      const execution = getExecutionById(executionMatch[1])
      return execution ? json(response, 200, { execution }) : json(response, 404, { error: '执行记录不存在' })
    }

    const rerunMatch = request.url?.match(/^\/api\/executions\/([a-f0-9-]+)\/rerun$/i)
    if (request.method === 'POST' && rerunMatch) {
      const original = getExecutionById(rerunMatch[1])
      if (!original) return json(response, 404, { error: '执行记录不存在' })
      if (!original.plan) return json(response, 409, { error: '历史记录未保存自动化计划，无法直接重跑' })
      const environment = original.environmentId ? getEnvironmentById(original.environmentId) : null
      if (original.environmentId && !environment) return json(response, 409, { error: '原测试环境已不存在，无法安全重跑' })
      const result = await runAutomationPlan(original.plan, environment?.storageStatePath)
      saveExecution(result, {
        analysisId: original.analysisId, automationPlanId: original.automationPlanId,
        environmentId: original.environmentId, caseKeys: original.caseKeys, plan: original.plan, rerunOf: original.id,
      })
      const execution = getExecutionById(result.id)
      return json(response, result.status === 'passed' ? 201 : 422, { execution })
    }

    if (request.method === 'GET' && request.url === '/api/environments/latest') return json(response, 200, { environment: getLatestEnvironment() })

    if (request.method === 'POST' && request.url === '/api/environments') {
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
      const id = typeof body.id === 'string' ? body.id : undefined
      if (!name || !baseUrl) return json(response, 400, { error: '环境名称和地址不能为空' })
      const url = new URL(baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return json(response, 400, { error: '环境地址只允许 HTTP 或 HTTPS' })
      return json(response, 200, { environment: saveEnvironment({ id, name, baseUrl: url.origin }) })
    }

    const stateMatch = request.url?.match(/^\/api\/environments\/([a-f0-9-]+)\/storage-state$/i)
    if (request.method === 'POST' && stateMatch) {
      const environment = getEnvironmentById(stateMatch[1])
      if (!environment) return json(response, 404, { error: '测试环境不存在' })
      const storageState = storageStateSchema.parse(await readJson(request))
      const directory = resolve('data/auth')
      await mkdir(directory, { recursive: true })
      const statePath = resolve(directory, `${environment.id}.json`)
      await writeFile(statePath, JSON.stringify(storageState), { mode: 0o600 })
      return json(response, 200, { environment: setEnvironmentStorageState(environment.id, statePath) })
    }

    const artifactMatch = request.url?.match(/^\/api\/artifacts\/([a-f0-9-]+)\/([^/?]+)$/i)
    if (request.method === 'GET' && artifactMatch) {
      const executionId = artifactMatch[1]
      const fileName = basename(decodeURIComponent(artifactMatch[2]))
      if (!/^(trace\.zip|failure\.png|\d{2}-[\w\u4e00-\u9fa5-]+\.png)$/.test(fileName)) return json(response, 400, { error: '证据文件名不合法' })
      const filePath = resolve('data/artifacts', executionId, fileName)
      if (!existsSync(filePath)) return json(response, 404, { error: '证据文件不存在' })
      response.writeHead(200, {
        'content-type': fileName.endsWith('.zip') ? 'application/zip' : 'image/png',
        'content-disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      })
      createReadStream(filePath).pipe(response)
      return
    }

    if (request.method === 'GET' && request.url === '/api/automation/plans/latest') {
      return json(response, 200, { automationPlan: getLatestAutomationPlan() })
    }

    if (request.method === 'POST' && request.url === '/api/automation/generate') {
      const body = await readJson(request)
      const analysisId = typeof body.analysisId === 'string' ? body.analysisId : ''
      const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl : ''
      const caseKeys = Array.isArray(body.caseKeys) && body.caseKeys.every(key => typeof key === 'string') ? body.caseKeys : []
      const analysis = getAnalysisById(analysisId)
      if (!analysis) return json(response, 404, { error: '解析记录不存在' })
      if (!targetUrl || !caseKeys.length) return json(response, 400, { error: '请选择用例并配置测试地址' })
      const testCases = caseKeys.map(key => {
        const match = key.match(/^(\d+)-TC-(\d+)$/)
        return match ? analysis.result.requirements[Number(match[1])]?.testCases[Number(match[2])] : undefined
      }).filter((item): item is NonNullable<typeof item> => Boolean(item))
      if (!testCases.length) return json(response, 400, { error: '没有找到可生成的测试用例' })
      const plan = await generateAutomationPlan(targetUrl, testCases)
      const savedPlan = { id: randomUUID(), analysisId, caseKeys, plan, createdAt: new Date().toISOString() }
      saveAutomationPlan(savedPlan)
      return json(response, 201, { automationPlan: savedPlan })
    }

    if (request.method === 'POST' && request.url === '/api/automation/run') {
      const body = await readJson(request)
      const environmentId = typeof body.environmentId === 'string' ? body.environmentId : undefined
      const automationPlanId = typeof body.automationPlanId === 'string' ? body.automationPlanId : undefined
      const environment = environmentId ? getEnvironmentById(environmentId) : null
      if (environmentId && !environment) return json(response, 404, { error: '测试环境不存在' })
      const savedPlan = automationPlanId ? getAutomationPlanById(automationPlanId) : null
      if (automationPlanId && !savedPlan) return json(response, 404, { error: '自动化计划不存在' })
      const wrappedPlan = automationPlanSchema.parse(savedPlan?.plan ?? body.plan ?? body)
      const result = await runAutomationPlan(wrappedPlan, environment?.storageStatePath)
      saveExecution(result, {
        analysisId: savedPlan?.analysisId,
        automationPlanId: savedPlan?.id,
        environmentId,
        caseKeys: savedPlan?.caseKeys,
        plan: wrappedPlan,
      })
      const execution = getExecutionById(result.id)
      return json(response, result.status === 'passed' ? 201 : 422, { execution })
    }

    if (request.method === 'POST' && request.url === '/api/analyze') {
      const body = await readJson(request)
      const rawFiles = Array.isArray(body.files)
        ? body.files
        : [{ fileName: body.fileName, content: body.content, role: 'prd' }]
      if (!rawFiles.length || rawFiles.length > 5) return json(response, 400, { error: '一次请选择 1-5 份需求材料' })
      const documents = rawFiles.map((item, index) => {
        if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 份材料格式错误`)
        const value = item as Record<string, unknown>
        const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : ''
        const content = typeof value.content === 'string' ? sanitizePrd(value.content) : ''
        const role = value.role === 'interface' ? 'interface' as const : 'prd' as const
        if (!fileName || !content) throw new Error(`第 ${index + 1} 份材料内容为空`)
        if (!/\.(md|markdown|txt)$/i.test(fileName)) throw new Error('当前支持 Markdown 和纯文本材料')
        return { fileName, content, role }
      })
      if (!documents.some(document => document.role === 'prd')) return json(response, 400, { error: '至少需要一份主 PRD' })

      const { result, model } = await analyzePrd(documents)
      const fileNames = documents.map(document => document.fileName)
      const saved = {
        id: randomUUID(),
        fileName: fileNames.join('、'),
        fileNames,
        sourceText: documents.map(document => document.content).join('\n\n---\n\n'),
        provider: 'deepseek',
        model,
        result,
        createdAt: new Date().toISOString(),
        review: { confirmedQuestions: [], selectedCases: [], updatedAt: null },
      }
      saveAnalysis(saved)
      return json(response, 201, { analysis: { ...saved, sourceText: undefined } })
    }

    const reviewMatch = request.url?.match(/^\/api\/analyses\/([^/]+)\/review$/)
    if (request.method === 'PATCH' && reviewMatch) {
      const body = await readJson(request)
      const confirmedQuestions = Array.isArray(body.confirmedQuestions) && body.confirmedQuestions.every(item => typeof item === 'string') ? body.confirmedQuestions : null
      const selectedCases = Array.isArray(body.selectedCases) && body.selectedCases.every(item => typeof item === 'string') ? body.selectedCases : null
      if (!confirmedQuestions || !selectedCases) return json(response, 400, { error: '评审状态格式错误' })
      return json(response, 200, { review: saveReview(decodeURIComponent(reviewMatch[1]), { confirmedQuestions, selectedCases }) })
    }

    return json(response, 404, { error: '接口不存在' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务处理失败'
    console.error('[api]', message)
    return json(response, 500, { error: message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[api] http://127.0.0.1:${port}`)
})
