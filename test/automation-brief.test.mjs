import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BRIEF_PROMPT_VERSION,
  BRIEF_SYSTEM_PROMPT,
  BriefValidationError,
  createBriefService,
  extractSessionAnswer,
  normalizeFinalAnswer,
  parseBriefOutput,
  readSessionAnswer,
  verifierBriefContent,
} from '../automation/brief.js'
import { createAutomationStore } from '../automation/store.js'
import { tradingCalendar } from '../automation/calendar.js'
import { createFakeDomain } from './automation-harness.mjs'

const NOW = Date.parse('2026-11-04T02:00:00Z')
const FINISHED = '2026-11-04T00:40:32.876Z'
const ANSWER = '昨晚美国科技股继续下跌。自选清单里 300803.SZ 指南针标记为持仓、占比 100%。今天开盘先看科技股能不能止跌。'
const PLAIN = '昨晚美国科技股继续下跌，市场怕的是它们之前涨得太贵。国内出了稳市场的新办法，但真正买股票的钱还没进来。今天开盘先看科技股能不能止跌，不然大盘还会被它们拖着走。'
const HEADLINE = '科技股又跌了，救兵还没到'

function output(overrides = {}) {
  return {
    headline: HEADLINE,
    plain: PLAIN,
    items: [{
      kind: 'confirm',
      title: '指南针持仓标记是否仍有效',
      detail: '占比 100%',
      symbol: '300803.SZ',
      sourceQuote: '自选清单里 300803.SZ 指南针标记为持仓、占比 100%',
    }],
    stocks: [{ symbol: '300803.SZ', name: '指南针', roles: ['holding'], note: '标记过期' }],
    gaps: [],
    ...overrides,
  }
}

function sessionEvents(text = ANSWER) {
  return {
    events: [
      { type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } },
      { type: 'tool/result', data: { message: { content: [{ type: 'text', text: '工具原文：收盘 44.55 元。' }] } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
    ],
  }
}

async function makeStore() {
  const fake = createFakeDomain()
  const store = createAutomationStore({
    openDomain: async () => fake.domain,
    profile: { name: 'web' },
    now: () => NOW,
    calendar: tradingCalendar,
  })
  const record = await store.createTask({
    title: '早间资讯',
    instruction: '给出结论',
    category: 'news',
    trigger: { kind: 'schedule', cadence: 'daily', time: '08:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
  })
  const task = await store.getTask(record.id)
  return { fake, store, task }
}

async function successRun(store, task) {
  const created = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: `manual-${Math.random()}`,
    status: 'succeeded',
    sessionId: 'session-test-1',
  })
  return store.updateRun(created.id, { finishedAt: FINISHED, durationMs: 1_000 })
}

async function waitForBrief(store, runId, expected, timeoutMs = 6_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const brief = await store.getBrief(runId)
    if (brief?.status === expected) return brief
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`brief ${runId} did not reach ${expected}`)
}

test('简报输出：代码围栏、原文引用、股票角色与跳过', () => {
  const parsed = parseBriefOutput(`\`\`\`json\n${JSON.stringify(output())}\n\`\`\``, ANSWER)
  assert.equal(parsed.headline, HEADLINE)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.stocks[0].roles[0], 'holding')
  assert.deepEqual(parseBriefOutput('{"skip":true}', ANSWER), { skip: true })
  assert.throws(() => parseBriefOutput('not json', ANSWER), BriefValidationError)
})

test('简报输出：items 不设条数上限，原文列了几条就保留几条', () => {
  const lines = Array.from({ length: 9 }, (_, index) => {
    const day = String(10 + index).padStart(2, '0')
    return `第 ${index + 1} 项：需要在 2026-11-${day} 前确认。`
  })
  const source = lines.join('\n')
  const items = lines.map((_line, index) => ({
    kind: 'track',
    title: `待确认事项 ${index + 1}`,
    detail: '原文明确列出的确认项',
    dueAt: `2026-11-${String(10 + index).padStart(2, '0')}`,
    sourceId: index + 1,
  }))
  const parsed = parseBriefOutput(JSON.stringify(output({ items })), source)
  assert.equal(parsed.items.length, 9, '超过 6 条不再被截断')
  assert.equal(parsed.items.at(-1).title, '待确认事项 9')
})

test('简报输出：gaps 也不设条数上限，原文列了几条就保留几条', () => {
  const lines = Array.from({ length: 8 }, (_, index) => `缺口 ${index + 1}：数据源没有该字段。`)
  const source = lines.join('\n')
  const gaps = lines.map((_line, index) => ({
    kind: 'capability',
    topic: `能力缺口 ${index + 1}`,
    detail: '数据源没有该字段。',
    sourceId: index + 1,
  }))
  const parsed = parseBriefOutput(JSON.stringify(output({ items: [], gaps })), source)
  assert.equal(parsed.gaps.length, 8, '超过 6 条不再被截断')
  assert.equal(parsed.gaps.at(-1).topic, '能力缺口 8')
})

test('简报 prompt：不再宣告 items 的条数上限', () => {
  assert.doesNotMatch(BRIEF_SYSTEM_PROMPT, /items 只提取[^\n]*最多\s*6\s*条/)
  assert.match(BRIEF_SYSTEM_PROMPT, /items 只提取[^\n]*不设条数上限/)
})

test('简报输出：headline 按字符数计，24 个通过、25 个报出实际长度', () => {
  const atLimit = `${'港'.repeat(23)}。`
  const overLimit = `${'港'.repeat(24)}。`
  assert.equal(parseBriefOutput(JSON.stringify(output({ headline: atLimit })), ANSWER).headline, atLimit)
  assert.throws(
    () => parseBriefOutput(JSON.stringify(output({ headline: overLimit })), ANSWER),
    (error) => error.code === 'headline_length' && error.details?.length === 25 && /当前 25 个/.test(error.message),
  )
})

test('简报输出：超长、Markdown 和伪造引用被拒绝或丢弃；内容语气与买卖建议交给用户', () => {
  assert.throws(() => parseBriefOutput(JSON.stringify(output({ plain: '字'.repeat(201) })), ANSWER), /plain 长度/)
  assert.throws(() => parseBriefOutput(JSON.stringify(output({ plain: `${PLAIN} \`\`\`` })), ANSWER), /Markdown/)
  const freeText = parseBriefOutput(JSON.stringify(output({
    plain: `${PLAIN} 今天崩了，龙虎榜买入 2.54 亿、卖出 2.03 亿，目标价 50 元，建议买入。`,
  })), ANSWER)
  assert.match(freeText.plain, /建议买入/, '不再按词表判断买卖建议')
  assert.match(freeText.plain, /崩了/, '不再按词表判断标题党语气')
  const dropped = parseBriefOutput(JSON.stringify(output({
    items: [{ ...output().items[0], sourceQuote: '原文里没有这句话' }],
  })), ANSWER)
  assert.equal(dropped.items.length, 0)
  const half = parseBriefOutput(JSON.stringify(output({
    items: [output().items[0], { ...output().items[0], title: '另一条', sourceQuote: '也不存在' }],
  })), ANSWER)
  assert.equal(half.items.length, 1, '一半有效时保留有效条目')
  assert.throws(
    () => parseBriefOutput(JSON.stringify(output({
      items: [
        { ...output().items[0], sourceQuote: '改写一' },
        { ...output().items[0], title: '第二条', sourceQuote: '改写二' },
        { ...output().items[0], title: '第三条', sourceQuote: '改写三' },
      ],
    })), ANSWER),
    (error) => error.code === 'items_dropped' && error.details.rejected.length === 3,
    '超过一半失败时错误里要带被拒引用的摘要',
  )
})

test('简报原文引用：标点、省略号、表格竖线差异不误杀，改写仍拒绝', () => {
  const quote = '“自选清单里 300803.SZ 指南针标记为持仓……占比 100%。”'
  const parsed = parseBriefOutput(JSON.stringify(output({
    items: [{ ...output().items[0], sourceQuote: quote }],
  })), ANSWER)
  assert.equal(parsed.items.length, 1, '补句号/引号/省略号后仍应命中原文')

  const tableSource = '| 1 | 美股非自选大市值公司的窗口内公告未取到 | SEC 未做全市场逐家扫描 |'
  const tableQuote = '1 美股非自选大市值公司的窗口内公告未取到；SEC 未做全市场逐家扫描。'
  const table = parseBriefOutput(JSON.stringify(output({
    items: [{ ...output().items[0], symbol: undefined, sourceQuote: tableQuote }],
  })), tableSource)
  assert.equal(table.items.length, 1, '表格竖线改成分号后仍应命中原文')

  const rewritten = parseBriefOutput(JSON.stringify(output({
    items: [{ ...output().items[0], sourceQuote: '指南针持仓占比很高' }],
  })), ANSWER)
  assert.equal(rewritten.items.length, 0, '改写后的内容仍必须丢弃')
})

test('简报按 sourceBlocks id 取依据，非法 id 丢弃', () => {
  const source = '自选清单里 300803.SZ 指南针标记为持仓、占比 100%。'
  const blocks = [{ id: 1, text: '开头' }, { id: 2, text: source }]
  const parsed = parseBriefOutput(JSON.stringify(output({
    items: [{ kind: 'confirm', title: '指南针持仓', symbol: '300803.SZ', sourceId: 2 }],
    stocks: [],
  })), source, blocks)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].sourceQuote, source)

  const invalid = parseBriefOutput(JSON.stringify(output({
    items: [{ kind: 'confirm', title: '指南针持仓', symbol: '300803.SZ', sourceId: 99 }],
    stocks: [],
  })), source, blocks)
  assert.equal(invalid.items.length, 0)
})

test('标的代码带交易所后缀时按基础代码匹配', () => {
  const source = '天山股份 000877 被证监会立案。'
  const parsed = parseBriefOutput(JSON.stringify(output({
    items: [{ ...output().items[0], symbol: '000877.SZ', sourceQuote: '天山股份 000877 被证监会立案。' }],
    stocks: [{ symbol: '000877.SZ', name: '天山股份', roles: ['event'] }],
  })), source)
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.stocks.length, 1)
})

test('会话正文：取最后一条主 assistant 文本和最后一条 request/header 路由', () => {
  const extracted = extractSessionAnswer({
    events: [
      { type: 'request/header', data: { header: { config: { provider: 'a', model: 'one' } } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '旧结论' }] } } },
      { type: 'request/header', data: { header: { config: { provider: 'b', model: 'two' } } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: '最终结论' }] } } },
    ],
  })
  assert.deepEqual(extracted, { text: '最终结论', provider: 'b', model: 'two' })
})

test('会话正文：结算通知唤醒的短确认不覆盖上一轮完整答复', () => {
  const extracted = extractSessionAnswer({
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '完整晨报：三件事与数据来源。' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'subagent-settled', senderSessionId: 'child-1' } } },
      { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '（本轮没有新增信息需要补入。）' }] } } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ],
  })
  assert.match(extracted.text, /完整晨报/, '上一轮完整答复必须进入简报正文')
  assert.match(extracted.text, /本轮没有新增信息/, '最后一轮确认仍保留，交给简报模型判断哪一段是实质结论')
})

test('会话正文：最后一轮本身有实质结论时也把上一轮保留为候选', () => {
  const extracted = extractSessionAnswer({
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '旧的中间结论' }] } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'subagent-settled', senderSessionId: 'child-1' } } },
      { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '结算后补齐的最终结论' }] } } },
    ],
  })
  assert.match(extracted.text, /旧的中间结论/, '上一轮作为候选保留')
  assert.match(extracted.text, /结算后补齐的最终结论/, '最后一轮实质结论不能被丢掉')
})

test('正文不截断：无论多长都完整交给简报与 TODO 核验', () => {
  const source = `${'字'.repeat(20_000)}\n尾部标记`
  const normalized = normalizeFinalAnswer(source)
  assert.equal(normalized.coverage, 'full')
  assert.equal(normalized.text, source)
})

test('固定 system prompt：无 persona、无工具，sessionId 与正文进入 user payload', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  let captured
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return { readSession: async () => sessionEvents() }
      if (name === 'llm') {
        return {
          async *stream(options) {
            captured = options
            yield { type: 'text-delta', text: JSON.stringify(output()) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      }
      return undefined
    },
  }
  const service = createBriefService({
    ctx,
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  await service.onRunSucceeded({ run: await store.getRun(run.id), task })
  const brief = await waitForBrief(store, run.id, 'ready')
  service.stop()
  assert.equal(captured.system, BRIEF_SYSTEM_PROMPT)
  assert.equal(captured.sessionId, 'session-test-1', 'opencode-go 需要会话头，否则 400 MissingSessionID')
  assert.equal(captured.tools, undefined)
  assert.equal(captured.temperature, 0)
  assert.equal(captured.maxTokens, 8_000, '推理模型会先消耗 thinking token，2400 会直接 length')
  const payload = JSON.parse(captured.messages[0].content[0].text)
  assert.equal(payload.sessionId, 'session-test-1')
  assert.match(payload.sourceBlocks.map((block) => block.text).join('\n'), /指南针/)
  assert.equal(payload.finalAnswer, undefined, '不再把整段 finalAnswer 塞进 payload')
  assert.equal(brief.headline, HEADLINE)
  assert.equal(brief.plain, PLAIN)
  assert.equal(brief.attempts, 1)
  assert.equal(brief.model, 'test-provider/test-model')
  assert.equal(brief.promptVersion, BRIEF_PROMPT_VERSION)
  assert.equal(brief.coverage, 'full')
  assert.equal((await store.getRun(run.id)).status, 'succeeded', '简报失败/成功都不能改运行终态')
})

test('长度校验失败后的修复请求带实际字数，并要求只改 headline', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return { readSession: async () => sessionEvents() }
      if (name === 'llm') {
        return {
          async *stream(options) {
            calls.push(options)
            const text = calls.length === 1
              ? JSON.stringify(output({ headline: `${'港'.repeat(24)}。` }))
              : JSON.stringify(output())
            yield { type: 'text-delta', text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      }
      return undefined
    },
  }
  const service = createBriefService({
    ctx,
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  await service.onRunSucceeded({ run: await store.getRun(run.id), task })
  const brief = await waitForBrief(store, run.id, 'ready')
  service.stop()
  assert.equal(calls.length, 2, '首轮超长后必须发一次修复请求')
  const repair = JSON.parse(calls[1].messages[0].content[0].text).repair
  assert.match(repair.issues, /当前 25 个/)
  assert.match(repair.issues, /只改 headline/)
  assert.equal(brief.status, 'ready')
  assert.equal(brief.attempts, 2)
})

test('核验简报文案：已触发项优先，无触发与无候选也有可读摘要', () => {
  const hit = verifierBriefContent({
    checked: 5,
    triggered: [
      { title: '指南针收盘站回 44.01', evidence: '收盘 44.55 元' },
      { title: '腾讯 Q3 财报已披露' },
    ],
    notTriggered: 2,
    needsHuman: 1,
    expired: 0,
  })
  assert.equal(hit.headline, '2 条核验已触发')
  assert.match(hit.plain, /指南针收盘站回 44\.01/)
  assert.match(hit.plain, /收盘 44\.55 元/, '没有模型文案时也要带出核实线索')
  assert.match(hit.plain, /2 条未触发、1 条需要你处理/)

  const authored = {
    headline: '指南针站回 44.01',
    plain: '指南针今日收盘 44.55 元，站回 44.01，成交量 1.2 亿，来源 eastmoney_quote，触发条件成立。',
  }
  assert.deepEqual(verifierBriefContent({ checked: 1, triggered: [], brief: authored }), authored, '模型写的 brief 优先')
  assert.equal(
    verifierBriefContent({ checked: 1, triggered: [{ title: '指南针收盘站回 44.01' }], brief: { headline: '短', plain: '太短' } }).headline,
    '1 条核验已触发',
    '不合法的模型 brief 回退到确定性文案',
  )
  assert.ok(Array.from(hit.plain).length >= 40 && Array.from(hit.plain).length <= 200)

  const quiet = verifierBriefContent({ checked: 3, triggered: [], notTriggered: 2, needsHuman: 1, expired: 0 })
  assert.equal(quiet.headline, '核验完成：没有触发')
  assert.match(quiet.plain, /2 条未成立、1 条需要你处理/)

  const empty = verifierBriefContent({ checked: 0, triggered: [] })
  assert.equal(empty.headline, '核验完成：本次无候选')
  assert.ok(Array.from(empty.plain).length >= 40)
})

test('核验简报落库：模型终稿里的 brief 原样落库，不再二次调用模型', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  const service = createBriefService({
    ctx: {},
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  const authored = {
    headline: '指南针站回 44.01',
    plain: '指南针今日收盘 44.55 元，站回 44.01，成交量 1.2 亿，来源 eastmoney_quote，触发条件成立。',
  }
  const brief = await service.recordVerifierBrief({
    run: await store.getRun(run.id),
    task,
    summary: {
      checked: 1,
      triggered: [{ title: '指南针收盘站回 44.01', evidence: '收盘 44.55 元' }],
      notTriggered: 0,
      needsHuman: 0,
      expired: 0,
      brief: authored,
    },
  })
  service.stop()
  assert.equal(brief.headline, authored.headline)
  assert.equal(brief.plain, authored.plain)
  assert.deepEqual(brief.items, [])
})

test('核验简报落库：ready 且 items/stocks/gaps 全空，不能变成新的 TODO 来源', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  const service = createBriefService({
    ctx: {},
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  const brief = await service.recordVerifierBrief({
    run: await store.getRun(run.id),
    task,
    summary: {
      checked: 2,
      triggered: [{ title: '指南针收盘站回 44.01', symbol: '300803.SZ' }],
      notTriggered: 1,
      needsHuman: 0,
      expired: 0,
    },
  })
  service.stop()
  assert.equal(brief.status, 'ready')
  assert.equal(brief.headline, '1 条核验已触发')
  assert.match(brief.plain, /指南针收盘站回 44\.01/)
  assert.deepEqual(brief.items, [], '核验结果不能回灌成 TODO')
  assert.deepEqual(brief.stocks, [])
  assert.deepEqual(brief.gaps, [])
  assert.equal(brief.promptVersion, BRIEF_PROMPT_VERSION)
})

test('读取终稿时同时返回工具原文，正文不按 12k 截断', async () => {
  const longAnswer = `${'长'.repeat(13_000)}\n尾部标记`
  const answer = await readSessionAnswer({
    readSession: async () => sessionEvents(longAnswer),
  }, 'session-test-1', { includeToolText: true })
  assert.ok(answer.text.length > 12_000, '终稿全文不能被 12k 截断')
  assert.match(answer.text, /尾部标记/)
  assert.match(answer.toolText, /工具原文：收盘 44\.55 元/)
  assert.deepEqual({ provider: answer.provider, model: answer.model }, { provider: 'test-provider', model: 'test-model' })
})

test('模型失败只把简报标失败，不影响运行；失败简报可单条重试', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  let fail = true
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return { readSession: async () => sessionEvents() }
      if (name === 'llm') {
        return {
          async *stream() {
            if (fail) throw new Error('model down')
            yield { type: 'text-delta', text: JSON.stringify(output()) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      }
      return undefined
    },
  }
  const service = createBriefService({
    ctx,
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  await service.onRunSucceeded({ run: await store.getRun(run.id), task })
  const failed = await waitForBrief(store, run.id, 'failed')
  assert.match(failed.error, /model down/)
  assert.equal((await store.getRun(run.id)).status, 'succeeded')

  fail = false
  const result = await service.retry(run.id)
  assert.deepEqual(result, { ok: true })
  const ready = await waitForBrief(store, run.id, 'ready')
  service.stop()
  assert.equal(ready.status, 'ready')
  assert.equal(ready.attempts, 3, '首次模型调用失败会内部重试一次，手动重试再成功')
  assert.match(ready.lastError, /model down/, '成功记录保留上一次失败原因')
  assert.ok(ready.lastErrorAt, '保留上一次失败时间')
})

test('重试：旧 prompt 版本重置尝试次数，新版本仍受上限约束', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  await store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })
  await store.updateBrief(run.id, { status: 'failed', attempts: 5, promptVersion: 1, error: '旧版本失败' })
  const service = createBriefService({
    ctx: { get: () => undefined },
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
    maxActive: 0,
  })
  assert.deepEqual(await service.retry(run.id), { ok: true })
  const pending = await store.getBrief(run.id)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.attempts, 0)
  assert.equal(pending.promptVersion, BRIEF_PROMPT_VERSION)
  assert.equal(pending.lastError, '旧版本失败', '重试时保留上一次失败原因')
  service.stop()

  const second = await makeStore()
  const run2 = await successRun(second.store, second.task)
  await second.store.createBrief({ runId: run2.id, taskId: second.task.id, sessionId: run2.sessionId })
  await second.store.updateBrief(run2.id, { status: 'failed', attempts: 5, promptVersion: BRIEF_PROMPT_VERSION, error: '新版本失败' })
  const service2 = createBriefService({
    ctx: { get: () => undefined },
    store: second.store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
    maxActive: 0,
  })
  const refused = await service2.retry(run2.id)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'brief_not_retryable')
  service2.stop()
})

test('没有 brief 的成功/失败运行不会触发历史生成', async () => {
  const { store, task } = await makeStore()
  const failed = await store.createRun({
    taskId: task.id,
    taskTitle: task.title,
    trigger: 'manual',
    occurrenceKey: 'manual-failed',
    status: 'failed',
    sessionId: 'session-failed',
  })
  let called = 0
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return { readSession: async () => { called += 1; return sessionEvents() } }
      return undefined
    },
  }
  const service = createBriefService({ ctx, store, scheduler: { status: () => ({ state: 'active' }) }, now: () => NOW })
  await service.onRunSucceeded({ run: await store.getRun(failed.id), task })
  assert.equal(await store.getBrief(failed.id), undefined)
  assert.equal(called, 0)
  service.stop()
})

test('模型 finish error 保留 provider code/status/message，便于定位 INVALID_REQUEST', async () => {
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') return { readSession: async () => sessionEvents() }
      if (name === 'llm') {
        return {
          async *stream() {
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: { code: 'INVALID_REQUEST', status: 400, message: 'Missing x-opencode-session' },
              },
            }
          },
        }
      }
      return undefined
    },
  }
  const service = createBriefService({
    ctx,
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => NOW,
    logger: { warn() {} },
  })
  await service.onRunSucceeded({ run: await store.getRun(run.id), task })
  const failed = await waitForBrief(store, run.id, 'failed')
  service.stop()
  assert.match(failed.error, /INVALID_REQUEST/)
  assert.match(failed.error, /status=400/)
  assert.match(failed.error, /Missing x-opencode-session/)
})

test('恢复扫描不把正在跑的第三次尝试提前判死；只有 stale pending 才按上限收口', async () => {
  const now = Date.parse('2026-11-04T02:00:00Z')
  const { store, task } = await makeStore()
  const run = await successRun(store, task)
  await store.createBrief({ runId: run.id, taskId: task.id, sessionId: run.sessionId })
  await store.updateBrief(run.id, { attempts: 5 })
  const service = createBriefService({
    ctx: { get: () => undefined },
    store,
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => now,
    logger: { warn() {} },
  })
  assert.equal(await service.recoverPending(), 0)
  assert.equal((await store.getBrief(run.id)).status, 'pending', '刚写入的 pending 即使 attempts=5 也不能被恢复扫描判死')
  service.stop()

  const old = now - 11 * 60_000
  const stale = await makeStore()
  const staleRun = await successRun(stale.store, stale.task)
  await stale.store.createBrief({ runId: staleRun.id, taskId: stale.task.id, sessionId: staleRun.sessionId })
  await stale.store.updateBrief(staleRun.id, { attempts: 5 })
  // Rewrite updatedAt through a separate store clock so the record looks older than the cutoff.
  const staleStore = {
    ...stale.store,
    listBriefsForProfile: stale.store.listBriefsForProfile,
    getBrief: stale.store.getBrief,
    updateBrief: stale.store.updateBrief,
  }
  const oldService = createBriefService({
    ctx: { get: () => undefined },
    store: {
      ...staleStore,
      listBriefsForProfile: async () => {
        const records = await stale.store.listBriefsForProfile()
        return records.map((record) => ({ ...record, updatedAt: new Date(old).toISOString() }))
      },
    },
    scheduler: { status: () => ({ state: 'active' }) },
    now: () => now,
    logger: { warn() {} },
  })
  await oldService.recoverPending()
  assert.equal((await stale.store.getBrief(staleRun.id)).status, 'failed')
  oldService.stop()
})
