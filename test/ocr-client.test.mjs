// `src/ocr/client.ts` 的回归：PaddleOCR **异步 job** 协议的生命周期形状。
//
// 钉住的都是 2026-09-25 拿真报文才看得见的东西：上游把业务错误装在 HTTP 200 里、
// `optionalPayload` 只认官方示例出现过的三个键、结果是一个 **JSONL** 而不是单个 JSON、
// 自有等待预算耗尽不是失败而是 `pending`（花钱的提交只有一次）。
// 这里注入的是 `options.request`（客户端的出网边界），不经过 `createHttpRequester` 的
// SSRF/超时层——那一份实现在 `test/web-retriever-local-fetch.test.mjs` 里有对等断言（§9.7）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPaddleOcrClient, OcrError, PADDLE_OCR_DEFAULT_MODEL } from '../lib/ocr/client.js'

const TOKEN = 'ba85ba-test-token-must-never-echo'
const ENDPOINT = 'https://paddleocr.test/api/v2/ocr/jobs'

/** 假出网口：记录每次请求，按调用顺序交给 responder 决定响应（Error 即传输层失败）。 */
function fakeRequest(responder) {
  const calls = []
  return {
    calls,
    async request(req, signal) {
      if (signal?.aborted) throw transportError('ABORTED', 'request aborted')
      calls.push(req)
      const outcome = await responder(req, calls.length)
      if (outcome instanceof Error) throw outcome
      return {
        url: req.url,
        status: outcome.status ?? 200,
        text: typeof outcome.body === 'string' ? outcome.body : JSON.stringify(outcome.body),
        truncated: outcome.truncated ?? false,
      }
    },
  }
}

function transportError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** 假时钟：睡眠推进它，于是"预算耗尽"是算出来的而不是等出来的。 */
function fakeClock(start = 0) {
  let at = start
  return {
    now: () => at,
    advance: (ms) => { at += ms },
  }
}

function submitBody(jobId = 'job-1') {
  return { body: { code: 0, msg: 'Success', data: { jobId } } }
}

function pollBody(state, extra = {}) {
  return { body: { code: 0, data: { state, ...extra } } }
}

/**
 * 上游 JSONL：一行一个**批次**（实测 15 页报告是 5 行 × 每行 3 页），`layoutParsingResults[]` 一项一页。
 * ⛔ 成功行**同样带** `errorCode: 0, errorMsg: 'Success'`（2026-09-25 实测）——夹具必须带上，
 *    否则"把 errorMsg 当失败"这类错根本测不出来（就是这样把每份成功文档报成 JOB_FAILED 的）。
 */
function jsonl(pages) {
  return pages.map((page) => JSON.stringify({
    errorCode: 0,
    errorMsg: 'Success',
    logId: 'trace-id',
    result: {
      layoutParsingResults: [{
        markdown: { text: page.text, images: page.images ?? {} },
      }],
    },
  })).join('\n')
}

function makeClient(options = {}) {
  const clock = options.clock ?? fakeClock()
  const requests = options.requests ?? [submitBody(), pollBody('done', { resultUrl: { jsonUrl: 'https://result.test/1.jsonl' } }), { body: jsonl([{ text: '# 标题\n正文' }]) }]
  let index = 0
  const transport = fakeRequest(() => requests[Math.min(index += 1, requests.length) - 1])
  const client = createPaddleOcrClient({
    endpoint: ENDPOINT,
    model: options.model ?? PADDLE_OCR_DEFAULT_MODEL,
    resolveToken: options.resolveToken ?? (async () => TOKEN),
    request: transport.request,
    pollIntervalMs: 5_000,
    waitBudgetMs: options.waitBudgetMs ?? 200_000,
    now: clock.now,
    sleep: async (ms) => { clock.advance(ms) },
  })
  return { client, transport, clock }
}

const signal = () => new AbortController().signal

test('submit(url)：提交体是 fileUrl + model + 官方示例那三个 optionalPayload 键，鉴权走 bearer', async () => {
  const { client, transport } = makeClient({ requests: [submitBody('job-42')] })
  const jobId = await client.submit({ fileUrl: 'https://pdf.test/a.pdf', charts: true, signal: signal() })
  assert.equal(jobId, 'job-42')
  const [request] = transport.calls
  assert.equal(request.url, ENDPOINT)
  assert.equal(request.method, 'POST')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(request.headers.authorization, `bearer ${TOKEN}`, '⛔ 提交必须带 bearer：只带 content-type 就是无鉴权请求（实测 401），而轮询是带的')
  const payload = JSON.parse(request.body)
  assert.deepEqual(payload, {
    fileUrl: 'https://pdf.test/a.pdf',
    model: PADDLE_OCR_DEFAULT_MODEL,
    optionalPayload: { useDocOrientationClassify: false, useDocUnwarping: false, useChartRecognition: true },
  }, '⛔ 未知键在上游被**静默忽略**：只传实测过的键，不给自己"看起来能配"的假开关')
  assert.equal(payload.optionalPayload.useChartRecognition, true, 'charts 入参必须真的落到 useChartRecognition')
})

test('submit(file)：multipart 上传，且刻意不写 content-type（boundary 归实现带）', async () => {
  const { client, transport } = makeClient({ requests: [submitBody()] })
  await client.submit({
    file: { bytes: new Uint8Array([37, 80, 68, 70]), filename: '茅台研报.pdf' },
    charts: false,
    signal: signal(),
  })
  const [request] = transport.calls
  assert.ok(request.body instanceof FormData, '本地字节必须走 FormData，不是把路径拼进 JSON')
  assert.equal(request.headers['content-type'], undefined, '写死 content-type 就等于把 multipart 请求写坏')
  assert.equal(request.headers.authorization, `bearer ${TOKEN}`, '两种提交形态的鉴权必须同一份：漏一条就是只有本地文件能用')
  assert.equal(request.body.get('model'), PADDLE_OCR_DEFAULT_MODEL)
  assert.equal(JSON.parse(request.body.get('optionalPayload')).useChartRecognition, false)
  const file = request.body.get('file')
  assert.ok(file instanceof Blob)
  assert.equal(file.name, '茅台研报.pdf')
})

test('wait：pending → running(进度) → done 才取结果，JSONL 多页拼成带页标记的文档', async () => {
  const { client, transport } = makeClient({
    requests: [
      pollBody('pending'),
      pollBody('running', { extractProgress: { totalPages: 2, extractedPages: 1 } }),
      pollBody('done', { resultUrl: { jsonUrl: 'https://result.test/j.jsonl' } }),
      { body: jsonl([{ text: '# 第一节\n营收 1,700 亿元' }, { text: '第二节正文', images: { a: 'u1', b: 'u2' } }]) },
    ],
  })
  const outcome = await client.wait('job-9', signal())
  assert.equal(outcome.status, 'done')
  assert.equal(outcome.job_id, 'job-9')
  assert.deepEqual(outcome.progress, { extracted_pages: 1, total_pages: 2 }, '进度取最后一次看到的值')
  assert.equal(outcome.document.pages.length, 2)
  assert.equal(outcome.document.images, 2, 'markdown.images 只数个数，不下载图链')
  assert.match(outcome.document.document, /<!-- page:1 -->/)
  assert.match(outcome.document.document, /<!-- page:2 -->/)
  assert.equal(outcome.document.pages[1].heading, undefined)
  assert.equal(outcome.document.pages[0].heading, '第一节')
  // 页偏移必须能切片回原页正文（按页取回靠它，不再出网）。
  const { document, pages } = outcome.document
  assert.equal(document.slice(pages[1].start, pages[1].end), '第二节正文')
  const jsonCall = transport.calls.at(-1)
  assert.equal(jsonCall.url, 'https://result.test/j.jsonl')
  assert.ok(jsonCall.maxBytes > 0 && jsonCall.maxContentChars > 0, '结果 JSONL 必须有逐请求体积上限（远超网页默认）')
  assert.equal(jsonCall.headers, undefined, '⛔ 结果地址是**预签名**的对象存储 URL：带上 bearer，BOS 会当成待验签请求索要 date 头并回 400（实测），把 token 发给第三方存储域本身就是泄漏')
  assert.equal(transport.calls.filter((call) => call.method === 'POST').length, 0, 'wait 不得重复提交作业')
  for (const call of transport.calls.slice(0, -1)) {
    assert.equal(call.headers.authorization, `bearer ${TOKEN}`, '作业 API 的每一次访问都要鉴权（只有取结果不带）')
  }
})

test('结果行的 errorCode≠0 才是批次失败：errorMsg="Success" 的成功行不得被误判成失败', async () => {
  // 实测：成功行的形状是 `{errorCode: 0, errorMsg: 'Success', result: {…}}`——`errorMsg` 一直在。
  const { client } = makeClient({
    requests: [
      pollBody('done', { resultUrl: { jsonUrl: 'https://result.test/j.jsonl' } }),
      { body: JSON.stringify({ errorCode: 41_001, errorMsg: 'page parse failed', logId: 'x' }) },
    ],
  })
  await assert.rejects(() => client.wait('job-1', signal()), (error) => {
    assert.ok(error instanceof OcrError)
    assert.equal(error.code, 'JOB_FAILED')
    assert.match(error.message, /errorCode=41001/u, '码要一起交回去：只给一句 msg 就没法向上游报障')
    assert.match(error.message, /page parse failed/u)
    return true
  })
})

test('state:failed → JOB_FAILED 并带上游 errorMsg（不能翻成"没有内容"）', async () => {
  const { client } = makeClient({ requests: [pollBody('failed', { errorMsg: 'file download failed' })] })
  await assert.rejects(() => client.wait('job-x', signal()), (error) => {
    assert.ok(error instanceof OcrError)
    assert.equal(error.code, 'JOB_FAILED')
    assert.match(error.message, /file download failed/)
    return true
  })
})

test('⛔ 上游把业务错误装在 HTTP 200 里：code≠0 必须响亮失败，不能拿 undefined jobId 去轮询', async () => {
  const { client, transport } = makeClient({ requests: [{ status: 200, body: { code: 10007, msg: '模型传参错误' } }] })
  await assert.rejects(() => client.submit({ fileUrl: 'https://pdf.test/a.pdf', charts: true, signal: signal() }), (error) => {
    assert.equal(error.code, 'UPSTREAM')
    assert.match(error.message, /10007.*模型传参错误/u)
    return true
  })
  assert.equal(transport.calls.length, 1, '失败后不得继续轮询')
})

test('自有预算耗尽不是失败：回 status:pending，且整段只提交一次', async () => {
  const clock = fakeClock()
  let polls = 0
  const { client, transport } = makeClient({
    clock,
    waitBudgetMs: 20_000,
    requests: [submitBody('job-slow'), ...Array.from({ length: 20 }, () => {
      polls += 1
      return pollBody('running', { extractProgress: { totalPages: 15, extractedPages: Math.min(polls, 15) } })
    })],
  })
  const outcome = await client.parse({ fileUrl: 'https://pdf.test/slow.pdf', charts: true, signal: signal() })
  assert.equal(outcome.status, 'pending')
  assert.equal(outcome.job_id, 'job-slow')
  assert.equal(transport.calls.filter((call) => call.method === 'POST').length, 1, '⛔ 超时绝不等于"再提交一次"：那会再花一次整篇作业')
  assert.equal(outcome.progress.total_pages, 15)
  assert.ok(outcome.progress.extracted_pages >= 1, '进度必须带回来，否则模型无从判断还要等多久')
  assert.ok(outcome.elapsed_ms >= 20_000)
})

test('取消原样抛出：ABORTED 不许被降级成 UPSTREAM 信封', async () => {
  const { client } = makeClient({ requests: [transportError('ABORTED', 'request aborted')] })
  await assert.rejects(() => client.submit({ fileUrl: 'https://pdf.test/a.pdf', charts: true, signal: signal() }), (error) => {
    assert.equal(error.code, 'ABORTED')
    assert.ok(!(error instanceof OcrError), 'ABORTED 必须还是调用方取消的那个形状')
    return true
  })
})

test('缺 Token：NO_CREDENTIAL 且一次请求都不发（不拿空鉴权去戳上游）', async () => {
  const { client, transport } = makeClient({ resolveToken: async () => undefined, requests: [] })
  await assert.rejects(() => client.submit({ fileUrl: 'https://pdf.test/a.pdf', charts: true, signal: signal() }), (error) => {
    assert.equal(error.code, 'NO_CREDENTIAL')
    assert.match(error.message, /PADDLE_OCR_TOKEN/)
    assert.ok(!error.message.includes(TOKEN))
    return true
  })
  assert.equal(transport.calls.length, 0)
})

test('鉴权被拒（HTTP 401）翻成 NO_CREDENTIAL 并指到设置卡片；消息里绝不带 Token 字面量', async () => {
  const { client, transport } = makeClient({
    requests: [transportError('HTTP', `PaddleOCR returned HTTP 401 while fetching url: ${ENDPOINT}`)],
  })
  await assert.rejects(() => client.submit({ fileUrl: 'https://pdf.test/a.pdf', charts: true, signal: signal() }), (error) => {
    assert.equal(error.code, 'NO_CREDENTIAL')
    assert.match(error.message, /设置.*插件.*Capital/)
    assert.ok(!error.message.includes(TOKEN), '⛔ 密钥出现在任何输出里即失败')
    return true
  })
  assert.ok(transport.calls.length >= 1)
})

test('结果不是完整 JSONL：空 layoutParsingResults / 非 JSON 行 / 被截断 一律作废整份文档', async () => {
  const empty = makeClient({ requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/e.jsonl' } }), { body: JSON.stringify({ result: { layoutParsingResults: [] } }) }] })
  await assert.rejects(() => empty.client.wait('j', signal()), (error) => {
    assert.equal(error.code, 'RESULT_INVALID')
    assert.match(error.message, /0 页/)
    return true
  }, '空 markdown 会被模型当成"这篇文档没有内容"，比报错危险')

  const dirty = makeClient({ requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/d.jsonl' } }), { body: 'not json\n' }] })
  await assert.rejects(() => dirty.client.wait('j', signal()), /不是 JSON/)

  const cut = makeClient({ requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/t.jsonl' } }), { body: '{"truncated":', truncated: true }] })
  await assert.rejects(() => cut.client.wait('j', signal()), (error) => {
    assert.equal(error.code, 'RESULT_INVALID')
    assert.match(error.message, /截断/)
    return true
  }, '截断的 JSON 是解析失败，不是"少读几条"')
})

test('缺 markdown.text 不静默给空白页；超 100 页响亮拒绝', async () => {
  const missing = makeClient({
    requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/m.jsonl' } }), { body: JSON.stringify({ result: { layoutParsingResults: [{ markdown: {} }] } }) }],
  })
  await assert.rejects(() => missing.client.wait('j', signal()), /markdown\.text/)

  const many = Array.from({ length: 101 }, (_unused, index) => ({ text: `第 ${index + 1} 页正文` }))
  const over = makeClient({ requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/p.jsonl' } }), { body: jsonl(many) }] })
  await assert.rejects(() => over.client.wait('j', signal()), (error) => {
    assert.equal(error.code, 'TOO_MANY_PAGES')
    return true
  })
})

test('一个批次里的多页按顺序编号（不是一行一页）', async () => {
  const body = JSON.stringify({
    result: {
      layoutParsingResults: [
        { markdown: { text: 'A' } },
        { markdown: { text: 'B' } },
      ],
    },
  })
  const { client } = makeClient({ requests: [pollBody('done', { resultUrl: { jsonUrl: 'https://r.test/b.jsonl' } }), { body }] })
  const outcome = await client.wait('j', signal())
  assert.deepEqual(outcome.document.pages.map((entry) => [entry.page, pageText(outcome, entry)]), [[1, 'A'], [2, 'B']])
})

function pageText(outcome, entry) {
  return outcome.document.document.slice(entry.start, entry.end)
}
