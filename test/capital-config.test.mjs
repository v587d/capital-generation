import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { load as yamlLoad } from 'js-yaml'
import { apply as hostApply, Config as CapitalConfig, SETTINGS_ENTRY_ID } from '../capital-config/index.js'
import { CAPITAL_CONFIG_ENTRY_ID, Config as MainConfig, LOCAL_FETCH_DEFAULTS, resolveLocalFetchConfig } from '../lib/index.js'
import { LOCAL_FETCH_CLIENT_VERSION } from '../lib/web-retriever/local-fetch.js'
import { SELECTED_SKILL_CATALOG } from '../selected-skills/catalog.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'capital-config', 'client.js')
const CLIENT_SRC = join(ROOT, 'capital-config', 'client.src.cjs')

/**
 * 0.1.7 的 settings 面里**条目 id 就是命名空间**：host 半边不再有 `settings.register`，
 * 可编辑面是条目 Config 的 `.volatile()` 投影；浏览器半边按 `configForms.get(条目 id)` 读写。
 * 卡片坐的是**组合包自己的页面**：槽 `plugins.bundle.config` 的 key 是组合包的**包名**
 * （页面 `renderSlot(..., { entryKey: pkg.name })`）。于是两条同字链各自钉住——条目 id 四处
 * （patch 行 id ≡ host ≡ 主插件 ≡ 浏览器半边）与包名一处（对根 `package.json`）。
 * 漂移的表现都是**卡片静默消失、零报错**（issue #3 那一族）。
 */
test('条目 id 四处一致 + 槽 key = 组合包包名：settings 命名空间与卡片座位各自同字', () => {
  const patch = yamlLoad(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, ''))
  const row = patch.flatMap((entry) => entry?.insert ?? []).find((item) => item?.name === './capital-config/index.js')
  assert.ok(row, 'cordis.patch.yml 必须有 capital-config 这颗 host 平面行')
  assert.equal(row.id, SETTINGS_ENTRY_ID, 'settings 命名空间就是 profile 条目 id：行 id 必须等于 SETTINGS_ENTRY_ID')
  assert.equal(SETTINGS_ENTRY_ID, CAPITAL_CONFIG_ENTRY_ID, '主插件读配置用的条目 id 必须与 host 半边一致')

  const source = readFileSync(CLIENT_SRC, 'utf8')
  const entryId = source.match(/^const ENTRY_ID = '([^']+)'/m)?.[1]
  const bundleName = source.match(/^const BUNDLE_NAME = '([^']+)'/m)?.[1]
  assert.equal(entryId, SETTINGS_ENTRY_ID, '浏览器半边读的条目 id 必须与 host 一致（漂移 = 卡片静默消失）')
  const bundle = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  assert.equal(bundleName, bundle, 'plugins.bundle.config 的 key 必须逐字等于组合包的包名')
  assert.ok(!/plugins\.row\.config/.test(codeOnly(source)),
    '配置坐组合包层，不留行级座位：行详情页要 3 跳，且同包其他行点进去是死路')
})

/**
 * 上游 `plainConfig`（`dsh-settings/lib/index.js:97`）的同一条解引用：`.volatile()` 字段在
 * 解析后是 cosmokit 的取值单元（`{ get, [cosmokit.volatile.write] }`），Host 把它投影成
 * 表单值之前先这样摊平。对照两处 schema 时必须走同一道摊平，否则比的是引用对象不是值。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function plainConfig(value) {
  if (value === null || typeof value !== 'object') return value
  if (VOLATILE_WRITE in value) return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]))
}

/** 注释里点名退休接口是文档说明，负向断言只查代码行。 */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 与上游 volatileForm 同一条遍历：`.dict` 逐层走，`meta.volatile` 是承重事实。 */
function volatilePaths(schema, path = []) {
  if (schema?.meta?.volatile) return [path.join('.')]
  if (schema?.type !== 'object') return []
  return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => volatilePaths(child, [...path, key]))
}

test('capital-config Host：可编辑面全靠 Config 的 .volatile() 字段，注册通道已退休', () => {
  // 0.1.7 的 volatileForm 在一个 volatile 字段都没有时返回 undefined ⇒ 条目**不进** describe
  // 镜像 ⇒ 卡片读不到命名空间；写非 volatile 路径被 `Config field "…" is not volatile` 拒绝。
  const flags = volatilePaths(CapitalConfig)
  for (const path of [
    'customPersona', 'fuyaoCredentialRef',
    'retriever.baseURL', 'retriever.credentialRef',
    'retriever.windDocs.credentialRef', 'retriever.localFetch.enabled', 'retriever.paddleOcr.credentialRef',
  ]) {
    assert.ok(flags.includes(path), `${path} 必须 .volatile()，否则卡片改不动它（条目甚至不进 describe 镜像）`)
  }

  const selectedSkillPaths = [
    'buffettFramework',
    'financialHealth',
    'riskWarningCatalysts',
    'valuationInvestmentStrategy',
    'strategyBusinessTransition',
    'industryCompetitionMoat',
    'businessDecompositionOrderQuality',
  ]
  for (const key of selectedSkillPaths) {
    assert.ok(flags.includes(`selectedSkills.${key}`), `selectedSkills.${key} 必须 .volatile()`)
  }

  const hostSource = codeOnly(readFileSync(join(ROOT, 'capital-config', 'index.js'), 'utf8'))
  assert.doesNotMatch(hostSource, /settings\.register|settingsScope|SETTINGS_NAMESPACE/,
    '0.1.7 已删除 settings.register / settingsScope；代码里再出现就是把卡片改回了退休的旧面')

  const logs = []
  hostApply({ logger: { info: (message) => logs.push(message) }, get: () => undefined })
  assert.ok(logs.some((message) => message.includes('settings entry active')), 'apply 留一行激活日志，证明这颗行起来了')
})

/** 假 SettingsFormModel：契约照 form-model.d.ts（bind/shell/field/actions/dispose），不实现暂存写。 */
function fakeModel(scope) {
  const drafts = new Map()
  let store
  const projection = () => store ? store.getSnapshot() : undefined
  return {
    drafts,
    bind(project) {
      let value = project()
      const listeners = new Set()
      store = {
        getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        set(next) { value = next; for (const listener of [...listeners]) listener() },
      }
      return store
    },
    shell() {
      const snapshot = scope.getSnapshot()
      return {
        available: snapshot.status === 'ready',
        writable: snapshot.writable,
        dirty: drafts.size > 0,
        invalid: false,
        saving: false,
        failed: false,
      }
    },
    field: (field) => ({ text: drafts.get(field) ?? '', overridden: false, invalid: false }),
    actions: () => ({
      edit: (field, text) => { drafts.set(field, text); store.set(projection()) },
      resetField: (field) => { drafts.delete(field); store.set(projection()) },
      save: () => {},
      discard: () => { drafts.clear(); store.set(projection()) },
    }),
    dispose() {},
  }
}

function loadClient({ scope, primitives = {} } = {}) {
  let entry
  const clipboardWrites = []
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { entry = value } } },
    navigator: { clipboard: { writeText: async (value) => { clipboardWrites.push(value) } } },
  }
  runInNewContext(readFileSync(CLIENT, 'utf8'), sandbox)
  assert.ok(entry)
  const model = fakeModel(scope)
  return {
    model,
    clipboardWrites,
    mod: entry.factory((name) => {
      if (name === 'react') return {
        // 测试里把函数组件就地展开成它自己返回的节点：渲染顺序与字段 id 要从**渲染树**上读，
        // 而不是从源码字符串量（ ids 现在是模板字面量，源码匹配不到）。
        createElement(type, props, ...children) {
          const kids = children.flat(Infinity).filter(Boolean)
          if (typeof type === 'function') return type({ ...props, children: kids })
          return { type, props: { ...props, children: kids }, children: kids }
        },
        // 假渲染树没有 DOM，portal 目标（官方 head 行）永远找不到 ⇒ useState 恒为 null，
        // 文档链接走"退回本行末尾"那条降级路，仍然出现在渲染树上。
        useRef: () => ({ current: null }),
        useState: (initial) => [initial, () => {}],
        useEffect: () => {},
      }
      if (name === 'react-dom') return { createPortal: (node) => node }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        SettingsForm(props) {
          const footer = { type: 'SettingsFormFooter', props: {}, children: [{ type: 'SaveButton', props: {}, children: [] }] }
          return { type: 'SettingsForm', props, children: [...(props.children ?? []), footer] }
        },
        SettingsSecretField(props) { return { type: 'SettingsSecretField', props, children: props.children ?? [] } },
        Switch(props) { return { type: 'Switch', props, children: props.children ?? [] } },
        IconRightUpOutlineRegular: () => ({ type: 'icon', props: {}, children: [] }),
        SettingsFormModel: function SettingsFormModel() { return model },
        ...primitives,
      }
      throw new Error(`unexpected client dependency: ${name}`)
    }),
  }
}

function fakeCtx({ scope, served = true, writes = [] }) {
  const registrations = []
  const servedCalls = []
  const injectedSlots = []
  const dictionaries = new Map()
  const ctx = {
    locale: { bind: (ns) => (key) => `${ns}.${key}`, register: (ns, dict) => { dictionaries.set(ns, dict); return () => {} } },
    configForms: {
      get: (entryId) => {
        assert.equal(entryId, SETTINGS_ENTRY_ID, '浏览器半边必须按条目 id 取表单')
        return scope
      },
      whileServed: (namespaces, register) => {
        // namespaces 是 sandbox realm 里的数组，直接进 deepStrictEqual 会被原型差异骗过。
        servedCalls.push(Array.from(namespaces, String))
        return namespaces.some((ns) => ns === SETTINGS_ENTRY_ID) && served ? (register(new Set([SETTINGS_ENTRY_ID])) ?? (() => {})) : () => {}
      },
    },
    remote: {
      credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => {} },
      $on: () => () => {},
    },
    effect: (callback) => { const dispose = callback(); return typeof dispose === 'function' ? dispose : () => {} },
    slots: {
      inject(name, callback) { injectedSlots.push(name); callback(); return () => {} },
      register(declaration, component) {
        registrations.push({ declaration, component })
        return () => {}
      },
    },
    logger: { info() {} },
  }
  return { ctx, registrations, servedCalls, injectedSlots, writes, dictionaries }
}

/** 一页两格（配置段 + 标题外链）都注册在同一份 registrations 上，按槽名取。 */
const registrationFor = (registrations, slotName) => registrations.find((item) => item.declaration.name === slotName)

const readyScope = (value = {}) => ({
  getSnapshot: () => ({ status: 'ready', writable: true, value, user: {}, base: {}, revision: 0 }),
  subscribe: () => () => {},
  mutate: async () => true,
})

test('capital-config Client：只依赖 slots/locale/remote/configForms，注册进 plugins.bundle.config 且用 shell React', () => {
  const scope = readyScope()
  const { mod, model } = loadClient({ scope })
  assert.equal(mod.name, 'capital-config')
  assert.deepEqual([...mod.inject], ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
    '0.1.7 的卡片不再注入 settingsScope；多了少了都要先对齐上游契约（账本 L15）')

  const { ctx, registrations, servedCalls, injectedSlots } = fakeCtx({ scope })
  mod.apply(ctx)
  assert.deepEqual(servedCalls, [[SETTINGS_ENTRY_ID]], '必须经 whileServed 门控：Host 不服务该条目时不留痕迹')
  assert.deepEqual(injectedSlots, ['plugins.bundle.config', 'plugins.detail.badge'],
    '同一页两格：配置段 + 标题右侧外链，都要真的 inject 过座位服务')
  assert.equal(registrations.length, 2)
  const { declaration, component } = registrationFor(registrations, 'plugins.bundle.config')
  assert.equal(declaration.name, 'plugins.bundle.config')
  assert.equal(declaration.key, '@v587d/capital-generation', '组合包级座位按**包名**寻址，不是 `<包名>#<行 id>`')
  assert.equal(typeof declaration.locale, 'string', '卡片文案自registered locale 命名空间')
  assert.equal(typeof component, 'function')

  const injected = declaration.inject()
  const store = injected.hooks.capitalCard
  assert.equal(store.getSnapshot(), store.getSnapshot(), '卡片 snapshot 必须在无更新时保持同一引用')
  for (const action of ['edit', 'resetField', 'save', 'discard', 'toggleLocalFetch']) {
    assert.equal(typeof injected[action], 'function', `inject 必须给出 ${action}`)
  }
  assert.equal(model.drafts.size, 0)
})

/** 深度收集渲染树里某类节点，顺序即渲染顺序。 */
function collect(node, type, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  for (const child of node.children ?? []) collect(child, type, out)
  return out
}

test('capital-config Client：四个密钥按序渲染，本机回退与 selected skill 开关依次收尾', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrationFor(registrations, 'plugins.bundle.config').declaration.inject()
  const Card = registrationFor(registrations, 'plugins.bundle.config').component
  const props = {
    t: (key) => String(key),
    useCapitalCard: (selector) => selector(injected.hooks.capitalCard.getSnapshot()),
    edit: injected.edit,
    resetField: injected.resetField,
    save: injected.save,
    discard: injected.discard,
    toggleLocalFetch: injected.toggleLocalFetch,
    toggleSelectedSkill: injected.toggleSelectedSkill,
  }
  // 组合包页面只给 `<section data-plugin-config>` 容器，小节标题归卡片自己画。
  const card = Card({ ...props, view: 'page' })
  const titles = collect(card, 'h4')
  assert.equal(titles.length, 1, '配置段要有自己的小节标题：页面这一格不画标题')
  assert.deepEqual(titles[0].children, ['title'], '标题走卡片字典，不许硬编码文案')
  const [page] = collect(card, 'SettingsForm')
  assert.ok(page, '表单必须走官方框（自带只读提示与保存控件）')
  const secrets = collect(page, 'SettingsSecretField').map((node) => node.props.id)
  assert.deepEqual(secrets, [
    'capital-config-fuyao-key',
    'capital-config-anysearch-key',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
  ], '四个密钥行的顺序与 CREDENTIAL_FIELDS 一致')
  const switches = collect(card, 'Switch')
  assert.equal(switches.length, SELECTED_SKILL_CATALOG.length + 1, '本机回退一颗开关，catalog 每项各一颗')
  assert.equal(switches[0].props.checked, true, '段缺省 ⇒ 本机回退默认开')
  assert.ok(switches.slice(1).every((node) => node.props.checked === false), 'selected skills 必须全部默认关闭')
  assert.equal(collect(card, 'button').filter((button) => button.props.className === 'capital-config-skill-copy').length, 0,
    '未启用技能不渲染复制技能按钮')
  const order = []
  const walk = (node) => {
    if (node?.type === 'SettingsSecretField') order.push(node.props.id)
    if (node?.type === 'SettingsFormFooter') order.push('save')
    if (node?.type === 'Switch') order.push(node.props.label === 'localFetchLabel' ? 'local-fetch' : 'selected-skill')
    for (const child of node?.children ?? []) walk(child)
  }
  walk(card)
  assert.deepEqual(order, [
    'capital-config-fuyao-key',
    'capital-config-anysearch-key',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
    'save',
    'local-fetch',
    ...SELECTED_SKILL_CATALOG.map(() => 'selected-skill'),
  ])
})

/**
 * 文案闸门：钉的是"这类话曾经写错成什么"，不是逐字措辞。
 * ① 文档链接曾经落在提示下方、还带服务名前缀（占一整行）；② 密钥曾经标"必填 / 选填"，
 * 而本项目不依赖任何单一数据源，四个 Key 一律选填；③ 生效范围要点名"新 Capital **模式**会话"；
 * ④ 说明文字曾经写到三四句，用户读不完。
 */
test('capital-config Client：精选 Skills 展示可复制 id 与仓库箭头链接，不展示维护元信息', async () => {
  const scope = readyScope({ selectedSkills: { buffettFramework: true } })
  const { mod, clipboardWrites } = loadClient({ scope })
  const { ctx, registrations, dictionaries } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrationFor(registrations, 'plugins.bundle.config').declaration.inject()
  const page = registrationFor(registrations, 'plugins.bundle.config').component({
    t: (key) => String(key),
    view: 'page',
    useCapitalCard: (selector) => selector(injected.hooks.capitalCard.getSnapshot()),
    edit: injected.edit, save: injected.save, discard: injected.discard, resetField: injected.resetField,
    toggleLocalFetch: injected.toggleLocalFetch,
    toggleSelectedSkill: injected.toggleSelectedSkill,
  })
  const links = collect(page, 'a')
  const docsLinks = links.filter((link) => link.props['data-capital-config-doc'] === 'true')
  assert.equal(docsLinks.length, 4, '四个密钥行各一个文档链接')
  for (const link of docsLinks) {
    assert.equal(link.props.target, '_blank', '文档链接新标签打开')
    assert.match(String(link.props.rel), /noopener/, '外链必须切断 opener')
    assert.equal(link.children[0], 'openDocs', '链接只写“官方文档”，不带服务名与密钥名')
    assert.equal(link.children[1]?.type, 'icon', '外链带右上角斜上箭头')
  }
  const repoLinks = links.filter((link) => link.props.title === 'selectedSkillsOpenRepo')
  assert.equal(repoLinks.length, SELECTED_SKILL_CATALOG.length, '每个 skill 都展示对应上游仓库链接')
  for (const [index, link] of repoLinks.entries()) {
    const entry = SELECTED_SKILL_CATALOG[index]
    assert.equal(link.props.href, `https://github.com/${entry.owner}/${entry.repository}`)
    assert.equal(link.props.children[0], `${entry.owner}/${entry.repository}`, '来源链接显示 owner/project')
    assert.equal(link.children[1]?.type, 'icon', '仓库链接带右上角斜上箭头')
    assert.match(String(link.props.rel), /noopener/)
  }
  const names = collect(page, 'code')
  assert.deepEqual(names.map((node) => node.children[0]), SELECTED_SKILL_CATALOG.map((entry) => entry.name))
  const copyButtons = collect(page, 'button').filter((button) => button.props.className === 'capital-config-skill-copy')
  assert.equal(copyButtons.length, 1, '只为已启用的技能渲染复制按钮')
  assert.equal(copyButtons[0].children[0], 'selectedSkillsCopyAction', '按钮文案为“复制技能”')
  await copyButtons[0].props.onClick()
  assert.deepEqual(clipboardWrites, [SELECTED_SKILL_CATALOG[0].name], '复制按钮写入 skill id')
  assert.ok(collect(page, 'button').some((button) => button.props['aria-pressed'] === 'true'), '能力标签筛选有可见选中态')
  assert.equal(collect(page, 'Switch').length, SELECTED_SKILL_CATALOG.length + 1)
  assert.equal(collect(page, 'h5')[0].children[0], 'selectedSkillsTitle')
  assert.ok(collect(page, 'h5')[0].props.className === 'capital-config-title')
  assert.equal(collect(page, 'p').filter((node) => node.props.className === 'capital-config-skill-description').length,
    SELECTED_SKILL_CATALOG.length, '只展示技能简述，不渲染额外风险提示')
  assert.equal(collect(page, 'p').some((node) => /实验中|观察中|最近提交|下次复查/.test(JSON.stringify(node.children))), false)

  const dict = dictionaries.get('settings.capital')
  assert.ok(dict, '卡片文案来自自己注册的 bilingual 字典')
  assert.equal(dict.zh.title, '数据源')
  assert.equal(dict.zh.selectedSkillsTitle, '精选 Skills')
  assert.equal(dict.zh.selectedSkillsHint, undefined, '已移除整段精选 Skills 说明')
  assert.equal(dict.zh.openDocs, '官方文档')
})

test('capital-config Client：Host 不服务该条目时不注册卡片', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope, served: false })
  mod.apply(ctx)
  assert.equal(registrationFor(registrations, 'plugins.bundle.config'), undefined,
    'whileServed 没放行就不许出现卡片（部署没装配本行 ⇒ 页面上不留痕迹）')
  assert.ok(registrationFor(registrations, 'plugins.detail.badge'),
    '外链不进 whileServed：它是插件的属性，与配置条目有没有被服务无关')
})

test('capital-config Client：回退开关即时写嵌套路径，写被拒不翻转且给出提示；只读存储不发写', async () => {
  const doc = { value: {} } // 段缺省 ⇒ 开关按 schema 默认呈现为「开」
  let writable = true
  let landed = true
  const writes = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable, value: doc.value, user: {}, base: {}, revision: 0 }),
    subscribe: () => () => {},
    mutate: async (ops) => {
      writes.push(ops)
      if (landed) doc.value = { retriever: { localFetch: { enabled: ops[0].value } } }
      return landed
    },
  }
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrationFor(registrations, 'plugins.bundle.config').declaration.inject()
  const store = injected.hooks.capitalCard
  assert.equal(store.getSnapshot().localFetch.on, true)

  await injected.toggleLocalFetch(false)
  // ops 在 VM sandbox realm 里创建，原型不同会骗过 deepStrictEqual ⇒ 先 JSON 归一再比结构。
  assert.equal(JSON.stringify(writes), JSON.stringify([[{ op: 'set', path: ['retriever', 'localFetch', 'enabled'], value: false }]]),
    '嵌套字段只能走 mutate；set(field) 只支持顶层')
  assert.equal(store.getSnapshot().localFetch.on, false)
  assert.equal(store.getSnapshot().localFetch.failed, false)
  assert.equal(store.getSnapshot().dirty, false, '即时保存的开关不进草稿流（不影响密钥的保存）')

  // 写被拒（revision 冲突 / 路径不被接受）：开关严格由快照渲染 ⇒ 不翻转，并显式说明没落上。
  landed = false
  await injected.toggleLocalFetch(true)
  assert.equal(store.getSnapshot().localFetch.on, false, '写失败时开关不得显示成已切换')
  assert.equal(store.getSnapshot().localFetch.failed, true)
  const page = registrationFor(registrations, 'plugins.bundle.config').component({
    t: (key) => String(key),
    view: 'page',
    useCapitalCard: (selector) => selector(store.getSnapshot()),
    edit: injected.edit, save: injected.save, discard: injected.discard, resetField: injected.resetField,
    toggleLocalFetch: injected.toggleLocalFetch,
    toggleSelectedSkill: injected.toggleSelectedSkill,
  })
  const notice = collect(page, 'p').find((node) => node.props.role === 'status')
  assert.ok(notice, '被拒的即时写必须有一句可见的提示')
  assert.equal(notice.props.children[0], 'saveFailed')

  // 只读存储：不发写请求。
  landed = true
  writable = false
  await injected.toggleLocalFetch(true)
  assert.equal(writes.length, 2, 'settings 只读时不得发起 mutate（前两次尝试之外不应有第三次写入）')
})

test('capital-config Client：selected skill 开关只写允许的 volatile 路径且默认关闭', async () => {
  const doc = { value: { selectedSkills: { buffettFramework: false } } }
  let writable = true
  const writes = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable, value: doc.value, user: {}, base: {}, revision: 0 }),
    subscribe: () => () => {},
    mutate: async (ops) => {
      writes.push(ops)
      doc.value = { selectedSkills: { buffettFramework: ops[0].value } }
      return true
    },
  }
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrationFor(registrations, 'plugins.bundle.config').declaration.inject()
  const store = injected.hooks.capitalCard
  assert.equal(store.getSnapshot().selectedSkills.buffettFramework.on, false)
  await injected.toggleSelectedSkill('buffettFramework', true)
  assert.equal(JSON.stringify(writes), JSON.stringify([[{ op: 'set', path: ['selectedSkills', 'buffettFramework'], value: true }]]))
  assert.equal(store.getSnapshot().selectedSkills.buffettFramework.on, true)

  await injected.toggleSelectedSkill('not-in-catalog', true)
  assert.equal(writes.length, 1, '不在准入 catalog 的 key 不得写入')
  writable = false
  await injected.toggleSelectedSkill('buffettFramework', false)
  assert.equal(writes.length, 1, '只读设置不得发起写入')
})

test('capital-config Host：schema 默认值必须与主插件 Config 完全一致（两处 schema 不能漂移）', () => {
  // 主插件用条目配置覆盖自身配置，再用自己的 Config 校验。两处 schema 一旦
  // 漂移，字段会在 条目→主插件 边界被静默改写/丢弃。默认值是最低限度的同步契约。
  // 摊平走的是 Host 自己那道 plainConfig：卡片与主插件看到的都是摊平后的值。
  assert.deepEqual(plainConfig(CapitalConfig({})), MainConfig({}))
  assert.deepEqual(MainConfig({}).selectedSkills, Object.fromEntries(SELECTED_SKILL_CATALOG.map(({ key }) => [key, false])), 'selected skill 默认必须全部关闭')
  assert.deepEqual(plainConfig(CapitalConfig({})).selectedSkills, MainConfig({}).selectedSkills,
    'Host 设置与主插件运行期的 selectedSkills 默认值必须一致')
})

test('capital-config Host：localFetch 默认值两处一致且消费点独立生效', () => {
  const capital = plainConfig(CapitalConfig({})).retriever.localFetch
  const main = MainConfig({}).retriever.localFetch
  // 主插件 schema 与消费点共用同一个导出常量，对照用例不靠重复字面量。
  assert.deepEqual(main, LOCAL_FETCH_DEFAULTS, '主插件 schema 默认值必须引用 LOCAL_FETCH_DEFAULTS')
  assert.deepEqual(capital, main, '两处 schema 的 localFetch 默认值必须逐字一致')
  assert.equal(main.enabled, true, '本地回退默认开启')
  assert.equal(capital.enabled, true, '本地回退默认开启')
  assert.equal(main.userAgent, '@v587d/capital-generation', 'schema 里的 UA 默认值是产品标识（裸版本号是 WAF 眼里的爬虫特征）')
  assert.equal(capital.userAgent, '@v587d/capital-generation')
  assert.equal(main.timeoutMs, 30000, '对齐官方 dsh-web-fetch-http 的 timeoutMs（15s 会误杀慢站点）')
  assert.equal(main.maxBytes, 524288)
  assert.equal(main.maxContentChars, 100000, '对齐官方 dsh-web-fetch-http 的 maxBodyChars；切在原始 HTML 上，必须按 HTML 体积给足')
  assert.equal(main.maxRedirects, 5)

  // 消费点（apply 装配段）在 localFetch 为 undefined 时独立补齐同样的默认值；
  // 只有 userAgent 例外：显式空串在消费点解析成插件版本号（唯一版本真值来源）。
  const consumed = resolveLocalFetchConfig(undefined)
  assert.equal(consumed.enabled, main.enabled)
  assert.equal(consumed.timeoutMs, main.timeoutMs)
  assert.equal(consumed.maxBytes, main.maxBytes)
  assert.equal(consumed.maxContentChars, main.maxContentChars)
  assert.equal(consumed.maxRedirects, main.maxRedirects)
  assert.equal(consumed.userAgent, main.userAgent)
  assert.equal(resolveLocalFetchConfig({ userAgent: '' }).userAgent, LOCAL_FETCH_CLIENT_VERSION,
    '显式空串才回落到插件版本号（版本真值仍只有一处）')
  assert.ok(consumed.userAgent.length > 0, '消费点的 UA 必须非空')

  assert.equal(resolveLocalFetchConfig({ enabled: false }).enabled, false, 'enabled:false 必须能关掉回退')
  assert.equal(resolveLocalFetchConfig({ timeoutMs: 1000 }).timeoutMs, 1000, '显式配置覆盖默认值')
  assert.equal(resolveLocalFetchConfig({ userAgent: 'custom/1' }).userAgent, 'custom/1', '显式 UA 覆盖版本号')
})

/**
 * 标题右侧的两枚外链（槽 `plugins.detail.badge`）。钉三件事：
 * ① **只在**本组合包的详情页出现——同一格座位在行详情页与官方插件页也会渲染，判错就是在
 *    别人的页面上挂我们的链接，且不报错；
 * ② list 座位的注册必须带 `id`（上游 `SlotCore.register` 对 list 缺 id 直接抛，同 id 二次注册也抛）；
 * ③ 两个地址与根 `package.json` 同字：仓库地址 = `repository.url` 去掉 `git+` 与 `.git`，
 *    npm 地址由包名拼出。改了包名而不改这里，链接就指向别人的仓库。
 */
test('capital-config Client：详情页外链只认本包，两枚图标各去 GitHub 与 npm', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations, dictionaries } = fakeCtx({ scope })
  mod.apply(ctx)
  const { declaration, component } = registrationFor(registrations, 'plugins.detail.badge')
  assert.equal(declaration.name, 'plugins.detail.badge')
  assert.equal(typeof declaration.id, 'string', 'list 座位按 id 占位：缺 id 上游直接抛')
  assert.equal(declaration.locale, 'settings.capital', '文案走卡片同一份 bilingual 字典')

  const t = (key) => String(key)
  const own = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const bundle = (name) => ({ kind: 'bundle', pkg: { name, rows: [] } })
  assert.equal(component({ subject: bundle('@deepseek-ai/dsh-tool-web'), t }), null,
    '别的包的详情页不许出现本插件的链接')
  assert.equal(component({ subject: { kind: 'row', pkg: bundle(own.name), row: { rowId: 'capital-config' } }, t }), null,
    '行详情页共用同一格座位：链接是包级属性，只出现在包页')
  assert.equal(component({ subject: { kind: 'item', id: 'capital' }, t }), null, '官方插件页同理')

  const links = collect(component({ subject: bundle(own.name), t }), 'a')
  assert.deepEqual(links.map((node) => node.props['data-capital-plugin-link']), ['github', 'npm'],
    '顺序固定：GitHub 在前、npm 收尾')
  for (const link of links) {
    assert.equal(link.props.target, '_blank', '外链新标签打开')
    assert.match(String(link.props.rel), /noopener/, '外链必须切断 opener')
    assert.ok(link.props['aria-label'], '纯图标没有可读文本，去处全靠 aria-label 说')
    assert.equal(link.props.title, link.props['aria-label'], '悬停提示与无障碍名同一句')
    assert.equal(link.children[0]?.type, 'svg', '图标是内联 SVG（官方图标表里没有 GitHub / npm 字形）')
  }
  const [github, npm] = links
  const repoUrl = own.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
  assert.equal(github.props.href, repoUrl, 'GitHub 图标必须逐字跟着 package.json 的 repository.url')
  assert.equal(npm.props.href, `https://www.npmjs.com/package/${own.name}`, 'npm 地址由包名拼出')

  const dict = dictionaries.get('settings.capital')
  assert.deepEqual(Object.keys(dict.zh).sort(), Object.keys(dict.en).sort(), '两份字典的键必须同集合')
  const labels = ['githubLabel', 'npmLabel'].map((key) => dict.zh[key])
  assert.equal(new Set(labels).size, 2, '两枚图标的中文提示各不相同（纯图标全靠它区分去处）')
})

test('capital-config 包清单：声明运行期 schemastery 依赖，且客户端 bundle 会随包发布', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'capital-config', 'package.json'), 'utf8'))
  // index.js 顶部 `import z from '@deepseek-ai/schemastery'` 是运行期外部导入，必须声明；
  // 且版本必须够新——`.volatile()` 是 3.18.4 才有的（3.18.2 上整颗行在 import 期就抛错）。
  assert.equal(manifest.dependencies?.['@deepseek-ai/schemastery'], '^3.18.4')
  // 声明了 dsh.client 就必须有 exports["./client"]，且 bundle 出现在 files 里（L2 闸门同口径）。
  assert.equal(manifest.exports?.['./client']?.default, './client.js')
  assert.ok(manifest.files.includes('client.js'), 'client.js 必须随包发布，否则 web profile 起不来')
  assert.ok(manifest.files.includes('index.js'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
  // dsh.client.inject 列的是**模块表**依赖：写一个本机 dsh 里没有的包名，bundle 就加载不了。
  const inject = manifest.dsh.client.inject ?? []
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'), 'plugins.bundle.config 槽主在该包里')
  assert.ok(!inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), '0.1.7 的插件页归 plugin-manager 所有')
})
