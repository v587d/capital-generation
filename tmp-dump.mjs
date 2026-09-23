import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decodeSession(file) {
  const buffer = readFileSync(file)
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(ZSTD_MAGIC, cursor)) >= 0) { offsets.push(cursor); cursor += ZSTD_MAGIC.length }
  offsets.push(buffer.length)
  let text = ''
  for (let i = 0; i < offsets.length - 1; i += 1) {
    try { text += zstdDecompressSync(buffer.subarray(offsets[i], offsets[i + 1])).toString('utf8') } catch {}
  }
  const events = []
  for (const line of text.split('\n')) { if (!line) continue; try { events.push(JSON.parse(line)) } catch {} }
  return events
}
const id = process.argv[2]
const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions', '--home-shawn-investment--', id, 'session.v3.jsonl.zstd')
const events = decodeSession(file)
console.log('events:', events.length, 'types:', [...new Set(events.map(e => e.type))].join(', '))
for (const e of events) {
  if (e.type === 'tool/call') {
    console.log('\n=== CALL', e.data?.name, '===')
    console.log(String(e.data?.arguments ?? '').slice(0, 1500))
  }
  if (e.type === 'tool/result') {
    console.log('--- RESULT keys=' + Object.keys(e.data ?? {}).join(',') + ' ---')
    console.log(JSON.stringify(e.data).slice(0, 3000))
  }
}
