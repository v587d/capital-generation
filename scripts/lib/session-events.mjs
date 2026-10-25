/**
 * One reader for durable session event logs. Node's zstd decoder stops after
 * the first frame, while DSH appends one frame per write, so a whole-file
 * decode silently loses every frame after the first. Four reports had their
 * own copy of this loop; keep the frame walk here.
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export function decodeSessionText(file) {
  const buffer = readFileSync(file)
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) >= 0) {
    offsets.push(cursor)
    cursor += ZSTD_MAGIC.length
  }
  offsets.push(buffer.length)
  let text = ''
  for (let index = 0; index < offsets.length - 1; index += 1) {
    try {
      text += zstdDecompressSync(buffer.subarray(offsets[index], offsets[index + 1])).toString('utf8')
    } catch {
      // A coincidental magic inside compressed data splits the frame wrong; skip it.
    }
  }
  return text
}

export function parseSessionLines(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // Ignore the truncated tail line of a half-written record.
    }
  }
  return events
}

/** Read a plain or multi-frame zstd session file into parsed events. */
export function readSessionEvents(file) {
  const text = file.endsWith('.jsonl') ? readFileSync(file, 'utf8') : decodeSessionText(file)
  return parseSessionLines(text)
}
