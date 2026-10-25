import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSessionRecords, findWorkspaceSessionRecords, latestSessionFile } from '../scripts/lib/session-files.mjs'

// `verify:sessions` needed a gate on its own gate: scripts/verify-sessions.mjs hardcoded
// `session.v3.jsonl.zstd` while the host writes `session.v4.jsonl.zstd` — no error ever, it read 0
// sessions and printed "检查 0 份会话 ✅", running green and empty from the format change onward.
// So every case below builds dirs from file names the current host really writes, not invented ones.

function store() {
  const root = mkdtempSync(join(tmpdir(), 'cg-sessions-'))
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  return { root: join(root, 'sessions'), cleanup }
}

const sessionDir = (root, id) => {
  const dir = join(root, '--home-user-project--', id)
  mkdirSync(dir, { recursive: true })
  return dir
}

test('findSessionRecords：认当前宿主写的 v4 文件名（硬编码 v3 时这里是 0 份）', () => {
  const { root, cleanup } = store()
  try {
    const a = sessionDir(root, 'session-aaaa')
    writeFileSync(join(a, 'session.v4.jsonl.zstd'), 'x')
    const records = findSessionRecords(root)
    assert.equal(records.length, 1, 'v4 会话必须被读到——曾经只找 v3，结果整代会话 invisible')
    assert.equal(records[0].id, 'session-aaaa')
    assert.equal(records[0].version, 4)
  } finally {
    cleanup()
  }
})

test('findSessionRecords：同一目录留了新旧两代时取版本号最大那份', () => {
  const { root, cleanup } = store()
  try {
    const both = sessionDir(root, 'session-upgraded')
    writeFileSync(join(both, 'session.v3.jsonl.zstd'), 'old')
    writeFileSync(join(both, 'session.v4.jsonl.zstd'), 'new')
    const records = findSessionRecords(root)
    assert.equal(records.length, 1, '一份会话只该出现一次，否则同一条被核对两遍')
    assert.ok(records[0].file.endsWith('session.v4.jsonl.zstd'), '必须读 v4：升级后 v3 是遗留副本')
    assert.equal(latestSessionFile(both).version, 4)
  } finally {
    cleanup()
  }
})

test('findSessionRecords：只认会话文件，锁文件与空文件都不算一份会话', () => {
  const { root, cleanup } = store()
  try {
    const lockOnly = sessionDir(root, 'session-empty-store')
    writeFileSync(join(lockOnly, 'session.lock'), '')
    const zeroed = sessionDir(root, 'session-zero-byte')
    writeFileSync(join(zeroed, 'session.v4.jsonl.zstd'), '')
    const good = sessionDir(root, 'session-good')
    writeFileSync(join(good, 'session.v4.jsonl.zstd'), 'payload')
    const records = findSessionRecords(root)
    assert.deepEqual(records.map((record) => record.id), ['session-good'],
      '锁文件、0 字节文件都不能被当成一份已核对的会话（否则"✅ 全部通过"是数出来的假绿）')
  } finally {
    cleanup()
  }
})

test('findSessionRecords：store 不存在或没有候选时返回空数组（调用方须报"没核对"而不是通过）', () => {
  assert.deepEqual(findSessionRecords(join(tmpdir(), 'cg-does-not-exist-at-all')), [])
  const { root, cleanup } = store()
  try {
    mkdirSync(root, { recursive: true })
    assert.deepEqual(findSessionRecords(root), [])
  } finally {
    cleanup()
  }
})


test('findWorkspaceSessionRecords：直接指向一个工作区时也能读到会话（报告脚本用它避免扫全库）', () => {
  const { root, cleanup } = store()
  try {
    const dir = sessionDir(root, 'session-scoped')
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x')
    const records = findWorkspaceSessionRecords(join(root, '--home-user-project--'))
    assert.equal(records.length, 1)
    assert.equal(records[0].id, 'session-scoped')
    assert.deepEqual(findWorkspaceSessionRecords(join(root, 'missing')), [])
  } finally {
    cleanup()
  }
})
