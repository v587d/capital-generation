/**
 * 读取宿主 credentials 引用（脚本侧专用；运行时走宿主 credentials 服务，见 src/index.ts）。
 *
 * 为什么要有它：`smoke-fuyao.mjs` 与 Wind 探针都要拿 Key，而两处各写一遍正则就是
 * AGENTS.md §9.7 那一族——Key 解析改了只改一处，另一处静默失效。
 * 顺序与运行时一致：环境变量优先，其次 `~/.dsh/.credentials.yaml`。
 * ⛔ 只返回字符串，任何调用方都不许把它打印或落盘。
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
    // 凭据文件不可读时由调用方决定怎么报缺 Key
  }
  return undefined
}
