import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
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
