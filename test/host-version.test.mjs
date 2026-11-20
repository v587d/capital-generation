import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { VERIFIED_DSH_VERSION, detectDshVersion, unverifiedHostWarning } from '../lib/host-version.js'

// The gate that decides whether this package mounts lives in the host (`engines.dsh`), so this file
// only pins the two things the plugin owns: the window in package.json and the warn on an untested
// host. `check:dsh` L40 proves the host still honours `engines.dsh` over peers.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

test('支持窗口：engines.dsh 是唯一声明，两个 dsh peer 与它同区间', () => {
  const range = manifest.engines?.dsh
  assert.equal(typeof range, 'string', 'package.json 必须有 engines.dsh：2.29.0 起宿主只认它')
  assert.equal(
    range,
    `>=${VERIFIED_DSH_VERSION} <0.2.3-0`,
    `engines.dsh 必须以 VERIFIED_DSH_VERSION（${VERIFIED_DSH_VERSION}）为下界、只放行同一 minor`,
  )
  for (const name of ['@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-skill-filesystem']) {
    assert.equal(manifest.peerDependencies?.[name], range, `${name} 的 peer 必须与 engines.dsh 同区间：安装期与启动期各说一套会一装一拒`)
  }
})

test('挂载期告警：只对"检测得到、且不是验证基线"的宿主发出', () => {
  assert.equal(unverifiedHostWarning(VERIFIED_DSH_VERSION), undefined, '验证基线本身不许报警')
  assert.equal(unverifiedHostWarning(undefined), undefined, '检测不到宿主时静默：未知不等于不兼容')
  for (const host of ['0.2.2', '0.2.2-rc.6', '0.2.2-rc.7']) {
    const line = unverifiedHostWarning(host)
    assert.ok(line?.includes(host), `宿主 ${host} 应有一条点名版本的 warn`)
    assert.ok(line.includes(VERIFIED_DSH_VERSION), 'warn 必须同时给出本版验证基线')
  }
})

test('宿主版本检测：优先读入口脚本上方的 @deepseek-ai/dsh 清单', () => {
  // A fake host install whose version (9.9.9) differs from the peer link, so winning is visible.
  const fixture = mkdtempSync(join(tmpdir(), 'cg-host-'))
  const hostDir = join(fixture, 'dsh')
  mkdirSync(join(hostDir, 'lib'), { recursive: true })
  writeFileSync(join(hostDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
  const script = join(hostDir, 'lib', 'bin.js')
  const moduleUrl = pathToFileURL(join(ROOT, 'lib', 'host-version.js')).href
  writeFileSync(script, `import { detectDshVersion } from ${JSON.stringify(moduleUrl)}\nconsole.log(detectDshVersion() ?? '<undefined>')\n`)
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, `子进程失败：${result.stderr}`)
  assert.equal(result.stdout.trim(), '9.9.9', '入口脚本上方的 @deepseek-ai/dsh 必须胜过 peer 兜底')
})

test('宿主版本检测：入口不在宿主包里时回落到 dsh-skill peer', () => {
  const tweak = createRequire(join(ROOT, 'package.json'))
  const peerVersion = JSON.parse(readFileSync(tweak.resolve('@deepseek-ai/dsh-skill/package.json'), 'utf8')).version
  const fixture = mkdtempSync(join(tmpdir(), 'cg-host-fallback-'))
  const script = join(fixture, 'probe.js')
  const moduleUrl = pathToFileURL(join(ROOT, 'lib', 'host-version.js')).href
  writeFileSync(script, `import { detectDshVersion } from ${JSON.stringify(moduleUrl)}\nconsole.log(detectDshVersion() ?? '<undefined>')\n`)
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 0, `子进程失败：${result.stderr}`)
  assert.equal(result.stdout.trim(), peerVersion, '没有宿主入口时应回落到 peer 的版本')
})
