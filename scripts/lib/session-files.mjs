/**
 * 在 DSH 的 session store 里找会话文件。
 *
 * ⛔ 为什么单独一份并可测：这里曾经硬编码 `session.v3.jsonl.zstd`，而 0.2.0-rc.2 的宿主写的是
 * `session.v4.jsonl.zstd` ⇒ `npm run verify:sessions` 在本机扫到 **0 份**会话，然后打印
 * "✅ 全部可冷加载"——闸门不是报错，是**绿着空转**（本机实测：store 里 384 份 v3 + 47 份 v4，
 * 它一份都没读过）。写这个脚本时宿主还在 v3，格式换了没有任何本地测试会红，所以只能靠
 * "按版本挑最新那份" + 一条用真名建目录的回归把这件事钉住。
 *
 * 真实形状（逐帧 zstd 的解压不在这里，见 `decode`）：
 *   <sessionsRoot>/<按 cwd 编码的目录>/<session-id>/session.v4.jsonl.zstd
 * 同一目录可能同时留着旧版（升级前写入的 v3 与之后重写的 v4），所以**取版本号最大的那份**，
 * 而不是"存在 v3 就算"。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SESSION_FILE = /^session\.v(\d+)\.jsonl(?:\.zst|\.zstd)?$/u

/** 一个 session 目录里的当前会话文件；没有则 undefined。 */
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

/**
 * 扫 store，返回 `<since>`（epoch ms，含）之后写过、且有非空会话文件的记录。
 * `sessionsRoot` 不存在时返回空数组（调用方负责把"0 份"报成可见的跳过，不许当成通过）。
 */
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
    for (const id of readdirSync(workspacePath)) {
      const found = latestSessionFile(join(workspacePath, id))
      if (found === undefined || found.mtime < since) continue
      records.push({ id, file: found.file, version: found.version, mtime: found.mtime })
    }
  }
  return records
}
