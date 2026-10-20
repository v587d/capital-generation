#!/usr/bin/env node
/**
 * Boot smoke: builds a scratch profile in the workspace and really starts dsh. `--dump-config`
 * evaluates no `!!js` and imports no row, so a bad row passes the dump and still keeps the whole web
 * profile down. Runs with `--port 0 --no-open`, an in-boot probe, and a negative control.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locateDshCli } from './lib/run-tool.mjs'
// Assembly rows come from test/preset-rows.mjs (ledger L17), never a second list.
import { allPresets, capitalRowsOf } from '../test/preset-rows.mjs'
import { INTERNAL_ROLE_PRESET_IDS, ROLE_PRESET_IDS, ROOT_PRESET_ID } from '../lib/preset-ids.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SANDBOX = join(ROOT, '.tmp-boot')
const TIMEOUT_MS = 90_000

/** dsh entry script, no shell: the `dsh` .cmd shim gives ENOENT, `dsh.cmd` gives EINVAL. Exit 2 if missing. */
const DSH_CLI = locateDshCli()
if (DSH_CLI === undefined) {
  console.error('smoke-boot: 定位不到 dsh 入口（<包根>/lib/bin.js）。')
  console.error('  把已安装的 @deepseek-ai/dsh 包目录写进 DSH_PACKAGE_DIR 后重试，例如：')
  console.error('  DSH_PACKAGE_DIR=$(dirname $(dirname $(readlink -f $(which dsh)))) npm run smoke:boot')
  process.exit(2)
}

/** Preset identity and settings entry id must match agent.patch.yml and config/index.js verbatim. */
const PRESET_ID = 'capital-generation'
const SETTINGS_ENTRY_ID = 'capital-config'
/** Bundle name from package.json: the plugin panel lists bundles by this name. */
const PACKAGE_NAME = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
/**
 * Family rows come from agent.patch.yml via test/preset-rows.mjs; only fiberState is checked. A
 * drifted row logs one warn and silently drops a whole tool family for that role.
 */
const FAMILY_ROWS_BY_PRESET = Object.fromEntries(
  allPresets()
    .filter((preset) => preset.disabled !== true)
    .map((preset) => [preset.config.id, capitalRowsOf(preset.config.id).map((row) => row.id)]),
)
/** The selector must show the three standalone modes and hide the two delegation-only roles. */
const VISIBLE_PRESET_IDS = [ROOT_PRESET_ID, ROLE_PRESET_IDS.collector, ROLE_PRESET_IDS.retriever]
const INTERNAL_PRESET_IDS = [...INTERNAL_ROLE_PRESET_IDS]
/** `__DSH_BOOT__` keys by package name: derive it from package.json, never hardcode the directory name. */
const CLIENT_BUNDLES = [
  { dir: 'chart-ui', label: '图表客户端 bundle' },
  { dir: 'config', label: 'settings 卡片 bundle' },
  { dir: 'watchlist', label: '自选股客户端 bundle' },
].map((entry) => ({ ...entry, id: JSON.parse(readFileSync(join(ROOT, entry.dir, 'package.json'), 'utf8')).name }))

/** Probe marker line; the parent process keys off it. */
const PROBE_MARKER = 'capital-boot-probe: '

/** Failure signatures: loader rows, preset rows, listening, and boot-time crashes. */
const FAILURE_PATTERNS = [
  /failed to import loader entry/i,
  /did not activate/i,
  /published process-global service/i,
  /ClientPackageCompositionError/,
  /client-modules:/,
  /failed to (?:boot|listen|initialize)/i,
  ...PRESET_FAILURE_PATTERNS(),
]

/** Registry preset failure: `agent preset <id>: <reason>` logs once in a warn and boot still succeeds. */
function PRESET_FAILURE_PATTERNS() {
  return [
    /agent preset \S+:/,
    /Unknown agent preset/i,
    /Duplicate agent preset/i,
  ]
}
const SUCCESS_PATTERN = /https?:\/\/[^\s]+/

/**
 * Confirms each client bundle really reached the boot graph. browserAuth 302s a `?token=` request to
 * a clean `/` and sets a cookie; later requests need that cookie or get 401. Node's fetch has no
 * cookie jar, so do the one handshake by hand.
 */
async function fetchIndex(url) {
  const signal = AbortSignal.timeout(15_000)
  const first = await fetch(url, { redirect: 'manual', signal })
  if (first.status < 300 || first.status >= 400) return first
  const location = first.headers.get('location')
  if (location === null) return first
  const cookies = typeof first.headers.getSetCookie === 'function'
    ? first.headers.getSetCookie()
    : [first.headers.get('set-cookie')].filter(Boolean)
  const cookie = cookies.map((value) => String(value).split(';')[0]).join('; ')
  const followed = await fetch(new URL(location, url).href, { headers: cookie.length > 0 ? { cookie } : {}, signal })
  // No cookie jar in Node's fetch: attach the cookie to the response for reuse in later probes.
  followed.cookie = cookie
  return followed
}

/**
 * Live fence check for the watchlist prefix route (anonymous 401, cookie 200) — the only runtime
 * proof that the route wires requestRejection; unit tests use a fake authorize.
 */
async function watchlistFenceProbe(url, cookie) {
  const signal = AbortSignal.timeout(15_000)
  const origin = new URL(url).origin
  const target = `${origin}/capital-watchlist/list`
  const anonymous = await fetch(target, { signal })
  const authed = await fetch(target, { headers: cookie.length > 0 ? { cookie } : {}, signal })
  let items = null
  let cause = null
  try {
    const payload = JSON.parse(await authed.text())
    items = payload?.items?.length ?? null
    cause = payload?.code ? `${payload.code}${payload.cause ? `：${payload.cause}` : ''}` : null
  } catch {
    items = null
    cause = '回包不是 JSON'
  }
  return { anonymousStatus: anonymous.status, status: authed.status, items, cause, cacheControl: authed.headers.get('cache-control') }
}

/**
 * Live fence and closed-set check for /capital-skills: anonymous 401, an uncatalogued or encoded
 * `../` name 404, and a hit returns real frontmatter.
 */
async function skillDocFenceProbe(url, cookie, skillName) {
  const signal = AbortSignal.timeout(15_000)
  const origin = new URL(url).origin
  const target = `${origin}/capital-skills/${encodeURIComponent(skillName)}.md`
  const headers = cookie.length > 0 ? { cookie } : {}
  const anonymous = await fetch(target, { signal })
  const authed = await fetch(target, { headers, signal })
  const body = authed.ok ? await authed.text() : ''
  const missing = await fetch(`${origin}/capital-skills/not-a-catalogued-skill.md`, { headers, signal })
  const traversal = await fetch(`${origin}/capital-skills/${encodeURIComponent('../../package.json')}.md`, { headers, signal })
  let missingError = null
  try {
    missingError = (await missing.json())?.error ?? null
  } catch {
    missingError = '回包不是 JSON'
  }
  return {
    anonymousStatus: anonymous.status,
    status: authed.status,
    cacheControl: authed.headers.get('cache-control'),
    bytes: body.length,
    startsWithFrontMatter: body.startsWith('---'),
    missingStatus: missing.status,
    missingError,
    traversalStatus: traversal.status,
  }
}

function skillFenceOk(fence) {
  return fence !== undefined && fence.anonymousStatus === 401 && fence.status === 200
    && fence.cacheControl === 'no-store' && fence.startsWithFrontMatter && fence.bytes > 200
    && fence.missingStatus === 404 && fence.missingError === 'skill_not_catalogued'
    && fence.traversalStatus === 404
}

async function bootGraphHasCapitalBundles(url) {
  try {
    const response = await fetchIndex(url)
    const html = await response.text()
    const hasBundles = Object.fromEntries(CLIENT_BUNDLES.map((bundle) => [bundle.id, html.includes(bundle.id)]))
    return { fetched: true, hasBundles, status: response.status, bytes: html.length, cookie: response.cookie ?? '' }
  } catch (error) {
    return { fetched: false, hasBundles: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

/** One plain host-plane probe row, written into the scratch profile so it dies with it. */
function probeSource() {
  return [
    `// smoke-boot 的一次性探针（由 scripts/smoke-boot.mjs 生成，不属于发布物）。`,
    `const MARKER = ${JSON.stringify(PROBE_MARKER)}`,
    `const PRESET_ID = ${JSON.stringify(PRESET_ID)}`,
    `const ENTRY_ID = ${JSON.stringify(SETTINGS_ENTRY_ID)}`,
    `const BUNDLE_NAME = ${JSON.stringify(PACKAGE_NAME)}`,
    ``,
    `function report(payload) {`,
    `  console.log(MARKER + JSON.stringify(payload))`,
    `}`,
    ``,
    `async function attempt(ctx) {`,
    `  const result = { preset: null, broken: null, entry: null, localFetchEnabled: null, rows: null, presetRows: null, rolePresets: null, remoteRoster: null, familyRows: null, hostRuntime: null, identityGuards: null, problems: [] }`,
    `  try {`,
    `    const agentPresets = ctx.get('agentPresets')`,
    `    if (!agentPresets) result.problems.push('agentPresets 服务未提供')`,
    `    else {`,
    `      const record = await agentPresets.resolve(PRESET_ID)`,
    `      result.preset = record?.id ?? null`,
    `      result.broken = record?.broken ?? null`,
    `      if (record?.id !== PRESET_ID) result.problems.push('预设未注册：resolve(' + PRESET_ID + ') 返回 ' + String(record?.id))`,
    `      else if (record.broken) result.problems.push('预设激活失败：' + record.broken)`,
    `      const composition = (await agentPresets.compositionInventory()).find((item) => item.id === PRESET_ID)`,
    `      // tool-fs 是 2026-10-15 新增行（主 Agent 的 read 通道）：挂载检查必须点名新增行 active`,
    `      const required = ['persona', 'tool-subagent-data-collector', 'tool-subagent-data-junior', 'tool-fs']`,
    `      result.presetRows = required.map((id) => ({ id, state: composition?.rows?.find((row) => row.entryId === id)?.fiberState ?? null }))`,
    `      for (const row of result.presetRows) if (row.state !== 2) result.problems.push('预设子行未激活：' + row.id + '（fiberState=' + row.state + '）')`,
    `      if (composition?.rows?.some((row) => row.entryId === 'capital-generation')) result.problems.push('根 preset 仍然挂着单体 capital-generation 行')`,
    `      // phase-1 spike：所有 Capital preset 都要能激活。`,
    `      const roster = await agentPresets.list()`,
    `      result.rolePresets = []`,
    `      for (const item of roster) {`,
    `        if (typeof item.id !== 'string' || !item.id.startsWith('capital-') || item.id === PRESET_ID) continue`,
    `        const role = await agentPresets.resolve(item.id)`,
    `        result.rolePresets.push({ id: item.id, broken: role?.broken ?? null })`,
    `        if (role?.broken) result.problems.push('角色预设激活失败：' + item.id + '：' + role.broken)`,
    `      }`,
    `      // 新会话选择器走 remoteExportList（remote 方法 agentPresets/list），不是 list()：`,
    `      // 内部角色必须从远端名单消失，但 list()/resolve() 仍要全量给委派与诊断用。`,
    `      const VISIBLE_PRESET_IDS = ${JSON.stringify(VISIBLE_PRESET_IDS)}`,
    `      const INTERNAL_PRESET_IDS = ${JSON.stringify(INTERNAL_PRESET_IDS)}`,
    `      if (typeof agentPresets.remoteExportList !== 'function') {`,
    `        result.problems.push('agentPresets.remoteExportList 不存在：新会话选择器无法隐藏内部角色')`,
    `      } else {`,
    `        const remote = await agentPresets.remoteExportList()`,
    `        const remoteRows = Array.isArray(remote?.presets) ? remote.presets : []`,
    `        result.remoteRoster = remoteRows.map((row) => row?.id ?? null)`,
    `        const capitalIds = result.remoteRoster.filter((id) => typeof id === 'string' && id.startsWith('capital-'))`,
    `        if (JSON.stringify(capitalIds) !== JSON.stringify(VISIBLE_PRESET_IDS)) {`,
    `          result.problems.push('新会话选择器里的 Capital 模式应为 ' + VISIBLE_PRESET_IDS.join(' / ') + '，实际 ' + capitalIds.join(' / '))`,
    `        }`,
    `        for (const id of INTERNAL_PRESET_IDS) {`,
    `          if (result.remoteRoster.includes(id)) result.problems.push('内部角色仍出现在新会话选择器：' + id)`,
    `        }`,
    `      }`,
    `      // D0：工具面 = preset 挂的族行。每一颗 preset 的每一行都必须 fiberState=2，`,
    `      // 否则那一族工具在该角色的会话里整族缺席（装载失败只打一行 warn，没有别的信号）。`,
    `      const inventory = await agentPresets.compositionInventory()`,
    `      const FAMILY_ROWS_BY_PRESET = ${JSON.stringify(FAMILY_ROWS_BY_PRESET)}`,
    `      result.familyRows = []`,
    `      for (const presetId of Object.keys(FAMILY_ROWS_BY_PRESET)) {`,
    `        const compositionOf = inventory.find((item) => item.id === presetId)`,
    `        if (!compositionOf) { result.problems.push('compositionInventory 里没有 ' + presetId); continue }`,
    `        for (const rowId of FAMILY_ROWS_BY_PRESET[presetId]) {`,
    `          const state = compositionOf.rows?.find((row) => row.entryId === rowId)?.fiberState ?? null`,
    `          result.familyRows.push({ preset: presetId, rowId, state })`,
    `          if (state !== 2) result.problems.push(presetId + ' 的族行 ' + rowId + ' 未激活（fiberState=' + state + '）：那颗角色的这一族工具整族不存在')`,
    `        }`,
    `        if (compositionOf.rows?.some((row) => row.entryId === 'capital-generation')) result.problems.push(presetId + ' 仍然挂着单体 capital-generation 行')`,
    `      }`,
    `    }`,
    `    result.hostRuntime = Boolean(ctx.get('capitalChartRuntime'))`,
    `    if (!result.hostRuntime) result.problems.push('capital-runtime 未提供 capitalChartRuntime（chart source token 无法跨 preset 共享）')`,
    `    // 身份闸门必须真的落在宿主的 global guard 层：capital-policy 行不声明 inject 时`,
    `    // ctx.get('tools') 在 boot 期解析成 undefined（不抛错），三颗闸门就静默不装`,
    `    //（2026-10-15 起的 fs 写口 guard 一直是这个形状，被 tool-fs 的行级开关掩护住）。`,
    `    try {`,
    `      const tools = ctx.get('tools')`,
    `      const guards = tools?.layers?.global ? [...tools.layers.global.guards.values()] : []`,
    `      result.identityGuards = guards.filter((guard) => /recordGuardDecision/.test(String(guard))).length`,
    `      if (result.identityGuards < 3) result.problems.push('宿主 global guard 层里只有 ' + result.identityGuards + '/3 颗本仓身份闸门（fs 写口 / ocr 形态 / 兄弟名字）：guard 面没拿到，闸门静默不装')`,
    `    } catch (error) {`,
    `      result.problems.push('读不到 tools.layers.global.guards：' + String(error && error.message || error))`,
    `    }`,
    `  } catch (error) {`,
    `    result.problems.push('预设解析抛错：' + String(error && error.message || error))`,
    `  }`,
    `  try {`,
    `    const settings = ctx.get('settings')`,
    `    if (!settings) result.problems.push('settings 服务未提供')`,
    `    else {`,
    `      const entry = settings.describe().find((item) => item.ns === ENTRY_ID)`,
    `      result.entry = entry ? 'present' : 'absent'`,
    `      result.localFetchEnabled = entry?.value?.retriever?.localFetch?.enabled ?? null`,
    `      if (!entry) result.problems.push('settings.describe() 里没有 ' + ENTRY_ID + '（卡片不会出现在 Plugins 页）')`,
    `      else if (typeof result.localFetchEnabled !== 'boolean') result.problems.push('条目 config 里没有 retriever.localFetch.enabled（叶子漏了 .volatile()）')`,
    `    }`,
    `  } catch (error) {`,
    `    result.problems.push('settings.describe() 抛错：' + String(error && error.message || error))`,
    `  }`,
    `  try {`,
    `    const pluginManager = ctx.get('pluginManager')`,
    `    if (!pluginManager) result.problems.push('pluginManager 服务未提供（读不到插件面板的行清单）')`,
    `    else {`,
    `      const bundles = await pluginManager.listBundles()`,
    `      const bundle = bundles.find((item) => item.name === BUNDLE_NAME)`,
    `      result.rows = bundle?.rows?.map((row) => row.rowId) ?? null`,
    `      if (!bundle) result.problems.push('插件面板里没有 ' + BUNDLE_NAME + ' 这颗 bundle（包级座位按包名寻址，没它就没地方放卡片）')`,
    `      else if (result.rows && !result.rows.includes(ENTRY_ID)) {`,
    `        result.problems.push('插件面板里该 bundle 没有 ' + ENTRY_ID + ' 行（卡片的取数通道没了，whileServed 不放行）')`,
    `      }`,
    `    }`,
    `  } catch (error) {`,
    `    // 读不到行清单不算失效（可能是 pnpm/网络环境问题），只报告：卡片可见性仍要人工确认。`,
    `    result.rows = null`,
    `    result.rowReadError = String(error && error.message || error)`,
    `  }`,
    `  report(result)`,
    `}`,
    ``,
    `export default function apply(ctx) {`,
    `  // 不在本行的 activation 里读：registry 的诊断要等 Host loader 树 settle，而 settle 会等我们自己。`,
    `  const deadline = Date.now() + 20000`,
    `  const tick = () => {`,
    `    if (ctx.get('agentPresets') && ctx.get('settings')) return void attempt(ctx)`,
    `    if (Date.now() < deadline) return void setTimeout(tick, 400)`,
    `    return void attempt(ctx)`,
    `  }`,
    `  setTimeout(tick, 1200)`,
    `}`,
    ``,
  ].join('\n')
}

function prepareSkeleton(name) {
  const profile = join(SANDBOX, 'profiles', name)
  const link = join(profile, 'node_modules', PACKAGE_NAME)
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(ROOT, link, 'dir')
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-scratch-${name}`,
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PACKAGE_NAME] } },
  }, null, 2)}\n`)
  writeFileSync(join(profile, 'cordis.yml'), '[]\n')
  return profile
}

/** Normal scratch profile. A profile-level patch `insert` must be a list. */
function prepareProfile() {
  rmSync(SANDBOX, { recursive: true, force: true })
  const profile = prepareSkeleton('scratch')
  writeFileSync(join(profile, 'probe.mjs'), probeSource())
  writeFileSync(join(profile, 'cordis.patch.yml'),
    `- insert:\n    - id: capital-boot-probe\n      name: './probe.mjs'\n`)
}

/** Negative control: duplicate preset id, which upstream only reports as one warn while web still starts. */
function prepareBadPresetProfile() {
  const profile = prepareSkeleton('badpreset')
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: smoke-boot-duplicate-preset',
    `      name: '@deepseek-ai/dsh-agent-preset'`,
    '      config:',
    `        id: ${PRESET_ID}`,
    `        name: 'smoke-boot negative control'`,
    '        plugins: []',
    '',
  ].join('\n'))
}

/** Runs one scratch profile; `waitMs` caps how long to wait for the probe after the URL appears. */
function run(name, waitMs = 0) {
  const profile = join(SANDBOX, 'profiles', name)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DSH_CLI, '--profile', name, '--port', '0', '--no-open'], {
      cwd: profile,
      env: { ...process.env, DSH_HOME: SANDBOX },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    let waiting = false
    let killed = false
    let grace

    // The caller stops this process after use: fetching index.html must happen while it is alive.
    const stop = () => {
      if (killed) return
      killed = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref?.()
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      resolve({ stop, ...result, output })
    }

    const timer = setTimeout(() => finish({ ok: false, reason: `超过 ${TIMEOUT_MS / 1000}s 既没启动成功也没报错` }), TIMEOUT_MS)

    const onChunk = (chunk) => {
      output += String(chunk)
      const failure = FAILURE_PATTERNS.find((pattern) => pattern.test(output))
      if (failure) {
        finish({ ok: false, reason: `命中失败特征 ${failure}`, failure })
        return
      }
      const urlMatch = output.match(SUCCESS_PATTERN)
      if (!urlMatch || waiting) return
      waiting = true
      clearTimeout(timer)
      if (waitMs === 0) {
        finish({ ok: true, reason: '已监听并打印访问 URL' })
        return
      }
      // Stop as soon as the probe prints; waitMs only caps how long to wait for a probe that never does.
      console.log(`smoke-boot: 已监听 ${urlMatch[0].replace(/\?.*$/, '')}，等待 boot 内探针…`)
      if (output.includes(PROBE_MARKER)) finish({ ok: true, reason: '已监听并打印访问 URL' })
      else grace = setTimeout(() => finish({ ok: true, reason: '已监听并打印访问 URL（探针未打印）' }), waitMs)
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (error) => finish({ ok: false, reason: `无法启动 dsh：${error.message}` }))
    child.on('exit', (code) => finish({ ok: false, reason: `dsh 提前退出（exit ${code}）` }))
  })
}

function parseProbe(output) {
  const line = output.split('\n').find((entry) => entry.includes(PROBE_MARKER))
  if (line === undefined) return { printed: false }
  const payload = line.slice(line.indexOf(PROBE_MARKER) + PROBE_MARKER.length)
  try {
    return { printed: true, ...JSON.parse(payload) }
  } catch (error) {
    return { printed: true, parseError: `${error.message}`, raw: payload }
  }
}

prepareProfile()
// One-shot scratch dir: never leave it behind, even when an exception is thrown midway.
process.on('exit', () => { rmSync(SANDBOX, { recursive: true, force: true }) })
console.log(`smoke-boot: scratch profile = ${join(SANDBOX, 'profiles', 'scratch')}`)
console.log('smoke-boot: 启动 dsh（--port 0 --no-open），等待 boot + 探针…')

const result = await run('scratch', 30_000)
const probe = parseProbe(result.output)
const tail = result.output.split('\n').filter(Boolean).slice(-15).join('\n')

let bundles
let fence
let skillFence
try {
  if (result.ok) {
    console.log(`smoke-boot: ✅ ${result.reason}`)
    console.log(tail)
    // The token URL is the one browserAuth exchanges for a cookie; fetch while the process lives.
    const urls = [...result.output.matchAll(new RegExp(SUCCESS_PATTERN.source, 'g'))].map((match) => match[0])
    const url = urls.find((entry) => entry.includes('token=')) ?? urls[urls.length - 1]
    bundles = await bootGraphHasCapitalBundles(url)
    if (bundles.fetched) {
      console.log(`smoke-boot: index.html HTTP ${bundles.status}，${bundles.bytes} 字节`)
      for (const bundle of CLIENT_BUNDLES) {
        const found = bundles.hasBundles[bundle.id] === true
        console.log(`smoke-boot: ${found ? '✅' : '⚠️ '} boot graph 中的${bundle.label}：${bundle.id} ${found ? '存在' : '未找到'}`)
      }
      // The watchlist host half (storage-domain + prefix route) is only proven mounted here.
      try {
        fence = await watchlistFenceProbe(url, bundles.cookie ?? '')
        const fenceOk = (bundles.cookie ?? '').length === 0
          ? fence.status === 200
          : fence.anonymousStatus === 401 && fence.status === 200
        fence.ok = fenceOk
        console.log(`smoke-boot: ${fenceOk ? '✅' : '❌'} /capital-watchlist/list 围栏：匿名 HTTP ${fence.anonymousStatus}（应 401）、带 cookie HTTP ${fence.status}（应 200），清单 ${fence.items ?? '?'} 条，cache-control=${fence.cacheControl}${fence.cause ? `，原因=${fence.cause}` : ''}`)
      } catch (error) {
        fence = { ok: false, error: String(error?.message ?? error) }
        console.log(`smoke-boot: ❌ 自选股路由探针失败：${fence.error}`)
      }
      // The skill-doc route is only real in a host; test both catalog ends (own path layout each).
      try {
        const { SELECTED_SKILL_CATALOG } = await import(new URL('../selected-skills/catalog.js', import.meta.url).href)
        const skillNames = [...new Set([
          SELECTED_SKILL_CATALOG[0].name,
          SELECTED_SKILL_CATALOG[SELECTED_SKILL_CATALOG.length - 1].name,
        ])]
        const fences = []
        for (const skillName of skillNames) {
          const fence = await skillDocFenceProbe(url, bundles.cookie ?? '', skillName)
          fence.ok = (bundles.cookie ?? '').length === 0
            ? fence.status === 200 && fence.startsWithFrontMatter
            : skillFenceOk(fence)
          fences.push(fence)
          console.log(`smoke-boot: ${fence.ok ? '✅' : '❌'} /capital-skills/${skillName}.md：匿名 HTTP ${fence.anonymousStatus}（应 401）、带 cookie HTTP ${fence.status}（应 200）${fence.bytes} 字节、cache-control=${fence.cacheControl}、开头是 frontmatter=${fence.startsWithFrontMatter}；表外名 HTTP ${fence.missingStatus}（error=${fence.missingError}）、编码斜杠穿越 HTTP ${fence.traversalStatus}（都应 404）`)
        }
        skillFence = { ok: fences.length > 0 && fences.every((fence) => fence.ok === true) }
      } catch (error) {
        skillFence = { ok: false, error: String(error?.message ?? error) }
        console.log(`smoke-boot: ❌ 读原文路由探针失败：${skillFence.error}`)
      }
    } else {
      console.log(`smoke-boot: ⚠️  未能拉取 index.html 复核 boot graph：${bundles.error ?? 'unknown'}`)
    }
    const problems = probe.printed
      ? (probe.problems ?? [])
      : ['boot 内探针没有打印结果（探针行未激活，或 resolve/describe 卡住）']
    if (probe.printed) {
      console.log(`smoke-boot: ${probe.preset === PRESET_ID && !probe.broken ? '✅' : '❌'} 预设 ${probe.preset}（broken=${probe.broken ?? 'null'}）`)
      console.log(`smoke-boot: ${Array.isArray(probe.rolePresets) && probe.rolePresets.every((item) => !item.broken) ? '✅' : '❌'} 角色 preset：${JSON.stringify(probe.rolePresets ?? [])}`)
      // Selector roster: three standalone modes, in order, and no delegation-only role.
      const remoteCapital = (probe.remoteRoster ?? []).filter((id) => typeof id === 'string' && id.startsWith('capital-'))
      console.log(`smoke-boot: ${JSON.stringify(remoteCapital) === JSON.stringify(VISIBLE_PRESET_IDS) ? '✅' : '❌'} 新会话选择器的 Capital 模式：${JSON.stringify(remoteCapital)}（应 ${JSON.stringify(VISIBLE_PRESET_IDS)}）`)
      // Tool surface = family rows; local tests see only the row contract, not the host's load result.
      const familyRows = probe.familyRows ?? []
      const familyBad = familyRows.filter((row) => row.state !== 2)
      const expectedFamilyRows = Object.values(FAMILY_ROWS_BY_PRESET).reduce((sum, ids) => sum + ids.length, 0)
      console.log(`smoke-boot: ${familyRows.length === expectedFamilyRows && familyBad.length === 0 ? '✅' : '❌'} 族行装配（共 ${familyRows.length}/${expectedFamilyRows} 行）${familyBad.length === 0 ? '' : '，未激活：' + familyBad.map((row) => row.preset + '/' + row.rowId + '=' + row.state).join(', ')}`)
      console.log(`smoke-boot: ${probe.hostRuntime === true ? '✅' : '❌'} host runtime capitalChartRuntime（${probe.hostRuntime === true ? 'present' : 'absent'}）`)
      console.log(`smoke-boot: ${probe.identityGuards === 3 ? '✅' : '❌'} 身份闸门在宿主 global guard 层：${probe.identityGuards ?? '读不到'} / 3 颗（fs 写口 + ocr 形态 + 兄弟名字）`)
      console.log(`smoke-boot: ${probe.presetRows?.every((row) => row.state === 2) ? '✅' : '❌'} 关键预设行：${JSON.stringify(probe.presetRows ?? [])}`)
      console.log(`smoke-boot: ${probe.entry === 'present' && typeof probe.localFetchEnabled === 'boolean' ? '✅' : '❌'} settings 条目 ${SETTINGS_ENTRY_ID}：${probe.entry}，retriever.localFetch.enabled=${probe.localFetchEnabled}`)
      // The card sits on its bundle's own page; the row count equals the card's "contained components".
      console.log(probe.rows
        ? `smoke-boot: ${probe.rows.includes(SETTINGS_ENTRY_ID) ? '✅' : '❌'} 插件页里 ${PACKAGE_NAME} 的行（共 ${probe.rows.length} 行 = 卡片「包含的组件」那个数字）：${probe.rows.join(', ')}`
        : `smoke-boot: ⚠️  读不到插件页的行清单（${probe.rowReadError ?? '未知原因'}），卡片座位需人工确认`)
    }
    if (problems.length > 0) {
      console.log('smoke-boot: ❌ boot 内探针报出的问题：')
      for (const problem of problems) console.log(`  ❌ ${problem}`)
    }
    result.probeProblems = problems
  } else {
    console.error(`smoke-boot: ❌ ${result.reason}`)
    console.error('--- dsh 输出（末 15 行）---')
    console.error(tail)
    console.error('--- 提示 ---')
    console.error('这类失败会让 **整个 profile 起不来**；先在 workspace 内用这个冒烟复现，')
    console.error('再对照 docs/reference/dsh-surface-ledger.md 的 L2（客户端 bundle 投递）、L9（行名解析）')
    console.error('与 L17（预设声明行）定位。')
  }
} finally {
  result.stop()
}

// Negative control: the gate must be able to fail.
console.log('smoke-boot: 反向对照 —— 故意重复声明预设，确认失败特征真的会触发…')
prepareBadPresetProfile()
const negative = await run('badpreset', 0)
negative.stop()
rmSync(SANDBOX, { recursive: true, force: true })

const gateFired = PRESET_FAILURE_PATTERNS().find((pattern) => pattern.test(negative.output))
if (gateFired) {
  console.log(`smoke-boot: ✅ 闸门能失败（重复声明被 ${gateFired} 抓到，${negative.ok ? '启动仍成功' : `且判为失败：${negative.reason}`}）`)
} else if (negative.ok) {
  console.log('smoke-boot: ❌ 反向对照**通过**了——重复声明预设没触发任何失败特征：')
  console.log('  这条闸门对预设失效是瞎的（上游改了症状措辞？），必须修 smoke-boot 而不是删这一步。')
  console.log(negative.output.split('\n').filter(Boolean).slice(-15).join('\n'))
} else {
  console.log(`smoke-boot: ❌ 反向对照以**无关**的失败收场（${negative.reason}），没证明预设特征可用`)
}

const positiveOk = result.ok
  && (result.probeProblems?.length ?? 1) === 0
  && (bundles?.fetched !== true || CLIENT_BUNDLES.every((bundle) => bundles.hasBundles[bundle.id] === true))
  // ⛔ The watchlist route must reject anonymous and serve with cookie: a prefix route without
  // requestRejection lets any local process read/write the user's watchlist
  // (docs/dev/chart-presentation.md §6.1).
  && (bundles?.fetched !== true || fence?.ok === true)
  // ⛔ The skill-doc route: anonymous rejected, closed set 404, disk read only on a hit.
  && (bundles?.fetched !== true || skillFence?.ok === true)
// The negative control is expected to fail: only ask whether the signature fired.
process.exit(positiveOk && gateFired !== undefined ? 0 : 1)
