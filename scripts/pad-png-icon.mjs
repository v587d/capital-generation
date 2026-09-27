import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const [,, srcPath, outPath, targetSideRaw] = process.argv
const targetSide = Number(targetSideRaw ?? 24)
if (!srcPath || !outPath || !Number.isFinite(targetSide) || targetSide <= 0) {
  console.error('usage: node scripts/pad-png-icon.mjs <in.png> <out.png> [visualSide=24]')
  process.exit(1)
}

const buf = readFileSync(srcPath)
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
let pos = 8
let width, height, bitDepth, colorType, interlace
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4)
    bitDepth = data[8]; colorType = data[9]; interlace = data[12]
  } else if (type === 'IDAT') idat.push(data)
  pos += 12 + len
}
if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
  throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`)
}

const bpp = 4
const stride = width * bpp
const raw = inflateSync(Buffer.concat(idat))
if (raw.length !== height * (stride + 1)) throw new Error('IDAT size mismatch')
const px = Buffer.alloc(height * stride)
const prev = Buffer.alloc(stride)
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
  const cur = px.subarray(y * stride, (y + 1) * stride)
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0
    const b = prev[x]
    const c = x >= bpp ? prev[x - bpp] : 0
    let v = line[x]
    if (filter === 1) v += a
    else if (filter === 2) v += b
    else if (filter === 3) v += (a + b) >> 1
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    } else if (filter !== 0) throw new Error(`bad filter ${filter}`)
    cur[x] = v & 0xff
  }
  cur.copy(prev)
}

// 画布边长让 logo 长边缩放到 targetSide 时刚好填满（渲染侧固定 36px 方框，等比 contain）
const side = Math.max(Math.ceil((Math.max(width, height) * 36) / targetSide), Math.max(width, height))
const offX = Math.floor((side - width) / 2)
const offY = Math.floor((side - height) / 2)
const canvas = Buffer.alloc(side * side * bpp)
for (let y = 0; y < height; y++) {
  px.copy(canvas, ((y + offY) * side + offX) * bpp, y * stride, (y + 1) * stride)
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4)
ihdr[8] = 8; ihdr[9] = 6
const lines = Buffer.alloc(side * (side * bpp + 1))
for (let y = 0; y < side; y++) {
  canvas.copy(lines, y * (side * bpp + 1) + 1, y * side * bpp, (y + 1) * side * bpp)
}
writeFileSync(outPath, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(lines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]))
console.log(`${width}x${height} -> ${side}x${side} canvas, logo visual ~${targetSide}px in a 36px frame`)
