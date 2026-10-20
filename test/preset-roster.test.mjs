import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterPresetRoster, installPresetRosterFilter, registerPresetRosterFilter } from '../lib/agents/preset-roster.js'
import { INTERNAL_ROLE_PRESET_IDS, ROLE_PRESET_IDS, ROOT_PRESET_ID } from '../lib/preset-ids.js'

const visibleRow = (id) => ({ id, name: id, isDefault: false })
const roster = () => ({
  presets: [
    visibleRow(ROOT_PRESET_ID),
    visibleRow('standard'),
    visibleRow(ROLE_PRESET_IDS.collector),
    visibleRow(ROLE_PRESET_IDS.junior),
    visibleRow(ROLE_PRESET_IDS.retriever),
    visibleRow(ROLE_PRESET_IDS.specialist),
  ],
})

test('内部角色名单只含分析师与绘图专员：其余预设仍可独立打开', () => {
  assert.deepEqual([...INTERNAL_ROLE_PRESET_IDS], [ROLE_PRESET_IDS.junior, ROLE_PRESET_IDS.specialist])
})

test('roster 过滤只摘内部角色：保留顺序、isDefault 与调用方数组', () => {
  const value = roster()
  const originalPresets = value.presets
  const filtered = filterPresetRoster(value)
  assert.notEqual(filtered, value, '过滤必须返回新对象，不能改写宿主已返回的 roster')
  assert.deepEqual(filtered.presets.map((row) => row.id), [
    ROOT_PRESET_ID,
    'standard',
    ROLE_PRESET_IDS.collector,
    ROLE_PRESET_IDS.retriever,
  ])
  assert.deepEqual(value.presets, originalPresets, '原数组不得被修改')
  assert.equal(filtered.presets[0], originalPresets[0], '非内部行原样保留（不重建行对象）')
})

test('数组形态同样过滤：兼容宿主直接返回列表', () => {
  const filtered = filterPresetRoster(roster().presets)
  assert.deepEqual(filtered.map((row) => row.id), [
    ROOT_PRESET_ID,
    'standard',
    ROLE_PRESET_IDS.collector,
    ROLE_PRESET_IDS.retriever,
  ])
})

test('未知形状原样放行：过滤器失效时不能拦掉整份 roster', () => {
  for (const shape of [undefined, null, 'roster', {}, { presets: 'not-an-array' }]) {
    assert.equal(filterPresetRoster(shape), shape)
  }
  const unknownRows = { presets: [null, 'x', { id: 42 }, { id: ROLE_PRESET_IDS.specialist }] }
  assert.deepEqual(filterPresetRoster(unknownRows).presets, [null, 'x', { id: 42 }], '无法识别的行必须保留')
})

test('包装 remoteExportList：list / resolve / 委派面保持全量，清理后复原', async () => {
  const calls = []
  const proto = {
    async remoteExportList() {
      calls.push('remoteExportList')
      return roster()
    },
    async list() {
      return roster().presets
    },
    resolve(id) {
      return { id }
    },
  }
  const service = Object.create(proto)
  const cleanups = []
  const installed = installPresetRosterFilter(service, {
    effect(execute, label) {
      assert.equal(label, 'capital-preset-roster')
      cleanups.push(execute())
    },
  })
  assert.equal(installed, true)
  assert.equal(Object.hasOwn(service, 'remoteExportList'), true, '包装必须是 own property 才能盖住原型方法')
  assert.equal(service.list, proto.list, 'list 必须保持全量：smoke 与诊断靠它认角色')
  assert.equal(service.resolve, proto.resolve, 'resolve 是历史会话与委派的身份入口，不能过滤')

  const filtered = await service.remoteExportList()
  assert.deepEqual(filtered.presets.map((row) => row.id), [
    ROOT_PRESET_ID,
    'standard',
    ROLE_PRESET_IDS.collector,
    ROLE_PRESET_IDS.retriever,
  ])
  assert.equal((await service.list()).length, 6, '全量 list 仍含两颗内部角色')
  assert.deepEqual(service.resolve(ROLE_PRESET_IDS.junior), { id: ROLE_PRESET_IDS.junior })
  assert.deepEqual(calls, ['remoteExportList'])

  cleanups[0]()
  assert.equal(Object.hasOwn(service, 'remoteExportList'), false, '清理后撤掉 own property')
  assert.equal(service.remoteExportList, proto.remoteExportList)
  assert.equal((await service.remoteExportList()).presets.length, 6)
})

test('没有 remoteExportList 时退回 list；拒绝与同步抛错保持原方向', async () => {
  const service = {
    async list() {
      return roster().presets
    },
  }
  const originalList = service.list
  assert.equal(installPresetRosterFilter(service, { effect: () => undefined }), true)
  assert.notEqual(service.list, originalList)
  assert.deepEqual((await service.list()).map((row) => row.id), [
    ROOT_PRESET_ID,
    'standard',
    ROLE_PRESET_IDS.collector,
    ROLE_PRESET_IDS.retriever,
  ])

  const failure = new Error('roster unavailable')
  const rejecting = { remoteExportList: async () => { throw failure } }
  installPresetRosterFilter(rejecting, {})
  await assert.rejects(rejecting.remoteExportList(), failure)

  const throwing = { remoteExportList() { throw failure } }
  installPresetRosterFilter(throwing, {})
  assert.throws(() => throwing.remoteExportList(), failure)
})

test('没有可用方法或属性不可改写时不安装、不抛错', () => {
  let effects = 0
  const effect = () => { effects += 1 }
  assert.equal(installPresetRosterFilter({}, { effect }), false)
  assert.equal(installPresetRosterFilter(null, { effect }), false)
  assert.equal(effects, 0, '没装上就不该注册清理')

  const frozen = {}
  Object.defineProperty(frozen, 'remoteExportList', { value: async () => roster(), configurable: false, writable: false })
  assert.equal(installPresetRosterFilter(frozen, { effect }), false)
  assert.equal(effects, 0)
})

test('registerPresetRosterFilter 只在 agentPresets 到位后安装，并随 fiber 清理', async () => {
  const service = { remoteExportList: async () => roster() }
  const cleanups = []
  const injected = []
  const ctx = {
    inject(deps, callback) {
      injected.push(deps)
      callback({
        agentPresets: service,
        effect(execute) {
          cleanups.push(execute())
        },
      })
    },
  }
  registerPresetRosterFilter(ctx)
  assert.deepEqual(injected, [['agentPresets']])
  assert.equal((await service.remoteExportList()).presets.length, 4)
  cleanups[0]()
  assert.equal((await service.remoteExportList()).presets.length, 6)

  const blind = { inject() {} }
  assert.doesNotThrow(() => registerPresetRosterFilter(blind))
})
