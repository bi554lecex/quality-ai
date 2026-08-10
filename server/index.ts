import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { analyzePrd } from './model'
import { getLatestAnalysis, saveAnalysis, saveReview } from './database'

const port = Number(process.env.API_PORT ?? 8787)
const maxBodySize = 10 * 1024 * 1024

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

    if (request.method === 'GET' && request.url === '/api/analyses/latest') {
      return json(response, 200, { analysis: getLatestAnalysis() })
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
