import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { SELECTED_SKILL_CATALOG } from '../selected-skills/catalog.js'
import {
  buildUsageTrees,
  extractSelectedSkillUsage,
  extractSkillCatalog,
  finalAssistantText,
  missingCitations,
  summarizeSession,
} from '../scripts/lib/skill-usage.mjs'

const CATALOG = new Set(SELECTED_SKILL_CATALOG.map(({ name }) => name))
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const rootEvents = [
  { type: 'session', id: 'session-root', agentPreset: 'capital-generation', createdAt: 1000 },
  { type: 'tool/call', data: { callId: 'c1', name: 'skill', arguments: '{"name":"china-dcf"}' } },
  {
    type: 'tool/result',
    data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '<skill_content ...>' }] } },
  },
  { type: 'tool/call', data: { callId: 'c2', name: 'skill', arguments: '{"name":"fact-check"}' } },
  {
    type: 'tool/result',
    data: { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'unknown skill' }] } },
  },
  { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'buffett-investment-framework' } } },
  {
    type: 'user/message',
    data: { source: { kind: 'skill-catalog', form: 'catalog', entries: [
      { name: 'china-dcf' }, { name: 'fact-check' }, { name: 'capital-data-protocol' },
    ] } },
  },
  { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'capital-data-protocol' } } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '旧答复' }] } } },
  {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '使用的方法：china-dcf 与 buffett-investment-framework。' }] } },
  },
]

const childEvents = [
  { type: 'session', id: 'child', parentSession: 'session-root', agentPreset: 'capital-data-junior', origin: 'subagent', createdAt: 1100 },
  {
    type: 'tool/ptc-dispatch',
    data: { name: 'skill', arguments: { name: 'financial-health' }, isError: false },
  },
  {
    type: 'tool/ptc-dispatch',
    data: { name: 'skill', arguments: '{"name":"china-dcf"}', isError: true },
  },
  { type: 'ptc-dispatch', data: { name: 'skill' } },
]

test('extractSelectedSkillUsage：只认成功加载的精选名，三种入口都覆盖', () => {
  const usage = extractSelectedSkillUsage([
    ...rootEvents,
    ...childEvents.slice(1),
  ], CATALOG)
  assert.deepEqual(usage, [
    { count: 1, name: 'buffett-investment-framework', via: ['user'], usedAt: 0 },
    { count: 1, name: 'china-dcf', via: ['tool'], usedAt: 0 },
    { count: 1, name: 'financial-health', via: ['ptc'], usedAt: 0 },
  ], '失败调用、内置协议名与未知事件都不入账')
})

test('extractSkillCatalog：读会话创建时的目录，不把协议名混进精选集合', () => {
  assert.deepEqual(extractSkillCatalog(rootEvents), ['china-dcf', 'fact-check', 'capital-data-protocol'])
  assert.deepEqual(extractSkillCatalog([]), [], '没有目录消息时返回空，不猜')
})

test('finalAssistantText：只取最后一个 turn 的答复，不把工具调用或旧轮次当答复', () => {
  assert.equal(finalAssistantText(rootEvents), '使用的方法：china-dcf 与 buffett-investment-framework。')
  assert.equal(finalAssistantText([
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '旧轮次点名了 fact-check' }] } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '新轮次还没点名' }] } } },
  ]), '新轮次还没点名', '上一轮的引用不能替本轮交差')
  assert.equal(finalAssistantText([{ type: 'assistant/message', data: { message: { content: [] } } }]), '')
  assert.equal(finalAssistantText([]), '')
  assert.deepEqual(missingCitations(['china-dcf', 'fact-check'], '只说 china-dcf'), ['fact-check'])
  assert.deepEqual(missingCitations(['catalyst-calendar'], '只点名 china-catalyst-calendar'),
    ['catalyst-calendar'], '短名是长名的子串，不能被当成已点名')
  assert.deepEqual(missingCitations(['catalyst-calendar'], '使用 `catalyst-calendar`'), [])
})

test('summarizeSession + buildUsageTrees：按 parentSession 归树，最终答复点名可审计', () => {
  const root = summarizeSession({ id: 'session-root', mtime: 2000, version: 4 }, rootEvents, CATALOG)
  const child = summarizeSession({ id: 'child', mtime: 2100, version: 4 }, childEvents, CATALOG)
  assert.equal(root.id, 'session-root')
  assert.equal(child.parentSession, 'session-root')

  const [tree] = buildUsageTrees([root, child])
  assert.equal(tree.root.id, 'session-root')
  assert.deepEqual(tree.sessions.map((session) => session.id).sort(), ['child', 'session-root'])
  assert.deepEqual(tree.skills.map((skill) => skill.name), ['buffett-investment-framework', 'china-dcf', 'financial-health'])
  assert.deepEqual(tree.finalAnswer, { cited: 2, total: 3, missing: ['financial-health'] },
    '子 Agent 加载但主 Agent 最终答复没点名的，必须落在 missing 里')
})

test('buildUsageTrees：父会话不在扫描窗口时，子会话自己成为根而不是消失', () => {
  const child = summarizeSession({ id: 'child', mtime: 2100, version: 4 }, childEvents, CATALOG)
  const [tree] = buildUsageTrees([child])
  assert.equal(tree.root.id, 'child')
  assert.deepEqual(tree.sessions.map((session) => session.id), ['child'])
})


test('buildUsageTrees：新用户轮次之前的加载不再要求本轮引用（与运行期清空一致）', () => {
  const events = [
    { type: 'session', id: 'session-turn', agentPreset: 'capital-generation', createdAt: 100 },
    { type: 'tool/call', time: 110, data: { callId: 'old', name: 'skill', arguments: '{"name":"china-dcf"}' } },
    { type: 'tool/result', time: 111, data: { message: { toolCallId: 'old', isError: false, content: [{ type: 'text', text: 'x' }] } } },
    { type: 'user/message', time: 200, data: { source: { kind: 'user' } } },
    { type: 'tool/call', time: 310, data: { callId: 'new', name: 'skill', arguments: '{"name":"fact-check"}' } },
    { type: 'tool/result', time: 311, data: { message: { toolCallId: 'new', isError: false, content: [{ type: 'text', text: 'x' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '本轮使用 fact-check。' }] } } },
  ]
  const summary = summarizeSession({ id: 'session-turn', mtime: 3000, version: 4 }, events, CATALOG)
  const [tree] = buildUsageTrees([summary])
  assert.deepEqual(tree.skills.map((skill) => skill.name), ['fact-check'], '上一轮的中国 DCF 不应再被要求引用')
  assert.deepEqual(tree.finalAnswer, { cited: 1, total: 1, missing: [] })
})


test('skill-usage-report CLI：--dir + --cwd 读真实会话文件并输出可审计 JSON', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'cg-skill-usage-'))
  try {
    const workspace = join(sandbox, 'sessions', '--workspace-proj--')
    const sessionDir = join(workspace, 'session-cli')
    mkdirSync(sessionDir, { recursive: true })
    const events = [
      { type: 'session', id: 'session-cli', agentPreset: 'capital-generation', createdAt: 1000 },
      { type: 'user/message', data: { source: { kind: 'skill-catalog', form: 'catalog', entries: [
        { name: 'china-dcf' }, { name: 'capital-data-protocol' },
      ] } } },
      { type: 'tool/call', time: 1010, data: { callId: 'c1', name: 'skill', arguments: '{"name":"china-dcf"}' } },
      { type: 'tool/result', time: 1011, data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'x' }] } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '使用的方法：china-dcf。' }] } } },
    ]
    writeFileSync(join(sessionDir, 'session.v4.jsonl'), events.map((event) => JSON.stringify(event)).join('\n'))
    const result = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'skill-usage-report.mjs'),
      '--dir', join(sandbox, 'sessions'),
      '--cwd', '/workspace/proj',
      '--json',
      '--catalog',
      '--latest', '1',
    ], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.trees.length, 1)
    assert.equal(report.trees[0].rootSession, 'session-cli')
    assert.deepEqual(report.trees[0].skills.map((skill) => skill.name), ['china-dcf'])
    assert.deepEqual(report.trees[0].finalAnswer, { cited: 1, total: 1, missing: [] })
    assert.deepEqual(report.trees[0].sessions[0].catalog, { total: 2, selected: 1, protocol: 1 },
      '--catalog 的 JSON 必须按精选 / 内置拆开')

    // Users copy the full `session-…` id; the filter must accept it as well as the bare prefix.
    const fullId = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'skill-usage-report.mjs'),
      '--dir', join(sandbox, 'sessions'),
      '--cwd', '/workspace/proj',
      '--session', 'session-cli',
      '--json',
    ], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(fullId.status, 0, fullId.stderr)
    assert.equal(JSON.parse(fullId.stdout).trees.length, 1)

    // `--strict` is the audit gate: a loaded method that the closing answer never names fails it.
    writeFileSync(join(sessionDir, 'session.v4.jsonl'), events.slice(0, -1).map((event) => JSON.stringify(event)).join('\n'))
    const strict = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'skill-usage-report.mjs'),
      '--dir', join(sandbox, 'sessions'),
      '--cwd', '/workspace/proj',
      '--strict',
      '--latest', '1',
    ], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(strict.status, 1, '有加载但最终答复没点名时 --strict 必须红')
    assert.match(strict.stdout, /缺：`china-dcf`/)

    // Without `--strict` the same report is diagnostic only.
    const relaxed = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'skill-usage-report.mjs'),
      '--dir', join(sandbox, 'sessions'),
      '--cwd', '/workspace/proj',
      '--json',
      '--latest', '1',
    ], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(relaxed.status, 0)
    assert.deepEqual(JSON.parse(relaxed.stdout).trees[0].finalAnswer, { cited: 0, total: 1, missing: ['china-dcf'] })
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
