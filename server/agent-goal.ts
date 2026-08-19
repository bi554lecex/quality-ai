import { agentTestGoalSchema, type AgentTestGoal, type SavedAnalysis } from '../shared/contracts'

export function buildAgentTestGoal(analysis: SavedAnalysis, caseKeys: string[], targetUrl: string): AgentTestGoal {
  const selectedCases = caseKeys.map(key => {
    const match = key.match(/^(\d+)-TC-(\d+)$/)
    const requirementIndex = match ? Number(match[1]) : -1
    const caseIndex = match ? Number(match[2]) : -1
    const requirement = analysis.result.requirements[requirementIndex]
    const testCase = requirement?.testCases[caseIndex]
    if (!requirement || !testCase) throw new Error(`测试用例不存在：${key}`)
    if (testCase.blockedByQuestion) throw new Error(`测试用例仍有待确认问题，不能执行：${key}`)
    return { key, requirement, testCase, requirementIndex, caseIndex }
  })

  const objective = selectedCases.map(({ key, requirement, testCase }) => [
    `[${key}] ${requirement.title} / ${testCase.title}`,
    `前置条件：${testCase.preconditions.length ? testCase.preconditions.join('；') : '无'}`,
    `操作步骤：${testCase.steps.join('；')}`,
    `预期结果：${testCase.expectedResult}`,
  ].join('\n')).join('\n\n')

  return agentTestGoalSchema.parse({
    name: selectedCases.length === 1 ? selectedCases[0].testCase.title : `${analysis.result.versionName} · ${selectedCases.length} 条用例`,
    targetUrl,
    objective,
    requiredAssertions: selectedCases.map(({ requirementIndex, caseIndex, testCase }) => ({
      id: `r${requirementIndex + 1}-tc${caseIndex + 1}`,
      description: testCase.expectedResult,
    })),
  })
}
