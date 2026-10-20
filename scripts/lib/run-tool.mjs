/**
 * Spawns a Node CLI (npm / dsh) without a shell. On Windows these are .cmd shims: name-spawn gives
 * ENOENT (with empty stderr) or EINVAL, and `shell: true` with an args array is DEP0190. Both CLIs
 * are plain Node, so `spawn(process.execPath, [cli.js, ...args])` is the quote-free path.
 * No platform branch here: PATH delimiter comes from node:path.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

/**
 * PATH directories. Always split on `delimiter`: `split(':')` breaks Windows paths and fails as a
 * silent "never found → skip the check".
 */
export function pathDirs() {
  return (process.env.PATH ?? '').split(delimiter).filter((dir) => dir.length > 0)
}

/** Returns an absolute path on hit; records misses in `tried` so failures can name them. */
const hit = (tried, file) => {
  try {
    if (file !== undefined && existsSync(file)) return file
  } catch {
    // Illegal characters / no permission just mean "not here".
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
 * Locates `npm-cli.js`, returning `{ cli, searched }`. Two real layouts must work: the official
 * installer (npm beside node) and Debian/Ubuntu (a symlink into /usr/lib/node_modules).
 * Missing must fail loudly with the searched paths, never degrade the packaging gate to an empty case.
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
      // Linux/macOS: the shim is (or links to) npm-cli.js; Windows: npm sits beside the shim.
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
 * Finds the dsh executable on PATH and walks up to its package root (`package.json` name
 * `@deepseek-ai/dsh`). `DSH_PACKAGE_DIR` wins (CI or unusual installs).
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
      // The shim may sit in <pkg>/bin or a distro bin dir; walk up to the matching package.json.
      for (let depth = 0; depth < 4; depth += 1) {
        if (readManifestName(join(current, 'package.json')) === '@deepseek-ai/dsh') return current
        current = dirname(current)
      }
    }
  }
  return undefined
}

/** dsh entry script; undefined when missing so callers can fail loudly. */
export function locateDshCli() {
  const dir = locateDshPackage()
  if (dir === undefined) return undefined
  return hit([], join(dir, 'lib', 'bin.js'))
}
