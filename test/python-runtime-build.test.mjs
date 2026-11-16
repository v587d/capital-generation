import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  assertNoEscapingSymlinks,
  executableFor,
  findNpmCli,
  packageJsonFor,
  runtimePackFor,
  targetParts,
} from '../runtime-build/pack.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(ROOT, 'runtime', 'manifest.json'), 'utf8'))
const TARGETS = Object.keys(manifest.packs.base.targets).sort()

test('runtime build: every manifest target produces the platform package shape', () => {
  assert.deepEqual(TARGETS, ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'])
  for (const target of TARGETS) {
    const { platform, arch } = targetParts(target)
    const pkg = packageJsonFor(manifest, 'base', target, manifest.packs.base.targets[target].version)
    assert.equal(pkg.name, manifest.packs.base.targets[target].package)
    assert.deepEqual(pkg.os, [platform])
    assert.deepEqual(pkg.cpu, [arch])
    assert.deepEqual(pkg.libc, platform === 'linux' ? ['glibc'] : undefined)
    assert.ok(!('dependencies' in pkg), '运行时包不许声明依赖：安装由 pnpm 精确 pin')
    assert.ok(!('scripts' in pkg), '运行时包不许带 install/postinstall 脚本')
    assert.ok(pkg.files.includes('runtime-pack.json'))
    assert.ok(pkg.files.includes('licenses'))
    assert.deepEqual(pkg.repository, {
      type: 'git',
      url: 'git+https://github.com/v587d/capital-generation.git',
    }, 'npm Trusted Publishing 要求 repository.url 与 GitHub 仓库完全一致')

    const runtime = runtimePackFor(manifest, 'base', target)
    assert.equal(runtime.kind, 'base')
    assert.equal(runtime.pythonVersion, manifest.python)
    assert.equal(runtime.executable, executableFor(target))
    assert.deepEqual(runtime.packages, manifest.packs.base.packages)

    const parquet = runtimePackFor(manifest, 'parquet', target)
    assert.equal(parquet.kind, 'lib')
    assert.equal(parquet.executable, null)
    assert.deepEqual(parquet.requires, manifest.packs.parquet.requires)
    assert.deepEqual(parquet.packages, manifest.packs.parquet.packages)
  }
  assert.equal(executableFor('win32-x64'), 'python/python.exe')
  assert.equal(executableFor('linux-x64'), 'python/bin/python3.13')
})

test('runtime build: a version not pinned by the manifest is refused', () => {
  assert.throws(
    () => packageJsonFor(manifest, 'base', 'linux-x64', '9.9.9'),
    /版本是 1\.0\.0/,
  )
  assert.throws(() => packageJsonFor(manifest, 'base', 'linux-arm64', '1.0.0'), /manifest 没有/)
})

test('runtime build: symlinks may stay inside the payload but never escape it', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cg-pack-links-'))
  await mkdir(join(root, 'python'))
  await writeFile(join(root, 'python', 'python3.13'), '#!/bin/sh\n')
  await symlink('python3.13', join(root, 'python', 'python3'))
  await assertNoEscapingSymlinks(root)

  const outside = await mkdtemp(join(tmpdir(), 'cg-pack-outside-'))
  await writeFile(join(outside, 'payload.bin'), 'x')
  await symlink(join(outside, 'payload.bin'), join(root, 'python', 'escape'))
  await assert.rejects(() => assertNoEscapingSymlinks(root), /逃出 payload/)
})

test('runtime build: npm is invoked through npm-cli.js, never the npm .cmd shim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cg-npm-cli-'))
  const cli = join(dir, 'npm-cli.js')
  await writeFile(cli, '// npm\n')
  assert.equal(findNpmCli({ CG_NPM_CLI: cli }), cli)
  assert.throws(() => findNpmCli({ CG_NPM_CLI: join(dir, 'missing.js') }), /找不到 npm-cli\.js/)
})

test('runtime build: CI matrix and publish gates match the manifest contract', async () => {
  const workflow = await readFile(join(ROOT, '.github', 'workflows', 'python-runtime-packs.yml'), 'utf8')
  const matrix = [...workflow.matchAll(/- target: ([\w-]+)\n\s+os: ([\w.-]+)/g)]
    .map((match) => ({ target: match[1], os: match[2] }))
  assert.deepEqual(matrix.map((item) => item.target).sort(), TARGETS, 'CI 矩阵漏了平台，等于该平台没发布')
  assert.deepEqual(Object.fromEntries(matrix.map((item) => [item.target, item.os])), {
    'linux-x64': 'ubuntu-22.04',
    'darwin-arm64': 'macos-15',
    'darwin-x64': 'macos-15-intel',
    'win32-x64': 'windows-latest',
  }, 'macOS 14 已退休；Intel 包必须用 macos-15-intel')
  assert.match(workflow, /tags:\s*\n\s*- 'python-runtime-v\*'/, 'tag 必须独立于主插件的 v*')
  assert.match(workflow, /id-token:\s*write/, 'npm Trusted Publishing 需要 OIDC')
  assert.match(workflow, /npm publish "\$tgz" --access public --provenance/, '发布必须带 provenance')
  assert.match(workflow, /astral-sh\/setup-uv@v6/, 'uv 是 macOS/Linux/Windows 的构建工具，必须 pin')
  assert.match(workflow, /runtime-build\/build-posix\.sh/, 'POSIX 构建脚本必须真的被 CI 调用')
  assert.match(workflow, /runtime-build\/build-windows\.ps1/, 'Windows 构建脚本必须真的被 CI 调用')
  assert.match(workflow, /runtime-build\/verify-pack\.mjs/, '只解包不算验证：必须跑 worker + pandas')
  assert.match(workflow, /process\.stdout\.write\(p\.name\+' '\+p\.version\+'\\n'\)/,
    'read 需要换行符；否则 EOF 返回 1，set -e 会在第一次 publish 前退出')
  assert.match(workflow, /npm run build/, 'CLI 从 lib/ 导入，验证前必须先构建')
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/, '仓库不存 npm token；发布走 OIDC')
})

test('runtime build: platform scripts read versions from the manifest instead of copying pins', async () => {
  const posix = await readFile(join(ROOT, 'runtime-build', 'build-posix.sh'), 'utf8')
  const windows = await readFile(join(ROOT, 'runtime-build', 'build-windows.ps1'), 'utf8')
  const linux = await readFile(join(ROOT, 'runtime-build', 'build-linux.sh'), 'utf8')
  const macos = await readFile(join(ROOT, 'runtime-build', 'build-macos.sh'), 'utf8')

  assert.match(posix, /runtime\/manifest\.json/)
  assert.match(posix, /install_only_stripped/)
  assert.match(posix, /python-build-standalone/)
  assert.match(posix, /pack\.mjs/)
  assert.match(posix, /CPYTHON-LICENSE\.txt/)
  assert.doesNotMatch(posix, /-maxdepth/, 'macOS 的 BSD find 没有 -maxdepth；Linux 能跑不等于 macOS 能跑')
  const bootstrap = await readFile(join(ROOT, 'runtime-build', 'bootstrap-publish.mjs'), 'utf8')
  assert.match(bootstrap, /runtime\/manifest\.json/, 'bootstrap 的包名必须来自 manifest')
  assert.match(bootstrap, /'0\.0\.0'/, '占位版本必须远离真实 1.0.0')
  assert.match(bootstrap, /'bootstrap'/, '占位包只能挂在 bootstrap tag，不能占 latest')
  assert.match(bootstrap, /--dry-run/, '发布前必须能预览')
  assert.match(bootstrap, /findNpmCli/, 'npm 必须通过 npm-cli.js 调用')
  assert.doesNotMatch(bootstrap, /@v587d\/cg-py-base-|@v587d\/cg-py-parquet-/, '包名不许手抄')
  assert.match(windows, /runtime\\manifest\.json/)
  assert.match(windows, /embed-amd64\.zip/)
  assert.match(windows, /pack\.mjs/)
  assert.match(linux, /linux-x64/)
  assert.match(macos, /darwin-\$ARCH/)

  for (const script of [posix, windows]) {
    assert.doesNotMatch(script, /numpy==2\.4\.6|pandas==3\.0\.6|pyarrow==25\.0\.1/,
      '版本只住 runtime/manifest.json；构建脚本抄一份就会在下次升级时漂移')
  }
  assert.ok(existsSync(join(ROOT, 'runtime-build', 'pack.mjs')))
  if (process.platform !== 'win32') {
    for (const name of ['build-posix.sh', 'build-linux.sh', 'build-macos.sh']) {
      const info = await stat(join(ROOT, 'runtime-build', name))
      assert.ok((info.mode & 0o111) !== 0, `${name} 必须可执行`)
    }
  }
})
