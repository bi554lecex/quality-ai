import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExecutionResult, PrdAnalysis, ReviewState, SavedAnalysis } from '../shared/contracts'

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
  CREATE TABLE IF NOT EXISTS analysis_reviews (
    analysis_id TEXT PRIMARY KEY,
    confirmed_questions_json TEXT NOT NULL DEFAULT '[]',
    selected_cases_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

const analysisColumns = database.prepare('PRAGMA table_info(analyses)').all() as Array<{ name: string }>
if (!analysisColumns.some(column => column.name === 'file_names_json')) {
  database.exec("ALTER TABLE analyses ADD COLUMN file_names_json TEXT NOT NULL DEFAULT '[]'")
}

export function saveAnalysis(input: {
  id: string
  fileName: string
  fileNames: string[]
  sourceText: string
  provider: string
  model: string
  result: PrdAnalysis
  createdAt: string
}) {
  database.prepare(`
    INSERT INTO analyses (id, file_name, file_names_json, source_text, provider, model, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.id, input.fileName, JSON.stringify(input.fileNames), input.sourceText, input.provider, input.model, JSON.stringify(input.result), input.createdAt)
}

export function getLatestAnalysis(): SavedAnalysis | null {
  const row = database.prepare(`
    SELECT a.id, a.file_name, a.file_names_json, a.provider, a.model, a.result_json, a.created_at,
           r.confirmed_questions_json, r.selected_cases_json, r.updated_at
    FROM analyses a
    LEFT JOIN analysis_reviews r ON r.analysis_id = a.id
    ORDER BY a.created_at DESC LIMIT 1
  `).get() as Record<string, string> | undefined

  if (!row) return null
  return {
    id: row.id,
    fileName: row.file_name,
    fileNames: JSON.parse(row.file_names_json || '[]') as string[],
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    result: JSON.parse(row.result_json) as PrdAnalysis,
    review: {
      confirmedQuestions: JSON.parse(row.confirmed_questions_json || '[]') as string[],
      selectedCases: JSON.parse(row.selected_cases_json || '[]') as string[],
      updatedAt: row.updated_at ?? null,
    },
  }
}

export function saveReview(analysisId: string, review: Omit<ReviewState, 'updatedAt'>): ReviewState {
  const exists = database.prepare('SELECT id FROM analyses WHERE id = ?').get(analysisId)
  if (!exists) throw new Error('解析记录不存在')
  const updatedAt = new Date().toISOString()
  database.prepare(`
    INSERT INTO analysis_reviews (analysis_id, confirmed_questions_json, selected_cases_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(analysis_id) DO UPDATE SET
      confirmed_questions_json = excluded.confirmed_questions_json,
      selected_cases_json = excluded.selected_cases_json,
      updated_at = excluded.updated_at
  `).run(analysisId, JSON.stringify(review.confirmedQuestions), JSON.stringify(review.selectedCases), updatedAt)
  return { ...review, updatedAt }
}

export function saveExecution(result: ExecutionResult) {
  database.prepare('INSERT INTO executions (id, name, status, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(result.id, result.name, result.status, JSON.stringify(result), result.startedAt)
}

export function getLatestExecution(): ExecutionResult | null {
  const row = database.prepare('SELECT result_json FROM executions ORDER BY created_at DESC LIMIT 1').get() as { result_json: string } | undefined
  return row ? JSON.parse(row.result_json) as ExecutionResult : null
}
