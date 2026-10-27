import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

test('host 行与官方 ui-schedule 共存：不 disabled、不注册官方身份', () => {
  const patch = yamlLoad(read('cordis.patch.yml').replace(/!!js\s+/g, ''))
  const rows = patch.flatMap((entry) => entry?.insert ?? [])
  const automation = rows.find((row) => row?.id === 'capital-automation')
  assert.ok(automation, 'cordis.patch.yml 必须有 capital-automation 行')
  assert.equal(automation.name, './automation/index.js', 'host 行必须是字面量相对路径')
  assert.ok(!rows.some((row) => row?.id === 'ui-schedule' && row?.disabled === true), '官方 ui-schedule 不得被 disabled')
  const text = read('cordis.patch.yml')
  for (const official of ['schedules', 'schedule-created']) {
    assert.equal(new RegExp(`id:\\s*${official}\\b`).test(text), false, `不能注册官方身份 ${official}`)
  }
})

test('automation/package.json 声明 web client、immediately、产物在 files 里', () => {
  const manifest = JSON.parse(read('automation/package.json'))
  assert.equal(manifest.name, '@v587d/capital-automation')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-workspace',
  ])
  for (const file of ['client.js', 'index.js', 'store.js', 'scheduler.js', 'workspaces.js']) {
    assert.ok(manifest.files.includes(file), `files 必须包含 ${file}`)
  }
  assert.ok(manifest.exports['./client'])
})

test('根 package.json 的 files / build 同时包含 automation', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.ok(manifest.files.includes('automation'))
  assert.match(manifest.scripts.build, /build:automation-client/)
  assert.equal(manifest.scripts['build:automation-client'], 'node scripts/build-automation-client.mjs')
})

test('client 产物是 ModuleLoader 包，只注册 Capital 自己的 main / sidebar key', () => {
  const client = read('automation/client.js')
  const source = read('automation/client.src.cjs')
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /id: ["']@v587d\/capital-automation["']/)
  assert.match(source, /const PANEL_ID = 'capital-automation'/)
  assert.match(source, /key: PANEL_ID/)
  assert.match(source, /id: PANEL_ID/)
  assert.doesNotMatch(client, /schedule-created/)
  assert.doesNotMatch(client, /tool\.call\.toolview|turnTail|sidebar\.right\.pane\.tab/)
  assert.doesNotMatch(source, /schedule-created|tool\.call\.toolview|turnTail|sidebar\.right\.pane\.tab/)
 })
