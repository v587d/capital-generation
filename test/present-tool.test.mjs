import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartArtifactRegistry } from '../lib/chart/artifact-ref.js'
import { registerPresentChartsTool } from '../lib/chart/present-tool.js'
import { createChartEventPublisher, resetChartEventPending, resetChartEventPublisher } from '../lib/chart/events.js'
import { chartDeliveryBlocker } from '../lib/present-entry.js'
import { outputSchemaViolations } from './output-contract.mjs'

// Root-only final-turn delivery: the auto-mode specialist row no longer auto-publishes, so
// present_charts is the only path that can put the chart card into the closing turn.

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const JUNIOR = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }

function fakeToolCtx() {
  const tools = []
  const ctx = {
    get(name) {
      if (name !== 'tools') return undefined
      return { register(definition) { tools.push(definition); return () => {} } }
    },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }
  return { ctx, tools }
}

function fakePublisher(accepted = true, { batch = false } = {}) {
  const published = []
  const batches = []
  const publisher = {
    published,
    batches,
    publish(input) {
      published.push(input)
      return accepted
    },
  }
  if (batch) {
    publisher.publishMany = (ownerSessionId, inputs) => {
      batches.push({ ownerSessionId, inputs })
      return accepted
    }
  }
  return publisher
}

let refSeq = 0
function seed(registry, { task_id = 'task-1', title = '日线', html = 'capital-analysis/charts/ch_a/chart.html', session = JUNIOR } = {}) {
  refSeq += 1
  const chartId = `ch_present_${refSeq}`
  const ref = registry.issue({
    session,
    chart_id: chartId,
    task_id,
    dataset_id: 'ds_01',
    source_label: '同花顺日线',
    captured_at: 1_700_000_000_000,
    kind: 'line',
    axis: 'time',
    title,
    chart_url: null,
    spec_path: `capital-analysis/charts/${chartId}/spec.json`,
    series_path: `capital-analysis/charts/${chartId}/series.json`,
    html_path: html,
  })
  return ref
}

function setup({ accepted = true, batch = false, readiness, delivery } = {}) {
  const registry = new ChartArtifactRegistry({
    now: () => 1_700_000_000_000,
    newRef: () => `chart_auto_${refSeq + 1}`,
  })
  const publisher = fakePublisher(accepted, { batch })
  const { ctx, tools } = fakeToolCtx()
  registerPresentChartsTool(ctx, { artifacts: registry, chartEvents: () => publisher, readiness, delivery })
  return { registry, publisher, tools }
}

const exec = (session) => ({ agent: { session }, signal: new AbortController().signal })

test('present_charts：主 Agent 按 chart_refs 逐个登记为 first-party 交付事件', async () => {
  const { registry, publisher, tools } = setup()
  const first = seed(registry, { html: 'capital-analysis/charts/ch_a/chart.html' })
  const second = seed(registry, { title: '营收', html: 'capital-analysis/charts/ch_b/chart.html' })

  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'present_charts')
  const receipt = await tools[0].execute({ chart_refs: [first.chart_ref, second.chart_ref] }, exec(MAIN))

  assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [first.chart_ref, second.chart_ref])
  assert.deepEqual(receipt.failed, [])
  assert.deepEqual(publisher.published.map((item) => item.html_path), [
    'capital-analysis/charts/ch_a/chart.html',
    'capital-analysis/charts/ch_b/chart.html',
  ])
  // Owner is the root conversation, titles ride along as the card description.
  assert.ok(publisher.published.every((item) => item.ownerSessionId === MAIN.id))
  assert.deepEqual(publisher.published.map((item) => item.title), ['日线', '营收'])
})

test('present_charts：refs 丢失时按 task_id 登记该任务全部图表，别的任务不混入', async () => {
  const { registry, publisher, tools } = setup()
  seed(registry, { task_id: 'task-1', html: 'capital-analysis/charts/ch_1/chart.html' })
  seed(registry, { task_id: 'task-1', html: 'capital-analysis/charts/ch_2/chart.html' })
  seed(registry, { task_id: 'task-2', html: 'capital-analysis/charts/ch_3/chart.html' })

  const receipt = await tools[0].execute({ task_id: 'task-1' }, exec(MAIN))

  assert.equal(receipt.presented.length, 2)
  assert.deepEqual(publisher.published.map((item) => item.html_path), [
    'capital-analysis/charts/ch_1/chart.html',
    'capital-analysis/charts/ch_2/chart.html',
  ])
})

test('present_charts：单个失效 ref 不拖垮整批，原因回给模型；无图任务如实空回执', async () => {
  const { registry, publisher, tools } = setup()
  const good = seed(registry, { html: 'capital-analysis/charts/ch_ok/chart.html' })

  const mixed = await tools[0].execute({ chart_refs: [good.chart_ref, 'chart_missing'] }, exec(MAIN))
  assert.deepEqual(mixed.presented.map((item) => item.chart_ref), [good.chart_ref])
  assert.equal(mixed.failed.length, 1)
  assert.equal(mixed.failed[0].chart_ref, 'chart_missing')
  assert.match(mixed.failed[0].reason, /chart_ref_invalid/)
  assert.equal(publisher.published.length, 1)

  const empty = await tools[0].execute({ task_id: 'task-none' }, exec(MAIN))
  assert.deepEqual(empty.presented, [])
  assert.equal(empty.failed.length, 1)
})

test('present_charts：入参校验（refs 与 task_id 至少一个、上限、空值）', async () => {
  const { registry, tools } = setup()
  const ref = seed(registry)

  await assert.rejects(tools[0].execute({}, exec(MAIN)), /chart_refs 或 task_id/)
  await assert.rejects(tools[0].execute({ chart_refs: [] }, exec(MAIN)), /chart_refs 或 task_id/)
  await assert.rejects(tools[0].execute({ chart_refs: [ref.chart_ref, ' '] }, exec(MAIN)), /不能有空值/)
  await assert.rejects(
    tools[0].execute({ chart_refs: Array.from({ length: 33 }, (_value, index) => `chart_x_${index}`) }, exec(MAIN)),
    /最多登记 32 张图/,
  )
  await assert.rejects(tools[0].execute({ task_id: '  ' }, exec(MAIN)), /task_id 必须是非空字符串/)
})

test('present_charts：发布器不可用时响亮失败，不假装登记成功', async () => {
  const registry = new ChartArtifactRegistry({ now: () => 1_700_000_000_000 })
  const { ctx, tools } = fakeToolCtx()
  registerPresentChartsTool(ctx, { artifacts: registry, chartEvents: () => undefined })
  const ref = seed(registry)
  await assert.rejects(tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN)), /交付通道不可用/)
})

test('present_charts：登记被拒（回合已关闭/超限）回执里记 failed，不谎报 presented', async () => {
  const { registry, tools } = setup({ accepted: false })
  const ref = seed(registry)
  const receipt = await tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN))
  assert.deepEqual(receipt.presented, [])
  assert.equal(receipt.failed.length, 1)
  assert.match(receipt.failed[0].reason, /8 次上限|回合已关闭/)
})

test('present_charts：schema 合规——参数根是 jsonObject，回执满足自己声明的 output.schema', async () => {
  const { registry, tools } = setup()
  const definition = tools[0]
  assert.equal(definition.parameters.type, 'object', 'parameters 根必须是 type:object（§9.1）')
  assert.deepEqual(definition.parameters.required, [], '两个参数都可选，必填列表为空')
  assert.equal(definition.parameters.additionalProperties, false)
  assert.ok(definition.parameters.properties.chart_refs)
  assert.ok(definition.parameters.properties.task_id)

  const ref = seed(registry)
  const receipt = await definition.execute({ chart_refs: [ref.chart_ref, 'chart_bad'] }, exec(MAIN))
  assert.deepEqual(outputSchemaViolations(definition.output.schema, receipt), [],
    '回执必须满足声明的 output.schema（宿主在模型看到之前会拒绝不一致的返回）')
})

test('present_charts：fork/branch 顶层会话仍能登记自己子 Agent 出的图', async () => {
  const { registry, publisher, tools } = setup()
  const forkRoot = { id: 'main-fork', header: { cwd: '/workspace/proj', parentSession: 'main-old', isSeeded: true } }
  const forkJunior = { id: 'junior-fork', header: { cwd: '/workspace/proj', parentSession: forkRoot.id, origin: 'subagent' } }
  const ref = seed(registry, { session: forkJunior })

  const receipt = await tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(forkRoot))

  assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [ref.chart_ref])
  assert.equal(publisher.published[0].ownerSessionId, forkRoot.id, '卡片必须落在 branch，而不是被 fork 的旧会话')
})

test('present_charts：refs 全部失效但给了 task_id 时回落到任务清单，不空手而归', async () => {
  const { registry, publisher, tools } = setup()
  const ref = seed(registry, { task_id: 'task-1', html: 'capital-analysis/charts/ch_ok/chart.html' })

  const receipt = await tools[0].execute({ chart_refs: ['chart_stale'], task_id: 'task-1' }, exec(MAIN))

  assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [ref.chart_ref])
  assert.equal(receipt.failed.length, 1, '失效 ref 的原因仍要如实回给模型')
  assert.equal(publisher.published.length, 1)
})

test('present_charts + 真实发布器：事件写进打开的回合，类型是 first-party deliverables/presented', async () => {
  resetChartEventPublisher()
  resetChartEventPending()
  try {
    const main = {
      id: 'main-1',
      header: { cwd: '/workspace/proj' },
      appended: [],
      append(type, data) { this.appended.push({ type, data }); return { type, seq: this.appended.length, data } },
    }
    const sessions = { get: (id) => (id === main.id ? main : undefined) }
    const projections = { stateOf: () => ({ openTurnStartSeq: 1, lastTurn: 7 }) }
    const tools = []
    const ctx = {
      get(name) {
        if (name === 'tools') return { register(definition) { tools.push(definition); return () => {} } }
        if (name === 'sessions') return sessions
        if (name === 'sessionProjections') return projections
        return undefined
      },
      effect(callback) { const dispose = callback(); return () => { if (typeof dispose === 'function') dispose() } },
    }
    const registry = new ChartArtifactRegistry({ now: () => 1_700_000_000_000, newRef: () => 'chart_live_1' })
    const ref = seed(registry, { task_id: 'task-1' })
    registerPresentChartsTool(ctx, { artifacts: registry, chartEvents: () => createChartEventPublisher(ctx) })

    await tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(main))

    assert.equal(main.appended.length, 1)
    assert.equal(main.appended[0].type, 'deliverables/presented')
    assert.equal(main.appended[0].data.turn, 7)
    assert.equal(main.appended[0].data.files[0].path, 'capital-analysis/charts/ch_a/chart.html')
    assert.equal(main.appended[0].data.files[0].description, '日线')
  } finally {
    resetChartEventPublisher()
    resetChartEventPending()
  }
})

test('present_charts：还有运行中的子 Agent / 待处理消息时拒绝登记，避免落进中间轮', async () => {
  let reason
  const readiness = async () => reason
  const blocked = setup({ readiness })
  const ref = seed(blocked.registry)
  reason = '还有 1 个子 Agent 在运行：等结算后再调用'
  await assert.rejects(blocked.tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN)), /子 Agent 在运行/)
  assert.equal(blocked.publisher.published.length, 0, '被闸门拦下时一次都不能写')

  reason = '还有 2 条待处理消息：等处理完再调用'
  await assert.rejects(blocked.tools[0].execute({ task_id: 'task-1' }, exec(MAIN)), /待处理消息/)

  reason = undefined
  const receipt = await blocked.tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN))
  assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [ref.chart_ref], '空闲后必须能正常登记')
})

test('present_charts：一次登记全部图表（单个交付事件，20 张不再被 8 张/轮上限切掉）', async () => {
  const { registry, publisher, tools } = setup({ batch: true })
  const refs = []
  for (let index = 0; index < 20; index += 1) {
    refs.push(seed(registry, { task_id: 'task-1', html: `capital-analysis/charts/ch_${index}/chart.html` }))
  }

  const receipt = await tools[0].execute({ chart_refs: refs.map((item) => item.chart_ref) }, exec(MAIN))

  assert.equal(receipt.presented.length, 20)
  assert.deepEqual(receipt.failed, [])
  assert.equal(publisher.batches.length, 1, '20 张图必须合成一次交付事件（卡片在收尾轮，不按轮次切段）')
  assert.equal(publisher.batches[0].inputs.length, 20)
  assert.equal(publisher.published.length, 0)
})

test('chartDeliveryBlocker：inbox 有待处理消息 / 子 Agent 在运行 → 拒绝；都空闲 → 放行', async () => {
  const serviceCtx = ({ inbox, descendants, failInbox = false, failChildren = false } = {}) => ({
    get(name) {
      if (name === 'sessionProjections') {
        return { stateOf: () => { if (failInbox) throw new Error('no projection'); return inbox ?? { 'next-turn': [], 'next-step': [] } } }
      }
      if (name === 'subagents') {
        return {
          async listDescendants() {
            if (failChildren) throw new Error('no service')
            return descendants ?? []
          },
        }
      }
      return undefined
    },
  })

  assert.match(
    await chartDeliveryBlocker(serviceCtx({ inbox: { 'next-turn': [], 'next-step': [{}] } }), MAIN),
    /待处理消息/,
  )
  assert.equal(
    await chartDeliveryBlocker(serviceCtx({
      inbox: { 'next-turn': [], 'next-step': [{ source: { kind: 'subagent-settled', senderSessionId: 'junior-1' } }] },
    }), MAIN),
    undefined,
    '结算通知可能在收尾答复后才到，不能挡住回退登记',
  )
  assert.match(
    await chartDeliveryBlocker(serviceCtx({ descendants: [{ kind: 'child', activity: 'running' }] }), MAIN),
    /子 Agent 在运行/,
  )
  assert.equal(
    await chartDeliveryBlocker(serviceCtx({ descendants: [{ kind: 'child', activity: 'inactive' }, { kind: 'diagnostic' }] }), MAIN),
    undefined,
    'inactive 子 Agent 与 diagnostics 不算待处理',
  )
  // Optional services: their failure must not block delivery (charts would silently disappear).
  assert.equal(await chartDeliveryBlocker(serviceCtx({ inbox: { 'next-step': [{}] }, failInbox: true }), MAIN), undefined)
  assert.equal(await chartDeliveryBlocker(serviceCtx({ descendants: [{ kind: 'child', activity: 'running' }], failChildren: true }), MAIN), undefined)
})

test('present_charts：流式收尾可用时只记录清单，不在调用时写事件（提前调用也安全）', async () => {
  const requested = []
  const delivery = {
    streaming: () => true,
    request: (session, inputs) => { requested.push({ session, inputs }) },
  }
  const { registry, publisher, tools } = setup({ delivery, readiness: async () => '不该被调用' })
  const ref = seed(registry)
  const receipt = await tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN))

  assert.deepEqual(receipt.presented.map((item) => item.chart_ref), [ref.chart_ref])
  assert.equal(publisher.published.length, 0, '交付必须等收尾流结束再写')
  assert.equal(requested.length, 1)
  assert.equal(requested[0].inputs[0].html_path, ref.html_path)
})

test('present_charts：流式通道未知（未观察到帧）时回退到立即可写 + 就绪闸门', async () => {
  let blocked = '还有子 Agent 在运行'
  const delivery = { streaming: () => false, request: () => { throw new Error('不应走延迟路径') } }
  const { registry, publisher, tools } = setup({ delivery, readiness: async () => blocked })
  const ref = seed(registry)
  await assert.rejects(tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN)), /子 Agent 在运行/)
  assert.equal(publisher.published.length, 0)

  blocked = undefined
  const receipt = await tools[0].execute({ chart_refs: [ref.chart_ref] }, exec(MAIN))
  assert.equal(receipt.presented.length, 1)
  assert.equal(publisher.published.length, 1, '回退路径必须真的写')
})
