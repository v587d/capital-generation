/**
 * Script-side credential lookup by ref name (runtime uses the host credentials service).
 * Env var wins over ~/.dsh/.credentials.yaml, matching runtime order. ⛔ Returned strings must
 * never be printed or written by any caller.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveCredential(ref) {
  const fromEnv = process.env[ref]
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  try {
    const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    const matched = new RegExp(`^\\s*${ref}:\\s*(.+?)\\s*$`, 'm').exec(text)
    if (matched) return matched[1].replace(/^["']|["']$/g, '')
  } catch {
    // Unreadable credential file: the caller decides how to report the missing key.
  }
  return undefined
}
