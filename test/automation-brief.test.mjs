import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BRIEF_MAX_ANSWER_CHARS,
  BRIEF_PROMPT_VERSION,
  BRIEF_SYSTEM_PROMPT,
  BriefValidationError,
  clipFinalAnswer,
  createBriefService,
  extractSessionAnswer,
  parseBriefOutput,
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

test('简报输出：超长、Markdown、买卖建议和伪造引用都被拒绝或丢弃', () => {
  assert.throws(() => parseBriefOutput(JSON.stringify(output({ plain: '字'.repeat(201) })), ANSWER), /plain 长度/)
  assert.throws(() => parseBriefOutput(JSON.stringify(output({ plain: `${PLAIN} \`\`\`` })), ANSWER), /Markdown/)
  assert.throws(() => parseBriefOutput(JSON.stringify(output({ plain: `${PLAIN} 建议买入。` })), ANSWER), /买卖建议/)
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

test('正文超过 12k 取头尾，coverage=partial', () => {
  const clipped = clipFinalAnswer('字'.repeat(BRIEF_MAX_ANSWER_CHARS + 1))
  assert.equal(clipped.coverage, 'partial')
  assert.match(clipped.text, /中间省略/)
  assert.ok(Array.from(clipped.text).length < BRIEF_MAX_ANSWER_CHARS + 40, '头尾相加再加省略标记')
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
