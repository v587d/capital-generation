import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDatasetTools } from '../lib/data-collector/dataset-tools.js'
import { DatasetStoreError, WorkspaceDatasetStore } from '../lib/data-collector/store.js'

const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }
const OTHER_SESSION = { id: 'session-2', header: { cwd: '/workspace/proj' } }
const COLLECTOR_CHILD = { id: 'collector-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const JUNIOR_CHILD = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const INDEPENDENT_SESSION = { id: 'main-2', header: { cwd: '/workspace/proj' } }

function fakeFs() {
  const files = new Map()
  const dirs = new Set()
  const ops = []
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
    ops,
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
    async writeText(target, content, expected, signal, policy) {
      this.ops.push({ path: target.displayPath, expected: expected?.kind, policy: policy?.mode })
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
  const store = new WorkspaceDatasetStore({
    fs,
    sandboxPolicy: options.sandboxPolicy ?? policyLike(options.mode),
    now: options.now ?? (() => 1_700_000_000_000),
    newId: options.newId ?? (() => 'ds_001'),
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

function saveInput(overrides = {}) {
  return {
    session: SESSION,
    capability: 'history',
    params_digest: 'digest-1',
    source_label: 'fuyao',
    format: 'json_rows',
    schema: { type: 'array' },
    row_count: 3,
    data: { timestamp: 1, item: [
      { date_ms: 1, close_price: 100, volume: 10 },
      { date_ms: 2, close_price: 102, volume: 11 },
      { date_ms: 3, close_price: 101, volume: 12 },
    ] },
    ...overrides,
  }
}

test('Dataset Phase 3：inspect、profile 走 query-only store 流程', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput())

  const inspection = await store.inspectDataset(ref.dataset_id, SESSION)
  assert.equal(inspection.dataset_id, ref.dataset_id)
  assert.equal(inspection.query_access.readable, true)
  assert.equal(inspection.query_access.shape, 'envelope_item')
  assert.ok(!('rows' in inspection))

  const profile = await store.writeProfile({
    session: SESSION,
    dataset_id: ref.dataset_id,
    task_id: 'task-1',
    profile: {
      row_count: 3,
      columns: ['date_ms', 'close_price'],
      quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true },
      statistics: { close_price: { min: 100, max: 102, mean: 101, p50: 101 } },
      warnings: [],
    },
  })
  assert.equal(profile.dataset_id, ref.dataset_id)
  assert.equal(profile.artifact_ref, `workspace://capital-data/profiles/${profile.profile_id}`)
  assert.ok(fs.files.has(`/workspace/proj/capital-data/profiles/${profile.profile_id}/profile.json`))
  assert.equal(fs.ops.at(-1).expected, 'createIfAbsent')
})

test('profile_dataset：宿主完成全量基础统计并只返回 profile 摘要', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, task_id: 'task-profile', time_column: 'date_ms' })
  assert.equal(result.dataset_id, ref.dataset_id)
  assert.equal(result.row_count, 3)
  assert.deepEqual(result.statistics.close_price, { count: 3, sum: 303, min: 100, max: 102, mean: 101, p25: 100.5, p50: 101, p75: 101.5 })
  assert.equal(result.quality.missing_values, 0)
  assert.equal(result.quality.duplicate_rows, 0)
  assert.equal(result.quality.time_ordered, true)
  assert.ok(!('rows' in result))
  const profilePath = `/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`
  assert.ok(fs.files.has(profilePath))
  const storedProfile = JSON.parse(fs.files.get(profilePath))
  assert.ok(!('rows' in storedProfile.profile))
  assert.deepEqual(storedProfile.profile.statistics.close_price, result.statistics.close_price)
})

test('Phase 1 profile：区分 observed type、null、missing、mixed，并对照 source output schema', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: {
      type: 'object',
      properties: {
        item: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              close_price: { type: 'number' },
              all_null: { type: 'number' },
            },
          },
        },
      },
    },
    data: { item: [
      { symbol: 'A', close_price: 100, all_null: null },
      { symbol: 'B', close_price: '101.5', all_null: null },
      { symbol: 3, close_price: null, all_null: null },
      { close_price: 'not-a-number', all_null: null },
    ] },
  }))

  const result = await store.profileDataset({
    session: JUNIOR_CHILD,
    dataset_id: ref.dataset_id,
  })

  assert.equal(result.schema.symbol.inferred_type, 'mixed')
  assert.equal(result.schema.symbol.null_count, 0)
  assert.equal(result.schema.symbol.missing_count, 1)
  assert.equal(result.schema.close_price.inferred_type, 'mixed')
  assert.equal(result.schema.close_price.numeric_string_count, 1)
  assert.equal(result.schema.all_null.inferred_type, 'null')
  assert.equal(result.schema.all_null.null_count, 4)
  assert.equal(result.validation.status, 'fail')
  assert.deepEqual(result.validation.violations.map((item) => [item.column, item.rule, item.invalid_count]), [
    ['symbol', 'type', 1],
    ['close_price', 'type', 1],
  ])

  const stored = JSON.parse(fs.files.get(`/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`))
  assert.equal(stored.profile.validation.status, 'fail')
  assert.ok(stored.profile.schema.close_price)
  assert.ok(!('rows' in stored.profile))
})

test('Phase 1 profile：只传 source schema 时，Fuyao number 契约允许 numeric string 但仍记录观察类型', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: {
      type: 'object',
      properties: { item: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' } } } } },
    },
    data: { item: [{ price: '100.5' }, { price: 101 }] },
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.deepEqual(result.schema.price.observed_types, { string: 1, integer: 1 })
  assert.equal(result.schema.price.numeric_string_count, 1)
  assert.equal(result.schema.price.invalid_count, 0)
  assert.equal(result.validation.status, 'pass')
})

test('Phase 1 profile：扫描并持久化超过 64 个字段，不静默截断', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const row = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`field_${index}`, index]))
  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD, data: { item: [row] }, row_count: 1 }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(result.columns.length, 70)
  assert.equal(Object.keys(result.schema).length, 70)
  assert.ok(result.schema.field_69)
})

test('Phase 2 profile：首末值必须来自真实首末行，不能拿 min/max 充当走势', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  // 实测教训：只有 min/max 时，模型把区间极值讲成「从 74 涨到 105 以上随后可能回落」。
  // 这条数据末行既不是最大值也不是最小值，用来钉住 first/last 的语义。
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [
      { date_ms: 1, close_price: 80 },
      { date_ms: 2, close_price: 105 },
      { date_ms: 3, close_price: 70 },
    ] },
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, time_column: 'date_ms' })
  assert.equal(result.time_facts.time_column, 'date_ms')
  assert.equal(result.time_facts.ordered_ascending, true)
  assert.equal(result.time_facts.covered_from, 1)
  assert.equal(result.time_facts.covered_to, 3)
  assert.deepEqual(result.time_facts.first, { date_ms: 1, close_price: 80 })
  assert.deepEqual(result.time_facts.last, { date_ms: 3, close_price: 70 })
  // 首值是 80、末值是 70，而 min=70 / max=105：三者不同，模型据此才能说清「期间最高 105、最新 70」
  assert.equal(result.statistics.close_price.min, 70)
  assert.equal(result.statistics.close_price.max, 105)
  const stored = JSON.parse(fs.files.get(`/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`))
  assert.deepEqual(stored.profile.time_facts, result.time_facts, 'time_facts 必须随 profile 一起持久化')
})

test('Phase 2 profile：时间列按取值判定，不把 report_type 之类的枚举当时间轴', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [
      { thscode: '000300.SH', report_type: 'quarter', report: '2025-2', value: 1 },
      { thscode: '000300.SH', report_type: 'quarter', report: '2025-1', value: 2 },
    ] },
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  // report_type 先出现在列序里且匹配 report 候选，但它全是枚举字符串 → 跳过；report 是日期样式 → 采用
  assert.equal(result.time_facts.time_column, 'report')
  assert.equal(result.time_facts.first.report, '2025-2')
  assert.equal(result.time_facts.last.report, '2025-1')
  assert.equal(result.time_facts.ordered_ascending, false, '文件顺序是降序，必须如实报告')
})

test('Phase 2 profile：类别事实给出 distinct 与高频取值，未列全时显式标记 truncated', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [
      { name: 'a', industry: '银行' },
      { name: 'b', industry: '银行' },
      { name: 'c', industry: '医药' },
      { name: 'd', industry: '电子' },
    ] },
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.deepEqual(result.categories.industry, {
    distinct_count: 3,
    // 先按次数降序，次数相同按取值排序（码位序），保证同一份数据每次结果一致
    top_values: [{ value: '银行', count: 2 }, { value: '医药', count: 1 }, { value: '电子', count: 1 }],
    truncated: false,
  })
  assert.equal(result.categories.name.distinct_count, 4)
  assert.equal(result.categories.name.truncated, false, '全部取值都在 top_values 里时不该标记 truncated')

  // 取值超过展示上限时必须显式披露「还有没列出的取值」
  const wide = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    params_digest: 'digest-wide-category',
    data: { item: Array.from({ length: 7 }, (_, index) => ({ tag: `标签${index}` })) },
  }))
  const wideProfile = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: wide.dataset_id })
  assert.equal(wideProfile.categories.tag.distinct_count, 7)
  assert.equal(wideProfile.categories.tag.top_values.length, 5)
  assert.equal(wideProfile.categories.tag.truncated, true)
})

test("Dataset row_key：保存后重新读取仍按声明的 stock_items 识别行集合", async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => prefix + "_" + (++next) })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    format: "json_rows",
    row_key: "stock_items",
    row_count: 2,
    data: { stock_items: [{ symbol: "A", price: 10 }, { symbol: "B", price: 20 }] },
  }))
  const inspection = await store.inspectDataset(ref.dataset_id, JUNIOR_CHILD)
  assert.equal(inspection.query_access.shape, "envelope_item")
  const profile = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(profile.row_count, 2)
  const query = await store.queryDataset({
    session: JUNIOR_CHILD,
    dataset_id: ref.dataset_id,
    query: { dataset_id: ref.dataset_id, select: ["rows"], aggregates: [{ function: "count", as: "rows" }] },
  })
  assert.deepEqual(query.rows, [{ rows: 2 }])
})

test("Phase 2 profile：超过 50 个嵌套元素时明确返回 sampled_elements", async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => prefix + "_" + (++next) })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [{ nested: Array.from({ length: 60 }, (_, index) => ({ id: index })) }] },
  }))
  const profile = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(profile.structure.nested.sampled_elements, 50)
  assert.equal("total_elements" in profile.structure.nested, false)
  assert.ok(profile.warnings.some((warning) => warning.includes("sampled_elements")))
})

test('Phase 2 profile：嵌套数组/对象展开成路径摘要，total_elements 即叶子总数', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  // QDII 额度形状：data[] → sub_tab[] → fund_list[]，顶层行（分类）不是叶子事实。
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    row_count: 1,
    data: [{ name: '热门', sub_tab: [
      { name: 'A', fund_list: [{ thscode: '1.OF' }, { thscode: '2.OF' }] },
      { name: 'B', fund_list: [{ thscode: '3.OF' }] },
    ] }],
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(result.row_count, 1, '顶层行数仍是分类数')
  const leaf = result.structure['sub_tab[].fund_list']
  assert.equal(leaf.type, 'array')
  assert.equal(leaf.total_elements, 3, '叶子总数必须由宿主算出：3 只基金，而不是 1 行')
  assert.equal(leaf.occurrences, 2)
  assert.equal(leaf.min_length, 1)
  assert.equal(leaf.max_length, 2)
  assert.deepEqual(result.structure['sub_tab[].fund_list[]'].fields.map((field) => field.name), ['thscode'])
  assert.equal(result.structure.sub_tab.total_elements, 2)
  assert.equal(result.structure['sub_tab[]'].fields.find((field) => field.name === 'fund_list').type, 'array')
  // 空数组与嵌套对象字段同样要可见
  const ladder = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    params_digest: 'digest-ladder',
    data: { item: [
      { date: '2026-06-01', boards: { two_board: [{ thscode: '1' }], three_board: [] } },
      { date: '2026-06-02', boards: { two_board: [], three_board: [] } },
    ] },
  }))
  const ladderProfile = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ladder.dataset_id })
  assert.equal(ladderProfile.structure['boards.two_board'].total_elements, 1)
  assert.equal(ladderProfile.structure['boards.two_board'].empty_count, 1)
  assert.deepEqual(ladderProfile.structure.boards.fields, [{ name: 'two_board', type: 'array' }, { name: 'three_board', type: 'array' }])
})

test('Phase 2 profile：事实块的体积有界，不随行数膨胀', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const profileSize = async (rowsCount, columns) => {
    const item = Array.from({ length: rowsCount }, (_, index) => Object.fromEntries(
      Array.from({ length: columns }, (_, key) => [`col_${key}`, key % 2 === 0 ? `文本${index}` : index * 1.5]),
    ))
    const saved = await store.save(saveInput({ session: COLLECTOR_CHILD, params_digest: `digest-${rowsCount}-${columns}`, data: { item } , row_count: item.length }))
    const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: saved.dataset_id })
    return JSON.stringify(result).length
  }
  // 行数不是瓶颈：profile 是「每列一段统计」，1000 行与 100 行体积几乎一致
  const small = await profileSize(100, 5)
  const large = await profileSize(1_000, 5)
  assert.ok(large - small < 200, `行数从 100 涨到 1000，profile 体积不应显著变化（${small} → ${large}）`)
  // 列数才是瓶颈：12 列仍应留在工具结果剪枝阈值（preset 配 8192）以内
  assert.ok(await profileSize(200, 12) < 5_000, '12 列 profile 应显著低于剪枝阈值')
})

test('Dataset session scope：collector 与 junior 兄弟子 Agent 可共享，独立主 session 不可读取', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD }))
  const inspection = await store.inspectDataset(ref.dataset_id, JUNIOR_CHILD)
  assert.equal(inspection.dataset_id, ref.dataset_id)
  await assert.rejects(() => store.inspectDataset(ref.dataset_id, INDEPENDENT_SESSION), /dataset_session_mismatch/)
})


test('Dataset Phase 3：拒绝其他 session 和绝对路径', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput())
  await assert.rejects(() => store.inspectDataset(ref.dataset_id, OTHER_SESSION), (error) => {
    assert.ok(error instanceof DatasetStoreError)
    assert.equal(error.code, 'dataset_session_mismatch')
    return true
  })
  await assert.rejects(() => store.inspectDataset('../../etc/passwd', SESSION), /dataset_id_invalid/)
})

test('Phase 1 profile 持久化：拒绝不一致的列计数和 validation 状态', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput())
  await assert.rejects(() => store.writeProfile({
    session: SESSION,
    dataset_id: ref.dataset_id,
    profile: {
      row_count: 3,
      columns: ['close_price'],
      quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true },
      schema: {
        close_price: {
          contract_type: 'number',
          inferred_type: 'number',
          observed_types: { number: 3 },
          missing_count: 0,
          null_count: 0,
          non_null_count: 2,
          invalid_count: 0,
          nullable: false,
        },
      },
      validation: { status: 'pass', violations: [{ column: 'close_price', rule: 'type', expected: 'number', observed: 'mixed', invalid_count: 1, severity: 'error' }] },
      warnings: [],
    },
  }), /profile_invalid/)
})

test('Dataset Phase 2：profile 不可包含 raw rows，且只读 workspace 不能写入', async () => {
  const { store } = makeStore({ mode: 'read-only' })
  await assert.rejects(() => store.writeProfile({
    session: SESSION,
    dataset_id: 'ds_001',
    profile: { row_count: 0, columns: [], quality: { missing_values: 0, duplicate_rows: 0, time_ordered: null }, warnings: [], rows: [] },
  }), /dataset_not_found|workspace_not_writable/)

  const writable = makeStore().store
  const ref = await writable.save(saveInput())
  await assert.rejects(() => writable.writeProfile({
    session: SESSION,
    dataset_id: ref.dataset_id,
    profile: { row_count: 3, columns: [], quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true }, warnings: [], rows: [{ secret: true }] },
  }), /profile contains unsupported fields/)
})

test('Dataset Phase 3：inspect、profile 与 query 工具真实注册，schema 不接受路径', () => {
  const definitions = []
  const ctx = {
    get: (name) => name === 'tools' ? { register: (definition) => { definitions.push(definition); return () => {} } } : undefined,
    effect: (fn) => fn(),
  }
  registerDatasetTools(ctx, makeStore().store)
  assert.deepEqual(definitions.map((definition) => definition.name), ['inspect_dataset', 'profile_dataset', 'query_dataset', 'write_profile'])
  const inspect = definitions[0]
  assert.equal(inspect.parameters.additionalProperties, false)
  assert.ok(!('path' in inspect.parameters.properties))
  const profile = definitions[1]
  assert.equal('expected_schema' in profile.parameters.properties, false)
  assert.ok(profile.output.schema.properties.schema)
  assert.ok(profile.output.schema.properties.validation)
  assert.equal(profile.output.schema.required.includes('schema'), false)
  assert.equal(profile.output.schema.required.includes('validation'), false)
  const query = definitions[2]
  // 根必须是单一 object：根级 oneOf（无 type）会被模型 API 以 400 拒绝，见 dataset-tools.ts 注释。
  assert.equal(query.parameters.type, 'object')
  assert.equal(query.parameters.additionalProperties, false)
  assert.deepEqual(query.parameters.required, ['dataset_id'])
  // flat 形态：QuerySpec 字段平铺在根上
  assert.equal(query.parameters.properties.limit.type, 'integer')
  assert.equal('minimum' in query.parameters.properties.limit, false)
  assert.equal('maximum' in query.parameters.properties.limit, false)
  assert.ok(query.parameters.properties.select)
  assert.ok(!query.parameters.required.includes('select'), 'select 可以省略，由执行器默认生成结果列')
  assert.equal('maxItems' in query.parameters.properties.filters, false)
  // envelope 形态：query 是可选嵌套对象，且自身就是完整 QuerySpec
  assert.ok(query.parameters.properties.query)
  assert.ok(query.parameters.properties.query.properties.group_by)
  assert.equal(query.parameters.properties.type.enum[0], 'query_request')
})

test('Phase 2 query：filter、group_by、聚合、排序和 limit 返回有限派生结果', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: {
      type: 'object',
      properties: {
        item: { type: 'array', items: { type: 'object', properties: {
          symbol: { type: 'string' },
          close_price: { type: 'number' },
          volume: { type: 'integer' },
        } } },
      },
    },
    data: { item: [
      { symbol: 'A', close_price: 100, volume: 10 },
      { symbol: 'A', close_price: 110, volume: 20 },
      { symbol: 'B', close_price: 90, volume: 5 },
      { symbol: 'B', close_price: null, volume: 7 },
    ] },
  }))
  const result = await store.queryDataset({
    session: JUNIOR_CHILD,
    dataset_id: ref.dataset_id,
    query: {
      dataset_id: ref.dataset_id,
      select: ['symbol', 'rows', 'avg_close'],
      filters: [{ column: 'close_price', operator: '>', value: 95 }],
      group_by: ['symbol'],
      aggregates: [
        { function: 'count', as: 'rows' },
        { function: 'avg', column: 'close_price', as: 'avg_close' },
      ],
      order_by: [{ column: 'avg_close', direction: 'desc' }],
      limit: 1,
    },
  })
  assert.deepEqual(result.rows, [{ symbol: 'A', rows: 2, avg_close: 105 }])
  assert.equal(result.matched_row_count, 2)
  assert.equal(result.group_count, 1)
  assert.equal(result.returned_count, 1)
  assert.ok(!('close_price' in result.rows[0]))
})

test('Phase 2 query 兼容：省略 select、默认跳过脏值并接受 query_request envelope', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: { type: 'object', properties: { item: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, price: { type: 'number' } } } } } },
    data: { item: [{ symbol: 'A', price: 100 }, { symbol: 'A', price: 'bad' }, { symbol: 'B', price: 120 }] },
  }))

  const envelope = definitionsFor(store).find((definition) => definition.name === 'query_dataset')
  const result = await envelope.execute({
    type: 'query_request',
    task_id: 'task-query',
    dataset_id: ref.dataset_id,
    query: {
      dataset_id: ref.dataset_id,
      group_by: ['symbol'],
      aggregates: [{ function: 'avg', column: 'price', as: 'avg_price' }],
    },
  }, { agent: { session: JUNIOR_CHILD }, signal: new AbortController().signal })
  assert.deepEqual(result.rows, [{ symbol: 'A', avg_price: 100 }, { symbol: 'B', avg_price: 120 }])
  assert.deepEqual(result.columns, ['symbol', 'avg_price'])
  assert.deepEqual(result.warnings, ['avg on price skipped incompatible values'])
})


test('Phase 2 query：null filter、全局聚合和 numeric string 契约行为明确', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: { type: 'object', properties: { item: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' } } } } } },
    data: { item: [{ price: '100' }, { price: 101 }, { price: null }, {}] },
  }))
  const result = await store.queryDataset({
    session: JUNIOR_CHILD,
    dataset_id: ref.dataset_id,
    query: {
      dataset_id: ref.dataset_id,
      select: ['rows', 'total'],
      filters: [{ column: 'price', operator: 'not_null' }],
      aggregates: [
        { function: 'count', as: 'rows' },
        { function: 'sum', column: 'price', as: 'total' },
      ],
    },
  })
  assert.deepEqual(result.rows, [{ rows: 2, total: 201 }])
  assert.deepEqual(result.warnings, ['column price uses numeric-compatible string values'])

  const nulls = await store.queryDataset({
    session: JUNIOR_CHILD,
    dataset_id: ref.dataset_id,
    query: {
      dataset_id: ref.dataset_id,
      select: ['rows'],
      filters: [{ column: 'price', operator: 'is_null' }],
      aggregates: [{ function: 'count', as: 'rows' }],
    },
  })
  assert.deepEqual(nulls.rows, [{ rows: 2 }], 'is_null 同时覆盖显式 null 和缺失字段')
})

test('Phase 2 query：禁止 raw select、类型冲突、未知字段和超限结果', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [{ symbol: 'A', close_price: 'not-a-number' }] },
  }))
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: {
    dataset_id: ref.dataset_id, select: ['symbol'],
  } }), /query_spec_invalid/)
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: {
    dataset_id: ref.dataset_id, select: ['avg'], error_policy: 'strict', aggregates: [{ function: 'avg', column: 'close_price', as: 'avg' }],
  } }), /query_type_conflict/)
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: {
    dataset_id: ref.dataset_id, select: ['rows'], aggregates: [{ function: 'count', as: 'rows' }], filters: [{ column: 'missing', operator: 'not_null' }],
  } }), /query_column_not_found/)
  await assert.rejects(() => store.queryDataset({ session: OTHER_SESSION, dataset_id: ref.dataset_id, query: {
    dataset_id: ref.dataset_id, select: ['rows'], aggregates: [{ function: 'count', as: 'rows' }],
  } }), /dataset_session_mismatch/)
})

test('Phase 2 query 工具：只注册受控 QuerySpec，data_junior 执行仍需 delegated session', async () => {
  const definitions = []
  const ctx = {
    get: (name) => name === 'tools' ? { register: (definition) => { definitions.push(definition); return () => {} } } : undefined,
    effect: (fn) => fn(),
  }
  registerDatasetTools(ctx, makeStore().store)
  assert.deepEqual(definitions.map((definition) => definition.name), ['inspect_dataset', 'profile_dataset', 'query_dataset', 'write_profile'])
  const query = definitions.find((definition) => definition.name === 'query_dataset')
  assert.ok(query)
  assert.equal(query.parameters.type, 'object')
  assert.ok(query.parameters.properties.aggregates)
  assert.equal(query.parameters.properties.limit.type, 'integer')
  assert.equal('maximum' in query.parameters.properties.limit, false)
  await assert.rejects(() => query.execute({ dataset_id: 'ds_001', select: ['rows'], aggregates: [{ function: 'count', as: 'rows' }] }, { agent: { session: SESSION }, signal: new AbortController().signal }), /dataset_session_mismatch/)
})

test('Phase 2 query：严格执行 QuerySpec 参数、分组数和输出字节上限', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const manyGroups = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    row_count: 1001,
    data: { item: Array.from({ length: 1001 }, (_, index) => ({ symbol: `S${index}`, close_price: index })) },
  }))
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: manyGroups.dataset_id, query: {
    dataset_id: manyGroups.dataset_id,
    select: ['symbol', 'rows'],
    group_by: ['symbol'],
    aggregates: [{ function: 'count', as: 'rows' }],
  } }), /query_group_limit_exceeded/)

  const hugeGroup = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    data: { item: [{ symbol: 'x'.repeat(300 * 1024) }] },
  }))
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: hugeGroup.dataset_id, query: {
    dataset_id: hugeGroup.dataset_id,
    select: ['symbol', 'rows'],
    group_by: ['symbol'],
    aggregates: [{ function: 'count', as: 'rows' }],
  } }), /query_result_too_large/)

  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD }))
  await assert.rejects(() => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: {
    dataset_id: ref.dataset_id,
    select: ['rows'],
    aggregates: [{ function: 'count', as: 'rows' }],
    limit: 201,
  } }), /query_spec_invalid/)
})

test('Phase 2 文档型 Dataset：可 inspect、可 profile 结构摘要，不再「不可读」', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  // 真实形状：财务指标 data = {thscode, report, abilities[].indicators[]}，没有行数组。
  // 实测教训：这类响应此前一律判 dataset_format_unsupported，data_junior 零路径。
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    format: 'json',
    row_count: null,
    capability: 'financial_indicators',
    data: {
      thscode: '300033.SZ',
      report: '2025-1',
      abilities: [
        { ability: 'growth', indicators: Array.from({ length: 8 }, (_, index) => ({ index_id: `growth_${index}`, value: `${index}.12` })) },
        { ability: 'profitability', indicators: [{ index_id: 'gross_margin', value: null }] },
      ],
    },
  }))

  const inspection = await store.inspectDataset(ref.dataset_id, JUNIOR_CHILD)
  assert.equal(inspection.query_access.readable, true)
  assert.equal(inspection.query_access.shape, 'document')

  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(result.row_count, 0)
  assert.equal(result.statistics, undefined, '文档没有行列统计')
  // 结构摘要：$ 是文档根，数组路径用 []，total_elements 即该路径下的条目总数
  assert.deepEqual(result.structure.$.fields, [
    { name: 'thscode', type: 'string' },
    { name: 'report', type: 'string' },
    { name: 'abilities', type: 'array' },
  ])
  assert.equal(result.structure['$.abilities'].total_elements, 2)
  assert.equal(result.structure['$.abilities[].indicators'].total_elements, 9)
  assert.deepEqual(result.structure['$.abilities[].indicators[]'].fields, [
    { name: 'index_id', type: 'string' },
    { name: 'value', type: 'string' },
  ])
  // 小文档整份交给 data_junior，不截断
  assert.equal(result.document.truncated, false)
  assert.deepEqual(result.document.omitted, [])
  assert.equal(result.document.content.abilities[0].indicators.length, 8)
  // 但 profile 产物里不能留原始内容：持久化的只有机器事实
  const stored = JSON.parse(fs.files.get(`/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`))
  assert.ok(!('document' in stored.profile), 'profile.json 不应包含文档内容')
  assert.ok(stored.profile.structure['$.abilities'])
})

test('Phase 2 文档型 Dataset：长数组按档位截断并逐条披露省略了什么', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    format: 'json',
    row_count: null,
    capability: 'fund_backtest',
    data: {
      start_date: '2025-01-01',
      end_date: '2025-06-30',
      metrics: { annual_return: 0.12, max_drawdown: -0.08 },
      trades: Array.from({ length: 300 }, (_, index) => ({ seq: index, action: 'buy', amount: 1000 + index })),
      curve_points: Array.from({ length: 400 }, (_, index) => [1700000000000 + index * 86400000, 1 + index * 0.001]),
    },
  }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id })
  assert.equal(result.document.truncated, true)
  assert.ok(result.document.omitted.length > 0, '截断了什么必须逐条披露，不能静默省略')
  const tradeOmission = result.document.omitted.find((item) => item.path === '$.trades')
  assert.ok(tradeOmission, `应披露 trades 的省略情况，实际：${JSON.stringify(result.document.omitted)}`)
  assert.ok(tradeOmission.kept < 300)
  assert.equal(tradeOmission.kept + tradeOmission.omitted, 300)
  // 小字段不能被截断误伤
  assert.deepEqual(result.document.content.metrics, { annual_return: 0.12, max_drawdown: -0.08 })
  // 交付给模型的内容必须留在剪枝阈值以内
  assert.ok(JSON.stringify(result).length < 8192, `文档型 profile 结果必须在剪枝阈值内，实际 ${JSON.stringify(result).length}`)
})

test('Phase 2 文档型 Dataset：query 明确拒绝，不假装有行', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    format: 'json',
    row_count: null,
    data: { thscode: 'x', abilities: [] },
  }))
  await assert.rejects(
    () => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: { dataset_id: ref.dataset_id, group_by: ['abilities'], aggregates: [{ function: 'count', as: 'n' }] } }),
    /dataset_format_unsupported/,
  )
  await assert.rejects(
    () => store.queryDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, query: { dataset_id: ref.dataset_id, group_by: ['abilities'], aggregates: [{ function: 'count', as: 'n' }] } }),
    /document Dataset has no rows to query/,
  )
})

test('Phase 2 query 兼容：数组/对象参数被序列化成 JSON 字符串时照样执行', async () => {
  let next = 0
  const { store } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({
    session: COLLECTOR_CHILD,
    schema: { type: 'object', properties: { item: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, price: { type: 'number' } } } } } },
    data: { item: [{ symbol: 'A', price: 100 }, { symbol: 'B', price: 120 }] },
  }))
  const query = definitionsFor(store).find((definition) => definition.name === 'query_dataset')
  const exec = { agent: { session: JUNIOR_CHILD }, signal: new AbortController().signal }

  // 实测事故：模型把 select / group_by / aggregates / order_by / limit 全部序列化成字符串，
  // 参数其实是对的，却报 "select must contain 1-32 column names"，模型于是反复试错。
  const stringified = await query.execute({
    dataset_id: ref.dataset_id,
    select: '["symbol", "rows"]',
    group_by: '["symbol"]',
    aggregates: '[{"function": "count", "as": "rows"}]',
    order_by: '[{"column": "symbol", "direction": "asc"}]',
    limit: '1',
  }, exec)
  assert.deepEqual(stringified.rows, [{ symbol: 'A', rows: 1 }])
  assert.equal(stringified.limit, 1)

  // 单个列名/单个对象用字符串传也要能用
  const singles = await query.execute({
    dataset_id: ref.dataset_id,
    select: ['symbol', 'rows'],
    group_by: 'symbol',
    aggregates: '{"function": "count", "as": "rows"}',
  }, exec)
  assert.deepEqual(singles.rows, [{ symbol: 'A', rows: 1 }, { symbol: 'B', rows: 1 }])

  // 整个 envelope 被序列化成字符串：解析后按 envelope 处理
  const envelope = await query.execute({
    dataset_id: ref.dataset_id,
    query: JSON.stringify({ dataset_id: ref.dataset_id, group_by: ['symbol'], aggregates: [{ function: 'count', as: 'rows' }] }),
  }, exec)
  assert.deepEqual(envelope.rows, [{ symbol: 'A', rows: 1 }, { symbol: 'B', rows: 1 }])

  // flat 形式带上 envelope 元数据（type/task_id）：按协议原样传时应被忽略，而不是报 unsupported fields
  const flatWithEnvelopeMeta = await query.execute({
    type: 'query_request',
    task_id: 'task-query',
    dataset_id: ref.dataset_id,
    group_by: ['symbol'],
    aggregates: [{ function: 'count', as: 'rows' }],
  }, exec)
  assert.equal(flatWithEnvelopeMeta.returned_count, 2)

  // 解析不了的 query 字符串要给出可行动的报错，而不是 "unsupported fields"
  await assert.rejects(
    () => query.execute({ dataset_id: ref.dataset_id, query: 'not-json' }, exec),
    /query must be an object/,
  )

  // 宽容解析不能放过真正违规的查询：无 group_by / 聚合就是原始行投影，必须仍然被拒
  await assert.rejects(
    () => query.execute({
      dataset_id: ref.dataset_id,
      select: '["symbol", "price"]',
      order_by: '[{"column": "price", "direction": "asc"}]',
      limit: '1',
    }, exec),
    /raw row selection is not allowed/,
    '解析成功后仍必须由引擎拒绝取原始行',
  )
})
