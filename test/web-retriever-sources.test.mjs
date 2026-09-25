/**
 * 九个具名来源工具（cls_telegraph / wscn_lives / cninfo_irm / sseinfo_qa / eastmoney_724 /
 * eastmoney_stock_news / eastmoney_reports / sina_reports / ths_eps_forecast）的回归。
 *
 * 夹具形状来自 2026-09-24 对真实端点的实测（不是照文献抄的），因此本文件同时是
 * "上游长什么样"的记录：字段名、时间戳量级、空结果提示语、以及两处**上游毛病**
 * （互动易第二步必须 POST、上证e互动 `type=10` 会把 600519 的数据返回成 600518）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerSourceTools, SOURCE_OUTPUT_BUDGET_CHARS } from '../lib/web-retriever/tools.js'
import { createEastmoneyClient } from '../lib/net/eastmoney-client.js'
import {
  clsSign,
  clsTelegraph,
  cninfoIrm,
  createSourceTransport,
  eastmoneyFastNews,
  eastmoneyReports,
  eastmoneyStockNews,
  sinaReports,
  sinaSymbol,
  SSE_UID_LOCATE_TIMEOUT_MS,
  thsEpsForecast,
  parseCompanyList,
  parseSseFeed,
  resetSseCachesForTest,
  sseTime,
  sseinfoQa,
  wscnLives,
} from '../lib/web-retriever/sources.js'
import { assertToolOutput } from './output-contract.mjs'

const TRANSPORT_OPTIONS = {
  timeoutMs: 1_000,
  maxBytes: 1_000_000,
  maxContentChars: 100_000,
  maxRedirects: 3,
  userAgent: 'test-source',
  resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
}

function makeTransport() {
  return createSourceTransport(TRANSPORT_OPTIONS)
}

function makeResponse(status, headers = {}, body = '') {
  // 说明：Node 内建 TextEncoder 只有 UTF-8，**无法**合成真正的 GBK 字节，
  // 而 `new TextDecoder('gbk').decode(utf8Bytes)` 是**有损**的（经 U+FFFD 替换后再逐码点取字节
  // 还原不回来，实测如此）。因此 GBK 相关来源（同花顺 / 新浪）的夹具一律用 ASCII，
  // 中文与编码路径由**真机冒烟**覆盖——见本文件顶部与 sources.ts 的实测记录。
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(body)
  const text = body instanceof Uint8Array ? new TextDecoder().decode(body) : body
  return {
    status,
    // 与真实 Response 对齐：不同读取路径都要可用——createHttpRequester 走 getReader，
    // 东财共享客户端走 text()/json()。
    ok: status < 400,
    text: async () => text,
    json: async () => JSON.parse(text),
    headers: {
      get(name) {
        const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
        return key === undefined ? null : headers[key]
      },
    },
    body: {
      getReader() {
        let done = false
        return {
          async read() {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: bytes }
          },
          async cancel() {},
          releaseLock() {},
        }
      },
    },
  }
}

/** 装一个按 URL 分派的假 fetch，并记录每次请求（含 method / body / headers）。 */
function installFetch(handler) {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init })
    const result = await handler(String(url), init)
    if (result instanceof Error) throw result
    return result
  }
  return {
    requests,
    restore() {
      globalThis.fetch = original
    },
  }
}

function json(body, status = 200) {
  return makeResponse(status, { 'content-type': 'application/json; charset=UTF-8' }, JSON.stringify(body))
}

// ── 夹具（真实响应裁剪而来）───────────────────────────────────────────────

const CLS_PAGE = {
  errno: 0,
  data: {
    roll_data: [
      { id: 2492045, ctime: 1790224318, title: '厦门诞生新单价地王', content: '【厦门诞生新单价地王】财联社9月24日电……', brief: '【厦门诞生新单价地王】……', shareurl: 'https://api3.cls.cn/share/article/2492045', in_roll: true, is_ad: false },
      // 真实数据里 title 常为空（实测 30 条里 6 条），此时按 brief 兜底。
      { id: 2492046, ctime: 1790223754, title: '', brief: '【无标题快讯】……', content: '', shareurl: 'https://api3.cls.cn/share/article/2492046', in_roll: true },
      // 广告位不属于快讯，必须被剔除。
      { id: 2492047, ctime: 1790223511, title: '推广位', brief: '广告', content: '广告', is_ad: true, in_roll: true },
    ],
  },
}

const WSCN_PAGE = {
  code: 20000,
  data: {
    next_cursor: 1790220645,
    items: [
      { id: 3170066, display_time: 1790224642, title: '月之暗面注册资本增至1157.53万元', content_text: '企查查APP显示……', content: '<p>企查查APP显示……</p>', score: 1, uri: 'https://wallstreetcn.com/livenews/3170066' },
      { id: 3170067, display_time: 1790224600, title: '头条级快讯', content_text: '正文', content: '<p>正文</p>', score: 2, uri: 'https://wallstreetcn.com/livenews/3170067' },
    ],
  },
}

const IRM_KEYWORD = { code: 0, data: [{ secid: 'gshk0001211', stockCode: '002594', shortName: '比亚迪', stockType: '1' }] }

const IRM_QUESTIONS = {
  total: 209,
  rows: [
    { stockCode: '002594', companyShortName: '比亚迪', pubDate: 1790162707000, mainContent: '国际油价大涨，有利于欧洲电车推广……', attachedContent: '尊敬的投资者，您好！感谢您的建议。', attachedAuthor: '比亚迪' },
    // 未回复：attachedContent 为空 —— 这是事实，不是缺口。
    { stockCode: '002594', companyShortName: '比亚迪', pubDate: 1790162700000, mainContent: '请问贵公司海外工厂进度？', attachedContent: null },
  ],
}

// 原始 HTML 片段照抄 2026-09-24 真实 `allcompany.do` 第 1 页（`content` 经 JSON 解析后的形态）：
// 实测 `<br/>` 在 `<img>` **之后**，且 uid 与 png 同在**同一个 `<a>`** 内。
const SSE_COMPANY_PAGE = {
  content: `\t<div class='companyBox'>\t\t<a rel='tag' uid=65 href='user.do?uid=65' title='浦发银行'>\t\t\t<img src='https://sns.sseinfo.com/resources/images/avatar/company/600000.png?random=1790225073593' height='40px' width='40px'  /><br/>\t\t</a> <div><a href='user.do?uid=65'>600000</a></div>`
    + `\t<div class='companyBox'>\t\t<a rel='tag' uid=369 href='user.do?uid=369' title='西南证券'>\t\t\t<img src='https://sns.sseinfo.com/resources/images/avatar/company/600369.png?random=1' height='40px' width='40px'  /><br/>\t\t</a> <div><a href='user.do?uid=369'>600369</a></div>`
    + `\t<div class='companyBox'>\t\t<a rel='tag' uid=518 href='user.do?uid=518' title='贵州茅台'>\t\t\t<img src='https://sns.sseinfo.com/resources/images/avatar/company/600519.png?random=2' height='40px' width='40px'  /><br/>\t\t</a> <div><a href='user.do?uid=518'>600519</a></div>`,
}

const SSE_FEED = `<div class="m_feed_item" id="item-1790708">
<div class="m_feed_detail m_qa_detail"><div class="m_feed_face"><a rel="face" uid="329066" href="user.do?uid=329066" title="投资者"></a></div>
<div class="m_feed_txt"><a href="user.do?uid=1">:投资者(600369)</a>请问公司低成本债务融资是否优于股权回购？</div>
<div class="m_feed_from"><span>昨天 18:16</span></div></div>
<div class="m_feed_detail m_qa"><div class="m_feed_txt"><p>尊敬的投资者，您好！</p><p>公司结合市场情况开展债务融资。</p></div>
<div class="m_feed_from"><span>今天 09:30</span></div></div></div>
<div class="m_feed_item" id="item-1790709">
<div class="m_feed_detail m_qa_detail"><div class="m_feed_txt"><a href="user.do?uid=1">:投资者(600369)</a>尚未回复的问题</div>
<div class="m_feed_from"><span>2026年09月24日 10:05</span></div></div></div>`

// ── 签名 ────────────────────────────────────────────────────────────────

test('财联社签名：md5(sha1(按 key 字典序拼接))，与独立实现逐字一致', () => {
  // 期望值由**独立实现**（python hashlib）算出，避免"断言与实现同源"式自证：
  //   query = appName=CailianpressWeb&last_time=&os=web&refresh_type=1&rn=50&sv=7.7.5
  //   sign  = md5(sha1(query))
  const params = { appName: 'CailianpressWeb', os: 'web', sv: '7.7.5', last_time: '', refresh_type: '1', rn: '50' }
  assert.equal(clsSign(params), 'b849fe86598f3ceca205eda7b33a49a1')
  // 键序不影响结果（签名按字典序，不按传入序）
  assert.equal(
    clsSign({ rn: '50', sv: '7.7.5', refresh_type: '1', os: 'web', last_time: '', appName: 'CailianpressWeb' }),
    'b849fe86598f3ceca205eda7b33a49a1',
  )
  assert.notEqual(clsSign({ ...params, rn: '20' }), 'b849fe86598f3ceca205eda7b33a49a1')
})

// ── cls_telegraph ───────────────────────────────────────────────────────

test('cls_telegraph：请求带本地签名与 Referer，title 空时按 brief 兜底，广告位被剔除', async () => {
  const restore = installFetch(async () => json(CLS_PAGE))
  try {
    const outcome = await clsTelegraph(makeTransport(), { limit: 3 })
    assert.equal(outcome.source, 'cls')
    assert.equal(outcome.items.length, 2, 'is_ad 条目必须被剔除')
    const [first, second] = outcome.items
    assert.match(String(first.title), /地王/)
    assert.equal(second.title, '【无标题快讯】……', 'title 为空时用 brief')
    assert.equal(second.content, '【无标题快讯】……', 'content 为空时也用 brief')
    assert.match(String(first.time), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} CST$/)
    assert.equal(first.url, 'https://api3.cls.cn/share/article/2492045')
    const url = new URL(restore.requests[0].url)
    assert.match(url.searchParams.get('sign') ?? '', /^[0-9a-f]{32}$/)
    assert.equal(url.searchParams.get('appName'), 'CailianpressWeb')
    assert.equal(restore.requests[0].init.headers.referer, 'https://www.cls.cn/')
    assert.equal(restore.requests[0].init.method, 'GET')
  } finally {
    restore.restore()
  }
})

test('cls_telegraph：errno 非 0 必须失败而不是返回空表', async () => {
  const restore = installFetch(async () => json({ errno: 10002, data: null }))
  try {
    await assert.rejects(clsTelegraph(makeTransport(), { limit: 3 }), /errno=10002/)
  } finally {
    restore.restore()
  }
})

// ── wscn_lives ──────────────────────────────────────────────────────────

test('wscn_lives：透出 next_cursor，score 进 importance，翻页把 cursor 传回上游', async () => {
  const restore = installFetch(async () => json(WSCN_PAGE))
  try {
    const first = await wscnLives(makeTransport(), { channel: 'a-stock-channel', limit: 2 })
    assert.equal(first.next_cursor, '1790220645')
    assert.equal(first.items[0].importance, 1)
    assert.equal(first.items[1].importance, 2)
    assert.equal(first.items[0].url, 'https://wallstreetcn.com/livenews/3170066')
    assert.equal(first.items[0].content, '企查查APP显示……', '必须取 content_text 纯文本，不用带标签的 content')

    const second = await wscnLives(makeTransport(), { channel: 'a-stock-channel', limit: 2, cursor: '1790220645' })
    assert.equal(second.items.length, 2)
    const urls = restore.requests.map((request) => new URL(request.url))
    assert.equal(urls[0].searchParams.get('cursor'), null, '首次不带 cursor')
    assert.equal(urls[1].searchParams.get('cursor'), '1790220645', '翻页必须传回 cursor')
    assert.equal(urls[0].searchParams.get('channel'), 'a-stock-channel')
  } finally {
    restore.restore()
  }
})

test('wscn_lives：code 非 20000 必须失败', async () => {
  const restore = installFetch(async () => json({ code: 40000, data: { items: [] } }))
  try {
    await assert.rejects(wscnLives(makeTransport(), { channel: 'global-channel', limit: 5 }), /code=40000/)
  } finally {
    restore.restore()
  }
})

// ── cninfo_irm ──────────────────────────────────────────────────────────

test('cninfo_irm：两步都必须是 POST（GET 会 405），未回复记为 unanswered 而不是缺口', async () => {
  const restore = installFetch(async (url) => (url.includes('queryKeyboardInfo') ? json(IRM_KEYWORD) : json(IRM_QUESTIONS)))
  try {
    const outcome = await cninfoIrm(makeTransport(), { code: '002594', pageSize: 20, pageNum: 1 })
    assert.equal(outcome.items.length, 2)
    const [answered, unanswered] = outcome.items
    assert.equal(answered.status, 'answered')
    assert.match(String(answered.answer), /感谢您的建议/)
    assert.equal(unanswered.status, 'unanswered')
    assert.equal(unanswered.answer, '')
    assert.match(String(outcome.note), /深市专用/, 'note 要写明沪市需改用 sseinfo_qa')
    assert.match(String(outcome.note), /209/, 'note 带上游累计条数')
    // 两步都是 POST —— 第一步写 body，第二步按实测要求 POST 且 body 为空。
    assert.equal(restore.requests.length, 2)
    assert.equal(restore.requests[0].init.method, 'POST')
    assert.equal(restore.requests[1].init.method, 'POST')
    assert.match(String(restore.requests[0].init.body), /keyWord=002594/)
    assert.match(restore.requests[1].url, /orgId=gshk0001211/, '第二步必须带上第一步解析出的 orgId')
    assert.match(restore.requests[1].url, /pageSize=20/)
  } finally {
    restore.restore()
  }
})

test('cninfo_irm：代码查不到时明确报 NOT_FOUND，而不是静默返回空表', async () => {
  const restore = installFetch(async () => json({ code: 0, data: [] }))
  try {
    await assert.rejects(cninfoIrm(makeTransport(), { code: '600519', pageSize: 20, pageNum: 1 }), /互动易查不到 600519/)
  } finally {
    restore.restore()
  }
})

// ── sseinfo_qa ──────────────────────────────────────────────────────────

test('sseTime：三类写法都要认（少认一类就会让整个列表失败）', () => {
  const now = new Date('2026-09-24T04:00:00Z') // 北京时间 2026-09-24 12:00
  // 绝对
  assert.equal(sseTime('2026年09月18日 10:05', now), '2026-09-18 10:05')
  // 相对昨天 / 今天
  assert.equal(sseTime('昨天 18:16', now), '2026-09-23 18:16')
  assert.equal(sseTime('今天 09:30', now), '2026-09-24 09:30')
  // 相对分钟 / 小时（实测全量抽样里 150 条中的多数）
  assert.equal(sseTime('2分钟前', now), '2026-09-24 11:58')
  assert.equal(sseTime('57分钟前', now), '2026-09-24 11:03')
  assert.equal(sseTime('1小时前', now), '2026-09-24 11:00')
  assert.equal(sseTime('2小时前', now), '2026-09-24 10:00')
  // 跨小时/跨天要正确回推
  assert.equal(sseTime('90分钟前', new Date('2026-09-24T00:30:00Z')), '2026-09-24 07:00')
  assert.equal(sseTime('刚刚', now), '2026-09-24 12:00')
  // 认不出的一律 undefined —— 调用方据此失败，绝不猜一个时间出来
  assert.equal(sseTime('前天 09:00', now), undefined)
  assert.equal(sseTime('很久以前', now), undefined)
})

test('公司列表解析：uid 与代码必须来自同一个 <a>；窗口式正则会跨条目错配', () => {
  const text = SSE_COMPANY_PAGE.content
  assert.deepEqual(parseCompanyList(text), [
    { code: '600000', uid: '65' },
    { code: '600369', uid: '369' },
    { code: '600519', uid: '518' },
  ])

  // 外部实践文献的写法在**真实页面上是好的**（2026-09-24 实测 32/32 全对）：`<br/>` 在 `<img>` 之后，
  // `[^>]*>` 从 uid 一路吃到 `<img` 并不越界。（早期调研稿曾说它匹配 0 条——那是我在**手工改写**
  // 的夹具上得出的结论，夹具把 `<br/>` 挪到了 `<img>` 之前，属误判，此处以真实页面为准。）
  const documented = /uid=['"]?(\d+)['"]?[^>]*>\s*<img[^>]*company\/(\d{6})\.png/gu
  assert.deepEqual([...text.matchAll(documented)].map((match) => [match[2], match[1]]), [
    ['600000', '65'], ['600369', '369'], ['600519', '518'],
  ])

  // 真正的坑是**窗口式**写法（本实现的第一版）：间隔长度一旦覆盖到下一个条目，
  // 就会把第 2 条的 600369 配成第 1 条的 uid=65 —— "能跑但错"的映射比报错危险得多。
  // 按元素切分在结构上排除了这种错配，这也是 `parseCompanyList` 采用逐 `<a>` 解析的原因。
  const windowed = /uid=['"]?(\d+)['"]?[\s\S]{0,400}?company\/(\d{6})\.png/gu
  assert.deepEqual([...text.matchAll(windowed)].map((match) => [match[2], match[1]]), [
    ['600000', '65'], ['600369', '65'], ['600519', '369'],
  ], '窗口写法确实错配（600369 配到了 uid=65）')
})

test('parseSseFeed：以回复块为界切问答，未回复条目 answer 为空且 status=unanswered', () => {
  const items = parseSseFeed(SSE_FEED)
  assert.equal(items.length, 2)
  const [answered, unanswered] = items
  assert.equal(answered.id, '1790708')
  assert.equal(answered.code, '600369')
  assert.match(String(answered.question), /低成本债务融资/)
  assert.match(String(answered.answer), /公司结合市场情况开展债务融资/)
  assert.equal(answered.status, 'answered')
  assert.equal(unanswered.status, 'unanswered')
  assert.equal(unanswered.answer, '')
  assert.equal(unanswered.time, '2026-09-24 10:05')
})

test('sseinfo_qa：公司列表返回 json/javascript 也必须收下（严格 application/json 判定会误拒）', async () => {
  resetSseCachesForTest()
  const restore = installFetch(async (url) => {
    if (url.includes('allcompany.do')) {
      return makeResponse(200, { 'content-type': 'json/javascript;charset=UTF-8' }, JSON.stringify(SSE_COMPANY_PAGE))
    }
    return makeResponse(200, { 'content-type': 'text/html;charset=UTF-8' }, SSE_FEED)
  })
  try {
    const outcome = await sseinfoQa(makeTransport(), { code: '600369', kind: 'answered', page: 1, pageSize: 10 })
    assert.equal(outcome.source, 'sseinfo')
    assert.equal(outcome.operation, 'company_answered')
    // 夹具里两条都属于 600369，其中一条未回复；answered 列表按页面给什么返回什么。
    assert.ok(outcome.items.length >= 1)
    assert.ok(outcome.items.every((item) => item.code === '600369'))
  } finally {
    restore.restore()
  }
})

test('sseinfo_qa：uid 定位有总时限，超时是 TIMEOUT 而不是"这一轮被取消"', async () => {
  resetSseCachesForTest()
  // 永不 settle 的上游：单请求超时（TRANSPORT_OPTIONS 1s）管不住"10–13 个串行请求"这一整段，
  // 只有注入的总预算能结束它。
  const restore = installFetch(async () => new Promise(() => {}))
  try {
    await assert.rejects(
      sseinfoQa(makeTransport(), { code: '600519', kind: 'answered', page: 1, pageSize: 10, uidLocateBudgetMs: 30 }),
      (error) => {
        assert.equal(error.code, 'TIMEOUT', `总时限到点必须报来源超时，实际 ${error.name}: ${error.message}`)
        assert.match(error.message, /uid 定位超过/)
        return true
      },
    )
    // 调用方先取消：原样是取消，不能被总时限改写成 TIMEOUT（§4.1）。
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      sseinfoQa(makeTransport(), { code: '600520', kind: 'answered', page: 1, pageSize: 10, uidLocateBudgetMs: 30, signal: controller.signal }),
      (error) => {
        assert.notEqual(error.code, 'TIMEOUT', '调用方取消不得被写成上游超时')
        return true
      },
    )
  } finally {
    restore.restore()
  }
})

test('sseinfo_qa 描述里写给模型的定位时限 = 代码实际用的预算', () => {
  const definition = registerSources().find((candidate) => candidate.name === 'sseinfo_qa')
  assert.match(definition.description, new RegExp(`整段定位有 ${SSE_UID_LOCATE_TIMEOUT_MS / 1000} 秒总时限`),
    '描述里的秒数与 SSE_UID_LOCATE_TIMEOUT_MS 不一致：模型会按错的口径决定要不要等/重试')
})

test('sseinfo_qa：上游把别的公司数据混进来时按条过滤并写进 note，不整次失败', async () => {
  resetSseCachesForTest()
  // 实测形态：600519（uid 518）在 kind='questions' 下返回 600518 的问答。
  const foreign = SSE_FEED.replace(/600369/g, '600518')
  const restore = installFetch(async (url) => {
    if (url.includes('allcompany.do')) {
      return makeResponse(200, { 'content-type': 'json/javascript;charset=UTF-8' }, JSON.stringify(SSE_COMPANY_PAGE))
    }
    return makeResponse(200, { 'content-type': 'text/html;charset=UTF-8' }, foreign)
  })
  try {
    await assert.rejects(
      sseinfoQa(makeTransport(), { code: '600519', kind: 'questions', page: 1, pageSize: 10 }),
      /全部属于其他公司/,
      '全部被污染时没有可用条目，必须失败而不是返回空表',
    )
  } finally {
    restore.restore()
  }
})

test('sseinfo_qa：混合页面只保留目标公司的条目，并如实写明丢弃条数', async () => {
  resetSseCachesForTest()
  const mixed = SSE_FEED + SSE_FEED.replace(/600369/g, '600518').replace(/1790708|1790709/g, '1790999')
  const restore = installFetch(async (url) => {
    if (url.includes('allcompany.do')) {
      return makeResponse(200, { 'content-type': 'json/javascript;charset=UTF-8' }, JSON.stringify(SSE_COMPANY_PAGE))
    }
    return makeResponse(200, { 'content-type': 'text/html;charset=UTF-8' }, mixed)
  })
  try {
    const outcome = await sseinfoQa(makeTransport(), { code: '600369', kind: 'answered', page: 1, pageSize: 10 })
    assert.ok(outcome.items.every((item) => item.code === '600369'))
    assert.match(String(outcome.note), /已丢弃 2 条非 600369 的问答/)
  } finally {
    restore.restore()
  }
})

test('sseinfo_qa：解析出 0 条且页面没有「暂无」提示时必须失败（结构变更不得伪装成空结果）', async () => {
  resetSseCachesForTest()
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html;charset=UTF-8' }, '<html><body>改版了</body></html>'))
  try {
    await assert.rejects(sseinfoQa(makeTransport(), { kind: 'answered', page: 1, pageSize: 10 }), /既没有问答也没有/)
  } finally {
    restore.restore()
  }
})

// ── 工具注册面 ──────────────────────────────────────────────────────────

function registerSources() {
  const definitions = []
  const runtime = { register: (definition) => { definitions.push(definition); return () => {} } }
  registerSourceTools({ get: (name) => (name === 'tools' ? runtime : undefined), effect: (fn) => fn() }, TRANSPORT_OPTIONS)
  return definitions
}

test('工具注册：九个来源工具 named provider_operation，且参数根为 object', () => {
  const definitions = registerSources()
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'cls_telegraph', 'wscn_lives', 'cninfo_irm', 'sseinfo_qa',
    'eastmoney_724', 'eastmoney_stock_news', 'eastmoney_reports', 'sina_reports', 'ths_eps_forecast',
  ])
  for (const definition of definitions) {
    assert.equal(definition.parameters.type, 'object', `${definition.name} 的 parameters 根必须是 object`)
    assert.equal(definition.parameters.additionalProperties, false)
    assert.ok(definition.parameters.properties, `${definition.name} 必须有 properties`)
  }
})

test('工具输出：成功回执满足 output.schema，且 provider 即来源名、provider_tally 按来源计', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const restore = installFetch(async (url) => {
    if (url.includes('get_roll_list')) return json(CLS_PAGE)
    if (url.includes('content/lives')) return json(WSCN_PAGE)
    if (url.includes('queryKeyboardInfo')) return json(IRM_KEYWORD)
    if (url.includes('company/question')) return json(IRM_QUESTIONS)
    throw new Error(`unexpected url ${url}`)
  })
  try {
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'source-test' } } }
    const cls = await byName.get('cls_telegraph').execute({ limit: 5 }, exec)
    assert.equal(cls.provider, 'cls')
    assert.equal(cls.ok, true)
    assert.equal(cls.count, cls.items.length)
    assert.equal(cls.provider_tally.cls, 1)
    // 宿主会按 output.schema 校验返回值，本地必须复刻这一层（见 test/output-contract.mjs）。
    assertToolOutput(byName.get('cls_telegraph'), cls)

    const irm = await byName.get('cninfo_irm').execute({ code: '002594', page_size: 5 }, exec)
    assert.equal(irm.provider, 'cninfo_irm')
    assert.equal(irm.provider_tally.cninfo_irm, 1)
    assert.equal(irm.provider_tally.cls, 1, '不同来源各自计数，不并进 anysearch')
    assertToolOutput(byName.get('cninfo_irm'), irm)
  } finally {
    restore.restore()
  }
})

test('工具输出：失败必须是工具错误（isError 路径），结构化回执里带 provider 与回声', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const restore = installFetch(async () => makeResponse(500, { 'content-type': 'application/json' }, '{}'))
  try {
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'source-fail' } } }
    await assert.rejects(byName.get('cls_telegraph').execute({ limit: 5 }, exec), (error) => {
      const payload = JSON.parse(error.message)
      assert.equal(payload.ok, false)
      assert.equal(payload.provider, 'cls')
      assert.ok(payload.error)
      assert.ok(payload.provider_tally)
      return true
    })
  } finally {
    restore.restore()
  }
})

test('工具输出：调用方取消必须原样抛出，不得降级成 ok:false 失败信封', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  // 先取消再调用：传输层的取消闸门要求"调用方已经不要结果时绝不发网络请求"，
  // 且取消是 `ABORTED` 而不是"来源失败"——做成失败信封会让上层误判来源不可用。
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    byName.get('cls_telegraph').execute({ limit: 5 }, { signal: controller.signal }),
    (error) => {
      assert.equal(error.code, 'ABORTED', `取消必须带 ABORTED 码，实际：${error.message}`)
      assert.throws(() => JSON.parse(error.message), '取消不得被包成结构化失败信封')
      return true
    },
  )
})

test('同意开关：enabled:false 时九个来源工具响亮失败（DISABLED），且一次本机 HTTP 都不发起', async () => {
  const definitions = []
  const runtime = { register: (definition) => { definitions.push(definition); return () => {} } }
  registerSourceTools({ get: (name) => (name === 'tools' ? runtime : undefined), effect: (fn) => fn() },
    { ...TRANSPORT_OPTIONS, enabled: false })
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'application/json' }, '{}'))
  try {
    const byName = new Map(definitions.map((definition) => [definition.name, definition]))
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'source-disabled' } } }
    // 覆盖一条闸门直连来源与一条东财共享客户端来源：开关管的是**全部九个**。
    for (const name of ['cls_telegraph', 'eastmoney_724']) {
      await assert.rejects(byName.get(name).execute({}, exec), (error) => {
        const payload = JSON.parse(error.message)
        assert.equal(payload.ok, false, `${name} 关闭时必须失败`)
        assert.equal(payload.code, 'DISABLED')
        assert.match(payload.error, /允许启动本地提取网页内容/)
        return true
      })
    }
    assert.equal(restore.requests.length, 0, '关闭后不得发起任何本机 HTTP')
  } finally {
    restore.restore()
  }
})

test('eastmoney_* 与其余来源共用同一份出口闸门：不支持的内容类型被闸门拦下（不再是裸 fetch 直通）', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  // 正文是合法 JSON：裸 fetch 会照常解析成功；闸门则按 content-type 拒绝。
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'application/octet-stream' }, '{"code":"1","data":{"fastNewsList":[]}}'))
  try {
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'source-gate' } } }
    await assert.rejects(byName.get('eastmoney_724').execute({ limit: 5 }, exec), (error) => {
      const payload = JSON.parse(error.message)
      assert.equal(payload.ok, false)
      assert.match(payload.error, /unsupported content type/)
      return true
    })
  } finally {
    restore.restore()
  }
})

test('eastmoney_724 取消：取消信号原样穿过东财客户端与闸门适配，不被包成失败信封', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    byName.get('eastmoney_724').execute({ limit: 5 }, { signal: controller.signal }),
    (error) => {
      assert.equal(error.name, 'AbortError', `取消必须原样抛出，实际：${error.message}`)
      assert.throws(() => JSON.parse(error.message), '取消不得被包成结构化失败信封')
      return true
    },
  )
})

test('工具参数校验：代码必须 6 位、channel 形如 *-channel、kind 只能两个取值', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const exec = { signal: new AbortController().signal }
  await assert.rejects(byName.get('cninfo_irm').execute({ code: '60051' }, exec), /six-digit/)
  await assert.rejects(byName.get('wscn_lives').execute({ channel: 'global' }, exec), /global-channel/)
  await assert.rejects(byName.get('sseinfo_qa').execute({ kind: 'all' }, exec), /answered/)
  await assert.rejects(byName.get('cls_telegraph').execute({ limit: 999 }, exec), /limit/)
})

test('工具参数：带交易所前缀的代码由工具归一化，上游只看到纯 6 位', async () => {
  // 实测：东财研报库对 `SH600519` 返回 hits=0，看起来像"这只票没研报"。归一化因此属于
  // 工具职责（`bareAshareDigits`），而不是靠模型记得每次都写对格式。
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const restore = installFetch(async (url) => {
    if (url.includes('reportapi')) {
      return makeResponse(200, { 'content-type': 'application/json' }, JSON.stringify({ data: [], TotalPage: 1, hits: 0 }))
    }
    if (url.includes('queryKeyboardInfo')) return json({ data: [{ secid: 'gssz0000001', code: '000001' }] })
    return json({ rows: [], total: 0 })
  })
  try {
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'code-forms' } } }
    for (const form of ['SH600519', '600519.SH', '600519']) {
      await byName.get('eastmoney_reports').execute({ code: form }, exec)
    }
    const reportUrls = restore.requests.filter((request) => request.url.includes('reportapi')).map((request) => request.url)
    assert.equal(reportUrls.length, 3)
    for (const url of reportUrls) {
      assert.match(url, /[?&]code=600519(&|$)/u, `带前缀写法必须先归一化：${url}`)
      assert.doesNotMatch(url, /SH/iu)
    }
    await byName.get('cninfo_irm').execute({ code: 'SZ000001' }, exec)
    // 两步取数：queryKeyboardInfo（POST body 带 keyWord）→ company/question（GET 带 stockcode）。
    const irm = restore.requests.filter((request) => request.url.includes('irm.cninfo.com.cn'))
    const keyword = irm.find((request) => request.url.includes('queryKeyboardInfo'))
    assert.ok(keyword, 'cninfo_irm 第一步必须查 queryKeyboardInfo')
    assert.match(String(keyword.init.body), /keyWord=000001(&|$)/u, '深市代码归一化后不带 SZ')
    const qa = irm.find((request) => request.url.includes('company/question'))
    assert.ok(qa, 'cninfo_irm 第二步必须按 orgId 查问答')
    assert.match(qa.url, /[?&]stockcode=000001(&|$)/u)
    await assert.rejects(byName.get('eastmoney_reports').execute({ code: '60051' }, exec), /six-digit/)
  } finally {
    restore.restore()
  }
})

test('工具输出：条目再多也留在宿主剪枝阈值内，count 只说真放下的条数', async () => {
  const definitions = registerSources()
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const long = '财联社9月24日电'.repeat(150)
  // 只有 `content` 是长正文（`brief` 真实上一句话就够）：50 条的 JSON 约 6.4 万字符，
  // 仍在出口 `maxContentChars`（100k）之内——否则正文会被静默切一刀，测试打的就不是预算了。
  const rows = Array.from({ length: 50 }, (_unused, index) => ({
    id: 2490000 + index, ctime: 1790224318 - index, title: `第${index}条`, content: long,
    brief: `第${index}条`,
    shareurl: `https://api3.cls.cn/share/article/${2490000 + index}`, in_roll: true,
  }))
  const restore = installFetch(async () => json({ errno: 0, data: { roll_data: rows } }))
  try {
    const exec = { signal: new AbortController().signal, agent: { session: { id: 'budget' } } }
    const payload = await byName.get('cls_telegraph').execute({ limit: 50 }, exec)
    const chars = JSON.stringify(payload).length
    assert.ok(chars <= SOURCE_OUTPUT_BUDGET_CHARS, `输出必须留在剪枝阈值内，实际 ${chars} 字符`)
    assert.ok(payload.count < 50, '单条 1200 字的 50 条必然超预算，必须裁')
    assert.equal(payload.count, payload.items.length, 'count 必须等于真放下的条数，否则头部声明与正文不一致')
    assert.match(payload.note, /只放了前 \d+ 条，省略其后 \d+ 条/, '被省略的条数必须写进 note，不能静默')
  } finally {
    restore.restore()
  }
})

test('条目的 url 字段：不合法链接丢字段不丢条目', async () => {
  // 这些 url 会变成用户可点击的 markdown 链接（docs/dev/web-retriever.md §4），所以协议、控制符、
  // 凭据、超长四种形态都不配出现在证据里。
  const page = {
    errno: 0,
    data: {
      roll_data: [
        { id: 1, ctime: 1790224318, title: '脚本协议', content: '正文', brief: '正文', shareurl: 'javascript:alert(document.cookie)', in_roll: true },
        { id: 2, ctime: 1790224317, title: '超长链接', content: '正文', brief: '正文', shareurl: `https://api3.cls.cn/share/article/1?p=${'x'.repeat(600)}`, in_roll: true },
        { id: 3, ctime: 1790224316, title: '凭据伪装', content: '正文', brief: '正文', shareurl: 'https://sseinfo.com.cn@evil.example/x', in_roll: true },
      ],
    },
  }
  const restore = installFetch(async () => json(page))
  try {
    const outcome = await clsTelegraph(makeTransport(), { limit: 10 })
    assert.equal(outcome.items.length, 3, '链接不合法不是丢条目的理由，条目本身仍是证据')
    assert.deepEqual(outcome.items.map((item) => item.url), ['', '', ''])
    assert.deepEqual(outcome.items.map((item) => item.title), ['脚本协议', '超长链接', '凭据伪装'])
  } finally {
    restore.restore()
  }
})

// ── 东财 / 新浪 / 同花顺（2026-09-24 新增）──────────────────────────────────
//
// 夹具形状取自真实响应；三个东财工具用 `createEastmoneyClient({ minIntervalMs: 0 })`
// 关掉节流以免拖慢测试（节流本身另有 test/net-throttle.test.mjs 覆盖）。

function makeEastmoneyClient() {
  return createEastmoneyClient({ minIntervalMs: 0 })
}

test('eastmoney_724：code 是字符串 "1"，聚合到的内容照常返回并提示可能重复', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'application/json' }, JSON.stringify({
    code: '1',
    data: { fastNewsList: [{ title: '快讯标题', showTime: '2026-09-24 13:38:59', summary: '【快讯标题】摘要', url: 'https://finance.eastmoney.com/a/1.html' }] },
  })))
  try {
    const outcome = await eastmoneyFastNews(makeEastmoneyClient(), { limit: 5 })
    assert.equal(outcome.source, 'eastmoney')
    assert.equal(outcome.items.length, 1)
    assert.equal(outcome.items[0].time, '2026-09-24 13:38:59')
    assert.equal(outcome.items[0].url, 'https://finance.eastmoney.com/a/1.html')
  } finally {
    restore.restore()
  }
})

test('eastmoney_stock_news：缺文章列表键（只有 passportWeb）必须报风控，不得当成"该股没新闻"', async () => {
  // 实测形态：被风控时 result 里只有 passportWeb（股民资料），没有 cmsArticleWebOld。
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/javascript;charset=UTF-8' },
    'jQuery_news({"result":{"passportWeb":[]}})'))
  try {
    await assert.rejects(
      eastmoneyStockNews(makeEastmoneyClient(), { code: '688017', limit: 5 }),
      /间歇风控/,
      '缺键必须报错：静默返回空表会把风控说成"没有新闻"',
    )
  } finally {
    restore.restore()
  }
})

test('eastmoney_stock_news：键在但数组为空 = 该股确实没有新闻（与风控区分开）', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/javascript;charset=UTF-8' },
    'jQuery_news({"result":{"cmsArticleWebOld":[]}})'))
  try {
    const outcome = await eastmoneyStockNews(makeEastmoneyClient(), { code: '688017', limit: 5 })
    assert.equal(outcome.items.length, 0, '真·空结果应正常返回')
  } finally {
    restore.restore()
  }
})

test('eastmoney_reports：预测 EPS 是**字符串**也要转成数字（按类型判定会让它恒为 null）', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/plain;charset=UTF-8' }, JSON.stringify({
    hits: 68,
    TotalPage: 14,
    data: [{
      publishDate: '2026-09-02 00:00:00.000',
      title: '2026年半年报点评',
      orgSName: '国元证券',
      researcher: '龚斯闻,楼珈利',
      emRatingName: '增持',
      ratingChange: 3,
      // 实测上游原样是字符串（保留精度），早先按 number 判定导致恒为 null。
      predictThisYearEps: '1.0700000000',
      predictNextYearEps: '1.4000000000',
      infoCode: 'AP202609021828901486',
    }],
  })))
  try {
    const outcome = await eastmoneyReports(makeEastmoneyClient(), { code: '688017', pageSize: 20, pageNo: 1 })
    assert.equal(outcome.items[0].eps_this_year, 1.07)
    assert.equal(outcome.items[0].eps_next_year, 1.4)
    assert.equal(outcome.items[0].date, '2026-09-02')
    assert.equal(outcome.next_cursor, '2', '还有下一页时要给游标')
    assert.match(String(outcome.note), /PDF/, '必须写明拿不到摘要/正文这个边界')
  } finally {
    restore.restore()
  }
})

test('sina_reports：必须补交易所前缀（缺前缀时科创板会返回假空页）', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html; charset=gbk' },
    '<table><tr><td>1</td><td class="tal f14"><a title="t" href="https://x/rptid/1/index.phtml">t</a></td><td>company-type</td><td>2026-09-01</td><td>o</td><td>a</td></tr></table>'))
  try {
    await sinaReports(makeTransport(), { code: '688017', page: 1 })
    const url = new URL(restore.requests[0].url)
    assert.equal(url.searchParams.get('symbol'), 'sh688017', '科创板必须带 sh 前缀')
  } finally {
    restore.restore()
  }
  assert.equal(sinaSymbol('600519'), 'sh600519')
  assert.equal(sinaSymbol('000001'), 'sz000001')
  assert.equal(sinaSymbol('300750'), 'sz300750')
  assert.equal(sinaSymbol('920982'), 'bj920982')
})

test('sina_reports：列序按页面表头（报告类型在第 4 列、发布日期在第 5 列）', async () => {
  // 真实行（照抄 2026-09-24 实测）：序号 | 标题 | 报告类型 | 发布日期 | 机构 | 研究员
  const row = '<tr><td>1</td><td class="tal f14"><a target="_blank" title="绿的谐波(688017)2026年半年报点评" href="//stock.finance.sina.com.cn/stock/go.php/vReport_Show/kind/search/rptid/841632286677/index.phtml">绿</a></td><td>company-type</td><td>2026-09-01</td><td><div class="fname05"><span>org-co</span></div></td><td>analyst-a</td></tr>'
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html; charset=gbk' }, `<table>${row}</table>`))
  try {
    const outcome = await sinaReports(makeTransport(), { code: '688017', page: 1 })
    assert.equal(outcome.items.length, 1)
    // 早先把两列写反会得到 date="公司" / type="2026-09-01"——每列都有值却整行错位。
    assert.equal(outcome.items[0].date, '2026-09-01')
    assert.equal(outcome.items[0].type, 'company-type')
    assert.equal(outcome.items[0].org, 'org-co')
    assert.equal(outcome.items[0].researcher, 'analyst-a')
    assert.equal(outcome.items[0].report_id, '841632286677')
    assert.equal(outcome.items[0].url, 'https://stock.finance.sina.com.cn/stock/go.php/vReport_Show/kind/search/rptid/841632286677/index.phtml')
    // 该站声明 charset=gbk，走响应头声明的编码即可（无需来源侧显式声明）。
    assert.equal(restore.requests[0].init.headers.referer, 'https://finance.sina.com.cn/')
  } finally {
    restore.restore()
  }
})

test('sina_reports：带序号的行解析不出来时必须报错（结构变更不得伪装成空结果）', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html; charset=gbk' }, '<table><tr><td>1</td><td>完全变了的结构</td></tr></table>'))
  try {
    await assert.rejects(sinaReports(makeTransport(), { code: '600519', page: 1 }), /页面行结构可能已变/)
  } finally {
    restore.restore()
  }
})

test('ths_eps_forecast：从多张干扰表里认出目标表，均值即一致预期（GBK 解码由真机冒烟覆盖）', async () => {
  // 夹具用 ASCII：Node 无法合成真 GBK 字节（见 makeResponse 注释）。
  // 因此断言的是**表格选择 + 行解析 + 数值转换**；编码路径由真机冒烟与下面的源码断言守着。
  const html = '<table><tr><td>noise</td></tr></table>'
    + '<p>as of 2026-09-24, <strong>16</strong> institutions cover it</p>'
    + '<table><tr><th>year</th><th>institutions</th><th>min</th><th>EPS-mean</th><th>max</th><th>industry</th></tr>'
    + '<tr><td>2026</td><td>16</td><td>0.94</td><td>1.05</td><td>1.15</td><td>1.10</td></tr>'
    + '<tr><td>2027</td><td>16</td><td>1.36</td><td>1.54</td><td>1.76</td><td>1.46</td></tr></table>'
  // 实现按表头定位目标表（认「每股收益|EPS」且认「均值|mean」两个标记），因此夹具用全 ASCII 的
  // `EPS-mean` 也能命中——这正是"按结构而不是按某个字面词识别"的好处。
  const fixture = html
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, fixture))
  try {
    const outcome = await thsEpsForecast(makeTransport(), { code: '688017' })
    assert.equal(outcome.items.length, 2, '干扰表格不得混进来')
    assert.deepEqual(outcome.items[0], { year: '2026', institutions: 16, eps_min: 0.94, eps_mean: 1.05, eps_max: 1.15, industry_average: 1.1 })
    assert.equal(outcome.items[1].eps_mean, 1.54)
    assert.match(String(outcome.note), /机构/)
    // 该站声明 text/html **不带 charset** 而正文是 GBK：来源实现必须显式声明 encoding。
    // 这条查源码，因为 `encoding` 是传给传输层的知识、不是发出去的请求头。
    const source = readFileSync(new URL('../src/web-retriever/sources.ts', import.meta.url), 'utf8')
    const block = source.slice(source.indexOf('export async function thsEpsForecast'), source.indexOf('export async function thsEpsForecast') + 1200)
    assert.match(block, /encoding: 'gbk'/, '同花顺请求必须显式声明 GBK 编码')
  } finally {
    restore.restore()
  }
})

test('ths_eps_forecast：找不到目标表格时报错，不返回空表', async () => {
  const restore = installFetch(async () => makeResponse(200, { 'content-type': 'text/html' }, '<table><tr><td>没有目标表</td></tr></table>'))
  try {
    await assert.rejects(thsEpsForecast(makeTransport(), { code: '688017' }), /没有含「每股收益 \/ 均值」列的表格/)
  } finally {
    restore.restore()
  }
})
