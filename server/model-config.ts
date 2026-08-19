export interface ModelConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function getModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  const apiKey = overrides.apiKey ?? process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置')
  return {
    apiKey,
    baseUrl: (overrides.baseUrl ?? process.env.MODEL_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, ''),
    model: overrides.model ?? process.env.MODEL_NAME ?? 'deepseek-v4-flash',
  }
}
