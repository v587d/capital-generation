// data_junior is the only PTC preset: `run_code` replaces its shell, and the native wording in
// persona/skills must not drift back. Mounting is proven by smoke:boot; this file pins the contract.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allPresets, allRowsOf, rolePersona } from './preset-rows.mjs'
import { ROOT_AGENT_DENIED_TOOLS } from '../lib/agents/root-tool-policy.js'
import { CAPITAL_ROW_TOOLS } from './family-rows.mjs'

const PRESENTATION = '@deepseek-ai/dsh-agent-tool-presentation'
const JUNIOR = 'capital-data-junior'
const SHELL_ROWS = /^@deepseek-ai\/dsh-tool-(bash|pwsh)$/

const SKILL = (name) => fileURLToPath(new URL(`../preset/capital-generation/skills/${name}/SKILL.md`, import.meta.url))
const readSkill = (name) => readFileSync(SKILL(name), 'utf8')
const compact = (value) => value.replace(/\s+/g, '')
const assertRule = (text, pattern, message) =>
  assert.ok(new RegExp(compact(pattern.source), pattern.flags).test(compact(text)), message ?? `未匹配：${pattern}`)
const assertNoRule = (text, pattern, message) =>
  assert.ok(!new RegExp(compact(pattern.source), pattern.flags).test(compact(text)), message ?? `不应匹配：${pattern}`)
const frontmatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? ''

const presentationRows = (preset) => allRowsOf(preset.config.id)
  .filter((row) => row?.name === PRESENTATION)
const shellRows = (preset) => allRowsOf(preset.config.id)
  .filter((row) => SHELL_ROWS.test(row?.name ?? ''))

test('presentation：只有 data_junior 有 tool-presentation，且 mode 恰好是 ptc', () => {
  const owners = allPresets()
    .filter((preset) => preset.disabled !== true)
    .filter((preset) => presentationRows(preset).length > 0)
    .map((preset) => preset.config.id)
  assert.deepEqual(owners, [JUNIOR],
    '一颗 agent 只能一种呈现方式；把 ptc 挂到别的 preset 等于给主 Agent / 其他角色开万能执行面')

  const junior = allPresets().find((preset) => preset?.config?.id === JUNIOR)
  assert.ok(junior, '必须存在 data_junior preset')
  const rows = presentationRows(junior)
  assert.equal(rows.length, 1, '同一颗 preset 只能声明一次 presentation')
  assert.equal(rows[0].id, 'tool-presentation', '行 id 保持 tool-presentation：装配探针与文档都点名它')
  assert.deepEqual(rows[0].config, { mode: 'ptc' }, 'presentation 行只允许 mode 一个配置键（runtime 由宿主提供）')
  assert.equal(junior.config.plugins.some((row) => row?.config?.systemPrompt?.toolOrder !== undefined), false,
    'ptc 下不能再配 systemPrompt.toolOrder 指向原生工具名')
})

test('shell：junior 两颗 shell 行都删掉，主 Agent 仍成对挂载', () => {
  for (const preset of allPresets()) {
    const rows = shellRows(preset)
    if (preset.config.id === JUNIOR) {
      assert.equal(rows.length, 0, 'data_junior 只能有 run_code 一个执行面：保留 shell 会让 SDK 主动塞 tools.bash 示例')
      continue
    }
    if (rows.length > 0) assert.equal(rows.length, 2, `${preset.config.id} 的 shell 行必须成对：只挂一颗等于另一平台没有执行器`)
  }
})

test('junior 仍是叶子 + 出图委派：PTC 不改工具面与 barrier', () => {
  const rows = allRowsOf(JUNIOR)
  const delegations = rows.filter((row) => row?.name === '@deepseek-ai/dsh-tool-subagent').map((row) => row.config?.toolName)
  assert.deepEqual(delegations, ['subagent_visualization_specialist'], 'junior 只保留出图委派；PTC 不是新的委派出口')
  for (const rowName of ['@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-tool-subagent-control']) {
    assert.ok(rows.some((row) => row?.name === rowName), `junior 必须仍挂 ${rowName}：协议加载与回传都靠它`)
  }
  // run_code is a framework transport, not one of our family tools: it must not leak into row contracts.
  for (const names of Object.values(CAPITAL_ROW_TOOLS)) assert.ok(!names.includes('run_code'), 'run_code 不属于任何族行')
  assert.ok(!ROOT_AGENT_DENIED_TOOLS.includes('run_code'),
    'run_code 是保留名：restrict() 点名会抛错，根侧不可见只靠“部署级 tools.mode 保持 native”')
})

test('junior persona：program discipline 覆盖直接取值、打印协议、回传与禁区', () => {
  const persona = rolePersona(JUNIOR)
  assert.ok(persona.length < 2760, `data_junior persona 过长（${persona.length} 字符）`)
  for (const pattern of [
    /PROGRAM DISCIPLINE/, /run_code/, /console\.log\(s\.content\)/, /Promise\.all/,
    /字段直接取|不手抄/, /变化量|增幅|CAGR/, /tools\.send_message/, /tools\.describe_dataset/,
    /不读文件|capital-data/, /不 fetch/, /sandbox_permissions/, /data_gap/, /只返回结论/,
  ]) assertRule(persona, pattern, `junior persona 缺少 PTC 要点：${pattern}`)
  assertNoRule(persona, /BASH DISCIPLINE|同一条消息|bash 只做纯计算/, 'junior persona 不得残留 native/bash 写法')
})

test('skills：数据协议把批量执行写进同一个 run_code 程序，不接受裸 native 调用', () => {
  const profile = readSkill('capital-data-profile')
  assertRule(profile, /同一个 `run_code` 程序/, 'profile §3.0 必须写同一个程序')
  assertRule(profile, /Promise\.all/, 'profile §3.0 必须写 Promise.all')
  assertRule(profile, /tools\.send_message/, 'profile §3.1 的 data_gap 必须给 tools.send_message')
  assertNoRule(profile, /同一条 assistant 消息里一次发完/, 'profile 不得残留“同一条消息”批量写法')

  const query = readSkill('capital-data-query')
  assert.match(frontmatter(query), /run_code programs/, 'query frontmatter 的 description 必须写 run_code')
  assert.doesNotMatch(frontmatter(query), /bash channel/, 'query frontmatter 不得再写 bash channel')
  assertRule(query, /## 3\.3 run_code/, 'query §3.3 标题必须是 run_code')
  assertRule(query, /tools\.describe_dataset/, 'query 示例必须用 tools.* 绑定')
  assertRule(query, /只返回结论/, 'query 必须要求只返回结论')
  assertRule(query, /不整行复制/, 'query 必须禁止整行复制到程序')
  assertRule(query, /只有 data_junior 有 `run_code`/, 'query 必须写明角色边界：主 Agent 只读格式')

  const viz = readSkill('capital-visualization-protocol')
  assertRule(viz, /tools\.prepare_chart_source/, '可视化协议必须写 tools.prepare_chart_source')
  assertRule(viz, /tools\.subagent_visualization_specialist/, '可视化协议必须写 tools.subagent_visualization_specialist')
  assertRule(viz, /specialist 是 native/, '可视化协议必须写明 specialist 仍是 native')
  // Gate states and barrier are presentation-independent: no PTC edit may rename or drop them.
  for (const pattern of [/not_needed/, /recommended/, /blocked/, /failed/, /出图 barrier/, /prepare_chart_source/, /chart_ref/]) {
    assertRule(viz, pattern, `可视化协议的 gate / barrier 被改动了：${pattern}`)
  }
})
