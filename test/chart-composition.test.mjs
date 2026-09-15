import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

/**
 * 组合层面的契约测试：patch 行、嵌套包声明、客户端 bundle 注册格式。
 *
 * 这里钉住的是**部署时才会暴露的致命错误**（下面两条都真实发生过，都让 profile 无法启动或
 * 客户端半边静默消失）：
 *  - 行名写成 `!!js` → loader 只对 `config` 插值，`name` 原样进 import，
 *    启动期 `name.startsWith is not a function`；
 *  - 行名写成 **subpath 说明符** → `locatePkgJson` 直接 `return undefined`，
 *    这颗行被静默当成"不是客户端包"，bundle 永不进 `__DSH_BOOT__`。
 * 所以这里既断言方言与形状，也**真的从模拟的 profile 根解析并导入一次**。
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHART_UI = join(ROOT, 'chart-ui')
const PATCH_TEXT = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

/**
 * 复刻 `dsh-client-modules` 的 `locatePkgJson` 守卫：不满足的行会被**静默**判为
 * "不是客户端包"（返回 undefined），既没有日志也没有报错。
 *
 * 上游原文：
 *   const pathLike = loaderName.startsWith(".") || loaderName.startsWith("file:") || isAbsolute(loaderName)
 *   const expectedPackageName = pathLike ? void 0 : exactPackageSpecifier(loaderName)
 *   if (!pathLike && expectedPackageName === void 0) return void 0
 */
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined
  }
  return specifier.length > 0 && !specifier.includes('/') ? specifier : undefined
}

function clientModulesAcceptsRowName(loaderName) {
  const pathLike = loaderName.startsWith('.') || loaderName.startsWith('file:') || isAbsolute(loaderName)
  const expectedPackageName = pathLike ? undefined : exactPackageSpecifier(loaderName)
  return pathLike || expectedPackageName !== undefined
}

/**
 * 读 patch。`!!js` 不是 js-yaml 的已知标签（本仓 persona.test.mjs 同一处理），
 * 去掉标签后表达式就是一段普通字符串。
 */
function loadPatch() {
  return yamlLoad(PATCH_TEXT.replace(/!!js\s+/g, ''))
}

/** 从模块 URL 向上找最近的 package.json 的 name——复刻 dsh-client-modules 的归属判定。 */
function nearestPackageName(fileUrl) {
  let dir = dirname(fileURLToPath(fileUrl))
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8')).name
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * 行名的解析基址是**本 patch 文件所在目录**（cordis-plugin-include 装载 patch 时
 * `ctx.baseUrl = new URL('.', pathToFileURL(filename))`），所以 probe 脚本就写在本仓根目录，
 * 与部署时的解析基址同构。用完即删。
 */
function resolveFromPatchDirectory(specifier) {
  const probePath = join(ROOT, `.probe-resolve-${process.pid}.mjs`)
  writeFileSync(probePath, [
    `const specifier = ${JSON.stringify(specifier)}`,
    'const url = import.meta.resolve(specifier)',
    'const mod = await import(specifier)',
    'console.log(JSON.stringify({ url, name: mod.name, hasApply: typeof mod.apply === \'function\' }))',
  ].join('\n'))
  try {
    const result = spawnSync(process.execPath, [probePath], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })
    assert.equal(result.status, 0, `从 patch 目录解析/导入 "${specifier}" 失败：\n${result.stderr}`)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(probePath, { force: true })
  }
}

function findRow(patch, id) {
  const visit = (nodes) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        const found = visit(node)
        if (found) return found
        continue
      }
      if (node.id === id) return node
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          const found = visit(value)
          if (found) return found
        }
      }
    }
    return undefined
  }
  return visit(patch)
}

test('patch：行名必须是 path-like 的字面量（subpath 会被静默丢掉）', () => {
  const row = findRow(loadPatch(), 'capital-charts')
  assert.equal(typeof row.name, 'string')

  // 上游事实：subpath 说明符既非 path-like、exactPackageSpecifier 又返回 undefined，
  // 于是 locatePkgJson 直接 return undefined —— 这颗行**静默**不是客户端包。
  // 把这条规则也断言下来：上游一旦放宽，这里先失败，我们就能改用更干净的 subpath 写法。
  assert.equal(clientModulesAcceptsRowName('@v587d/capital-generation/chart-ui'), false,
    '上游已不再丢弃 subpath 行名：可以简化 cordis.patch.yml 的写法和本文件的这条注释')

  assert.equal(clientModulesAcceptsRowName(row.name), true,
    `行名必须让 locatePkgJson 接受（path-like 或精确包名），否则客户端 bundle 永不进 __DSH_BOOT__：${row.name}`)
  assert.match(row.name, /chart-ui\/index\.js$/)
})

test('patch：任何行的 name 都必须是字面量字符串（name 不接受 !!js）', () => {
  // 事故回归：loader 只对 fiber 的 config 做插值（cordis-plugin-loader 的
  // `internal/config` 钩子），`name` 原样进入 ESM import。曾经把图表行的 name 写成
  // !!js，后果是启动期 `failed to import loader entry capital-charts ([object Object]):
  // name.startsWith is not a function`，**整个 profile 起不来**。
  const nameLines = PATCH_TEXT.split('\n').filter((line) => /^\s*-?\s*name:/.test(line))
  assert.ok(nameLines.length >= 2, `patch 里的 name 行太少（${nameLines.length}），断言可能失效`)
  for (const line of nameLines) {
    assert.match(line, /name:\s*['"]/, `行名必须是字面量字符串，不能是表达式或裸对象：${line.trim()}`)
  }
})

test('patch：存在 capital-charts 行，且它在 insert 里（新增行而不是改已有行）', () => {
  const patch = loadPatch()
  const row = findRow(patch, 'capital-charts')
  assert.ok(row, 'cordis.patch.yml 必须有 id=capital-charts 的行')
  const inserter = patch.find((node) => Array.isArray(node?.insert) && node.insert.some((item) => item?.id === 'capital-charts'))
  assert.ok(inserter, 'capital-charts 必须在 insert 列表里：它是新增的 host 平面行')
})

test('patch：行名能从 profile 根解析并导入，且归属到 chart-ui 这个独立包身份', () => {
  const row = findRow(loadPatch(), 'capital-charts')
  assert.equal(typeof row.name, 'string')
  assert.ok(!row.name.includes('!!js'), '去掉标签后残留说明写法有问题')

  const probe = resolveFromPatchDirectory(row.name)
  assert.equal(probe.name, 'capital-charts', '导入的应当是宿主半边插件')
  assert.equal(probe.hasApply, true)
  assert.ok(existsSync(fileURLToPath(probe.url)), `解析结果必须是真实存在的文件：${probe.url}`)
  assert.equal(basename(probe.url), 'index.js')

  // 关键：包身份必须是嵌套包，不能落到主包（落到主包就是重复 Loader source 组合错误）。
  const nearest = nearestPackageName(probe.url)
  const rootName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  assert.equal(nearest, '@v587d/capital-charts')
  assert.notEqual(nearest, rootName)
  assert.ok(fileURLToPath(probe.url).startsWith(CHART_UI), '必须落在 chart-ui/ 目录内')
})

test('嵌套包：chart-ui 的包身份、dsh.client 声明与 exports 自洽', () => {
  const manifest = JSON.parse(readFileSync(join(CHART_UI, 'package.json'), 'utf8'))
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

  assert.equal(manifest.name, '@v587d/capital-charts')
  assert.notEqual(manifest.name, root.name, '必须是独立包名：同名会被 dsh-client-modules 判为重复 Loader source')
  assert.equal(manifest.version, root.version, '嵌套包随主包发布，版本必须同步（本测试就是防它悄悄漂移）')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(manifest.dsh?.client?.immediately, true, '本包没有消费者会 require 它，必须开机自激活')

  const client = typeof manifest.exports['./client'] === 'string' ? manifest.exports['./client'] : manifest.exports['./client']?.default
  assert.equal(typeof client, 'string')
  assert.ok(existsSync(join(CHART_UI, client)), `exports["./client"] 指向的文件不存在：${client}`)
  assert.ok(root.files.includes('chart-ui'), '主包的 files 必须收录 chart-ui，否则发布后客户端 bundle 丢失')
})

test('客户端 bundle：注册 id 必须等于包名，且是模块表格式而不是直接副作用', () => {
  const manifest = JSON.parse(readFileSync(join(CHART_UI, 'package.json'), 'utf8'))
  const source = readFileSync(join(CHART_UI, 'client.js'), 'utf8')

  assert.match(source, /window\.__ModuleLoader__\.load\(/, '必须是客户端模块表的注册格式')
  assert.ok(source.includes(`id: '${manifest.name}'`), 'ModuleLoader 的 id 必须等于 package.json 的 name（消费者按 <id>/client 取）')
  assert.match(source, /exports\.apply\s*=/, '必须导出 apply')
  // 模块体只能在工厂函数内执行：顶层不得有页面副作用。
  const beforeFactory = source.slice(0, source.indexOf('factory:'))
  assert.equal(/document\.|globalThis\./.test(beforeFactory), false, '登记阶段不得触碰页面')
})
