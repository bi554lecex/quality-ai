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

export interface ReviewState {
  confirmedQuestions: string[]
  selectedCases: string[]
  updatedAt: string | null
}
