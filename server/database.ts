import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PrdAnalysis, SavedAnalysis } from '../shared/contracts'

const databasePath = resolve('data/quality-ai.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    source_text TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

export function saveAnalysis(input: {
  id: string
  fileName: string
  sourceText: string
  provider: string
  model: string
  result: PrdAnalysis
  createdAt: string
}) {
  database.prepare(`
    INSERT INTO analyses (id, file_name, source_text, provider, model, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.id, input.fileName, input.sourceText, input.provider, input.model, JSON.stringify(input.result), input.createdAt)
}

export function getLatestAnalysis(): SavedAnalysis | null {
  const row = database.prepare(`
    SELECT id, file_name, provider, model, result_json, created_at
    FROM analyses ORDER BY created_at DESC LIMIT 1
  `).get() as Record<string, string> | undefined

  if (!row) return null
  return {
    id: row.id,
    fileName: row.file_name,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    result: JSON.parse(row.result_json) as PrdAnalysis,
  }
}
