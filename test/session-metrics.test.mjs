import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { collectSessionMetrics, summarizeSession, totalsOf } from '../scripts/lib/session-metrics.mjs'
import { workspaceSlug } from '../scripts/lib/session-files.mjs'

/**
 * The Phase 6 observation tool must be honest about missing data: usage is `undefined` when the
 * host did not record it, never zero; empty workspaces are a visible skip (exit 1), not a pass.
 */
const events = [
  { type: 'session', version: 4, id: 'session-root01', createdAt: 1_700_000_000_000, cwd: '/workspace', agentPreset: 'capital-generation', origin: 'user', delegationDepth: 0 },
  { type: 'turn/start', time: 1_700_000_001_000 },
  {
    type: 'assistant/message',
    time: 1_700_000_002_000,
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '先建快照。' },
          { type: 'tool-call', name: 'create_analysis_snapshot' },
        ],
        source: { kind: 'model', provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      },
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 2300 },
    },
  },
  { type: 'tool/call', time: 1_700_000_003_000, data: { name: 'create_analysis_snapshot', arguments: '{}' } },
  {
    type: 'tool/result',
    time: 1_700_000_004_000,
    data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'analysis_input_invalid' }] } },
  },
  { type: 'tool/call', time: 1_700_000_005_000, data: { name: 'submit_analysis', arguments: '{}' } },
  { type: 'turn/end', time: 1_700_000_006_000, data: { reason: 'done' } },
]

test('summarizeSession：turns / tool 调用 / 错误 / usage / 模型都按事件求和', () => {
  const summary = summarizeSession(events)
  assert.equal(summary.id, 'session-root01')
  assert.equal(summary.preset, 'capital-generation')
  assert.equal(summary.turns, 1)
  assert.equal(summary.assistantMessages, 1)
  assert.equal(summary.toolCalls, 2)
  assert.equal(summary.toolErrors, 1)
  assert.deepEqual(summary.toolNames, { create_analysis_snapshot: 1, submit_analysis: 1 })
  assert.deepEqual(summary.models, ['opencode-go/deepseek-v4.1-flash'])
  assert.deepEqual(summary.usage, { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 2300, recorded: true })
  assert.equal(summary.durationMs, 5000)
  assert.equal(summary.finalAnswerChars, '先建快照。'.length)
})

test('summarizeSession：宿主没记录 usage 时是 undefined，不是 0（不许把缺失当零成本）', () => {
  const summary = summarizeSession([
    { type: 'session', version: 4, id: 'session-no-usage', createdAt: 1_700_000_000_000, agentPreset: 'capital-generation' },
    { type: 'assistant/message', time: 1_700_000_001_000, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'turn/end', time: 1_700_000_002_000, data: { reason: 'done' } },
  ])
  assert.equal(summary.usage, undefined)
  assert.equal(summary.durationMs, 1000)
})

async function writeSession(home, sessionId, lines) {
  const dir = join(home, 'sessions', workspaceSlug('/eval/ws'), sessionId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl')
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8')
  return file
}

test('collectSessionMetrics + totalsOf：按 workspace 找到会话并汇总，空 workspace 返回空数组', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cg-session-metrics-'))
  await writeSession(home, 'session-root01', events)
  await writeSession(home, 'session-child1', [
    { type: 'session', version: 4, id: 'session-child1', parentSession: 'session-root01', createdAt: 1_700_000_000_500, agentPreset: 'capital-data-collector', origin: 'subagent', delegationDepth: 1 },
    { type: 'turn/start', time: 1_700_000_001_500 },
    { type: 'tool/call', time: 1_700_000_002_500, data: { name: 'request_data' } },
  ])

  const sessions = collectSessionMetrics(home, '/eval/ws')
  assert.equal(sessions.length, 2)
  const root = sessions.find((session) => session.id === 'session-root01')
  assert.equal(root.preset, 'capital-generation')
  const child = sessions.find((session) => session.id === 'session-child1')
  assert.equal(child.parent, 'session-root01')
  assert.equal(child.depth, 1)

  const totals = totalsOf(sessions)
  assert.deepEqual(totals, {
    sessions: 2,
    turns: 2,
    toolCalls: 3,
    toolErrors: 1,
    usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 2300 },
  })

  assert.deepEqual(collectSessionMetrics(home, '/no/such/workspace'), [], '空 workspace 必须是空数组，由 CLI 报可见 skip')
})
