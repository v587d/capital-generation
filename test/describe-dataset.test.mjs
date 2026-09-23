import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDatasetTools } from '../lib/data-collector/dataset-tools.js'
import { WorkspaceDatasetStore } from '../lib/data-collector/store.js'
import { MAX_DESCRIBE_QUERIES, SAFE_RESULT_CHARS } from '../lib/data-collector/describe.js'
import { assertToolOutput } from './output-contract.mjs'

/**
 * `describe_dataset` 的契约测试。
 *
 * 设计要点（docs/design/describe-dataset-design.md）：
 *  - **一次一份**：多个 dataset 由模型在同一条消息里发多个调用，靠 `isConcurrencySafe`
 *    进框架并发池——所以这里既断言"没有 dataset_ids 数组参数"，也断言并发声明存在。
 *  - **形状分支在宿主**：document 型不执行 queries。
 *  - **唯一体积闸门**：超过 SAFE_RESULT_CHARS 返回 too_large 小回执，绝不返回超长载荷。
 */

const CHILD = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const ROOT = { id: 'main-1', header: { cwd: '/workspace/proj' } }

function fakeFs() {
  const files = new Map()
  const dirs = new Set()
  const norm = (path) => {
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return '/' + parts.join('/')
  }
  return {
    files,
    dirs,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      return { targetKey: `key:${norm(path.startsWith('/') ? path : `${cwd}/${path}`)}`, displayPath: norm(path.startsWith('/') ? path : `${cwd}/${path}`) }
    },
    contains(parent, child) {
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async stat(target) {
      if (this.files.has(target.displayPath)) return { type: 'file', size: new TextEncoder().encode(this.files.get(target.displayPath)).byteLength }
      if (this.dirs.has(target.displayPath)) return { type: 'directory' }
      return undefined
    },
    async writeText(target, content, expected) {
      if (expected?.kind === 'createIfAbsent' && this.files.has(target.displayPath)) {
        const error = new Error('already exists')
        error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let i = 1; i < segments.length; i += 1) this.dirs.add('/' + segments.slice(0, i).join('/'))
      this.files.set(target.displayPath, content)
    },
    async readText(target) {
      if (!this.files.has(target.displayPath)) {
        const error = new Error('missing')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return this.files.get(target.displayPath)
    },
  }
}

function policyLike(mode = 'workspace-write') {
  return { resolve: ({ session }) => ({ mode, workspaceRoot: session?.header?.cwd, sessionId: session?.id }) }
}

function makeStore(options = {}) {
  const fs = options.fs ?? fakeFs()
  let ids = 0
  const store = new WorkspaceDatasetStore({
    fs,
    sandboxPolicy: policyLike(options.mode),
    now: options.now ?? (() => 1_700_000_000_000),
    newId: options.newId ?? ((prefix) => `${prefix}_${++ids}`),
  })
  return { store, fs }
}

function definitionsFor(store) {
  const definitions = []
  const ctx = {
    get: (name) => name === 'tools' ? { register: (definition) => { definitions.push(definition); return () => {} } } : undefined,
    effect: (fn) => fn(),
  }
  registerDatasetTools(ctx, store)
  return definitions
}

const describeTool = (store) => definitionsFor(store).find((definition) => definition.name === 'describe_dataset')
const exec = (session) => ({ agent: { session }, signal: new AbortController().signal })

/**
 * 复刻宿主 `snapshotJsonValue`（`@deepseek-ai/dsh-util-values`）的"无损 JSON"规则。
 *
 * ⛔ 为什么不能用 `JSON.stringify` 代替：它会**静默丢掉** undefined 属性，于是
 * "返回值带 undefined"这种真实故障在本地完全不可见。2026-09-23 真机事故正是如此：
 * 同一批 5 次 `describe_dataset` 里 3 次被宿主判
 * `ToolOutputError: value is not lossless JSON`，而本地 11 条测试全绿。
 */
function assertLosslessJson(value, path = '$') {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path} 必须是有限数字（宿主拒绝 NaN/Infinity）`)
    assert.ok(!Object.is(value, -0), `${path} 不能是 -0`)
    return
  }
  assert.notEqual(type, 'undefined', `${path} 是 undefined —— 宿主会判 value is not lossless JSON`)
  assert.equal(type, 'object', `${path} 的类型 ${type} 不可 JSON 序列化`)
  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype, `${path} 必须是普通数组`)
    for (let index = 0; index < value.length; index += 1) {
      assert.ok(Object.prototype.hasOwnProperty.call(value, index), `${path}[${index}] 是数组空洞`)
      assertLosslessJson(value[index], `${path}[${index}]`)
    }
    return
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} 必须是 plain 对象`)
  for (const [key, entry] of Object.entries(value)) assertLosslessJson(entry, `${path}.${key}`)
}

let seq = 0
const saveRows = (store, data, overrides = {}) => store.save({
  session: CHILD,
  capability: 'history',
  params_digest: `digest-${++seq}`,
  source_label: 'fuyao',
  format: 'json_rows',
  schema: { type: 'array' },
  row_count: Array.isArray(data) ? data.length : null,
  data: Array.isArray(data) ? { item: data } : data,
  ...overrides,
})

const closeRows = (rows) => Array.from({ length: rows }, (_, index) => ({
  date_ms: 1_700_000_000_000 + index * 86_400_000,
  report_type: index % 3 === 0 ? '年报' : '季报',
  close_price: 100 + index,
  volume: 1_000 + index,
  turnover: 2_000 + index,
}))

/** 21 列宽表：实测 profile ≈ 8.2KB，必然触发体积闸门。 */
const wideRows = (rows) => Array.from({ length: rows }, (_, index) => Object.fromEntries(
  Array.from({ length: 21 }, (_, key) => [`metric_${key}`, key % 3 === 0 ? `文本${index}` : (index + 1) * 1.5]),
))

test('describe_dataset：注册、一次一份、并发声明与 schema 根形状', () => {
  const { store } = makeStore()
  const definition = describeTool(store)
  assert.ok(definition, 'describe_dataset 必须注册')

  // 并发声明是"省往返"的机制本身：同一条消息里的多个调用靠它进框架并发池。
  assert.equal(typeof definition.isConcurrencySafe, 'function')
  assert.equal(definition.isConcurrencySafe({}), true)

  // 一次一份：不接受 dataset_ids 数组（合并 N 份结果才会引出体积预算/digest）。
  assert.deepEqual(Object.keys(definition.parameters.properties).sort(), [
    'columns_of_interest', 'dataset_id', 'primary_key', 'queries', 'task_id', 'time_column',
  ])
  assert.deepEqual(definition.parameters.required, ['dataset_id'])
  assert.equal(definition.parameters.type, 'object')
  assert.equal(definition.parameters.additionalProperties, false)

  // 其余三个底层工具仍然注册（单点复核的逃生通道）。
  const names = definitionsFor(store).map((item) => item.name)
  for (const name of ['inspect_dataset', 'profile_dataset', 'query_dataset']) assert.ok(names.includes(name), `${name} 必须保留`)
})

test('describe_dataset：一次调用完成 inspect + profile + queries', async () => {
  const { store, fs } = makeStore()
  const ref = await saveRows(store, closeRows(30))
  const definition = describeTool(store)

  const result = await definition.execute({
    dataset_id: ref.dataset_id,
    task_id: 'task-1',
    queries: [{ group_by: ['report_type'], aggregates: [{ function: 'count', as: 'n' }], limit: 5 }],
  }, exec(CHILD))

  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  // 宿主按 output.schema 校验返回值：ok 形态（含新增的 time_facts.axis/windows）必须合规。
  assertToolOutput(definition, result)
  assert.equal(result.dataset_id, ref.dataset_id)
  assert.equal(result.capability, 'history')
  assert.equal(result.source_label, 'fuyao')
  assert.equal(result.query_access.shape, 'envelope_item')
  assert.equal(result.row_count, 30)
  assert.ok(result.artifact_ref.startsWith('workspace://capital-data/datasets/'))
  assert.ok(result.profile_ref.startsWith('workspace://capital-data/profiles/'))
  // profile 四类事实随行返回，且 profile 已落盘
  assert.ok(result.quality)
  assert.ok(result.time_facts)
  assert.ok(result.statistics.close_price)
  assert.equal(result.queries.length, 1)
  assert.ok(result.queries[0].result, 'query 成功时应带 result')
  assert.equal(result.queries[0].result.returned_count, 2)
  assert.ok(fs.files.has(`/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`))
  // 载荷不得出现绝对路径
  assert.ok(!JSON.stringify(result).includes('/workspace/proj'))
})

test('describe_dataset：document 型不执行 queries，文档内容随行返回', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, {
    report: { revenue: 1, net_profit: 2 },
    abilities: [{ indicators: [{ index_id: 'roe', value: '12.3' }] }],
  }, { format: 'json', row_count: null })
  const definition = describeTool(store)

  const result = await definition.execute({
    dataset_id: ref.dataset_id,
    queries: [{ group_by: ['report_type'], aggregates: [{ function: 'count', as: 'n' }] }],
  }, exec(CHILD))

  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  assert.equal(result.query_access.shape, 'document')
  assert.deepEqual(result.queries, [], 'document 型不得执行 queries')
  assert.ok(result.warnings.some((warning) => /queries were not executed/.test(warning)), '必须如实披露 queries 被跳过')
  assert.ok(result.structure, '文档型必须有 structure 摘要')
  assert.ok(result.document, '文档型必须有有界内容')
})

test('describe_dataset：columns_of_interest 只保留指定列的统计与类型', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(30))
  const definition = describeTool(store)

  const result = await definition.execute({
    dataset_id: ref.dataset_id,
    columns_of_interest: ['close_price'],
  }, exec(CHILD))

  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  assert.deepEqual(Object.keys(result.statistics), ['close_price'])
  assert.deepEqual(Object.keys(result.schema), ['close_price'])
  assert.deepEqual(result.categories, {}, '未指定的类别列不应返回')
  // 列清单本身保留全量，模型才知道还能要哪些列
  assert.ok(result.columns.includes('volume'))
})

test('describe_dataset：体积闸门——宽表不返回超长载荷，改返回可操作的小回执', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, wideRows(10))
  const definition = describeTool(store)

  const tooLarge = await definition.execute({ dataset_id: ref.dataset_id }, exec(CHILD))
  assert.equal(tooLarge.status, 'too_large')
  assertLosslessJson(tooLarge)
  // too_large 是同一工具的第二形态：它的字段集合与 ok 形态不同，必须同样对声明合规。
  assertToolOutput(definition, tooLarge)
  assert.ok(tooLarge.bytes > SAFE_RESULT_CHARS, `bytes=${tooLarge.bytes} 应超过闸门 ${SAFE_RESULT_CHARS}`)
  assert.equal(tooLarge.columns.length, 21, '回执必须带完整列名，模型才知道怎么收窄')
  assert.ok(tooLarge.profile_ref.startsWith('workspace://capital-data/profiles/'))
  assert.ok(/columns_of_interest/.test(tooLarge.hint))
  assert.ok(JSON.stringify(tooLarge).length < SAFE_RESULT_CHARS, '回执自身必须在预算内')

  // 按 hint 收窄后应当正常返回
  const narrowed = await definition.execute({ dataset_id: ref.dataset_id, columns_of_interest: ['metric_0', 'metric_1'] }, exec(CHILD))
  assert.equal(narrowed.status, 'ok')
  assertLosslessJson(narrowed)
  assert.ok(JSON.stringify(narrowed).length <= SAFE_RESULT_CHARS)
})

test('describe_dataset：窄表不触发闸门（闸门只拦真正超预算的结果）', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(240))
  const definition = describeTool(store)
  const result = await definition.execute({ dataset_id: ref.dataset_id }, exec(CHILD))
  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  assert.ok(JSON.stringify(result).length < SAFE_RESULT_CHARS)
})

test('describe_dataset：文档型超预算时给文档专用 hint（列过滤对文档无效）', async () => {
  const { store } = makeStore()
  // 文档内容按 MAX_DOCUMENT_CHARS 有界，但 structure 摘要仍可能把它推过闸门。
  const doc = { blob: 'x'.repeat(5900) }
  for (let index = 0; index < 40; index += 1) {
    doc[`section_${index}`] = Object.fromEntries(Array.from({ length: 8 }, (_, key) => [`field_${index}_${key}`, key % 2 ? 1 : 'text']))
  }
  const ref = await saveRows(store, doc, { format: 'json', row_count: null })
  const definition = describeTool(store)

  const result = await definition.execute({ dataset_id: ref.dataset_id }, exec(CHILD))
  assert.equal(result.status, 'too_large')
  assertLosslessJson(result)
  assert.equal(result.shape, 'document')
  assert.match(result.hint, /profile_dataset/, '文档型必须指向 profile_dataset，而不是 columns_of_interest')
  assert.ok(JSON.stringify(result).length < SAFE_RESULT_CHARS)
})

test('describe_dataset：单条 query 失败只记该条，不影响 profile 与其余 query', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(30))
  const definition = describeTool(store)

  const result = await definition.execute({
    dataset_id: ref.dataset_id,
    queries: [
      { group_by: ['report_type'], aggregates: [{ function: 'count', as: 'n' }] },
      { group_by: ['missing_column'], aggregates: [{ function: 'count', as: 'n' }] },
    ],
  }, exec(CHILD))

  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  assert.ok(result.queries[0].result, '第一条应成功')
  assert.equal(result.queries[1].error.code, 'query_column_not_found')
  assert.ok(result.time_facts, 'profile 事实不受单条 query 失败影响')
})

test('describe_dataset：宽容解析字符串化的 JSON（与 query_dataset 同一套原语）', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(30))
  const definition = describeTool(store)

  const result = await definition.execute({
    dataset_id: ref.dataset_id,
    columns_of_interest: '["close_price"]',
    queries: '[{"group_by":"[\\"report_type\\"]","aggregates":"[{\\"function\\":\\"count\\",\\"as\\":\\"n\\"}]"}]',
  }, exec(CHILD))

  assert.equal(result.status, 'ok')
  assertLosslessJson(result)
  assert.deepEqual(Object.keys(result.statistics), ['close_price'])
  assert.ok(result.queries[0].result, '字符串化的 queries 必须被解析')
})

test('回归（2026-09-23 真机）：缺事实块时不得把 undefined 带出工具（宿主判 value is not lossless JSON）', async () => {
  const { store } = makeStore()
  const definition = describeTool(store)

  // ① 全数值列（真机里的日线）：profile 没有 categories —— 绝不能让 categories: undefined 出工具。
  //    真机里模型还猜错了列名（open/high/low/close，实际是 open_price/...），三个事实块全部落空。
  const numeric = await saveRows(store, Array.from({ length: 10 }, (_, index) => ({
    date_ms: 1_700_000_000_000 + index * 86_400_000,
    open_price: 10 + index,
    high_price: 11 + index,
    low_price: 9 + index,
    close_price: 10.5 + index,
    volume: 1_000 + index,
    turnover: 2_000 + index,
  })))
  const numericResult = await definition.execute({
    dataset_id: numeric.dataset_id,
    task_id: 'task_1',
    time_column: 'date_ms',
    columns_of_interest: ['date_ms', 'open', 'high', 'low', 'close', 'volume', 'turnover'],
  }, exec(CHILD))
  assert.equal(numericResult.status, 'ok')
  assertLosslessJson(numericResult)
  assert.equal('categories' in numericResult, false, '没有字符串列时 categories 必须缺省，而不是 undefined')
  assert.deepEqual(Object.keys(numericResult.statistics).sort(), ['date_ms', 'turnover', 'volume'],
    '只保留真实存在的列；猜错的 open/high/low/close 被忽略')
  assert.ok(numericResult.warnings.some((warning) => /ignored unknown columns/.test(warning)),
    '猜错的列名必须如实披露，而不是静默丢掉')

  // ② 全字符串列（真机里的 ticker_search）：profile 没有 statistics
  const strings = await saveRows(store, [{ thscode: '300803.SZ', ticker: '300803', name: '指南针' }])
  const stringResult = await definition.execute({ dataset_id: strings.dataset_id }, exec(CHILD))
  assert.equal(stringResult.status, 'ok')
  assertLosslessJson(stringResult)
  assert.equal('statistics' in stringResult, false, '没有数值列时 statistics 必须缺省，而不是 undefined')

  // ③ 文档型：没有逐列 schema / validation
  const document = await saveRows(store, { report: { revenue: 1, net_profit: 2 } }, { format: 'json', row_count: null })
  const documentResult = await definition.execute({ dataset_id: document.dataset_id }, exec(CHILD))
  assert.equal(documentResult.status, 'ok')
  assertLosslessJson(documentResult)
  assert.equal('schema' in documentResult, false, '文档型没有逐列 schema，必须缺省')
  assert.equal('validation' in documentResult, false, '文档型没有 validation，必须缺省')
})

test('describe_dataset：session 与入参边界一律抛错（isError），不做失败信封', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(5))
  const definition = describeTool(store)

  // 主 Agent 直调：非 delegated session
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id }, exec(ROOT)),
    /dataset_session_mismatch/,
  )
  await assert.rejects(() => definition.execute({ dataset_id: '../etc/passwd' }, exec(CHILD)), /dataset_id_invalid/)
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id, queries: new Array(MAX_DESCRIBE_QUERIES + 1).fill({ aggregates: [{ function: 'count', as: 'n' }] }) }, exec(CHILD)),
    /at most 8 items/,
  )
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id, columns_of_interest: 42 }, exec(CHILD)),
    /columns_of_interest/,
  )
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id, queries: [{ dataset_id: 'ds_other', aggregates: [{ function: 'count', as: 'n' }] }] }, exec(CHILD)),
    /must match the describe_dataset dataset_id/,
  )
})

test('describe_dataset：不可读的 Dataset 抛错并保留真实原因', async () => {
  const { store, fs } = makeStore()
  const ref = await saveRows(store, closeRows(5))
  fs.files.set(`/workspace/proj/capital-data/datasets/${ref.dataset_id}/raw.json`, '{ this is not json')
  const definition = describeTool(store)
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id }, exec(CHILD)),
    /dataset_not_row_readable/,
  )
})

test('describe_dataset：过期 Dataset 抛错（单 dataset 调用没有"部分成功"）', async () => {
  let now = 1_700_000_000_000
  const { store } = makeStore({ now: () => now })
  const ref = await saveRows(store, closeRows(5))
  now += 8 * 24 * 60 * 60 * 1000 // 超过 7 天保留期
  const definition = describeTool(store)
  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id }, exec(CHILD)),
    /dataset_expired/,
  )
})

/**
 * ⛔ 2026-09-23 事故（会话 `66fa9666`）：describe 内嵌 queries 与 `query_dataset` **行为不一致**。
 *
 * 同一个回合里，模型按协议把时间筛选写成日期串：
 *   - `query_dataset`：`">=": "2026-09"` 正常按区间筛；
 *   - `describe_dataset.queries`：`">=": "2026"` 被引擎当**数字 2026** 比较 → 243 行全中
 *     （`days_2026: 243`，静默错数）；`">=": "2026-07"` 被 `skip_with_warning` 整条跳过 → 0 行。
 * 两条都是"看起来成功"的错结果，比报错危险。根因是这一层归一最初只接在 `query_dataset` 上。
 */
test('describe_dataset：内嵌 queries 的时间筛选与 query_dataset 同构（日期串必须按区间解析）', async () => {
  const { store } = makeStore()
  const rows = [
    { date_ms: Date.UTC(2025, 11, 31) - 8 * 3_600_000, close_price: 900 },
    { date_ms: Date.UTC(2026, 0, 5) - 8 * 3_600_000, close_price: 1000 },
    { date_ms: Date.UTC(2026, 6, 15) - 8 * 3_600_000, close_price: 1100 },
    { date_ms: Date.UTC(2026, 8, 4) - 8 * 3_600_000, close_price: 1330 },
    { date_ms: Date.UTC(2026, 8, 23) - 8 * 3_600_000, close_price: 1252.57 },
  ]
  const ref = await saveRows(store, rows)
  const definition = describeTool(store)

  const described = await definition.execute({
    dataset_id: ref.dataset_id,
    time_column: 'date_ms',
    columns_of_interest: ['close_price'],
    queries: [
      // `>= "2026"` 必须是"2026 年内"，而不是被当成数字 2026 匹配全部 5 行。
      { filters: [{ column: 'date_ms', operator: '>=', value: '2026' }], aggregates: [{ function: 'count', as: 'days_2026' }] },
      // `>= "2026-07"` 与 `<= "2026-07-31"` 必须是七月区间，不能整条被跳过。
      { filters: [{ column: 'date_ms', operator: '>=', value: '2026-07' }, { column: 'date_ms', operator: '<=', value: '2026-07-31' }], aggregates: [{ function: 'count', as: 'july_days' }] },
      // `=` 单日必须能命中（展开成当天上下界）。
      { filters: [{ column: 'date_ms', operator: '=', value: '2026-09-04' }], aggregates: [{ function: 'max', column: 'close_price', as: 'close_0904' }] },
      // 日期串配 `>` 无意义 ⇒ 只让**这一条**报错，不影响 profile 与其余 query。
      { filters: [{ column: 'date_ms', operator: '>', value: '2026-09-04' }], aggregates: [{ function: 'count', as: 'n' }] },
      // 分组返回时间列时，与 query_dataset 一样补可读日期。
      { filters: [{ column: 'date_ms', operator: '>=', value: '2026-09-01' }], group_by: ['date_ms'], aggregates: [{ function: 'max', column: 'close_price', as: 'c' }], order_by: [{ column: 'date_ms', direction: 'asc' }] },
    ],
  }, exec(CHILD))

  assert.equal(described.status, 'ok')
  const [ytd, july, day, rejected, grouped] = described.queries
  assert.equal(ytd.result.rows[0].days_2026, 4, '">= 2026" 应只命中 2026 年的 4 行（含 2026-01-05）')
  assert.equal(ytd.result.warnings.length, 0, '不得再出现 "skipped incompatible value" 这类静默降级')
  assert.equal(july.result.rows[0].july_days, 1)
  assert.equal(day.result.rows[0].close_0904, 1330)
  assert.equal(rejected.error.code, 'query_type_conflict', '无意义的日期算子必须响亮失败，而不是给错答案')
  assert.deepEqual(grouped.result.rows.map((row) => row.date_ms_iso), ['2026-09-04', '2026-09-23'])
  assert.ok(grouped.result.columns.includes('date_ms_iso'))
  // 单条失败不影响整份结果的可加载性与输出契约。
  assertLosslessJson(described)
  assertToolOutput(definition, described)
})

test('describe_dataset：内嵌 queries 的相对期写法同样生效（{ period } 与字符串化对象）', async () => {
  const { store } = makeStore()
  const rows = [
    { date_ms: Date.UTC(2025, 8, 24) - 8 * 3_600_000, close_price: 900 },
    { date_ms: Date.UTC(2026, 7, 24) - 8 * 3_600_000, close_price: 1000 },
    { date_ms: Date.UTC(2026, 8, 23) - 8 * 3_600_000, close_price: 1252.57 },
  ]
  const ref = await saveRows(store, rows)
  const described = await describeTool(store).execute({
    dataset_id: ref.dataset_id,
    time_column: 'date_ms',
    columns_of_interest: ['close_price'],
    queries: [
      { filters: [{ column: 'date_ms', operator: '>=', value: { period: 'last_1_month' } }], aggregates: [{ function: 'count', as: 'n' }] },
      { filters: [{ column: 'date_ms', operator: '>=', value: { period: 'ytd' } }], aggregates: [{ function: 'count', as: 'ytd_n' }] },
    ],
  }, exec(CHILD))
  assert.equal(described.queries[0].result.rows[0].n, 2, '锚点=数据最后一天，近 1 月应含 8/24 与 9/23')
  assert.equal(described.queries[1].result.rows[0].ytd_n, 2)
})

test('describe_dataset：columns_of_interest 也收窄 time_facts 的首末值投影（承诺与行为一致）', async () => {
  const { store } = makeStore()
  const ref = await saveRows(store, closeRows(30))
  const definition = describeTool(store)

  const full = await definition.execute({ dataset_id: ref.dataset_id, time_column: 'date_ms' }, exec(CHILD))
  // first/last 只投影「时间列 + 数值列」（字符串列不进首末投影）。
  assert.deepEqual(Object.keys(full.time_facts.first).sort(), ['close_price', 'date_ms', 'turnover', 'volume'])

  const narrowed = await definition.execute({
    dataset_id: ref.dataset_id,
    time_column: 'date_ms',
    columns_of_interest: ['close_price'],
  }, exec(CHILD))
  // 时间列永远保留（首末值的时间坐标），其余只留被点名的列。
  assert.deepEqual(Object.keys(narrowed.time_facts.first), ['date_ms', 'close_price'])
  assert.deepEqual(Object.keys(narrowed.time_facts.last), ['date_ms', 'close_price'])
  assert.ok(JSON.stringify(narrowed).length < JSON.stringify(full).length)
  assertToolOutput(definition, narrowed)
})
