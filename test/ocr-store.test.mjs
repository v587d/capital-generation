// `src/ocr/store.ts` 的落盘回归：产物层是"第二次读取不再花钱"的唯一凭据。
//
// 为什么单独钉一份：`ocr` 的全部省钱逻辑（内容寻址 `doc_id`、按页取回、关键词定位）都建立在
// "正文确实在盘上、且能被原样读回来"之上。半件产物（写完 document 还没写 meta 就被中断）
// 必须**可自愈**而不是把 `doc_id` 永久锁死；三种"读不到"（没解析过 / 记录坏了 / 正文丢了）
// 必须在回执里是三种话。fs 与 sandbox 走假实现，路径由 `WorkspaceDatasetStore` 真实校验。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceDatasetStore } from '../lib/data-collector/store.js'
import {
  OCR_ARTIFACT_SUBDIR,
  OCR_DOC_ID_PATTERN,
  OCR_MAX_SOURCE_BYTES,
  buildArtifactMeta,
  deriveOcrDocId,
  ocrArtifactRef,
  OcrArtifactError,
  readOcrArtifact,
  readOcrSourceBytes,
  writeOcrArtifact,
} from '../lib/ocr/store.js'
import { buildOcrDocument } from '../lib/ocr/markdown.js'

const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }
const ROOT = '/workspace/proj'
const DOC_ID = 'ocr_1a2b3c4d5e6f'
/** 内存 fs：只实现 OCR 产物层用到的最小子集（含 `readBytes` 与 `stat`）。 */
function fakeFs() {
  const files = new Map()
  const bytes = new Map()
  const dirs = new Set()
  const ops = []
  const norm = (path) => {
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return `/${parts.join('/')}`
  }
  const failure = (code, message) => Object.assign(new Error(message), { code })
  return {
    files, bytes, dirs, ops,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      const normalized = norm(path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`)
      return { targetKey: `key:${normalized}`, displayPath: normalized }
    },
    contains(parent, child) {
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async writeText(target, content, expected) {
      ops.push({ op: 'write', path: target.displayPath, expected: expected?.kind })
      if (expected?.kind === 'createIfAbsent' && files.has(target.displayPath)) {
        throw failure('FS_NOT_OBSERVED', 'already exists')
      }
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let index = 1; index < segments.length; index += 1) dirs.add(`/${segments.slice(0, index).join('/')}`)
      files.set(target.displayPath, content)
      return { operation: 'create', version: 'v1', before: null, after: content }
    },
    async readText(target) {
      if (!files.has(target.displayPath)) throw failure('FS_NOT_FOUND', 'missing')
      return files.get(target.displayPath)
    },
    async readBytes(target, _signal, maxBytes) {
      const value = bytes.get(target.displayPath)
      if (value === undefined) throw failure('FS_NOT_FOUND', 'missing')
      if (value.byteLength > maxBytes) throw failure('FS_TOO_LARGE', 'too large')
      return value
    },
    async stat(target) {
      if (files.has(target.displayPath)) return { type: 'file', size: Buffer.byteLength(files.get(target.displayPath)) }
      if (bytes.has(target.displayPath)) return { type: 'file', size: bytes.get(target.displayPath).byteLength }
      if (dirs.has(target.displayPath)) return { type: 'directory' }
      return undefined
    },
    seedBytes(relative, value) { bytes.set(`${ROOT}/${relative}`, value) },
    drop(relative) { files.delete(`${ROOT}/${relative}`) },
  }
}

function makeStore(options = {}) {
  const fs = options.fs ?? fakeFs()
  const store = new WorkspaceDatasetStore({
    fs,
    sandboxPolicy: options.sandboxPolicy ?? { resolve: ({ session }) => ({ mode: 'workspace-write', workspaceRoot: ROOT, sessionId: session?.id }) },
    now: () => 1_700_000_000_000,
  })
  return { store, fs }
}

const document = buildOcrDocument([
  { page: 1, markdown: '# 封面\n贵州茅台研报', images: 1 },
  { page: 2, markdown: '第二节：营业收入 1,740.63 亿元', images: 0 },
])

function metaFor(overrides = {}) {
  return buildArtifactMeta({
    doc_id: DOC_ID,
    source: 'url:https://pdf.dfcfw.com/H3_1.pdf',
    source_kind: 'url',
    charts: true,
    job_id: 'job-1',
    model: 'PaddleOCR-VL-1.6',
    document,
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  })
}

test('落盘：document.md 先写、meta.json 后写（meta 在场即产物完整），回执只给 workspace:// 引用', async () => {
  const { store, fs } = makeStore()
  const written = await writeOcrArtifact(store, { session: SESSION, meta: metaFor(), document })
  assert.deepEqual(fs.ops.map((op) => [op.path.replace(`${ROOT}/`, ''), op.expected]), [
    [`capital-data/ocr/${DOC_ID}/document.md`, 'createIfAbsent'],
    [`capital-data/ocr/${DOC_ID}/meta.json`, 'createIfAbsent'],
  ], '顺序反过来就会留下"meta 说有两页、正文不在"的死产物')
  assert.equal(written.artifact_ref, `workspace://capital-data/ocr/${DOC_ID}`)
  assert.deepEqual(written.paths, [`capital-data/ocr/${DOC_ID}/document.md`, `capital-data/ocr/${DOC_ID}/meta.json`], '回给 Agent 的只能是相对路径')
  assert.ok(!JSON.stringify({ ref: written.artifact_ref, paths: written.paths }).includes(ROOT), '⛔ 绝对路径不出宿主进程')
  assert.equal(fs.files.get(`${ROOT}/capital-data/ocr/${DOC_ID}/document.md`), document.document)
})

test('读回：meta 与页偏移索引原样回来，按页切片命中正文（第二次读取不再出网）', async () => {
  const { store } = makeStore()
  await writeOcrArtifact(store, { session: SESSION, meta: metaFor(), document })
  const artifact = await readOcrArtifact(store, { session: SESSION, doc_id: DOC_ID })
  assert.equal(artifact.meta.doc_id, DOC_ID)
  assert.equal(artifact.meta.pages, 2)
  assert.equal(artifact.meta.chars, document.chars)
  assert.equal(artifact.meta.images, 1)
  assert.equal(artifact.meta.tables, 0)
  assert.equal(artifact.meta.created_at, '2026-09-25T00:00:00.000Z')
  assert.deepEqual(artifact.meta.page_entries, document.pages)
  assert.equal(artifact.document.document, document.document)
  const second = artifact.document.pages[1]
  assert.equal(artifact.document.document.slice(second.start, second.end), '第二节：营业收入 1,740.63 亿元')
})

test('三种"读不到"是三种形状：没解析过=undefined；正文丢失/记录损坏=响亮抛错', async () => {
  const fresh = makeStore()
  assert.equal(await readOcrArtifact(fresh.store, { session: SESSION, doc_id: DOC_ID }), undefined, '缺缓存必须能被调用方翻译成"去提交一次作业"')

  const halfWritten = makeStore()
  await writeOcrArtifact(halfWritten.store, { session: SESSION, meta: metaFor(), document })
  halfWritten.fs.drop(`capital-data/ocr/${DOC_ID}/document.md`)
  await assert.rejects(() => readOcrArtifact(halfWritten.store, { session: SESSION, doc_id: DOC_ID }), (error) => {
    assert.ok(error instanceof OcrArtifactError, '半件产物要有自己的类型：翻回执的那一层要知道该说什么下一步')
    assert.equal(error.reason, 'document_missing')
    assert.equal(error.docId, DOC_ID)
    assert.equal(error.sourceKind, 'url', 'meta 里存着的来源指认要一并交出去——修复需要它，而调用方手上未必还有')
    assert.equal(error.source, 'url:https://pdf.dfcfw.com/H3_1.pdf')
    assert.ok(!/refresh/u.test(error.message), '这一层不发指令：读形态不接受 refresh，指令属于回执层')
    return true
  }, 'meta 在、正文不在：不能说"没有内容"，也不能静默重跑（那要再花一次钱）')

  // 反过来（只写了正文没写 meta）就是"未缓存"：下一次解析用 overwrite 自愈，不锁死 doc_id。
  const orphan = makeStore()
  await orphan.store.writeWorkspaceFiles({ session: SESSION, dir: `${OCR_ARTIFACT_SUBDIR}/${DOC_ID}`, files: [{ name: 'document.md', content: '半件产物' }] })
  assert.equal(await readOcrArtifact(orphan.store, { session: SESSION, doc_id: DOC_ID }), undefined)
  const rewritten = await writeOcrArtifact(orphan.store, { session: SESSION, meta: metaFor(), document, overwrite: true })
  assert.equal(rewritten.artifact_ref, `workspace://capital-data/ocr/${DOC_ID}`, 'overwrite 让被中断的 doc_id 能被重新解析')

  const metaOnly = makeStore()
  await writeOcrArtifact(metaOnly.store, { session: SESSION, meta: metaFor(), document })
  metaOnly.fs.files.set(`${ROOT}/capital-data/ocr/${DOC_ID}/meta.json`, '{ not json')
  await assert.rejects(() => readOcrArtifact(metaOnly.store, { session: SESSION, doc_id: DOC_ID }), (error) => {
    assert.ok(error instanceof OcrArtifactError)
    assert.equal(error.reason, 'meta_invalid')
    assert.match(error.message, /不是可识别的记录/)
    return true
  })
})

test('盘上记录被手改过也要响亮失败：doc_id 与目录不一致、页偏移缺字段、来源类别不认识', async () => {
  const cases = [
    [{ doc_id: 'ocr_ffffffffffff' }, /doc_id 与目录不一致/],
    [{ page_entries: [{ page: 1, start: 0 }] }, /page_entries/],
    [{ source_kind: 'magic' }, /source_kind 不认识/],
    [{ model: undefined }, /meta\.model/],
  ]
  for (const [patch, expectation] of cases) {
    const { store, fs } = makeStore()
    await writeOcrArtifact(store, { session: SESSION, meta: metaFor(), document })
    const meta = { ...metaFor(), ...patch }
    fs.files.set(`${ROOT}/capital-data/ocr/${DOC_ID}/meta.json`, `${JSON.stringify(meta)}\n`)
    await assert.rejects(() => readOcrArtifact(store, { session: SESSION, doc_id: DOC_ID }), expectation)
  }
})

test('doc_id 是内容寻址的：同文同参数撞同一个键，换 model/charts 就是另一个键', () => {
  const url = 'url:https://pdf.dfcfw.com/pdf/H3_AN202404021629466789_1.pdf'
  assert.equal(deriveOcrDocId(url, 'PaddleOCR-VL-1.6', true), deriveOcrDocId(url, 'PaddleOCR-VL-1.6', true))
  assert.ok(OCR_DOC_ID_PATTERN.test(deriveOcrDocId(url, 'PaddleOCR-VL-1.6', true)))
  assert.notEqual(deriveOcrDocId(url, 'PaddleOCR-VL-1.6', false), deriveOcrDocId(url, 'PaddleOCR-VL-1.6', true), 'charts 关掉就是另一份产物，不能互相冒充')
  assert.notEqual(deriveOcrDocId(url, 'PaddleOCR-VL-2.0', true), deriveOcrDocId(url, 'PaddleOCR-VL-1.6', true))
  const bytes = new Uint8Array([1, 2, 3])
  assert.equal(deriveOcrDocId(bytes, 'm', true), deriveOcrDocId(new Uint8Array([1, 2, 3]), 'm', true), '本地字节按内容寻址，与文件名无关')
  assert.notEqual(deriveOcrDocId(bytes, 'm', true), deriveOcrDocId(new Uint8Array([1, 2, 4]), 'm', true))
})

test('落盘只带得走"该带的"：meta 里没有绝对路径，字段是闭集', async () => {
  const { store, fs } = makeStore()
  await writeOcrArtifact(store, { session: SESSION, meta: metaFor(), document })
  const text = fs.files.get(`${ROOT}/capital-data/ocr/${DOC_ID}/meta.json`)
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), [
    'chars', 'charts', 'created_at', 'doc_id', 'images', 'job_id', 'model', 'page_entries',
    'pages', 'source', 'source_kind', 'style_chars_removed', 'tables',
  ].sort(), '落盘字段是闭集：多一个就是多一处可能泄露信息（新增须在此写明理由）')
  assert.ok(!text.includes(SESSION.header.cwd), 'meta 只记 workspace 相对路径')
  assert.equal(ocrArtifactRef(DOC_ID), `workspace://${OCR_ARTIFACT_SUBDIR}/${DOC_ID}`)
})

test('file 形态读取：只收 workspace 相对路径，字节上限显式，缺 readBytes 能力响亮失败', async () => {
  const { store, fs } = makeStore()
  fs.seedBytes('refs/茅台研报.pdf', new Uint8Array([37, 80, 68, 70]))
  const read = await readOcrSourceBytes(store, { session: SESSION, path: 'refs/茅台研报.pdf' })
  assert.deepEqual([...read.bytes], [37, 80, 68, 70])
  assert.equal(read.filename, '茅台研报.pdf', '上传给上游的文件名取路径末段（不带目录）')

  // 后缀闸门属于工具层（`normalizeLocalPath`），这一层只管"是不是 workspace 内的相对路径"。
  for (const path of ['/etc/passwd.pdf', '../outside.pdf', 'refs/../../x.pdf', 'refs/../escape.pdf']) {
    await assert.rejects(() => readOcrSourceBytes(store, { session: SESSION, path }), (error) => {
      assert.match(`${error.code} ${error.message}`, /workspace_path_invalid|relative to the session workspace|not contain/u, `${path} 应该被拒`)
      return true
    })
  }
  await assert.rejects(() => readOcrSourceBytes(store, { session: SESSION, path: 'refs/missing.pdf' }), /was not found/, '没这个文件 ≠ 空文档')

  fs.seedBytes('refs/huge.pdf', new Uint8Array(OCR_MAX_SOURCE_BYTES + 1))
  await assert.rejects(() => readOcrSourceBytes(store, { session: SESSION, path: 'refs/huge.pdf' }), /exceeds/)

  const blindFs = { ...fakeFs(), readBytes: undefined }
  blindFs.seedBytes('refs/a.pdf', new Uint8Array([1]))
  const noBytes = makeStore({ fs: blindFs })
  await assert.rejects(() => readOcrSourceBytes(noBytes.store, { session: SESSION, path: 'refs/a.pdf' }), /filesystem_unavailable|cannot read raw bytes/u,
    '⛔ 二进制不许回退成 readText：解码会把字节弄坏')
})

test('权限不足（read-only）时零写入：落盘是 ocr 的硬前提，不能只在内存里给正文', async () => {
  const fs = fakeFs()
  const { store } = makeStore({ fs, sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: ROOT }) } })
  await assert.rejects(() => writeOcrArtifact(store, { session: SESSION, meta: metaFor(), document }), /workspace_not_writable/)
  assert.equal(fs.ops.length, 0)
})
