import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * DSH 接口账本的**测试形态**：跑一遍 scripts/check-dsh-compat.mjs。
 *
 * 退出码约定：
 *   0 = 全部通过；1 = 有接口失配（真失败）；2 = 本机找不到 dsh（跳过，不应在无 dsh 的
 *   CI/容器里制造假失败）。
 *
 * 断言的是"账本还在"，不是我们自己的措辞——失配时按
 * docs/reference/dsh-surface-ledger.md 的"修复位置"改本仓 adapter，不要改探针。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('DSH 接口账本探针：上游扩展面未漂移', (t) => {
  const result = spawnSync(process.execPath, ['scripts/check-dsh-compat.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  })

  if (result.status === 2) {
    t.diagnostic('本机未安装 dsh，跳过接口账本核对（设置 DSH_PACKAGE_DIR 可启用）')
    return
  }

  assert.equal(
    result.status,
    0,
    `接口账本失配（exit ${result.status}）：\n${result.stdout}\n${result.stderr}\n` +
    '处理顺序：先读 docs/reference/dsh-surface-ledger.md 找到修复位置，再改本仓 adapter，不要改探针。',
  )
})

/**
 * 账本条目与探针必须一一对应。历史教训：账本与 `scripts/check-dsh-compat.mjs` 各写一份，
 * 新增接口时只改一边（账本加了条目但没写探针，或探针加了 id 但账本没登记），
 * 就会退化成"账本看起来很全、实际没人探"——正是账本要防的静默失效。
 * 这条守卫让"往账本里加一条不存在的探针 id"直接失败。
 */
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
