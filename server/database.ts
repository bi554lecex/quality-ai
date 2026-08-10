import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AutomationPlan, ExecutionResult, PrdAnalysis, ReviewState, SavedAnalysis, SavedAutomationPlan } from '../shared/contracts'

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
  CREATE TABLE IF NOT EXISTS automation_plans (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    case_keys_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
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

function mapAnalysisRow(row: Record<string, string> | undefined): SavedAnalysis | null {
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

const analysisSelect = `
  SELECT a.id, a.file_name, a.file_names_json, a.provider, a.model, a.result_json, a.created_at,
         r.confirmed_questions_json, r.selected_cases_json, r.updated_at
  FROM analyses a LEFT JOIN analysis_reviews r ON r.analysis_id = a.id
`

export function getLatestAnalysis(): SavedAnalysis | null {
  const row = database.prepare(`${analysisSelect}
    ORDER BY a.created_at DESC LIMIT 1
  `).get() as Record<string, string> | undefined
  return mapAnalysisRow(row)
}

export function getAnalysisById(id: string): SavedAnalysis | null {
  return mapAnalysisRow(database.prepare(`${analysisSelect} WHERE a.id = ?`).get(id) as Record<string, string> | undefined)
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

export function saveAutomationPlan(input: SavedAutomationPlan) {
  database.prepare('INSERT INTO automation_plans (id, analysis_id, case_keys_json, plan_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.id, input.analysisId, JSON.stringify(input.caseKeys), JSON.stringify(input.plan), input.createdAt)
}

export function getLatestAutomationPlan(): SavedAutomationPlan | null {
  const row = database.prepare('SELECT id, analysis_id, case_keys_json, plan_json, created_at FROM automation_plans ORDER BY created_at DESC LIMIT 1').get() as Record<string, string> | undefined
  if (!row) return null
  return { id: row.id, analysisId: row.analysis_id, caseKeys: JSON.parse(row.case_keys_json) as string[], plan: JSON.parse(row.plan_json) as AutomationPlan, createdAt: row.created_at }
}
