#!/usr/bin/env node
/**
 * 启动冒烟：在 workspace 内搭一个 scratch profile 并**真的把 dsh 跑起来**，确认
 * profile 能完成 boot（loader 行全部导入并激活）。
 *
 * 为什么必须有这一步（事故教训，2026-09-15）：
 * `dsh --dump-config` 只打印组合后的配置，**不会触发 `!!js` 求值、也不会导入任何行**。
 * 当时把"行出现在 dump 里"当成了验证通过，结果 `name` 上误用 `!!js` 的写法在真实启动时
 * 变成 `failed to import loader entry capital-charts ([object Object]): name.startsWith is
 * not a function` —— 用户重启后**整个 dsh web 起不来**。dump 能证明的只有"patch 应用了"，
 * 证明不了"能起来"。
 *
 * 做法：与真实 profile 同构的目录 + 真实 `dsh` 进程 + `--port 0`（让 OS 选端口，不碰
 * 用户正在跑的 3080）+ `--no-open`（不弹浏览器）；所有写入都在 workspace 内。
 *
 * 2026-09-26（issue #3）补了两件当时缺的事，因为那次升级的**两个根因都没被这个冒烟抓到**：
 *  1. **boot 内探针**（`probe.mjs`，随 scratch profile 一起写）：在真实 boot graph 里读
 *     `agentPresets.resolve('capital-generation')`、`settings.describe()` 与
 *     `pluginManager.listBundles()` 的行清单。0.1.7 起预设由一颗声明行注册，registry 激活失败
 *     只打一行 warn（`agent preset <id>: <原因>`），启动期什么都正常，症状延后到用户打开历史
 *     会话（`Unknown agent preset`）；settings 卡片那条链同理（条目没 `.volatile()` 叶子 →
 *     根本不进 describe 镜像；卡片座位在「插件」页那一行，见 docs/dev/settings-config.md §5.4）。
 *     探针把这三件事提前到 boot。
 *  2. **反向对照**（`badpreset` profile）：故意重复声明同一个预设 id，确认失败特征**真的会触发**。
 *     闸门抓不到的东西看起来就像通过了 —— 上一条事故正是"只复核 bundle 投递"的闸门一路绿。
 *
 * 用法：npm run smoke:boot
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SANDBOX = join(ROOT, '.tmp-boot')
const TIMEOUT_MS = 90_000

/** 预设身份与 settings 条目 id —— 与 `preset/capital-generation/agent.patch.yml`、
 *  `capital-config/index.js` 必须同字，测试另有断言（`test/capital-config.test.mjs`）。 */
const PRESET_ID = 'capital-generation'
const SETTINGS_ENTRY_ID = 'capital-config'
/** bundle 名以 package.json 为准（插件面板按它列出这颗包的行）。 */
const PACKAGE_NAME = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name

/** 探针在 boot 内打印这一行（JSON），父进程按它判定。 */
const PROBE_MARKER = 'capital-boot-probe: '

/** 失败特征：loader 行导入/激活失败、**预设声明行激活失败**、监听失败、启动期未捕获异常。 */
const FAILURE_PATTERNS = [
  /failed to import loader entry/i,
  /did not activate/i,
  /published process-global service/i,
  /ClientPackageCompositionError/,
  /client-modules:/,
  /failed to (?:boot|listen|initialize)/i,
  ...PRESET_FAILURE_PATTERNS(),
]

/** registry 的预设失效特征：`agent preset <id>: <原因>` 只在 warn 里出现一次，启动照旧成功。 */
function PRESET_FAILURE_PATTERNS() {
  return [
    /agent preset \S+:/,
    /Unknown agent preset/i,
    /Duplicate agent preset/i,
  ]
}
/** 成功特征：web-runtime 行打印的访问 URL（带 token）。 */
const SUCCESS_PATTERN = /https?:\/\/[^\s]+/

/**
 * boot 成功后顺手确认客户端半边真的进了 boot graph。
 *
 * 这是 F3（"preset 行的客户端 bundle 到不了浏览器"）的**运行期反证**：index.html 的
 * `window.__DSH_BOOT__` 里出现 chart-ui 的 bundle，说明"挂在 host 平面"这个选择是对的。
 *
 * 认证流程（dsh-client-connection 的 browserAuth）：带 `?token=` 的根请求会 302 到干净的
 * `/` 并 Set-Cookie；后续请求必须带上那个 cookie，否则一律 401。Node 的 fetch 不做
 * cookie jar，所以这里手工接一次。
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
  return fetch(new URL(location, url).href, { headers: cookie.length > 0 ? { cookie } : {}, signal })
}

async function bootGraphHasCapitalBundles(url) {
  try {
    const response = await fetchIndex(url)
    const html = await response.text()
    const hasBundles = {
      'capital-config': html.includes('capital-config'),
      'capital-charts': html.includes('capital-charts'),
    }
    return { fetched: true, hasBundles, status: response.status, bytes: html.length }
  } catch (error) {
    return { fetched: false, hasBundles: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 探针行源码：一颗普通 host 平面行，等两个服务都到位后读**运行期事实**。
 * 写在 profile 目录里（不在发布物内），随 scratch profile 一起生灭。
 */
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
    `  const result = { preset: null, broken: null, entry: null, localFetchEnabled: null, rows: null, problems: [] }`,
    `  try {`,
    `    const agentPresets = ctx.get('agentPresets')`,
    `    if (!agentPresets) result.problems.push('agentPresets 服务未提供')`,
    `    else {`,
    `      const record = await agentPresets.resolve(PRESET_ID)`,
    `      result.preset = record?.id ?? null`,
    `      result.broken = record?.broken ?? null`,
    `      if (record?.id !== PRESET_ID) result.problems.push('预设未注册：resolve(' + PRESET_ID + ') 返回 ' + String(record?.id))`,
    `      else if (record.broken) result.problems.push('预设激活失败：' + record.broken)`,
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
    `      if (!bundle) result.problems.push('插件面板里没有 ' + BUNDLE_NAME + ' 这颗 bundle')`,
    `      else if (result.rows && !result.rows.includes(ENTRY_ID)) {`,
    `        result.problems.push('插件面板里该 bundle 没有 ' + ENTRY_ID + ' 行（卡片没有座位，plugins.row.config 的键对不上）')`,
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

/** scratch profile 的骨架：与真实 profile 同构，但完全落在 workspace 内。 */
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

/** 正常 scratch profile：挂上探针行（profile 级 patch 的 `insert` **必须是列表**）。 */
function prepareProfile() {
  rmSync(SANDBOX, { recursive: true, force: true })
  const profile = prepareSkeleton('scratch')
  writeFileSync(join(profile, 'probe.mjs'), probeSource())
  writeFileSync(join(profile, 'cordis.patch.yml'),
    `- insert:\n    - id: capital-boot-probe\n      name: './probe.mjs'\n`)
}

/**
 * 反向对照 profile：**重复声明**同一个预设 id。上游 registry 对此是
 * `Duplicate agent preset: <id>`（`dsh-agent-preset-registry/lib/index.js`），
 * 表现是 "1 entry did not activate" 的 warn + 一行原因，**web 照样起来** ——
 * 所以这一步证明的正是"闸门看得见这种失效"。
 */
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

/**
 * 真跑一颗 scratch profile。
 *
 * @param name profile 名（`profiles/<name>`）
 * @param waitMs 看到监听 URL 之后额外等待的时间（留给探针打印；0 = 不等）
 */
function run(name, waitMs = 0) {
  const profile = join(SANDBOX, 'profiles', name)
  return new Promise((resolve) => {
    const child = spawn('dsh', ['--profile', name, '--port', '0', '--no-open'], {
      cwd: profile,
      env: { ...process.env, DSH_HOME: SANDBOX },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    let waiting = false
    let killed = false
    let grace

    // 由调用方在**用完这个进程之后**收尾（拉 index.html 复核 boot graph 必须趁它还活着）。
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
      // 探针一打印就收尾；waitMs 是"它压根没打印"的上限，别白等。
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
// scratch 目录是一次性产物：哪怕中途抛异常也不许留在树里（`.tmp-*` 不进版本库不代表可以留）。
process.on('exit', () => { rmSync(SANDBOX, { recursive: true, force: true }) })
console.log(`smoke-boot: scratch profile = ${join(SANDBOX, 'profiles', 'scratch')}`)
console.log('smoke-boot: 启动 dsh（--port 0 --no-open），等待 boot + 探针…')

const result = await run('scratch', 30_000)
const probe = parseProbe(result.output)
const tail = result.output.split('\n').filter(Boolean).slice(-15).join('\n')

let bundles
try {
  if (result.ok) {
    console.log(`smoke-boot: ✅ ${result.reason}`)
    console.log(tail)
    // 带 token 的那条才是浏览器认证要用的 URL（browserAuth 拿它换 cookie）；进程还活着时去拉。
    const urls = [...result.output.matchAll(new RegExp(SUCCESS_PATTERN.source, 'g'))].map((match) => match[0])
    const url = urls.find((entry) => entry.includes('token=')) ?? urls[urls.length - 1]
    bundles = await bootGraphHasCapitalBundles(url)
    if (bundles.fetched) {
      console.log(`smoke-boot: ${bundles.hasBundles['capital-config'] ? '✅' : '⚠️ '} boot graph 中的 Capital settings bundle：${bundles.hasBundles['capital-config'] ? '存在' : '未找到'}`)
      console.log(`smoke-boot: ${bundles.hasBundles['capital-charts'] ? '✅' : '⚠️ '} boot graph 中的图表客户端 bundle：${bundles.hasBundles['capital-charts'] ? '存在' : '未找到'}（HTTP ${bundles.status}，${bundles.bytes} 字节）`)
    } else {
      console.log(`smoke-boot: ⚠️  未能拉取 index.html 复核 boot graph：${bundles.error ?? 'unknown'}`)
    }
    const problems = probe.printed
      ? (probe.problems ?? [])
      : ['boot 内探针没有打印结果（探针行未激活，或 resolve/describe 卡住）']
    if (probe.printed) {
      console.log(`smoke-boot: ${probe.preset === PRESET_ID && !probe.broken ? '✅' : '❌'} 预设 ${probe.preset}（broken=${probe.broken ?? 'null'}）`)
      console.log(`smoke-boot: ${probe.entry === 'present' && typeof probe.localFetchEnabled === 'boolean' ? '✅' : '❌'} settings 条目 ${SETTINGS_ENTRY_ID}：${probe.entry}，retriever.localFetch.enabled=${probe.localFetchEnabled}`)
      // 卡片座位在**插件页**（0.1.7 起设置页不再托管第三方卡片）：按 bundle 的行清单核对。
      console.log(probe.rows
        ? `smoke-boot: ${probe.rows.includes(SETTINGS_ENTRY_ID) ? '✅' : '❌'} 插件页里 ${PACKAGE_NAME} 的行：${probe.rows.join(', ')}`
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

// ── 反向对照：闸门必须**能**失败 ──────────────────────────────────────────────
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
  && (bundles?.fetched !== true || (!!bundles.hasBundles['capital-charts'] && !!bundles.hasBundles['capital-config']))
// 反向对照**期望**是失败：`negative.ok` 为 false 才算它对，所以这里只问"特征有没有触发"。
process.exit(positiveOk && gateFired !== undefined ? 0 : 1)
