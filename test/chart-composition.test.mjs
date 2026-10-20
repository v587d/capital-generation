import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

/**
 * Composition contract: patch rows, nested package manifest, client bundle registration. Pins
 * deploy-only failures that really happened: a `!!js` row name makes the whole profile fail to
 * start, and a subpath row name is silently dropped by `locatePkgJson` (bundle never boots).
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHART_UI = join(ROOT, 'chart-ui')
const PATCH_TEXT = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

/**
 * Replica of `dsh-client-modules`' `locatePkgJson` guard: a rejected row is silently treated as
 * "not a client package" (undefined), with no log and no error.
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

/** Reads the patch. `!!js` is unknown to js-yaml, so strip the tag and the expression stays a plain string. */
function loadPatch() {
  return yamlLoad(PATCH_TEXT.replace(/!!js\s+/g, ''))
}

/** Nearest package.json name above a module URL, mirroring dsh-client-modules' ownership check. */
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

/** Row names resolve from the patch file's own directory, so the probe lives at repo root. Deleted after use. */
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

  // Upstream fact: a subpath is neither path-like nor an exact package specifier, so the row is
  // silently not a client package. If upstream relaxes this, fail here and simplify the patch.
  assert.equal(clientModulesAcceptsRowName('@v587d/capital-generation/chart-ui'), false,
    '上游已不再丢弃 subpath 行名：可以简化 cordis.patch.yml 的写法和本文件的这条注释')

  assert.equal(clientModulesAcceptsRowName(row.name), true,
    `行名必须让 locatePkgJson 接受（path-like 或精确包名），否则客户端 bundle 永不进 __DSH_BOOT__：${row.name}`)
  assert.match(row.name, /chart-ui\/index\.js$/)
})

test('patch：任何行的 name 都必须是字面量字符串（name 不接受 !!js）', () => {
  // Regression: the loader interpolates only `config`, so a `!!js` name breaks the whole profile at startup.
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

  // Package identity must be the nested package; falling back to the root package duplicates a Loader source.
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
  // The module body must run only inside the factory: no page side effects at registration.
  const beforeFactory = source.slice(0, source.indexOf('factory:'))
  assert.equal(/document\.|globalThis\./.test(beforeFactory), false, '登记阶段不得触碰页面')
})
