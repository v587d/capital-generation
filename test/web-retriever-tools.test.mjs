import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerWebRetrieverTools } from '../lib/web-retriever/tools.js'
import { WebRetriever } from '../lib/web-retriever/retriever.js'
import { AnySearchError } from '../lib/web-retriever/engines.js'
import { LocalFetchError } from '../lib/web-retriever/local-fetch.js'
import { DatasetStoreError } from '../lib/data-collector/store.js'
import { OcrError } from '../lib/ocr/client.js'
import { buildOcrDocument } from '../lib/ocr/markdown.js'
import { assertToolOutput } from './output-contract.mjs'

function fakeToolRuntime() {
  const definitions = []
  return {
    definitions,
    register: (definition) => {
      definitions.push(definition)
      return () => {}
    },
  }
}

function fakeCtx(toolRuntime) {
  const services = { tools: toolRuntime }
  return {
    get: (name) => services[name],
    effect: (fn) => fn(),
  }
}

function fakeRetriever(options = {}) {
  const calls = { search: [], fetch: [] }
  const retriever = new WebRetriever({
    search: async (request) => {
      calls.search.push(request)
      return options.search?.(request) ?? { results: [{ url: 'https://example.test/result', title: 'Title', snippet: 'Snippet' }] }
    },
    extract: async (request) => {
      calls.fetch.push(request)
      if (options.extract) return options.extract(request)
      return { title: 'Page', content: 'Body' }
    },
  }, options.localFetch)
  return { retriever, calls }
}

function fakeLocalFetcher(result) {
  let calls = 0
  return {
    calls: () => calls,
    fetch: async (url) => {
      calls += 1
      if (result instanceof Error) throw result
      return result ?? { url, status: 200, title: 'Local page', markdown: 'local body', truncated: false }
    },
  }
}

function fakeWindClient(overrides = {}) {
  const calls = []
  const client = {
    callTool: async (toolName, args) => {
      calls.push({ toolName, args })
      return overrides.callTool?.(toolName, args) ?? { ok: true, data: { items: ['doc'] } }
    },
  }
  return { client, calls }
}

function registerAll(retriever, windClient, ocr) {
  const runtime = fakeToolRuntime()
  registerWebRetrieverTools(fakeCtx(runtime), retriever, windClient, ocr ?? fakeOcrDeps().deps)
  return runtime
}

function runTool(runtime, name, args, session) {
  const definition = runtime.definitions.find((item) => item.name === name)
  assert.ok(definition, `tool ${name} should be registered`)
  const resolved = typeof session === 'string' || session === undefined ? (session ? { id: session } : undefined) : session
  return definition.execute(args, {
    signal: new AbortController().signal,
    ...(resolved ? { agent: { session: resolved } } : {}),
  })
}

/** 工具级夹具：假客户端 + 假 workspace（沙箱与落盘本身在 `test/ocr-store.test.mjs` 钉）。 */
function fakeOcrDeps(options = {}) {
  const files = new Map()
  const bytes = new Map(options.bytes ?? [])
  const sessions = []
  const writes = []
  const store = {
    async readWorkspaceText({ session, path }) {
      sessions.push(session)
      if (!files.has(path)) throw new DatasetStoreError('dataset_not_found', `${path} was not found`)
      return files.get(path)
    },
    async readWorkspaceBytes({ session, path }) {
      sessions.push(session)
      const value = bytes.get(path)
      if (value === undefined) throw new DatasetStoreError('dataset_not_found', `${path} was not found`)
      return value
    },
    async writeWorkspaceFiles({ session, dir, files: entries, overwrite }) {
      sessions.push(session)
      writes.push({ dir, names: entries.map((entry) => entry.name), overwrite: overwrite ?? false })
      return entries.map((entry) => {
        const path = `${dir}/${entry.name}`
        if (!overwrite && files.has(path)) throw new DatasetStoreError('dataset_write_failed', `writing ${path} failed`)
        files.set(path, entry.content)
        return { name: entry.name, path, absolutePath: `/workspace/proj/${path}` }
      })
    },
  }
  const submitCalls = []
  const waitCalls = []
  const client = {
    model: 'PaddleOCR-VL-1.6',
    async submit(input) {
      submitCalls.push(input)
      if (options.submitError) throw options.submitError
      return options.jobId ?? 'job-1'
    },
    async wait(jobId, signal) {
      waitCalls.push(jobId)
      if (options.waitError) throw options.waitError
      return options.wait ?? { status: 'done', job_id: jobId, elapsed_ms: 1_200, document: options.document ?? ocrDocument(2) }
    },
  }
  const deps = { store, client, now: () => Date.parse('2026-09-25T00:00:00.000Z') }
  return { deps, files, bytes, store, client, submitCalls, waitCalls, writes, sessions }
}

function ocrDocument(pages, pageChars = 120) {
  return buildOcrDocument(Array.from({ length: pages }, (_unused, index) => ({
    page: index + 1,
    markdown: `# 第 ${index + 1} 节\n营业收入 ${'数字'.repeat(pageChars / 2)} 亿元`,
    images: 0,
  })))
}

/** 公网性闸门默认走真实 DNS，测试里注入一个"全是公网地址"的解析器（生产路径不传）。 */
const PUBLIC_DNS = async () => [{ address: '93.184.216.34', family: 4 }]
const SESSION = { id: 'web-s1', header: { cwd: '/workspace/proj' } }

function registerOcr(ocr) {
  const runtime = registerAll(fakeRetriever().retriever, fakeWindClient().client, ocr)
  return { runtime, definition: runtime.definitions.find((item) => item.name === 'ocr') }
}

test('工具注册：anysearch 两工具 + wind_docs 两工具 + ocr，无条件注册（缺 Token 不影响注册）', () => {
  const runtime = registerAll(fakeRetriever().retriever, fakeWindClient().client, { store: {}, client: { model: 'm' } })
  assert.deepEqual(runtime.definitions.map((item) => item.name), [
    'anysearch_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news', 'ocr',
  ])
})

test('anysearch_search：单查询、参数有界、信封带 provider 与 recent_retrievals', async () => {
  const { retriever, calls } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'anysearch_search', { query: '贵州茅台公告', max_results: 3 }, 's1')
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'anysearch')
  assert.equal(result.sources[0].url, 'https://example.test/result')
  assert.equal(result.recent_retrievals.length, 1)
  assert.equal(result.recent_retrievals[0].tool, 'anysearch_search')
  assert.deepEqual(calls.search, [{ query: '贵州茅台公告', max_results: 3 }])
  await assert.rejects(() => runTool(runtime, 'anysearch_search', { query: '' }), /query is required/)
  await assert.rejects(() => runTool(runtime, 'anysearch_search', { query: 'x', max_results: 21 }), /between 1 and 20/)
})

test('web_retriever_fetch：严格单 URL，信封带 provider 与回声', async () => {
  const { retriever, calls } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/notice' }, 's1')
  const { recent_retrievals, provider_tally, ...rest } = result
  assert.deepEqual(rest, {
    provider: 'anysearch', url: 'https://example.test/notice', ok: true, via: 'anysearch', title: 'Page', content: 'Body', content_chars: 4,
  })
  assert.equal(recent_retrievals.length, 1)
  assert.equal(recent_retrievals[0].tool, 'web_retriever_fetch')
  assert.deepEqual(provider_tally, { anysearch: 1 })
  assert.deepEqual(calls.fetch, [{ url: 'https://example.test/notice' }])
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: 'file:///tmp/a' }), /only http\(s\) URLs are allowed/)
  await assert.rejects(() => runTool(runtime, 'web_retriever_fetch', { url: ['https://a.test', 'https://b.test'] }), /url is required/)
})

test('recent_retrievals 与 provider_tally：跨 provider 累计、按调用方 session 隔离、回声上限 8 而计数不封顶', async () => {
  const { retriever } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  await runTool(runtime, 'anysearch_search', { query: 'q1' }, 's1')
  await runTool(runtime, 'wind_docs_announcements', { query: 'q2' }, 's1')
  const third = await runTool(runtime, 'anysearch_search', { query: 'q3' }, 's1')
  assert.deepEqual(third.recent_retrievals.map((item) => [item.provider, item.tool, item.query]), [
    ['anysearch', 'anysearch_search', 'q1'],
    ['wind_docs', 'wind_docs_announcements', 'q2'],
    ['anysearch', 'anysearch_search', 'q3'],
  ])
  assert.deepEqual(third.provider_tally, { anysearch: 2, wind_docs: 1 }, 'tally 按 provider 累计且含本次')

  const other = await runTool(runtime, 'anysearch_search', { query: 'other-session' }, 's2')
  assert.equal(other.recent_retrievals.length, 1, '不同调用方 session 的回声相互隔离')
  assert.deepEqual(other.provider_tally, { anysearch: 1 }, '不同调用方 session 的计数相互隔离')

  let last
  for (let i = 0; i < 10; i += 1) {
    last = await runTool(runtime, 'anysearch_search', { query: `loop-${i}` }, 's3')
  }
  assert.equal(last.recent_retrievals.length, 8, '回声最多保留最近 8 条')
  assert.equal(last.recent_retrievals[7].query, 'loop-9')
  assert.deepEqual(last.provider_tally, { anysearch: 10 }, 'tally 累计不随回声截断而丢失')
})

test('wind_docs_announcements：透传上游工具名与参数，成功返回 data', async () => {
  const { retriever } = fakeRetriever()
  const wind = fakeWindClient()
  const runtime = registerAll(retriever, wind.client)
  const result = await runTool(runtime, 'wind_docs_announcements', { query: '茅台分红公告', top_k: 3 }, 's1')
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'wind_docs')
  assert.equal(result.tool, 'wind_docs_announcements')
  assert.equal(result.query, '茅台分红公告')
  assert.deepEqual(result.data, { items: ['doc'] })
  assert.deepEqual(wind.calls, [{ toolName: 'get_company_announcements', args: { query: '茅台分红公告', top_k: 3 } }])
  assert.ok(result.recent_retrievals.some((item) => item.tool === 'wind_docs_announcements'))

  const noTopK = await runTool(runtime, 'wind_docs_announcements', { query: 'x' }, 's1')
  assert.deepEqual(wind.calls.at(-1).args, { query: 'x' }, 'top_k 省略时不透传默认值')
  assert.equal(noTopK.ok, true)

  const news = await runTool(runtime, 'wind_docs_news', { query: '固态电池新闻' }, 's1')
  assert.equal(news.tool, 'wind_docs_news')
  assert.equal(wind.calls.at(-1).toolName, 'get_financial_news')
})

test('wind_docs：失败返回结构化错误信封而非抛错；参数校验拒绝越界', async () => {
  const { retriever } = fakeRetriever()
  const failing = fakeWindClient({ callTool: async () => ({ ok: false, code: 'AUTH', error: 'Wind API Key 未配置' }) })
  const runtime = registerAll(retriever, failing.client)
  const result = await runTool(runtime, 'wind_docs_announcements', { query: 'x' }, 's1')
  assert.deepEqual({ ok: result.ok, code: result.code, error: result.error }, {
    ok: false, code: 'AUTH', error: 'Wind API Key 未配置',
  })

  await assert.rejects(() => runTool(runtime, 'wind_docs_announcements', { query: '' }), /query is required/)
  await assert.rejects(() => runTool(runtime, 'wind_docs_announcements', { query: 'x', top_k: 0 }), /between 1 and 10/)
  await assert.rejects(() => runTool(runtime, 'wind_docs_news', { query: 'x', top_k: 11 }), /between 1 and 10/)
})

test('web_retriever_fetch：成功回执透出 via 且无 fallback/truncated，provider_tally 只计 anysearch', async () => {
  const { retriever } = fakeRetriever()
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/notice' }, 's1')
  assert.equal(result.via, 'anysearch')
  assert.equal(result.fallback, undefined)
  assert.equal(result.local_error, undefined)
  assert.equal(result.truncated, undefined)
  assert.equal(result.code, undefined)
  assert.deepEqual(result.provider_tally, { anysearch: 1 })
  assert.equal(result.recent_retrievals.at(-1).via, 'anysearch')
})

test('web_retriever_fetch：本地回退成功回执透出 via/fallback，recent_retrievals 记录 via', async () => {
  const local = fakeLocalFetcher()
  const { retriever } = fakeRetriever({
    extract: async () => { throw new AnySearchError('TARGET_BLOCKED', '/v1/extract', 'blocked by target') },
    localFetch: local,
  })
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/blocked' }, 's1')
  assert.equal(result.ok, true)
  assert.equal(result.via, 'local-http')
  assert.equal(result.content, 'local body')
  assert.equal(result.fallback.from, 'anysearch')
  assert.equal(result.fallback.code, 'TARGET_BLOCKED')
  assert.equal(local.calls(), 1)
  assert.equal(result.recent_retrievals.at(-1).via, 'local-http')
})

test('web_retriever_fetch：两边都失败必须抛错（isError），结构化回执不丢', async () => {
  const local = fakeLocalFetcher(new LocalFetchError('TIMEOUT', 'local fetch timed out'))
  const { retriever } = fakeRetriever({
    extract: async () => { throw new AnySearchError('TARGET_BLOCKED', '/v1/extract', 'blocked by target') },
    localFetch: local,
  })
  const runtime = registerAll(retriever, fakeWindClient().client)
  // 回归（2026-09 实测缺陷）：失败此前被做成 ok:false 信封**正常返回**，于是子 Agent
  // 会话日志里 7 次实际失败的抓取全部记成 isError:false，UI 与模型都当成成功。
  // DSH 的 createSuccessResult 硬编码 isError:false ⇒ 唯一通道是从 execute 抛出。
  let payload
  await assert.rejects(
    () => runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/blocked' }, 's1'),
    (error) => {
      assert.ok(error instanceof Error, '必须抛 Error 才能让宿主置 isError')
      payload = JSON.parse(error.message)
      return true
    },
  )
  assert.equal(payload.ok, false)
  assert.equal(payload.via, 'anysearch')
  assert.equal(payload.code, 'TARGET_BLOCKED')
  assert.equal(payload.local_error.code, 'TIMEOUT')
  assert.match(payload.error, /blocked by target/)
  assert.match(payload.error, /local fetch timed out/)
  assert.equal(payload.recent_retrievals.at(-1).tool, 'web_retriever_fetch', '抛错路径仍保留检索回声')
  assert.deepEqual(payload.provider_tally, { anysearch: 1 })
})

test('web_retriever_fetch：截断回执透出 truncated', async () => {
  const { retriever } = fakeRetriever({
    extract: async () => ({ title: 'Long', content: 'x'.repeat(30_000) }),
  })
  const runtime = registerAll(retriever, fakeWindClient().client)
  const result = await runTool(runtime, 'web_retriever_fetch', { url: 'https://example.test/long' }, 's1')
  assert.equal(result.truncated, true)
})

test('web_retriever_fetch 描述声明自动回退与 via 来源标注', () => {
  const runtime = registerAll(fakeRetriever().retriever, fakeWindClient().client)
  const definition = runtime.definitions.find((item) => item.name === 'web_retriever_fetch')
  assert.match(definition.description, /via/u)
  assert.match(definition.description, /本机直连/u)
})

// ── ocr：四形态、预算装载与失败映射 ───────────────────────────────────────
//
// `ocr` 的形态歧义、超预算装载与"超时不是失败"都是**模型会踩**的形状，所以这一组只测工具层：
// 上游协议在 `test/ocr-client.test.mjs`，落盘与编排在 `test/ocr-store.test.mjs`（§9.7 各层各测一份）。

const OCR_URL = 'https://pdf.dfcfw.com/pdf/H3_AN202404021629466789_1.pdf'

function ocrDnsDeps(options = {}) {
  const fixture = fakeOcrDeps(options)
  return { ...fixture, deps: { ...fixture.deps, resolveAddresses: PUBLIC_DNS } }
}

test('ocr 定义：普通工具自带 timeoutMs，参数根是 jsonObject 且无必填（四形态靠可选属性）', () => {
  const { definition } = registerOcr(fakeOcrDeps().deps)
  assert.equal(definition.timeoutMs, 240_000, '长任务靠工具自带 timeoutMs，不需要 backgroundTask 改造')
  assert.equal(definition.parameters.type, 'object')
  assert.equal(definition.parameters.additionalProperties, false)
  assert.deepEqual(definition.parameters.required, [])
  assert.deepEqual(Object.keys(definition.parameters.properties).sort(), [
    'charts', 'doc_id', 'file', 'job_id', 'limit', 'pages', 'query', 'refresh', 'url',
  ])
  assert.match(definition.description, /整篇一次算完/u, 'pages 不影响算价必须写在 description 里，否则模型以为翻页省钱')
  assert.match(definition.description, /不重复提交、不再花钱/u)
  assert.match(definition.description, /不得把 PDF 链接当正文来源标注/u)
})

test('ocr url 形态：提交一次、落盘两份文件、回执给 workspace:// 引用与全文', async () => {
  const fixture = ocrDnsDeps()
  const { runtime, definition } = registerOcr(fixture.deps)
  const result = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  assertToolOutput(definition, result)
  assert.equal(result.provider, 'paddleocr')
  assert.equal(result.status, 'done')
  assert.equal(result.ok, true)
  assert.equal(result.cached, false)
  assert.equal(result.pages, 2)
  assert.equal(result.source, `url:${OCR_URL}`)
  assert.equal(result.source_kind, 'url')
  assert.equal(result.model, 'PaddleOCR-VL-1.6')
  assert.equal(result.created_at, '2026-09-25T00:00:00.000Z')
  assert.match(result.artifact_ref, /^workspace:\/\/capital-data\/ocr\/ocr_[0-9a-f]{12}$/u)
  assert.equal(result.doc_id, result.artifact_ref.split('/').pop(), 'doc_id 与引用是同一个键，模型能自己核对')
  assert.match(result.content, /营业收入/)
  assert.equal(result.content_chars, result.chars)
  assert.deepEqual(fixture.submitCalls.map((call) => call.fileUrl), [OCR_URL], '本机不抓文件：交给上游的是 fileUrl')
  assert.deepEqual(fixture.writes.map((write) => [write.dir.replace('capital-data/ocr/', ''), write.names]), [
    [result.doc_id, ['document.md', 'meta.json']],
  ])
  assert.deepEqual(fixture.sessions.map((session) => session.id), new Array(fixture.sessions.length).fill(SESSION.id), '落盘必须用调用方 session（框架 exec 形状，§9.7）')
  assert.ok(fixture.sessions.length >= 2, '读缓存与写产物都要拿到 session：任一处漏接就会在真机上炸')
  assert.ok(!JSON.stringify(result).includes('/workspace/proj'), '回执不得外泄绝对路径')
  assert.deepEqual(result.provider_tally, { paddleocr: 1 })
  assert.equal(result.recent_retrievals.length, 1)
  assert.equal(result.recent_retrievals[0].tool, 'ocr', 'ocr 在检索回声里记一次，与 fetch 同口径')
})

test('ocr 幂等：同一 URL 第二次命中 doc_id 缓存，一次都不出网；refresh 才强制重跑', async () => {
  const fixture = ocrDnsDeps()
  const { runtime } = registerOcr(fixture.deps)
  const first = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  const second = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  assert.equal(second.doc_id, first.doc_id, '内容寻址：同一份文档 + 同一组参数就是同一个键')
  assert.equal(second.cached, true)
  assert.equal(fixture.submitCalls.length, 1, '⛔ 命中缓存不得再提交作业（那是再花一次整篇的钱）')
  assert.equal(second.content, first.content, '回读的是盘上同一份正文')
  const forced = await runTool(runtime, 'ocr', { url: OCR_URL, refresh: true }, SESSION)
  assert.equal(forced.cached, false)
  assert.equal(fixture.submitCalls.length, 2, 'refresh 是显式重新解析，才允许再提交')
  assert.equal(fixture.writes.at(-1).overwrite, true, '重跑要能覆盖自己刚写的产物（半件产物自愈）')
})

test('ocr charts 参与 doc_id：关掉图表识别是另一份产物，不复用缓存', async () => {
  const fixture = ocrDnsDeps()
  const { runtime } = registerOcr(fixture.deps)
  const withCharts = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  const withoutCharts = await runTool(runtime, 'ocr', { url: OCR_URL, charts: false }, SESSION)
  assert.notEqual(withoutCharts.doc_id, withCharts.doc_id)
  assert.equal(fixture.submitCalls[1].charts, false, 'charts 必须真的落到提交参数')
  assert.equal(fixture.submitCalls.length, 2)
})

test('ocr file 形态：读 workspace 相对路径的字节上传，source 只记相对路径', async () => {
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 54])
  const fixture = fakeOcrDeps({ bytes: new Map([['refs/茅台研报.pdf', pdfBytes]]) })
  const { runtime, definition } = registerOcr(fixture.deps)
  const result = await runTool(runtime, 'ocr', { file: '@refs/茅台研报.pdf' }, SESSION)
  assertToolOutput(definition, result)
  assert.equal(result.source, 'file:refs/茅台研报.pdf', '@mention 带的开头 @ 被剥掉，且不落绝对路径')
  assert.equal(result.source_kind, 'file')
  assert.deepEqual([...fixture.submitCalls[0].file.bytes], [...pdfBytes])
  assert.equal(fixture.submitCalls[0].file.filename, '茅台研报.pdf')
  await assert.rejects(() => runTool(runtime, 'ocr', { file: 'notes.docx' }, SESSION), /INVALID_INPUT/)
  await assert.rejects(() => runTool(runtime, 'ocr', { file: '/etc/passwd.pdf' }, SESSION), /INVALID_INPUT|workspace/u)
})

test('ocr 续查形态：job_id + doc_id 不重复提交；仍在跑就回 pending 并给出下一步', async () => {
  const fixture = ocrDnsDeps({ wait: { status: 'pending', job_id: 'job-1', elapsed_ms: 200_000, progress: { extracted_pages: 7, total_pages: 15 } } })
  const { runtime, definition } = registerOcr(fixture.deps)
  const pending = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  assertToolOutput(definition, pending)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.ok, true, '自有预算耗尽不是失败')
  assert.equal(pending.job_id, 'job-1')
  assert.deepEqual([pending.extracted_pages, pending.total_pages], [7, 15])
  assert.match(pending.hint, /同时.*job_id.*doc_id/u)
  assert.equal(pending.content, undefined)
  assert.equal(fixture.submitCalls.length, 1)

  // 续查：作业跑完了 → 落盘并回 done，全程只提交过一次。
  fixture.client.wait = async (jobId) => ({ status: 'done', job_id: jobId, elapsed_ms: 30_000, document: ocrDocument(2) })
  const done = await runTool(runtime, 'ocr', { job_id: 'job-1', doc_id: pending.doc_id }, SESSION)
  assertToolOutput(definition, done)
  assert.equal(done.status, 'done')
  assert.equal(done.pages, 2)
  assert.equal(done.source_kind, 'job', '续查时本机没有重算种子的输入，指认留空而不是编一个')
  assert.equal(done.source, undefined)
  assert.equal(fixture.submitCalls.length, 1, '⛔ 续查绝不重复提交')
  assert.deepEqual(fixture.waitCalls, ['job-1'])
})

test('ocr 读取形态：doc_id + pages 整页给、+ query 带页号，二者互斥且都不出网', async () => {
  const fixture = ocrDnsDeps({ document: ocrDocument(2, 400) })
  const { runtime, definition } = registerOcr(fixture.deps)
  const parsed = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  fixture.submitCalls.length = 0
  const paged = await runTool(runtime, 'ocr', { doc_id: parsed.doc_id, pages: '2' }, SESSION)
  assertToolOutput(definition, paged)
  assert.equal(paged.status, 'done')
  assert.equal(paged.cached, true)
  assert.deepEqual(paged.pages_requested, [2])
  assert.equal(paged.excerpts.length, 1)
  assert.equal(paged.excerpts[0].page, 2)
  assert.match(paged.excerpts[0].text, /营业收入/)
  assert.match(paged.excerpts[0].heading, /第 2 节/)
  const located = await runTool(runtime, 'ocr', { doc_id: parsed.doc_id, query: '营业收入', limit: 2 }, SESSION)
  assertToolOutput(definition, located)
  assert.deepEqual([located.query, located.hit_count], ['营业收入', 2])
  assert.ok(located.hits.every((hit) => Number.isInteger(hit.page)), '命中必须带页号，回传才能标页')
  assert.deepEqual(located.hits.map((hit) => hit.page), [1, 2])
  assert.match(located.note, /命中 2 处/)
  assert.equal(fixture.submitCalls.length, 0, '读取形态纯本地：不出网、不花钱')
  assert.deepEqual(located.provider_tally, { paddleocr: 3 }, '但每一次调用都要在回声里记一次')
  const absent = await runTool(runtime, 'ocr', { doc_id: parsed.doc_id, query: '根本不存在的词' }, SESSION)
  assert.equal(absent.hit_count, 0)
  assert.match(absent.note, /没有命中不等于文档里没有这个主题/)
})

test('ocr 装载受预算约束：整篇放不下就只给页索引 + 首页，永不半路截断', async () => {
  const fixture = ocrDnsDeps({ document: ocrDocument(40, 2000) })
  const { runtime, definition } = registerOcr(fixture.deps)
  const result = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  assertToolOutput(definition, result)
  assert.ok(JSON.stringify(result).length <= 6144, `回执必须留在剪枝阈值内：实际 ${JSON.stringify(result).length}`)
  assert.equal(result.content, undefined, '⛔ 超预算给半篇正文会被当成完整正文引用，比少给一页危险')
  assert.equal(result.pages, 40)
  assert.equal(result.index.length, 40)
  assert.ok(result.index[0].chars > 1000 && result.chars > 6144, '整篇确实超出预算，这条断言才有意义')
  assert.equal(result.index[0].page, 1)
  assert.match(result.index[0].heading, /第 1 节/)
  assert.match(result.page_one.text, /营业收入/)
  assert.match(result.note, /页索引/)
  assert.match(result.note, /不再出网、不再花钱/)
  // 一次最多 8 页：多要就是响亮拒绝，不静默少给。
  await assert.rejects(() => runTool(runtime, 'ocr', { doc_id: result.doc_id, pages: '1-9' }, SESSION), /一次最多读 8 页/)
  // 8 页也装不下这份预算：整页让路并点名省略了哪几页（不许给半页）。
  const partial = await runTool(runtime, 'ocr', { doc_id: result.doc_id, pages: '1-8' }, SESSION)
  assertToolOutput(definition, partial)
  assert.ok(JSON.stringify(partial).length <= 6144)
  assert.ok(partial.excerpts.length >= 1, '第一条永不因预算丢弃以外的理由跳过')
  assert.ok(partial.omitted_pages.length > 0)
  assert.match(partial.note, /未放入/)
  assert.deepEqual(partial.pages_requested, [1, 2, 3, 4, 5, 6, 7, 8], '请求了哪 8 页要如实回显，省略的是哪几页也要点名')
})

test('ocr 预算说明必须算得过来：正文本身没超、是整份回执装不下时不许写"正文超出预算"', async () => {
  // 真机第 9 步抓到的口径缺陷：5717 字符的正文配一句"整篇 5717 字符超出回执预算 6144"，
  // 数字自己打自己。被装的从来不只是正文，还有信封与那 35 条页索引。
  const fixture = ocrDnsDeps({ document: ocrDocument(35) })
  const { runtime, definition } = registerOcr(fixture.deps)
  const result = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  assertToolOutput(definition, result)
  assert.ok(result.chars < 6144, `这条钉的是"正文在预算内、回执超了"的形状，实际正文 ${result.chars} 字符`)
  assert.equal(result.content, undefined, '装不下就整篇不给，不许切半篇')
  const claimed = Number(/整篇正文 (\d+) 字符/u.exec(result.note)?.[1])
  assert.equal(claimed, result.chars, 'note 里报的字符数必须就是 `chars`，不能是另一套算法')
  assert.match(result.note, /连同回执装不进/u, '⛔ 声明要指到真正的原因：正文 + 回执一起才越界')
  assert.match(result.note, result.page_one === undefined ? /这里给页索引，/u : /页索引与首页/u, '说了给什么，就得真给了什么')
})

test('ocr 形态歧义一律响亮拒绝，并给出可照做的下一步', async () => {
  const fixture = ocrDnsDeps()
  const { runtime } = registerOcr(fixture.deps)
  const cases = [
    [{}, /必须给出 url \/ file \/ job_id/],
    [{ url: OCR_URL, file: 'a.pdf' }, /一次只走一种形态/],
    [{ doc_id: 'ocr_1a2b3c4d5e6f', pages: '1', query: '营收' }, /pages 与 query 只能给一个/],
    [{ doc_id: 'ocr_1a2b3c4d5e6f', refresh: true }, /refresh \/ charts 只对 url 或 file 形态有意义/],
    [{ job_id: 'j1' }, /job_id 必须与同一回执里的 doc_id 一起传/],
    [{ job_id: 'j1', doc_id: 'ocr_1a2b3c4d5e6f', url: OCR_URL }, /续查时不要再传 url/],
    [{ job_id: 'j1', doc_id: 'ocr_1a2b3c4d5e6f', pages: '1' }, /作业还没解析完/],
    [{ url: OCR_URL, pages: '1' }, /新解析时还没有页可读/],
    [{ doc_id: 'ocr_1' }, /doc_id 形状不对/],
    [{ url: 'https://pdf.dfcfw.com/report.html' }, /不是 \.pdf/],
  ]
  for (const [args, expectation] of cases) {
    await assert.rejects(() => runTool(runtime, 'ocr', args, SESSION), (error) => {
      const payload = JSON.parse(error.message)
      assert.equal(payload.status, 'error')
      assert.equal(payload.ok, false)
      assert.equal(payload.provider, 'paddleocr')
      assert.match(payload.error, expectation, `${JSON.stringify(args)} 的拒绝理由不对`)
      assert.ok(payload.hint === undefined || typeof payload.hint === 'string')
      return true
    })
  }
  assert.equal(fixture.submitCalls.length, 0, '被拒的形态组合一次都不该打到上游')
})

test('ocr 失败映射：SSRF 闸门 / 缺 Token / 取消，三种失败三种话', async () => {
  const blocked = ocrDnsDeps()
  const blockedRuntime = registerOcr(blocked.deps).runtime
  for (const url of ['http://127.0.0.1:8080/a.pdf', 'http://192.168.1.1/a.pdf', 'https://user:pass@pdf.test/a.pdf']) {
    await assert.rejects(() => runTool(blockedRuntime, 'ocr', { url }, SESSION), (error) => {
      const payload = JSON.parse(error.message)
      assert.equal(payload.code, 'BLOCKED_URL')
      assert.match(payload.hint, /内网|凭据/u)
      return true
    }, `${url} 必须被闸门拦下`)
  }
  assert.equal(blocked.submitCalls.length, 0, '⛔ 本插件不能成为"把内网 URL 交给第三方去戳"的通道')

  const noCredential = ocrDnsDeps({ submitError: new OcrError('NO_CREDENTIAL', 'PaddleOCR Token 未配置：credentials 引用 PADDLE_OCR_TOKEN') })
  const noCredentialRuntime = registerOcr(noCredential.deps).runtime
  await assert.rejects(() => runTool(noCredentialRuntime, 'ocr', { url: OCR_URL }, SESSION), (error) => {
    const payload = JSON.parse(error.message)
    assert.equal(payload.code, 'NO_CREDENTIAL')
    assert.deepEqual(payload.provider_tally, { paddleocr: 1 }, '失败也保留检索回声：换来源的判断依据不能丢')
    return true
  })

  const aborted = ocrDnsDeps({ submitError: Object.assign(new Error('request aborted'), { code: 'ABORTED', name: 'LocalFetchError' }) })
  const abortedRuntime = registerOcr(aborted.deps).runtime
  await assert.rejects(() => runTool(abortedRuntime, 'ocr', { url: OCR_URL }, SESSION), (error) => {
    assert.equal(error.code, 'ABORTED', '取消原样抛出：不许降级成"看起来像上游坏了"的错误信封')
    assert.ok(!(error.message.trim().startsWith('{')), '取消不许被翻成回执')
    return true
  })
})

test('ocr 落盘失败不假装成功：写不进去就响亮报错并指到 workspace 权限', async () => {
  const fixture = ocrDnsDeps()
  fixture.deps.store.writeWorkspaceFiles = async () => {
    throw new DatasetStoreError('workspace_not_writable', 'current workspace permission is read-only')
  }
  const { runtime } = registerOcr(fixture.deps)
  // ⚠️ 这条钉的是"异步返回必须在 try 内 await"：少了 await，落盘失败会绕过下面的错误映射，
  //    模型只剩一句 `workspace_not_writable: …`，丢掉 code / hint / doc_id / 检索回声。
  await assert.rejects(() => runTool(runtime, 'ocr', { url: OCR_URL }, SESSION), (error) => {
    const payload = JSON.parse(error.message)
    assert.equal(payload.code, 'STORE_UNAVAILABLE')
    assert.match(payload.hint, /workspace/u)
    assert.match(payload.doc_id, /^ocr_[0-9a-f]{12}$/u, '花掉的那次作业要能被指认')
    assert.deepEqual(payload.provider_tally, { paddleocr: 1 })
    return true
  })
})

test('ocr 读一个不存在的 doc_id：DOC_NOT_FOUND 并说清下一步，而不是回空正文', async () => {
  const fixture = fakeOcrDeps()
  const { runtime } = registerOcr(fixture.deps)
  await assert.rejects(() => runTool(runtime, 'ocr', { doc_id: 'ocr_000000000000' }, SESSION), (error) => {
    const payload = JSON.parse(error.message)
    assert.equal(payload.code, 'DOC_NOT_FOUND')
    assert.equal(payload.doc_id, 'ocr_000000000000', '回显入参里的 doc_id，模型才能核对是自己抄错了还是没解析过')
    assert.match(payload.hint, /先用 url 或 file 解析/u)
    return true
  })
  assert.equal(fixture.submitCalls.length, 0, '读盘不命中绝不升级为"顺手再解析一次"（那是另一次收费作业）')
  assert.deepEqual(fixture.waitCalls, [])
})

test('ocr 半件产物（meta 在、正文丢了）：回执给一次可照抄的修复调用，而不是怪调用方', async () => {
  const fixture = ocrDnsDeps()
  const { runtime } = registerOcr(fixture.deps)
  const first = await runTool(runtime, 'ocr', { url: OCR_URL }, SESSION)
  fixture.files.delete(`capital-data/ocr/${first.doc_id}/document.md`)

  let receipt
  await assert.rejects(() => runTool(runtime, 'ocr', { doc_id: first.doc_id }, SESSION), (error) => {
    receipt = JSON.parse(error.message)
    assert.equal(receipt.code, 'RESULT_INVALID', '产物自己坏了说成 INVALID_INPUT，会把模型推到"换个参数再猜"')
    assert.match(receipt.error, /document\.md 缺失/u)
    assert.equal(receipt.doc_id, first.doc_id)
    return true
  })
  assert.equal(fixture.submitCalls.length, 1, '发现半件产物也不许顺手重跑——重跑要再花一次整篇的钱')

  // ⛔ hint 必须是能照做的：读形态不接受 refresh，所以要把 meta 里的来源指认写回去。
  const repair = /\{ url: ("(?:[^"\\]|\\.)*"), refresh: true \}/u.exec(receipt.hint)
  assert.ok(repair, `hint 要给出可照抄的那一次调用，实际是：${receipt.hint}`)
  assert.equal(JSON.parse(repair[1]), OCR_URL, '来源指认取自 meta，不是把入参里的 doc_id 换个位置再念一遍')
  const healed = await runTool(runtime, 'ocr', { url: JSON.parse(repair[1]), refresh: true }, SESSION)
  assert.equal(healed.doc_id, first.doc_id, 'doc_id 内容寻址：重跑落回同一个产物')
  assert.match(healed.content, /营业收入/u)
  assert.equal(fixture.submitCalls.length, 2, '这一趟是照抄 hint 的显式重跑，不是顺手补的')
})

test('ocr 作业失败：已经把 doc_id 与 job_id 花出去的指认必须随回执交回去', async () => {
  const fixture = ocrDnsDeps({ jobId: 'job-9', waitError: new OcrError('JOB_FAILED', '上游返回 state=failed：PDF 加密无法解密') })
  const { runtime } = registerOcr(fixture.deps)
  let receipt
  await assert.rejects(() => runTool(runtime, 'ocr', { url: OCR_URL }, SESSION), (error) => {
    receipt = JSON.parse(error.message)
    assert.equal(receipt.code, 'JOB_FAILED')
    assert.match(receipt.error, /加密/u)
    assert.match(receipt.doc_id, /^ocr_[0-9a-f]{12}$/u)
    assert.equal(receipt.job_id, 'job-9')
    assert.deepEqual(receipt.provider_tally, { paddleocr: 1 })
    return true
  })
  assert.equal(fixture.submitCalls.length, 1)
  // ⛔ 回执里那两个 id 必须是**能照做的**：拿它们续查不得再提交一次作业。
  fixture.client.wait = async (jobId) => ({ status: 'done', job_id: jobId, elapsed_ms: 5_000, document: ocrDocument(2) })
  const resumed = await runTool(runtime, 'ocr', { job_id: receipt.job_id, doc_id: receipt.doc_id }, SESSION)
  assert.equal(resumed.status, 'done')
  assert.equal(fixture.submitCalls.length, 1, '失败回执给的就是续查凭据，否则那次付费作业被丢在半路')
})

test('ocr 没有 session 就拒绝落盘：不给"只在内存里"的正文', async () => {
  const fixture = ocrDnsDeps()
  const { runtime } = registerOcr(fixture.deps)
  await assert.rejects(() => runTool(runtime, 'ocr', { url: OCR_URL }, undefined), (error) => {
    assert.match(JSON.parse(error.message).error, /session/u)
    return true
  })
  assert.equal(fixture.submitCalls.length, 0)
})
