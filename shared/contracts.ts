import { z } from 'zod'

export const riskSchema = z.enum(['高风险', '中风险', '低风险'])
export const prioritySchema = z.enum(['P0', 'P1', 'P2'])

export const requirementAnalysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  risk: riskSchema,
  riskReason: z.string().min(1),
  businessRules: z.array(z.object({
    description: z.string().min(1),
    evidence: z.string().min(1),
  })).min(1),
  pageStates: z.array(z.object({
    trigger: z.string().min(1),
    initialState: z.string().min(1),
    interaction: z.string().min(1),
    expectedResult: z.string().min(1),
  })).min(1),
  questions: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    suggestion: z.string().min(1),
  })),
  testCases: z.array(z.object({
    title: z.string().min(1),
    type: z.enum(['主流程', '分支', '边界', '异常', '回归', '交互', '空数据', '数据契约']),
    priority: prioritySchema,
    preconditions: z.array(z.string()),
    steps: z.array(z.string()).min(1),
    expectedResult: z.string().min(1),
    blockedByQuestion: z.boolean(),
  })).min(1),
})

export const prdAnalysisSchema = z.object({
  versionName: z.string().min(1),
  productName: z.string().min(1),
  overview: z.string().min(1),
  requirements: z.array(requirementAnalysisSchema).min(1),
})

export type PrdAnalysis = z.infer<typeof prdAnalysisSchema>

export interface SavedAnalysis {
  id: string
  fileName: string
  fileNames: string[]
  provider: string
  model: string
  createdAt: string
  result: PrdAnalysis
  review: ReviewState
}

export interface AnalysisSummary {
  id: string
  versionName: string
  productName: string
  requirementCount: number
  questionCount: number
  confirmedQuestionCount: number
  testCaseCount: number
  selectedCaseCount: number
  provider: string
  model: string
  createdAt: string
}

export interface TestCaseAsset {
  id: string
  analysisId: string
  caseKey: string
  caseCode: string
  versionName: string
  productName: string
  requirementTitle: string
  requirementIndex: number
  title: string
  type: PrdAnalysis['requirements'][number]['testCases'][number]['type']
  priority: PrdAnalysis['requirements'][number]['testCases'][number]['priority']
  preconditions: string[]
  steps: string[]
  expectedResult: string
  blockedByQuestion: boolean
  selected: boolean
  createdAt: string
  lastExecutionStatus?: 'passed' | 'failed'
  lastExecutedAt?: string
}

export interface ReviewState {
  confirmedQuestions: string[]
  selectedCases: string[]
  updatedAt: string | null
}

export const locatorSchema = z.object({
  by: z.enum(['role', 'label', 'text', 'css']),
  value: z.string().min(1),
  name: z.string().optional(),
})

export const automationStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), path: z.string().min(1) }),
  z.object({ action: z.literal('click'), locator: locatorSchema }),
  z.object({ action: z.literal('fill'), locator: locatorSchema, value: z.string() }),
  z.object({ action: z.literal('expectText'), text: z.string().min(1) }),
  z.object({ action: z.literal('screenshot'), name: z.string().min(1) }),
])

export const automationPlanSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  steps: z.array(automationStepSchema).min(1).max(50),
})

export type AutomationPlan = z.infer<typeof automationPlanSchema>

export interface SavedAutomationPlan {
  id: string
  analysisId: string
  caseKeys: string[]
  createdAt: string
  plan: AutomationPlan
}

export interface TestEnvironment {
  id: string
  name: string
  baseUrl: string
  hasStorageState: boolean
  createdAt: string
  updatedAt: string
}

export const storageStateSchema = z.object({
  cookies: z.array(z.object({
    name: z.string(), value: z.string(), domain: z.string(), path: z.string(),
    expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict', 'Lax', 'None']),
  }).passthrough()),
  origins: z.array(z.object({
    origin: z.string().url(),
    localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
  })),
})

export interface ExecutionResult {
  id: string
  name: string
  targetUrl: string
  status: 'passed' | 'failed'
  startedAt: string
  finishedAt: string
  durationMs: number
  steps: Array<{ index: number; action: string; status: 'passed' | 'failed'; durationMs: number; error?: string }>
  screenshots: string[]
  tracePath?: string
  error?: string
}

export interface ExecutionRecord extends ExecutionResult {
  analysisId?: string
  automationPlanId?: string
  environmentId?: string
  caseKeys: string[]
  plan?: AutomationPlan
  versionName?: string
  productName?: string
  environmentName?: string
  rerunOf?: string
}
