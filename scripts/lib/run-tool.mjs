/**
 * 子进程启动的唯一实现：启动一个 **Node CLI**（npm / dsh）时绕开 shell。
 *
 * 为什么要绕开 shell（2026-09 两端实测）：
 *  - Windows 上 `npm` / `dsh` 是 `.cmd` 垫片。`spawnSync('npm')` → ENOENT，而 `stderr` 是空的，
 *    于是"打包闸门失败"被报成一句没有原因的断言；`spawnSync('npm.cmd')` 更糟 → EINVAL
 *    （Node 对 `.bat`/`.cmd` 强制要求 shell）。
 *  - `shell: true` 配 args 数组是 DEP0190 弃用形态（参数不转义、只做拼接），不是修法。
 *  - 唯一没有引号问题的路：`spawn(process.execPath, [<cli.js>, ...args])`——npm 与 dsh 都是
 *    Node CLI，不需要任何 shell 参与。
 *
 * 平台分支在这里一处都不写：PATH 分隔符交给 `node:path` 的 `delimiter`，可执行名用清单同时含
 * `dsh` 与 `dsh.cmd`。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

/**
 * PATH 的目录清单。**只这一份**：`.split(':')` 在 Windows 上会把
 * `C:\\Program Files;C:\\Windows` 拆成 `['C','\\Program Files;C','\\Windows']`，
 * 症状不是报错而是"永远找不到 → 跳过核对"（闸门静默失效）。
 */
export function pathDirs() {
  return (process.env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0)
}

/** 命中就返回绝对路径；没命中就把搜过的位置记进 `tried`，返回 undefined（失败时要点名）。 */
const hit = (tried, file) => {
  try {
    if (file !== undefined && existsSync(file)) return file
  } catch {
    // 非法字符 / 无权限的路径 = 不在这里
  }
  if (file !== undefined) tried.push(file)
  return undefined
}

const safeRealpath = (file) => {
  try {
    return realpathSync(file)
  } catch {
    return undefined
  }
}

const readManifestName = (manifest) => {
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).name
  } catch {
    return undefined
  }
}

/**
 * 定位 `npm-cli.js`，返回 `{ cli, searched }`（`cli` 找不到时 undefined）。
 *
 * 两种真实布局都要覆盖：
 *  - 官方安装包（Windows / macOS）：npm 就住在 node 旁边的 `node_modules/npm/bin/`。
 *  - Debian/Ubuntu 的发行版包：`/usr/bin/npm` 是指向 `/usr/lib/node_modules/npm/bin/npm-cli.js`
 *    的符号链接——只跟着 execPath 找在这里找不到。
 * 找不到就响亮失败并点名搜过哪些路径：不允许"找不到就跳过"，否则打包闸门静默退化成空用例。
 */
export function locateNpmCli() {
  const tried = []
  const nodeDir = dirname(safeRealpath(process.execPath) ?? process.execPath)
  const beside = hit(tried, join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  if (beside !== undefined) return { cli: beside, searched: tried }

  for (const dir of pathDirs()) {
    for (const shim of ['npm', 'npm.cmd']) {
      const candidate = join(dir, shim)
      try {
        if (!existsSync(candidate)) continue
      } catch {
        continue
      }
      // Linux/macOS：垫片本身就（或链到）npm-cli.js；Windows：从垫片旁边找 node_modules/npm
      const real = safeRealpath(candidate)
      const found = (real !== undefined && basename(real) === 'npm-cli.js' && hit(tried, real))
        || hit(tried, join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
        || hit(tried, resolve(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
      if (found !== undefined) return { cli: found, searched: tried }
    }
  }
  return { cli: undefined, searched: tried }
}

/**
 * 在 PATH 里找 dsh 可执行文件，回溯到它的包根（`package.json` 的 `bin` = `lib/bin.js`）。
 * `DSH_PACKAGE_DIR` 优先（CI 或非常规安装）。
 */
export function locateDshPackage() {
  if (process.env.DSH_PACKAGE_DIR) return process.env.DSH_PACKAGE_DIR
  for (const dir of pathDirs()) {
    for (const name of ['dsh', 'dsh.cmd']) {
      const candidate = join(dir, name)
      let current
      try {
        if (!existsSync(candidate)) continue
        current = dirname(safeRealpath(candidate) ?? candidate)
      } catch {
        continue
      }
      // 垫片可能在 <pkg>/bin 或发行版的 bin 目录里，向上找带这个名字的 package.json
      for (let depth = 0; depth < 4; depth += 1) {
        if (readManifestName(join(current, 'package.json')) === '@deepseek-ai/dsh') return current
        current = dirname(current)
      }
    }
  }
  return undefined
}

/** dsh 的入口脚本；包根或入口找不到就 undefined（调用方响亮报错，不静默跳过）。 */
export function locateDshCli() {
  const dir = locateDshPackage()
  if (dir === undefined) return undefined
  return hit([], join(dir, 'lib', 'bin.js'))
}
