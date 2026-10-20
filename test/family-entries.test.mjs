import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as collectEntry from '../lib/collect-entry.js'
import * as datasetReadEntry from '../lib/dataset-read-entry.js'
import * as chartSourceEntry from '../lib/chart-source-entry.js'
import * as chartRenderEntry from '../lib/chart-render-entry.js'
import * as searchEntry from '../lib/search-entry.js'
import * as sourcesEntry from '../lib/sources-entry.js'
import * as ocrEntry from '../lib/ocr-entry.js'
import * as timeEntry from '../lib/time-entry.js'
import * as watchlistEntry from '../lib/watchlist-entry.js'
import * as rootExtrasEntry from '../lib/root-extras-entry.js'
import { CAPITAL_ROW_TOOLS, rowTools } from './family-rows.mjs'
import { allPresets, capitalRowsOf } from './preset-rows.mjs'
import { DATASET_READING_PRESET_IDS } from '../lib/preset-ids.js'

// D0 row contract: which names one row registers on the code side.
// Expectations live only in test/family-rows.mjs — restating them here would red just one side when
// an entry changes (AGENTS.md §9.7). persona.test.mjs checks that same table against the YAML presets.

function fakeCtx({ settings } = {}) {
  const tools = []
  const provided = []
  const sections = []
  const systemPrompt = { section: (section) => { sections.push(section); return () => {} } }
  const ctx = {
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            tools.push(definition)
            return () => {}
          },
        }
      }
      if (name === 'settings') return settings
      if (name === 'systemPrompt') return systemPrompt
      return undefined
    },
    systemPrompt,
    provide(name, value) {
      provided.push({ name, value })
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  }
  return { ctx, tools, provided, sections }
}

const namesOf = (apply, options) => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, options)
  return tools.map((definition) => definition.name).sort()
}

const ENTRIES = {
  '@v587d/capital-generation/tools/collect': collectEntry,
  '@v587d/capital-generation/tools/dataset-read': datasetReadEntry,
  '@v587d/capital-generation/tools/chart-source': chartSourceEntry,
  '@v587d/capital-generation/tools/chart-render': chartRenderEntry,
  '@v587d/capital-generation/tools/retrieve-search': searchEntry,
  '@v587d/capital-generation/tools/retrieve-sources': sourcesEntry,
  '@v587d/capital-generation/tools/ocr': ocrEntry,
  '@v587d/capital-generation/tools/time': timeEntry,
  '@v587d/capital-generation/tools/watchlist': watchlistEntry,
  '@v587d/capital-generation/tools/root-extras': rootExtrasEntry,
}

// Row name -> that row's entry apply(), i.e. the package export the YAML mounts.
const APPLIERS = Object.fromEntries(Object.entries(ENTRIES).map(([rowName, entry]) => [rowName, entry.apply]))
const applyTime = timeEntry.apply
const applySources = sourcesEntry.apply
const applyDatasetRead = datasetReadEntry.apply
const applyRootExtras = rootExtrasEntry.apply

test('每一族入口只注册自己那几颗名字，别的族一颗都不带', () => {
  for (const [rowName, expected] of Object.entries(CAPITAL_ROW_TOOLS)) {
    const apply = APPLIERS[rowName]
    assert.ok(typeof apply === 'function', `${rowName} 写在行契约里却没有对应实现：YAML 挂上它就会装载失败`)
    assert.deepEqual(namesOf(apply), [...expected].sort(),
      `${rowName} 注册的名字与行契约不一致：这一行多带/少带工具，挂它的那颗 preset 就跟着变`)
  }
})

test('YAML 组合 × 真实入口：每颗 preset 注册的工具等于所挂族行契约的并集', () => {
  for (const preset of allPresets()) {
    const rows = capitalRowsOf(preset.config.id)
    const expected = [...new Set(rows.flatMap((row) => CAPITAL_ROW_TOOLS[row.name] ?? []))].sort()
    const { ctx, tools } = fakeCtx()
    for (const row of rows) {
      const entry = ENTRIES[row.name]
      assert.ok(entry, `${preset.config.id} 挂了没有实现的族行 ${row.name}`)
      entry.apply(ctx)
    }
    assert.deepEqual(tools.map((definition) => definition.name).sort(), expected,
      `${preset.config.id} 的 YAML 组合与入口注册面不一致`)
  }
})

test('Dataset 读面授权集合与挂载行一致：挂 dataset-read 的 preset 全部放行', () => {
  const mounted = allPresets()
    .filter((preset) => capitalRowsOf(preset.config.id).some((row) => row.name.endsWith('/dataset-read')))
    .map((preset) => preset.config.id)
    .sort()
  assert.deepEqual(mounted, [...DATASET_READING_PRESET_IDS].sort(),
    '挂了 dataset-read 却不在授权集合里，等于工具可见但一调用就拒绝')
})

test('行契约没有漏网：package.json 的 tools/* 导出与表一一对应', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const exported = Object.keys(pkg.exports ?? {}).filter((key) => key.startsWith('./tools/')).sort()
  const contracted = Object.keys(CAPITAL_ROW_TOOLS).map((name) => `./tools/${name.split('/tools/')[1]}`).sort()
  // Both directions matter: an extra export = a new entry outside regression guard (§9.3); an extra
  // table row = the YAML mounts a package export that does not exist.
  assert.deepEqual(exported, contracted, '新增/删除族行必须同时改 package.json 与 test/family-rows.mjs')
  for (const [rowName, apply] of Object.entries(APPLIERS)) {
    assert.ok(exported.includes(`./tools/${rowName.split('/tools/')[1]}`), `${rowName} 有实现但没导出`)
    assert.ok(typeof apply === 'function', `${rowName} 导出了却没有实现`)
  }
})

test('tools/time：两颗一组，没有行成员开关', () => {
  assert.deepEqual(namesOf(applyTime), ['get_local_datetime', 'resolve_data_time_range'])
  // Generic capabilities are not trimmed per role: telling the time and resolving a window are two needs.
  assert.deepEqual(rowTools('@v587d/capital-generation/tools/time'), ['get_local_datetime', 'resolve_data_time_range'])
  assert.throws(() => rowTools('@v587d/capital-generation/tools/time', { localDatetime: false }), /没人读的 config/,
    'YAML 里再写一格开关，组合断言先红——那正是"以为裁了、其实没裁"的形状')
})

test('tools/dataset-read：write_profile 不在这颗默认行上（junior 的旧边界不退化）', () => {
  assert.ok(!namesOf(applyDatasetRead).includes('write_profile'), 'write_profile 只在单体入口里注册，族行默认关')
})

test('tools/retrieve-sources：本地直连开关关掉也照样注册（失败留到调用期点名）', () => {
  // §9.7 shape: registering fewer tools from assembly-time config pins one read for the whole process.
  const { ctx, tools } = fakeCtx({
    settings: { describe: () => [{ ns: 'capital-config', value: { retriever: { localFetch: { enabled: false } } } }] },
  })
  applySources(ctx)
  assert.deepEqual(tools.map((definition) => definition.name).sort(),
    [...CAPITAL_ROW_TOOLS['@v587d/capital-generation/tools/retrieve-sources']].sort(),
    '开关关掉时九颗仍在目录里（调用期响亮失败），工具面不许随配置变形')
})

test('tools/root-extras：不带任何工具（在场配置，不是工具面）', () => {
  const { ctx, tools } = fakeCtx()
  applyRootExtras(ctx)
  assert.deepEqual(tools.map((definition) => definition.name), [], '这一行注册工具就等于又开出一个入口')
})

test('族行入口声明自己读取的服务：工具行等 tools，root-extras 等 systemPrompt', () => {
  for (const [rowName, entry] of Object.entries(ENTRIES)) {
    assert.deepEqual(entry.inject, rowName.endsWith('/root-extras') ? ['systemPrompt'] : ['tools'],
      `${rowName} 的 inject 与它读取的服务不一致`)
  }
})
