import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { projectConfigFileSchema, type ProjectConfig } from './types'

const defaultConfigPath = resolve('config/projects.local.json')

export async function loadProjectConfigs(configPath = process.env.PROJECTS_CONFIG_PATH ?? defaultConfigPath): Promise<ProjectConfig[]> {
  try {
    const content = await readFile(configPath, 'utf8')
    return projectConfigFileSchema.parse(JSON.parse(content)).projects
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT' && configPath === defaultConfigPath) return []
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`项目配置加载失败（${configPath}）：${message}`)
  }
}
