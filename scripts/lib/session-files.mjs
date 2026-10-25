/**
 * Finds the current session file inside a DSH session store.
 * ⛔ Always take the highest `session.v<N>.jsonl[.zst|.zstd]` per directory: the host moved v3 → v4,
 * and a hardcoded name scanned 0 sessions while printing "all load fine".
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SESSION_FILE = /^session\.v(\d+)\.jsonl(?:\.zst|\.zstd)?$/u

/**
 * DSH encodes cwd into the session dir name: strip the leading `/`, replace `/` with `-`,
 * wrap in `-`. Backslashes are normalized first: Windows callers may hand us a native path,
 * while the harness always encodes separators forward. Paths are not reversible (dashes
 * collide with separators), so compare only forward encodings.
 */
export function workspaceSlug(cwd) {
  return `--${String(cwd).replace(/\\/g, '/').replace(/^\//, '').replace(/\//g, '-')}--`
}

export function latestSessionFile(sessionDir) {
  let best
  let names
  try {
    names = readdirSync(sessionDir)
  } catch {
    return undefined
  }
  for (const name of names) {
    const matched = SESSION_FILE.exec(name)
    if (matched === null) continue
    const version = Number(matched[1])
    if (best !== undefined && version <= best.version) continue
    const file = join(sessionDir, name)
    let stat
    try {
      stat = statSync(file)
    } catch {
      continue
    }
    if (stat.size === 0) continue
    best = { file, version, mtime: stat.mtimeMs }
  }
  return best
}

// A missing root returns []; callers must report 0 sessions as a visible skip, not a pass.
export function findWorkspaceSessionRecords(workspaceRoot, since = 0) {
  if (!existsSync(workspaceRoot)) return []
  const records = []
  let entries
  try {
    entries = readdirSync(workspaceRoot)
  } catch {
    return []
  }
  for (const id of entries) {
    const found = latestSessionFile(join(workspaceRoot, id))
    if (found === undefined || found.mtime < since) continue
    records.push({ id, file: found.file, version: found.version, mtime: found.mtime })
  }
  return records
}

// A missing root returns []; callers must report 0 sessions as a visible skip, not a pass.
export function findSessionRecords(sessionsRoot, since = 0) {
  if (!existsSync(sessionsRoot)) return []
  const records = []
  for (const workspace of readdirSync(sessionsRoot)) {
    const workspacePath = join(sessionsRoot, workspace)
    try {
      if (!statSync(workspacePath).isDirectory()) continue
    } catch {
      continue
    }
    records.push(...findWorkspaceSessionRecords(workspacePath, since))
  }
  return records
}
