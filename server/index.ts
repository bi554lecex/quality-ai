import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { analyzePrd } from './model'
import { getLatestAnalysis, saveAnalysis } from './database'

const port = Number(process.env.API_PORT ?? 8787)
const maxBodySize = 2 * 1024 * 1024

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
    if (size > maxBodySize) throw new Error('PRD 文件不能超过 2MB')
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
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
      if (!fileName || !rawContent) return json(response, 400, { error: '文件名和 PRD 内容不能为空' })
      if (!/\.(md|markdown|txt)$/i.test(fileName)) return json(response, 415, { error: '第一版暂时支持 Markdown 和纯文本 PRD' })

      const content = sanitizePrd(rawContent)
      const { result, model } = await analyzePrd(fileName, content)
      const saved = {
        id: randomUUID(),
        fileName,
        sourceText: content,
        provider: 'deepseek',
        model,
        result,
        createdAt: new Date().toISOString(),
      }
      saveAnalysis(saved)
      return json(response, 201, { analysis: { ...saved, sourceText: undefined } })
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
