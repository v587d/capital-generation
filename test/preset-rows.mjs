/**
 * 预设装配行（`preset/capital-generation/agent.patch.yml`）的**唯一**读取器。
 *
 * 0.1.7 起预设是一条 `@deepseek-ai/dsh-agent-preset` 声明行，子插件内联在
 * `config.plugins` 里（旧的 `agent.cordis.yml` 行数组 + registry `config.roots`
 * 目录式注册已被上游删除，见 docs/dev/preset-persona.md §8.1）。persona 体积闸门、
 * 研发文档外泄检查、装配断言都要读这同一份形状——各自解析一遍的话，改文件形状时
 * 漏掉的那处只会表现为「断言集体失配」，不会告诉你是路径没了。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

const PATCH = fileURLToPath(new URL('../preset/capital-generation/agent.patch.yml', import.meta.url))

/** patch 文件原文（`!!js` 保留，供需要核对表达式形状的断言用）。 */
export const PRESET_PATCH_TEXT = readFileSync(PATCH, 'utf8')

/** 声明预设那一行的 `config`（`id` / `name` / `description` / `plugins`）。 */
export function presetDeclaration(patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  const declared = patch
    .flatMap((entry) => entry?.insert ?? [])
    .find((row) => row?.name === '@deepseek-ai/dsh-agent-preset')
  if (!declared) throw new Error('agent.patch.yml 里没有 @deepseek-ai/dsh-agent-preset 声明行')
  return declared.config
}

/** `config.plugins` 行数组——旧 `agent.cordis.yml` 的顶层数组就是它。 */
export function presetRows() {
  const plugins = presetDeclaration().plugins
  if (!Array.isArray(plugins)) throw new Error('预设声明的 config.plugins 必须是行数组')
  return plugins
}
