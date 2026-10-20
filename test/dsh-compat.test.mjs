import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs scripts/check-dsh-compat.mjs as a test. Exit 0 = pass, 1 = surface drift (real failure),
// 2 = dsh not found here → skipped, so CI/containers without dsh don't get a false failure.
// Drift means fix our adapter per docs/reference/dsh-surface-ledger.md, never the probe.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('DSH 接口账本探针：上游扩展面未漂移', (t) => {
  const result = spawnSync(process.execPath, ['scripts/check-dsh-compat.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  })

  if (result.status === 2) {
    // skip, not diagnostic+return: node:test records a returned test as pass, so "no dsh here"
    // (desktop harness lives in app.asar, probe can't read the package dir) would report all
    // green while checking nothing — exactly the silent failure this ledger exists to catch.
    t.skip('本机未定位到 dsh 包目录，接口账本**未核对**（设置 DSH_PACKAGE_DIR 可启用）')
    return
  }

  assert.equal(
    result.status,
    0,
    `接口账本失配（exit ${result.status}）：\n${result.stdout}\n${result.stderr}\n` +
    '处理顺序：先读 docs/reference/dsh-surface-ledger.md 找到修复位置，再改本仓 adapter，不要改探针。',
  )
})

// Ledger entries and probe ids must correspond 1:1: they live in two files, and adding an
// interface on one side only degrades into "the ledger looks complete, nothing is probed".
test('DSH 接口账本：条目与 check-dsh 探针一一对应（新增/改名必须两边同步）', () => {
  const ledger = readFileSync(join(ROOT, 'docs/reference/dsh-surface-ledger.md'), 'utf8')
  const script = readFileSync(join(ROOT, 'scripts/check-dsh-compat.mjs'), 'utf8')
  const sortIds = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const ledgerIds = sortIds([...ledger.matchAll(/^\|\s*(L\d+)\s*\|/gmu)].map((match) => match[1]))
  const probeIds = sortIds([...script.matchAll(/\bid:\s*'(L\d+)'/gu)].map((match) => match[1]))
  assert.ok(ledgerIds.length > 0, '账本里必须至少有一条接口条目')
  assert.deepEqual(
    ledgerIds,
    probeIds,
    '账本条目与 check-dsh 探针必须一一对应：新增接口时两边同改（只在账本加条目 = 没有探针；只在探针加 id = 没登记）',
  )
})
