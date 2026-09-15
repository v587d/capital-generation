import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 打包闸门。
 *
 * 为什么必须有这条测试：浏览器侧的静态资源（vendored 图表库）**不会**被 tsc 搬运，
 * 漏掉的表现不是"图表难看"，而是运行时 `loadVendoredChartLibrary()` 抛错、
 * 图表 HTML 里少一段脚本。而将来 Step 3 的客户端 bundle 一旦漏发，
 * 上游会以 `ClientPackageCompositionError` 让**整个 web profile 起不来**。
 *
 * 所以这里断言的不是"文件存在"，而是"**发布出去的那个包里**文件存在"——用
 * `npm pack --dry-run --json` 的实际文件清单，而不是源码目录里看一眼。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function packedFilePaths() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--cache', './.npm-cache'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(result.status, 0, `npm pack --dry-run 失败：\n${result.stderr}`)
  const report = JSON.parse(result.stdout)
  assert.ok(Array.isArray(report) && report.length === 1, 'npm pack --dry-run --json 应返回一个包的报告')
  return new Set(report[0].files.map((file) => file.path))
}

test('打包闸门：vendored 图表库与构建产物都在发布清单里', (t) => {
  const paths = packedFilePaths()

  for (const required of [
    'lib/index.js',
    'lib/chart/tool.js',
    'lib/chart/runtime.js',
    'lib/chart/vendor/lightweight-charts.standalone.production.js',
    'lib/chart/vendor/VERSION.json',
    'lib/chart/vendor/LICENSE',
    'chart-ui/package.json',
    'chart-ui/index.js',
    'chart-ui/client.js',
    'preset/capital-generation/agent.cordis.yml',
    'preset/capital-generation/skills/capital-chart-protocol/SKILL.md',
    'cordis.patch.yml',
  ]) {
    assert.ok(paths.has(required), `发布清单里缺少 ${required}（npm run build 是否跑过？files 列表是否漏了？）`)
  }

  // 许可证必须随包发布：Apache-2.0 的 NOTICE 义务。
  const license = [...paths].find((path) => path.endsWith('chart/vendor/LICENSE'))
  assert.ok(license, 'vendored 图表库的 LICENSE 必须随包发布')

  // 反向断言：本地研发文档不进包（.gitignore 之外的第二道闸门）。
  for (const path of paths) {
    assert.equal(path.startsWith('docs/'), false, `研发文档不应随包发布：${path}`)
  }
  t.diagnostic(`发布清单 ${paths.size} 个文件`)
})

test('打包闸门：声明 dsh.client 的包，其客户端 bundle 必须真的在包里', () => {
  // 主包与随包携带的嵌套包都要查：漏发 chart-ui/client.js 会让整个 web profile 起不来。
  const manifests = ['package.json', 'chart-ui/package.json']
  const paths = packedFilePaths()
  let checked = 0

  for (const relativeManifest of manifests) {
    const manifest = JSON.parse(readFileSync(join(ROOT, relativeManifest), 'utf8'))
    if (manifest.dsh?.client === undefined) continue
    checked += 1

    const relative = manifest.exports?.['./client']
    const resolved = typeof relative === 'string' ? relative : relative?.default
    assert.equal(typeof resolved, 'string', `${manifest.name} 声明了 dsh.client 就必须有 exports["./client"]`)

    const owner = dirname(relativeManifest)
    const onDisk = join(ROOT, owner, resolved)
    assert.ok(existsSync(onDisk), `exports["./client"] 指向的文件不存在：${owner}/${resolved}`)

    const packedPath = join(owner, resolved).replace(/^\.\//, '')
    assert.ok(paths.has(packedPath), `${packedPath} 不在发布清单里；bundle 缺失会让整个 web profile 起不来`)
  }

  assert.ok(checked >= 1, '至少 chart-ui 应声明 dsh.client；一个都没检查到说明测试失效了')
})
