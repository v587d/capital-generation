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
 * 用法：npm run smoke:boot
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SANDBOX = join(ROOT, '.tmp-boot')
const PROFILE = join(SANDBOX, 'profiles', 'scratch')
const TIMEOUT_MS = 90_000

/** 失败特征：loader 行导入/激活失败、监听失败、启动期未捕获异常。 */
const FAILURE_PATTERNS = [
  /failed to import loader entry/i,
  /did not activate/i,
  /published process-global service/i,
  /ClientPackageCompositionError/,
  /client-modules:/,
  /failed to (?:boot|listen|initialize)/i,
]
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

async function bootGraphHasChartBundle(url) {
  try {
    const response = await fetchIndex(url)
    const html = await response.text()
    return { fetched: true, hasBundle: html.includes('capital-charts'), status: response.status, bytes: html.length }
  } catch (error) {
    return { fetched: false, hasBundle: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 搭一个与真实 profile 同构、但完全落在 workspace 内的 scratch profile。 */
function prepareProfile() {
  rmSync(SANDBOX, { recursive: true, force: true })
  mkdirSync(join(PROFILE, 'node_modules', '@v587d'), { recursive: true })
  symlinkSync(ROOT, join(PROFILE, 'node_modules', '@v587d', 'capital-generation'), 'dir')
  writeFileSync(join(PROFILE, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-scratch-boot',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@v587d/capital-generation'] } },
  }, null, 2)}\n`)
  writeFileSync(join(PROFILE, 'cordis.yml'), '[]\n')
  writeFileSync(join(PROFILE, 'cordis.patch.yml'), '[]\n')
}

function run() {
  return new Promise((resolve) => {
    const child = spawn('dsh', ['--profile', 'scratch', '--port', '0', '--no-open'], {
      cwd: PROFILE,
      env: { ...process.env, DSH_HOME: SANDBOX },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    let probing = false

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref?.()
      resolve({ ...result, output })
    }

    const timer = setTimeout(() => finish({ ok: false, reason: `超过 ${TIMEOUT_MS / 1000}s 既没启动成功也没报错` }), TIMEOUT_MS)

    const onChunk = (chunk) => {
      output += String(chunk)
      const failure = FAILURE_PATTERNS.find((pattern) => pattern.test(output))
      if (failure) {
        finish({ ok: false, reason: `命中失败特征 ${failure}` })
        return
      }
      const urlMatch = output.match(SUCCESS_PATTERN)
      if (urlMatch && !probing) {
        probing = true
        clearTimeout(timer)
        console.log(`smoke-boot: 已监听 ${urlMatch[0].replace(/\?.*$/, '')}，复核 boot graph…`)
        // 复核是尽力而为：无论结果如何都要收尾，绝不能让冒烟挂死。
        bootGraphHasChartBundle(urlMatch[0]).then((probe) => {
          finish({ ok: true, reason: '已监听并打印访问 URL', probe })
        })
        setTimeout(() => {
          finish({ ok: true, reason: '已监听并打印访问 URL（boot graph 复核超时）', probe: { fetched: false, error: 'probe timeout' } })
        }, 20_000).unref?.()
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (error) => finish({ ok: false, reason: `无法启动 dsh：${error.message}` }))
    child.on('exit', (code) => finish({ ok: false, reason: `dsh 提前退出（exit ${code}）` }))
  })
}

prepareProfile()
console.log(`smoke-boot: scratch profile = ${PROFILE}`)
console.log('smoke-boot: 启动 dsh（--port 0 --no-open），等待 boot 完成…')

const result = await run()
rmSync(SANDBOX, { recursive: true, force: true })

const tail = result.output.split('\n').filter(Boolean).slice(-15).join('\n')
if (result.ok) {
  console.log(`smoke-boot: ✅ ${result.reason}`)
  console.log(tail)
  const probe = result.probe
  if (probe?.fetched) {
    console.log(`smoke-boot: ${probe.hasBundle ? '✅' : '⚠️ '} boot graph 中的图表客户端 bundle：${probe.hasBundle ? '存在' : '未找到'}（HTTP ${probe.status}，${probe.bytes} 字节）`)
  } else {
    console.log(`smoke-boot: ⚠️  未能拉取 index.html 复核 boot graph：${probe?.error ?? 'unknown'}`)
  }
  process.exit(probe?.fetched === true && probe.hasBundle === false ? 1 : 0)
}

console.error(`smoke-boot: ❌ ${result.reason}`)
console.error('--- dsh 输出（末 15 行）---')
console.error(tail)
console.error('--- 提示 ---')
console.error('这类失败会让 **整个 profile 起不来**；先在 workspace 内用这个冒烟复现，')
console.error('再对照 docs/reference/dsh-surface-ledger.md 的 L2（客户端 bundle 投递）与 L9（行名解析）定位。')
process.exit(1)
