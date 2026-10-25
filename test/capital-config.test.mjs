import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { load as yamlLoad } from 'js-yaml'
import { apply as hostApply, Config as CapitalConfig, SETTINGS_ENTRY_ID } from '../config/index.js'
import { fakeCtx as hostFakeCtx } from './cordis-fake.mjs'
import { CAPITAL_CONFIG_ENTRY_ID, Config as MainConfig, LOCAL_FETCH_DEFAULTS, resolveLocalFetchConfig } from '../lib/index.js'
import { LOCAL_FETCH_CLIENT_VERSION } from '../lib/web-retriever/local-fetch.js'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_TAG_LABELS } from '../selected-skills/catalog.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'config', 'client.js')
const CLIENT_SRC = join(ROOT, 'config', 'client.src.cjs')

// Config and card are two lists: compare resolved credential refs, so an omitted or extra ref fails.
test('capital-config：条目 Config 里每个凭据引用名，卡片都必须有一行密钥', () => {
  const names = []
  const walk = (value) => {
    for (const [key, item] of Object.entries(value ?? {})) {
      if (/credentialref$/i.test(key) && typeof item === 'string') names.push(item)
      else if (item && typeof item === 'object') walk(item)
    }
  }
  walk(plainConfig(CapitalConfig({})))
  const clientNames = [...readFileSync(CLIENT_SRC, 'utf8').matchAll(/^const \w*DEFAULT_REF = '([^']+)'/gm)]
    .map((match) => match[1])
  assert.deepEqual([...new Set(names)].sort(), [...new Set(clientNames)].sort(),
    '凭据引用名不齐：卡片少一格 = 这把密钥没有输入口，多一格 = 界面上永远存不了东西')
  assert.ok(names.length >= 5, `密钥行只剩 ${names.length} 把，闸门多半被架空了`)
})

// Entry id is the settings namespace and must match in four places (patch row, host, main plugin, client); the slot key must equal the bundle name.
test('条目 id 四处一致 + 槽 key = 组合包包名：settings 命名空间与卡片座位各自同字', () => {
  const patch = yamlLoad(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, ''))
  const row = patch.flatMap((entry) => entry?.insert ?? []).find((item) => item?.name === './config/index.js')
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

// Same dereference as the host: volatile fields are cosmokit cells; flatten before comparing.
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function plainConfig(value) {
  if (value === null || typeof value !== 'object') return value
  if (VOLATILE_WRITE in value) return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]))
}

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function volatilePaths(schema, path = []) {
  if (schema?.meta?.volatile) return [path.join('.')]
  if (schema?.type !== 'object') return []
  return Object.entries(schema.dict ?? {}).flatMap(([key, child]) => volatilePaths(child, [...path, key]))
}

test('capital-config Host：可编辑面全靠 Config 的 .volatile() 字段，注册通道已退休', () => {
  const flags = volatilePaths(CapitalConfig)
  for (const path of [
    'customPersona', 'fuyaoCredentialRef', 'ftshareCredentialRef',
    'retriever.baseURL', 'retriever.credentialRef',
    'retriever.windDocs.credentialRef', 'retriever.localFetch.enabled', 'retriever.paddleOcr.credentialRef',
  ]) {
    assert.ok(flags.includes(path), `${path} 必须 .volatile()，否则卡片改不动它（条目甚至不进 describe 镜像）`)
  }

  const selectedSkillPaths = SELECTED_SKILL_CATALOG.map(({ key }) => key)
  assert.ok(selectedSkillPaths.length >= 7, `catalog 只剩 ${selectedSkillPaths.length} 条，这条闸门要退化成空断言了`)
  for (const key of selectedSkillPaths) {
    assert.ok(flags.includes(`selectedSkills.${key}`), `selectedSkills.${key} 必须 .volatile()`)
  }

  const hostSource = codeOnly(readFileSync(join(ROOT, 'config', 'index.js'), 'utf8'))
  assert.doesNotMatch(hostSource, /settings\.register|settingsScope|SETTINGS_NAMESPACE/,
    '0.1.7 已删除 settings.register / settingsScope；代码里再出现就是把卡片改回了退休的旧面')

  // apply registers a local route, so use the cordis fake where bare ctx.webServer throws.
  const registered = []
  const logs = []
  const { ctx: hostCtx, injected } = hostFakeCtx({
    webServer: { register: (route) => { registered.push(route); return () => {} } },
    connection: { requestRejection: () => undefined },
  })
  hostCtx.logger = { info: (message) => logs.push(message) }
  hostApply(hostCtx)
  assert.ok(logs.some((message) => message.includes('settings entry active')), 'apply 留一行激活日志，证明这颗行起来了')
  assert.deepEqual(injected.map((item) => item.deps), [['webServer']],
    'webServer 只走 inject：探测式写法把正确性押在装配顺序上，2026-09-30 桌面端就是这么炸的两颗行')
  assert.equal(registered.length, 1, '原文旁路路由随这颗行注册一次')
})

function fakeModel(scope) {
  const drafts = new Map()
  let store
  // Keep bind()'s projector or the dirty flag never reaches the store.
  let bound
  const push = () => { if (store && bound) store.set(bound()) }
  return {
    drafts,
    bind(project) {
      bound = project
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
      edit: (field, text) => { drafts.set(field, text); push() },
      resetField: (field) => { drafts.delete(field); push() },
      save: () => {},
      discard: () => { drafts.clear(); push() },
    }),
    dispose() {},
  }
}

const defaultFetch = async () => ({
  ok: true,
  status: 200,
  text: async () => '# SKILL 原文\nbody: true',
  json: async () => ({}),
})

function loadClient({ scope, primitives = {}, fetchImpl = defaultFetch } = {}) {
  let entry
  const clipboardWrites = []
  const docRequests = []
  const timers = []
  const warnings = []
  // Fake DOM captures the parsed stylesheet; the build keeps mine as a template literal.
  const styles = []
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { entry = value } } },
    console: { warn: (message) => warnings.push(String(message)) },
    fetch: async (url, init) => { docRequests.push({ url: String(url), init }); return fetchImpl(url, init) },
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length },
    clearTimeout: () => {},
    document: {
      documentElement: { lang: 'zh-CN' },
      querySelector: () => null,
      createElement: () => { const node = { dataset: {}, textContent: '', remove() {} }; styles.push(node); return node },
      head: { appendChild() {} },
    },
  }
  runInNewContext(readFileSync(CLIENT, 'utf8'), sandbox)
  assert.ok(entry)
  const model = fakeModel(scope)
  return {
    model,
    clipboardWrites,
    docRequests,
    timers,
    warnings,
    styles,
    mod: entry.factory((name) => {
      if (name === 'react') return {
        // Expand function components in place; ids are template literals, so read the tree.
        createElement(type, props, ...children) {
          const kids = children.flat(Infinity).filter(Boolean)
          if (typeof type === 'function') return type({ ...props, children: kids })
          return { type, props: { ...props, children: kids }, children: kids }
        },
        useRef: () => ({ current: null }),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {},
      }
      if (name === 'react-dom') return { createPortal: (node) => node }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        SettingsForm(props) {
          const footer = { type: 'SettingsFormFooter', props: {}, children: [{ type: 'SaveButton', props: {}, children: [] }] }
          return { type: 'SettingsForm', props, children: [...(props.children ?? []), footer] }
        },
        SettingsSecretField(props) { return { type: 'SettingsSecretField', props, children: props.children ?? [] } },
        SegmentedControl(props) { return { type: 'SegmentedControl', props, children: [] } },
        Modal(props) { return { type: 'Modal', props, children: props.children ?? [] } },
        Switch(props) { return { type: 'Switch', props, children: props.children ?? [] } },
        IconRightUpOutlineRegular: () => ({ type: 'icon', props: {}, children: [] }),
        IconWarningTriangleOutlineRegular: () => ({ type: 'warning-icon', props: {}, children: [] }),
        SettingsFormModel: function SettingsFormModel() { return model },
        writeClipboard: async (value) => { clipboardWrites.push(value); return true },
        ...primitives,
      }
      throw new Error(`unexpected client dependency: ${name}`)
    }),
  }
}

function bundlesWith(rowCount) {
  const rows = Array.from({ length: rowCount }, (unused, index) => ({ rowId: `row-${index}` }))
  return { ok: true, value: [{ name: '@v587d/capital-generation', rows }] }
}

function fakeCtx({ scope, served = true, writes = [], listBundles = async () => bundlesWith(4) } = {}) {
  const registrations = []
  const servedCalls = []
  const injectedSlots = []
  const dictionaries = new Map()
  const remoteEvents = new Map()
  const contextEvents = new Map()
  let listBundlesCalls = 0
  const ctx = {
    locale: { bind: (ns) => (key) => `${ns}.${key}`, register: (ns, dict) => { dictionaries.set(ns, dict); return () => {} } },
    configForms: {
      get: (entryId) => {
        assert.equal(entryId, SETTINGS_ENTRY_ID, '浏览器半边必须按条目 id 取表单')
        return scope
      },
      whileServed: (namespaces, register) => {
        // Sandbox-realm arrays differ by prototype; normalize with Array.from.
        servedCalls.push(Array.from(namespaces, String))
        return namespaces.some((ns) => ns === SETTINGS_ENTRY_ID) && served ? (register(new Set([SETTINGS_ENTRY_ID])) ?? (() => {})) : () => {}
      },
    },
    remote: {
      credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => {} },
      pluginManager: { listBundles: async () => { listBundlesCalls += 1; return listBundles() } },
      $on(name, handler) { remoteEvents.set(name, handler); return () => { if (remoteEvents.get(name) === handler) remoteEvents.delete(name) } },
    },
    on(name, handler) { contextEvents.set(name, handler); return () => { if (contextEvents.get(name) === handler) contextEvents.delete(name) } },
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
  return {
    ctx, registrations, servedCalls, injectedSlots, writes, dictionaries,
    remoteEvents, contextEvents, listBundlesCalls: () => listBundlesCalls,
    fire(event, listeners) { listeners.get(event)?.() },
  }
}

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
  assert.deepEqual(
    [...mod.inject],
    ['slots', 'locale', 'remote', 'remote.credentials', 'remote.pluginManager', 'configForms'],
    '0.1.7 的卡片不再注入 settingsScope；行数以 listBundles 为源 ⇒ 多一颗 remote.pluginManager；'
    + '多了少了都要先对齐上游契约（账本 L15、L28）。注意 inject 里一个拿不到的服务名不是"卡片不见了"，'
    + '而是整个 web profile 起不来（0.1.7 那次事故）。',
  )

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
  for (const action of ['edit', 'resetField', 'save', 'discard', 'toggleLocalFetch', 'ensureBundleRows']) {
    assert.equal(typeof injected[action], 'function', `inject 必须给出 ${action}`)
  }
  assert.equal(model.drafts.size, 0)
})

function collect(node, type, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  for (const child of node.children ?? []) collect(child, type, out)
  return out
}

function detailButtons(page) {
  return collect(page, 'button').filter((button) => String(button.props['aria-label']).startsWith('selectedSkillsDetail'))
}

function cardProps(injected) {
  return {
    t: (key) => String(key),
    view: 'page',
    useCapitalCard: (selector) => selector(injected.hooks.capitalCard.getSnapshot()),
    edit: injected.edit,
    resetField: injected.resetField,
    save: injected.save,
    discard: injected.discard,
    toggleLocalFetch: injected.toggleLocalFetch,
    toggleSelectedSkill: injected.toggleSelectedSkill,
    ensureBundleRows: injected.ensureBundleRows,
  }
}

function cardRenderer(registrations) {
  const { declaration, component } = registrationFor(registrations, 'plugins.bundle.config')
  const injected = declaration.inject()
  const props = cardProps(injected)
  return { injected, render: () => component(props) }
}

// Drain one macrotask: async fetches in handlers expose no awaitable handle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('capital-config Client：五个密钥按序渲染，本机回退与 selected skill 开关依次收尾', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const card = render()
  const titles = collect(card, 'h4')
  assert.deepEqual(titles, [], '标题体系交给 tab 条：卡片不再自绘 h4（h4/h5 两级曾把精选 Skills 压成数据源的子项）')
  const [tabs] = collect(card, 'SegmentedControl')
  assert.ok(tabs, '三格切换必须走官方 tab 件，不自造 tablist')
  assert.equal(tabs.props.id, 'capital-config-tabs')
  assert.equal(tabs.props.value, 'sources', '默认停在数据源')
  assert.equal(tabs.props.label, 'tabsLabel', 'tablist 的名字走字典')
  assert.deepEqual(Array.from(tabs.props.options, (option) => option.value), ['sources', 'skills', 'components'])
  assert.equal(tabs.props.options[0].label, 'title', '第一格文案仍走卡片字典，不硬编码')
  assert.deepEqual(
    collect(card, 'section').filter((node) => node.props.role === 'tabpanel').map((node) => node.props.hidden),
    [false, true, true],
    '⛔ 三块面板**全部挂载**，不在屏的只是 hidden：SettingsForm 卸载即丢草稿，只渲染活动格会吃掉用户填的密钥',
  )
  const [page] = collect(card, 'SettingsForm')
  assert.ok(page, '表单必须走官方框（自带只读提示与保存控件）')
  const secrets = collect(page, 'SettingsSecretField').map((node) => node.props.id)
  assert.deepEqual(secrets, [
    'capital-config-fuyao-key',
    'capital-config-ftshare-key',
    'capital-config-anysearch-key',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
  ], '五个密钥行的顺序与 CREDENTIAL_FIELDS 一致')
  const switches = collect(card, 'Switch')
  assert.equal(switches.length, SELECTED_SKILL_CATALOG.length + 2, '本机回退 + 精选模式各一颗，catalog 每项各一颗')
  assert.equal(switches[0].props.checked, true, '段缺省 ⇒ 本机回退默认开')
  assert.equal(switches[1].props.checked, false, '精选模式默认 manual')
  assert.ok(switches.slice(2).every((node) => node.props.checked === false), 'selected skills 必须全部默认关闭')
  assert.equal(collect(card, 'button').filter((button) => button.props.className === 'capital-config-skill-action').length,
    SELECTED_SKILL_CATALOG.length,
    '全默认关闭 ⇒ 每行只有「详情」一颗按钮：复制技能名只给已开启的技能')
  const order = []
  const walk = (node) => {
    if (node?.type === 'SettingsSecretField') order.push(node.props.id)
    if (node?.type === 'SettingsFormFooter') order.push('save')
    if (node?.type === 'Switch') {
      order.push(node.props.label === 'localFetchLabel'
        ? 'local-fetch'
        : node.props.label === 'selectedSkillsModeLabel' ? 'selected-skills-mode' : 'selected-skill')
    }
    for (const child of node?.children ?? []) walk(child)
  }
  walk(card)
  assert.deepEqual(order, [
    'capital-config-fuyao-key',
    'capital-config-ftshare-key',
    'capital-config-anysearch-key',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
    'save',
    'local-fetch',
    'selected-skills-mode',
    ...SELECTED_SKILL_CATALOG.map(() => 'selected-skill'),
  ], '数据源格内：五个密钥 → 保存 → 回退开关；精选 Skills 的模式开关与 68 行随后（hidden 也在树上）')
})

test('capital-config Client：catalog 用到的每个能力标签都有中英两套显示名', () => {
  // Filter tags derive from the catalog; a missing label silently renders the raw tag.
  const used = [...new Set(SELECTED_SKILL_CATALOG.flatMap((entry) => entry.tags))].sort()
  assert.ok(used.length >= 3, `catalog 只用到 ${used.length} 个能力标签，这条闸门多半被架空了`)
  for (const locale of ['zh', 'en']) {
    const labels = SELECTED_SKILL_TAG_LABELS[locale]
    assert.ok(labels, `SELECTED_SKILL_TAG_LABELS 缺少 ${locale} 那一套`)
    const missing = used.filter((tag) => typeof labels[tag] !== 'string' || labels[tag].trim() === '')
    assert.deepEqual(missing, [], `${locale} 界面缺这些能力标签的显示名：${missing.join(', ')}`)
  }
  assert.deepEqual(Object.keys(SELECTED_SKILL_TAG_LABELS.en).sort(), Object.keys(SELECTED_SKILL_TAG_LABELS.zh).sort(),
    'zh 与 en 的标签表键不齐：切语言时会有标签露出英文原词')
  for (const locale of ['zh', 'en']) assert.ok(SELECTED_SKILL_TAG_LABELS[locale].all, `${locale} 的筛选条缺「全部」`)
})

test('capital-config Client：精选 Skills 每行给复制技能名与仓库链接，不再显示 slug', async () => {
  const scope = readyScope({ selectedSkills: { buffettFramework: true } })
  const { mod, clipboardWrites, timers } = loadClient({ scope })
  const { ctx, registrations, dictionaries } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const page = render()
  const links = collect(page, 'a')
  const docsLinks = links.filter((link) => link.props['data-capital-config-doc'] === 'true')
  assert.equal(docsLinks.length, 5, '五个密钥行各一个文档链接')
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
  assert.deepEqual(collect(page, 'code'), [], '卡片不再显示 slug')
  const copyButtons = collect(page, 'button').filter((button) => button.props.className === 'capital-config-skill-action'
    && String(button.props['aria-label']).startsWith('selectedSkillsCopyName'))
  assert.equal(copyButtons.length, 1, '⛔ 复制技能名只给**已开启**的技能：没开的复制了也用不上（那串名字是给会话用的）')
  assert.equal(detailButtons(page).length, SELECTED_SKILL_CATALOG.length,
    '「详情」不留这一道闸门——开之前正是要读原文的时候')
  assert.deepEqual(copyButtons.map((button) => button.props['aria-label']),
    [`selectedSkillsCopyName: ${SELECTED_SKILL_CATALOG[0].name}`], '复制的目标写进无障碍名')
  assert.deepEqual(copyButtons.map((button) => button.props.title),
    [`selectedSkillsCopyName: ${SELECTED_SKILL_CATALOG[0].name}`], '悬停提示与无障碍名同一句')
  assert.equal(copyButtons[0].children[0], 'selectedSkillsCopyName', '按钮文案是「复制技能名」')
  await copyButtons[0].props.onClick()
  assert.deepEqual(clipboardWrites, [`/${SELECTED_SKILL_CATALOG[0].name}`], '走官方 writeClipboard 写入 /name，粘贴即可强制加载')
  assert.equal(timers.length, 1, '「已复制」必须定时复位：一直亮着等于把一次性动作说成一个状态')
  assert.equal(timers[0].ms, 1600)
  assert.ok(collect(page, 'button').some((button) => button.props['aria-pressed'] === 'true'), '能力标签筛选有可见选中态')
  assert.equal(collect(page, 'Switch').length, SELECTED_SKILL_CATALOG.length + 2)
  assert.deepEqual(collect(page, 'h5'), [], '精选 Skills 不再是数据源底下的 h5：它与数据源平级，如今各占一格')
  const [tabs] = collect(page, 'SegmentedControl')
  assert.equal(tabs.props.options[1].label, `selectedSkillsTitle 1/${SELECTED_SKILL_CATALOG.length}`,
    '第二格标"已开启/总数"：只标总数会让人以为整张 catalog 都开着')
  const skillsPanel = collect(page, 'section').find((node) => node.props.id === 'capital-config-tabs-skills-panel')
  assert.equal(skillsPanel.props.hidden, true, '不在屏的那格 hidden 收起（仍在渲染树上，所以以上断言量的是真内容）')
  assert.equal(collect(page, 'p').filter((node) => node.props.className === 'capital-config-skill-description').length,
    SELECTED_SKILL_CATALOG.length, '只展示技能简述，不渲染额外风险提示')
  assert.equal(collect(page, 'p').filter((node) => node.props.className === 'capital-config-skill-when').length,
    SELECTED_SKILL_CATALOG.length, '每行展示路由触发句（useWhen），不只给一段主题摘要')
  assert.ok(collect(page, 'span').some((node) => node.props.className === 'capital-config-skill-role'), '每行展示角色徽标，用户知道它归主 Agent 还是数据侧')
  assert.equal(collect(page, 'p').some((node) => /实验中|观察中|最近提交|下次复查/.test(JSON.stringify(node.children))), false)

  const dict = dictionaries.get('settings.capital')
  assert.ok(dict, '卡片文案来自自己注册的 bilingual 字典')
  assert.equal(dict.zh.title, '数据源')
  assert.equal(dict.zh.selectedSkillsTitle, '精选 Skills')
  assert.equal(dict.zh.selectedSkillsHint, undefined, '已移除整段精选 Skills 说明')
  assert.equal(dict.zh.openDocs, '官方文档')
  // Must match the host's partsLabel, or the tab and section names diverge.
  assert.equal(dict.zh.componentsTitle, '包含的组件')
  assert.equal(dict.en.componentsTitle, 'Components')
  assert.equal(typeof dict.zh.tabsLabel, 'string')
  assert.equal(typeof dict.zh.componentsHint, 'string', '那句"清单在下方"仍在字典里：它只是从画面上挪到了读屏侧')
  assert.equal(dict.zh.selectedSkillsCopyAction, undefined, '复制按钮只剩一套文案（visible 与 aria 同名，不再分两个键）')
  assert.equal(dict.zh.selectedSkillsDetail, '详情')
  assert.equal(typeof dict.zh.selectedSkillsDocFailed, 'string', '原文取不到时要有一句人话')
})

test('capital-config Client：筛选器在左侧、每个标签带"点它会显示几行"', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const page = render()
  const [layout] = collect(page, 'div').filter((node) => node.props.className === 'capital-config-selected-layout')
  assert.ok(layout, '第二格是一行两列（上下布局时 35 行清单里根本回不去筛选器）')
  const [filter, list] = layout.children
  assert.equal(filter.props.className, 'capital-config-selected-filter', '左列是筛选器')
  assert.equal(list.props.className, 'capital-config-selected-list', '右列是清单')
  const tagCount = new Map()
  for (const entry of SELECTED_SKILL_CATALOG) {
    for (const tag of entry.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  }
  tagCount.set('all', SELECTED_SKILL_CATALOG.length)
  const tags = ['all', ...Array.from(tagCount.keys()).filter((tag) => tag !== 'all')
    .sort((left, right) => tagCount.get(right) - tagCount.get(left))]
  const buttons = collect(filter, 'button')
  assert.deepEqual(buttons.map((button) => button.children[0]), tags.map((tag) => SELECTED_SKILL_TAG_LABELS.zh[tag]),
    '筛选器按个数从高到低排，「全部」不参与排序')
  assert.equal(buttons[0].children[0], SELECTED_SKILL_TAG_LABELS.zh.all, '「全部」恒在第一格')
  assert.equal(collect(filter, 'span').filter((node) => node.children[0] === 'selectedSkillsFilterLabel').length, 0,
    '「按能力筛选」那句字面提示删了（名字仍挂在 role=group 的 aria-label 上）')
  assert.equal(filter.props['aria-label'], 'selectedSkillsFilterLabel')
  const ordered = buttons.slice(1).map((button) => Number(button.children[1].children[0]))
  assert.deepEqual(ordered, [...ordered].sort((left, right) => right - left), '数字必须单调不升')
  const shown = buttons.map((button) => Number(button.children[1].children[0]))
  assert.deepEqual(shown, tags.map((tag) => tagCount.get(tag)), '数字 = catalog 里带这个标签的条数')
  assert.equal(shown[0], collect(list, 'div').filter((node) => node.props.className === 'capital-config-field').length,
    '「全部」那个数与右边当场渲染的行数必须相等')
  for (const [index, button] of buttons.entries()) {
    assert.equal(button.children[1].props.className, 'capital-config-selected-filter-count', `${index} 的数字是自己的元素，不拼在名字里`)
  }
})

// Enabled skills sort first, and the order is frozen on tab entry so toggling does not move a row under the cursor.
test('capital-config Client：已开启的 Skill 置顶，但只在进入那一格时定顺序', () => {
  const enabled = { financialHealth: true, valuationInvestmentStrategy: true }
  const scope = readyScope({ selectedSkills: enabled })
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const page = cardRenderer(registrations).render()
  // Copy before sorting: the catalog is shared module state.
  const ordered = [...SELECTED_SKILL_CATALOG]
    .sort((left, right) => (enabled[left.key] === true ? 0 : 1) - (enabled[right.key] === true ? 0 : 1))
  const titles = collect(page, 'span')
    .filter((node) => node.props.className === 'capital-config-title')
    .map((node) => node.children[0])
  assert.equal(titles.length, SELECTED_SKILL_CATALOG.length, '每行一个标题')
  assert.deepEqual(titles, ordered.map((entry) => entry.label.zh), '开了的两颗在最前，组内还是 catalog 顺序')
  assert.equal(titles[0], SELECTED_SKILL_CATALOG[1].label.zh, '开了的那颗真的不在它原本的位子上')
  const copyRows = collect(page, 'button')
    .filter((button) => String(button.props['aria-label']).startsWith('selectedSkillsCopyName'))
  assert.deepEqual(copyRows.map((button) => button.props['aria-label']),
    ordered.slice(0, 2).map((entry) => `selectedSkillsCopyName: ${entry.name}`),
    '「复制技能名」只给已开启的行 ⇒ 它们跟着聚在最上面')
})

// Opening must be a click: HoverCard only times pointerenter and closes on anchor click.
test('capital-config Client：「详情」点击开对话框、悬停预热原文，成功才缓存', async () => {
  const scope = readyScope()
  const { mod, docRequests } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const page = render()
  const modals = collect(page, 'Modal')
  assert.equal(modals.length, SELECTED_SKILL_CATALOG.length, '每行一个详情对话框')
  for (const modal of modals) {
    assert.equal(modal.props.open, false, '默认全关着（开着的那些由官方组件自己返回 null）')
    assert.equal(typeof modal.props.onClose, 'function', '关闭是应用侧动作：Esc / 遮罩 / 关闭按钮都走它')
    assert.equal(typeof modal.props.closeLabel, 'string', '非 headless 的 Modal 必须给关闭按钮一句本地化文案')
  }
  const details = detailButtons(page)
  assert.equal(details.length, SELECTED_SKILL_CATALOG.length, '「详情」不留"已开启"这道闸门——开之前正是要读原文的时候')
  assert.deepEqual(collect(page, 'HoverCard'), [], '悬浮预览卡已经不用了：它点不开')
  assert.equal(modals[0].props.description, SELECTED_SKILL_CATALOG[0].name, 'slug 从行面上删了，但打开的那一刻要说清读的是哪一份')
  assert.equal(modals[0].children[0].props.children[0], 'selectedSkillsDocLoading', '还没取到时先把"读取中"摆好，不给一个空对话框')
  assert.equal(details[0].props['aria-haspopup'], 'dialog', '点下去开的是对话框，无障碍树上得先说出来')
  assert.equal(docRequests.length, 0, '没悬停也没点击就一份都不取')
  details[0].props.onPointerEnter({})
  await settle()
  assert.deepEqual(docRequests.map((item) => item.url), [`/capital-skills/${SELECTED_SKILL_CATALOG[0].name}.md`])
  assert.equal(docRequests[0].init.cache, 'no-store')
  assert.equal(docRequests[0].init.credentials, 'same-origin', '本机旁路要带着宿主的 cookie，不带就是匿名请求本地文件')
  details[0].props.onPointerEnter({})
  await settle()
  assert.equal(docRequests.length, 1, '同一行来回不重复要同一份')
  details[1].props.onClick()
  await settle()
  assert.equal(docRequests.length, 2, '另一行的原文是另一份')
  assert.equal(docRequests[1].url, `/capital-skills/${SELECTED_SKILL_CATALOG[1].name}.md`)
})

test('capital-config Client：原文读不到不写缓存，再点一次还会重试，且两种读不到分得开', async () => {
  const scope = readyScope()
  let fail = true
  const { mod, docRequests, warnings } = loadClient({
    scope,
    fetchImpl: async () => (fail
      ? { ok: false, status: 404, json: async () => ({ error: 'skill_doc_unreadable' }), text: async () => '' }
      : { ok: true, status: 200, json: async () => ({}), text: async () => '# 回来了' }),
  })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const [detail] = detailButtons(render())
  detail.props.onClick()
  await settle()
  assert.equal(docRequests.length, 1)
  detail.props.onClick()
  await settle()
  assert.equal(docRequests.length, 2, '把一次失败缓存住 = 这一整场会话都读不到原文')
  fail = false
  detail.props.onClick()
  await settle()
  assert.equal(docRequests.length, 3)
  assert.match(warnings.join('\n'), /skill_doc_unreadable/)
})

test('capital-config Client：宿主还没这条路由时，分类落 route_missing 而不是"快照读不到"', async () => {
  const scope = readyScope()
  const { mod, warnings } = loadClient({
    scope,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => { throw new Error('not json') }, text: async () => '<html>Not Found</html>' }),
  })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const [detail] = detailButtons(render())
  detail.props.onPointerEnter({})
  await settle()
  assert.match(warnings.join('\n'), /route_missing/, '回包不是我们的形状 ⇒ 判成"宿主没这条路由"')
  const dict = (() => {
    const { ctx: other, dictionaries } = fakeCtx({ scope })
    loadClient({ scope }).mod.apply(other)
    return dictionaries.get('settings.capital')
  })()
  assert.notEqual(dict.zh.selectedSkillsDocStale, dict.zh.selectedSkillsDocFailed, '两句必须说不同的动作')
  assert.match(dict.zh.selectedSkillsDocStale, /重启/, 'stale 那句要点名"重启宿主"')
  assert.match(dict.zh.selectedSkillsDocStale, /刷新页面也没有用/, '并且要说清刷新不管用（不然用户会一直刷）')
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

// SegmentedControl always emits aria-controls, so all three panels must exist; a dangling id fails silently.
test('capital-config Client：三块面板各有 tabpanel 身份，第三块也真的存在', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const card = render()
  const panels = collect(card, 'section').filter((node) => node.props.role === 'tabpanel')
  assert.deepEqual(panels.map((node) => node.props.id), [
    'capital-config-tabs-sources-panel',
    'capital-config-tabs-skills-panel',
    'capital-config-tabs-components-panel',
  ], '面板 id 必须逐字跟着官方 <id>-<value>-panel 方案')
  assert.deepEqual(panels.map((node) => node.props['aria-labelledby']), [
    'capital-config-tabs-sources',
    'capital-config-tabs-skills',
    'capital-config-tabs-components',
  ], '面板的名字就是 tab 上那几个字')
  const root = card
  assert.equal(root.props['data-capital-config-tab'], 'sources', '收起/放行宿主段落的判据挂在卡片根上')
  assert.deepEqual(panels.map((node) => node.props['data-capital-config-panel']), ['sources', 'skills', 'components'],
    '样式表按这一格挂的属性摆间距（第三格那句 padding 认的就是它）')
  const componentsPanel = panels[2]
  assert.equal(collect(componentsPanel, 'p').length, 0,
    '第三格画面里没有那行"清单由 DSH 绘制"——点这一格看到的就是清单，多余的一行字只是噪音')
  assert.ok(collect(componentsPanel, 'span').some((node) => node.props.className === 'capital-config-sr-only'
    && node.children[0] === 'componentsHint'),
    '但 aria-controls 指的这块面板不许是空的：那句话改挂在读屏侧，零布局贡献')
})

// Enabled count is live snapshot state; row count comes only from listBundles(), and an unknown count is never drawn as 0.
test('capital-config Client：tab 上的两个计数，取不到的数字宁可不画', async () => {
  const scope = readyScope({ selectedSkills: { financialHealth: true, valuationInvestmentStrategy: true } })
  const { mod } = loadClient({ scope })
  const { ctx, registrations, listBundlesCalls } = fakeCtx({ scope })
  mod.apply(ctx)
  const { injected, render } = cardRenderer(registrations)

  let tabs = collect(render(), 'SegmentedControl')[0]
  assert.equal(tabs.props.options[1].label, `selectedSkillsTitle 2/${SELECTED_SKILL_CATALOG.length}`,
    '已开启 2 颗 ⇒ 2/35')
  assert.equal(tabs.props.options[2].label, 'componentsTitle', '没取过行数之前，第三格只有标题、没有数字')

  await injected.ensureBundleRows()
  tabs = collect(render(), 'SegmentedControl')[0]
  assert.equal(tabs.props.options[2].label, 'componentsTitle 4')

  const calls = listBundlesCalls()
  await injected.ensureBundleRows()
  assert.equal(listBundlesCalls(), calls, '已取到 ⇒ 不再重取')
})

test('capital-config Client：行数读不到（拒答 / 抛错 / 清单里没我们）都不落成 0，且下次会重试', async () => {
  for (const [name, listBundles] of [
    ['拒答', async () => ({ ok: false, error: { message: 'nope' } })],
    ['抛错', async () => { throw new Error('connection lost') }],
    ['清单里没我们这个包', async () => ({ ok: true, value: [{ name: 'other', rows: [] }] })],
  ]) {
    const scope = readyScope()
    const { mod } = loadClient({ scope })
    const { ctx, registrations } = fakeCtx({ scope, listBundles })
    mod.apply(ctx)
    const { injected, render } = cardRenderer(registrations)
    await injected.ensureBundleRows()
    const tabs = collect(render(), 'SegmentedControl')[0]
    assert.doesNotMatch(String(tabs.props.options[2].label), /\d/, `行数${name}时不得画出数字`)
    assert.equal(tabs.props.options[2].label, 'componentsTitle', `行数${name} ⇒ 退回只写标题`)
  }
})

test('capital-config Client：一次失败的读数会被下一次取数补上（失败不留痕）', async () => {
  const scope = readyScope()
  let serve = async () => ({ ok: false })
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope, listBundles: () => serve() })
  mod.apply(ctx)
  const { injected, render } = cardRenderer(registrations)
  await injected.ensureBundleRows()
  assert.doesNotMatch(String(collect(render(), 'SegmentedControl')[0].props.options[2].label), /\d/)
  serve = async () => bundlesWith(7)
  await injected.ensureBundleRows()
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[2].label, 'componentsTitle 7',
    '把一次抢跑失败缓存成永久"无数字"= 钉到进程结束')
})

test('capital-config Client：plugin-manager/changed 与 connection/reset 都会重取行数', async () => {
  const scope = readyScope()
  let rowCount = 4
  const { mod } = loadClient({ scope })
  const { ctx, registrations, remoteEvents, contextEvents, fire } = fakeCtx({ scope, listBundles: async () => bundlesWith(rowCount) })
  mod.apply(ctx)
  const { injected, render } = cardRenderer(registrations)
  assert.ok(remoteEvents.has('plugin-manager/changed'), '行增删的权威信号必须订阅')
  assert.ok(contextEvents.has('connection/reset'), '重连后也要重取（卡片单例活过页面来回）')

  await injected.ensureBundleRows()
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[2].label, 'componentsTitle 4')

  rowCount = 5
  fire('plugin-manager/changed', remoteEvents)
  await settle()
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[2].label, 'componentsTitle 5')

  rowCount = 3
  fire('connection/reset', contextEvents)
  await settle()
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[2].label, 'componentsTitle 3')
})

test('capital-config Client：密钥草稿还在时 tab 点名未保存（保存按钮此刻看不见）', () => {
  const scope = readyScope()
  const { mod, model } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[0].label, 'title')
  model.actions().edit('fuyao', 'sk-demo')
  assert.equal(collect(render(), 'SegmentedControl')[0].props.options[0].label, 'titleUnsaved')
})

test('capital-config Client：条目还没就绪时退回一根列，不写 tab 属性（宿主段落因此藏不掉）', () => {
  const scope = {
    getSnapshot: () => ({ status: 'loading', writable: false, value: {}, user: {}, base: {}, revision: 0 }),
    subscribe: () => () => {},
    mutate: async () => true,
  }
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const { render } = cardRenderer(registrations)
  const card = render()
  assert.deepEqual(collect(card, 'SegmentedControl'), [], '没有可编辑面时不画三格：那时"精选 Skills""包含的组件"都是空话')
  assert.equal(card.props['data-capital-config-tab'], undefined,
    '属性缺席是 fail-open 的开关：installStyles 那两条 :has() 认不出卡片 ⇒ 宿主的组件段照常可见')
})

// Collapse rule for the host components section: a reversed direction hides user rows silently, so mismatches fall on the visible side.
test('capital-config Client：宿主组件段的收起规则只认自家 tab，失配一律落在"照常可见"', () => {
  const scope = readyScope()
  const { mod, styles } = loadClient({ scope })
  const { ctx } = fakeCtx({ scope })
  mod.apply(ctx)
  const css = styles.map((node) => String(node.textContent)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const bundleName = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  const hideRules = Array.from(css.matchAll(/^[ \t]*\[data-plugin-detail="([^"]+)"\][^\n]*$/gm), (match) => match[0])
  assert.equal(hideRules.length, 2, '两条收起规则：数据源格与精选 Skills 格各一条，一条都不许多')
  for (const rule of hideRules) {
    assert.ok(rule.includes(`[data-plugin-detail="${bundleName}"]`),
      '规则必须限定在**我们这个包**的详情页里：插在别的包页面上 = 在别人的页面藏宿主的段落')
    assert.match(rule, /:has\(\.capital-config-card\[data-capital-config-tab="(?:sources|skills)"\]\)/,
      '只从**正面**认出"我们的卡片 + 这两个 tab"才动手')
    assert.match(rule, /section\[data-plugin-rows\]\s*\{\s*display: none/, '动的只有宿主那一格')
    assert.ok(!rule.includes(':not('), '否定式收起 = 一个拼错的属性值就把用户数据藏了起来')
  }
  assert.doesNotMatch(css, /:not\(\[data-capital-config-tab="components"\]\)/, '禁用否定式判据')
  assert.doesNotMatch(css, /^[ \t]*section\[data-plugin-rows\]\s*\{/m, '不存在"默认就藏起来"的裸规则')
  assert.doesNotMatch(css, /\[data-plugin-config\]\s*\+/, '不拿 data-plugin-config 当锚点：行详情页那格是 div，同名不同形')
  // Author display overrides [hidden]{display:none}, leaving invisible but tabbable controls.
  assert.doesNotMatch(css, /\.capital-config-panel\s*\{[^}]*display:/, '面板类自身不许声明 display')
  assert.match(css, /\.capital-config-panel:not\(\[hidden\]\)\s*\{\s*display: flex/, 'display 只在非 hidden 时声明')
  assert.match(css, /\.capital-config-panel\[hidden\]\s*\{\s*display: none/, 'hidden 一侧单独钉死')
})

test('capital-config Client：只隐藏两颗内部角色卡片，委派注册仍在宿主侧', () => {
  const scope = readyScope()
  const { mod, styles } = loadClient({ scope })
  const { ctx } = fakeCtx({ scope })
  mod.apply(ctx)
  const css = styles.map((node) => String(node.textContent)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const hiddenIds = Array.from(css.matchAll(/\[data-agent-preset-id="([^"]+)"\]/g), (match) => match[1])
  assert.deepEqual(hiddenIds, ['capital-data-junior', 'capital-visualization-specialist'],
    '只隐藏分析师与绘图专员；自动模式、行情专家、资讯专员必须仍可选')
  assert.match(css, /\[data-agent-preset-id="capital-data-junior"\][\s\S]{0,100}\[data-agent-preset-id="capital-visualization-specialist"\][\s\S]{0,100}\{\s*display:\s*none\s*!important/,
    '两张内部角色卡片都由同一条 display:none !important 收起')
})

test('capital-config Client：筛选器吸顶、三格首行等距，且不许冒出第二个滚动容器', () => {
  const scope = readyScope()
  const { mod, styles } = loadClient({ scope })
  const { ctx } = fakeCtx({ scope })
  mod.apply(ctx)
  const css = styles.map((node) => String(node.textContent)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (selector) => {
    const escaped = selector.replace(/[[\]"=]/g, (ch) => `\\${ch}`)
    const match = new RegExp(`^[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
    assert.ok(match, `样式表里没有 ${selector} 这条：布局纪律靠它，掉了就是页面自己变样`)
    return match[1]
  }
  assert.match(rule('.capital-config-selected-filter'), /position:\s*sticky/, '筛选器要随滚动钉在左边')
  assert.match(rule('.capital-config-selected-filter'), /top:/, 'sticky 没有 top 等于不吸顶')
  // Sticky references the nearest scroll container; overflow on either column breaks it silently.
  for (const selector of ['.capital-config-selected-layout', '.capital-config-selected-list']) {
    assert.doesNotMatch(rule(selector), /overflow:/, `${selector} 不许开第二个滚动容器：那会让 sticky 静默失效`)
  }
  assert.match(rule('.capital-config-field'), /padding:\s*12px\s+0/, '行的上内边距仍是一档 12px')
  assert.match(rule('.capital-config-selected-layout'), /padding-top:\s*12px/,
    '左列第一颗按钮要顶到 24px：面板只有一个子元素时 flex gap 不发生作用，不补这一档就是 12px')
  assert.match(rule('.capital-config-panel[data-capital-config-panel="components"]'), /margin-bottom:\s*-\d+px/,
    '第三格自己不留内容，靠这条把它的首行文字顶到与另两格等距（负数：宿主那段本来就离得远）')
  assert.match(rule('div.capital-config-skill-modal'), /width:\s*min\(\d{3,}px/, '详情对话框要宽过官方默认的 380px')
  assert.match(rule('div.capital-config-skill-modal'), /max-height:\s*100%/, '高度只封顶：.dialog 自己 overflow hidden')
  assert.ok(/^[ \t]*div\.capital-config-skill-modal\b/m.test(css),
    '宽度那条要挂在 div. 上：光一个类名与官方散列类同权重，靠"我们的样式后注入"赢是押注不是设计')
  assert.match(rule('.capital-config-skill-doc'), /overflow:\s*auto/, '原文在对话框里自己滚（一份有 34 KB）')
  assert.match(rule('.capital-config-skill-doc'), /max-height:/, '封顶的是正文那一块，标题与关闭按钮因此留在原位')
  // Only reference tokens the theme defines; an undefined var() falls back to inherited color.
  assert.doesNotMatch(css, /--dsw-alias-label-error/, '主题里不存在的 token 不许引用')
  assert.match(rule('.capital-config-skill-when'), /line-height:/, '触发句要有自己的行高，长句不挤在标题上')
  assert.match(rule('.capital-config-skill-role'), /border:/, '角色徽标要有边框，和标签区分开')
  assert.match(rule('.capital-config-write-failed'), /color:\s*var\(--dsw-alias-state-error-primary\)/,
    '写失败红字用 error-primary：同一个坏 token 的另一处，一并钉住')
  for (const retired of ['capital-config-skill-slug', 'capital-config-skill-copy', 'capital-config-selected-filter-label', 'capital-config-cap-hint', 'capital-config-selected-cap-count']) {
    assert.ok(!css.includes(`.${retired}`), `.${retired} 已经从渲染树上 retire 了，样式表里不许留死规则`)
  }
})

test('capital-config Client：回退开关即时写嵌套路径，写被拒不翻转且给出提示；只读存储不发写', async () => {
  const doc = { value: {} } // Missing section defaults to enabled.
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
  // ops come from the VM realm; normalize through JSON before deep comparing.
  assert.equal(JSON.stringify(writes), JSON.stringify([[{ op: 'set', path: ['retriever', 'localFetch', 'enabled'], value: false }]]),
    '嵌套字段只能走 mutate；set(field) 只支持顶层')
  assert.equal(store.getSnapshot().localFetch.on, false)
  assert.equal(store.getSnapshot().localFetch.failed, false)
  assert.equal(store.getSnapshot().dirty, false, '即时保存的开关不进草稿流（不影响密钥的保存）')

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

test('capital-config Client：auto 模式标自动、勾选只读，切换只写 selectedSkillsMode', async () => {
  const doc = { value: { selectedSkillsMode: 'auto', selectedSkills: { buffettFramework: false } } }
  const writes = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: doc.value, user: {}, base: {}, revision: 0 }),
    subscribe: () => () => {},
    mutate: async (ops) => {
      writes.push(ops)
      doc.value = { ...doc.value, selectedSkillsMode: ops[0].value }
      return true
    },
  }
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrationFor(registrations, 'plugins.bundle.config').declaration.inject()
  const store = injected.hooks.capitalCard
  assert.equal(store.getSnapshot().selectedSkillsMode.auto, true)

  const { render } = cardRenderer(registrations)
  const card = render()
  const [tabs] = collect(card, 'SegmentedControl')
  assert.equal(tabs.props.options[1].label, 'selectedSkillsTitle selectedSkillsModeShort',
    'auto 模式不按「已开启/总数」报数：勾选在这一模式下不参与过滤')
  const switches = collect(card, 'Switch')
  assert.equal(switches[1].props.checked, true, '模式开关必须反映 auto')
  assert.ok(switches.slice(2).every((node) => node.props.disabled === true),
    'auto 下逐颗勾选只读：拨了也不会生效，不能让它看起来可操作')
  assert.equal(collect(card, 'button')
    .filter((button) => String(button.props['aria-label']).startsWith('selectedSkillsCopyName')).length,
  SELECTED_SKILL_CATALOG.length, 'auto 下每个角色都能加载自己的方法，复制入口必须全开')

  await injected.toggleSelectedSkillsMode(false)
  assert.equal(JSON.stringify(writes), JSON.stringify([[{ op: 'set', path: ['selectedSkillsMode'], value: 'manual' }]]),
    '模式写顶层 volatile 路径，不污染 selectedSkills 的目录键')
  assert.equal(store.getSnapshot().selectedSkillsMode.auto, false)
})

test('capital-config Host：schema 默认值必须与主插件 Config 完全一致（两处 schema 不能漂移）', () => {
  assert.deepEqual(plainConfig(CapitalConfig({})), MainConfig({}))
  assert.deepEqual(MainConfig({}).selectedSkills, Object.fromEntries(SELECTED_SKILL_CATALOG.map(({ key }) => [key, false])), 'selected skill 默认必须全部关闭')
  assert.deepEqual(plainConfig(CapitalConfig({})).selectedSkills, MainConfig({}).selectedSkills,
    'Host 设置与主插件运行期的 selectedSkills 默认值必须一致')
  assert.equal(MainConfig({}).selectedSkillsMode, 'manual', '精选模式默认 manual：老配置升级后不改变行为')
  assert.equal(plainConfig(CapitalConfig({})).selectedSkillsMode, MainConfig({}).selectedSkillsMode,
    'Host 设置与主插件运行期的模式默认值必须一致')
})

test('capital-config Host：localFetch 默认值两处一致且消费点独立生效', () => {
  const capital = plainConfig(CapitalConfig({})).retriever.localFetch
  const main = MainConfig({}).retriever.localFetch
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

  // The consumer fills the same defaults independently; an explicit empty UA resolves to the plugin version.
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
  const manifest = JSON.parse(readFileSync(join(ROOT, 'config', 'package.json'), 'utf8'))
  // schemastery is a runtime import; .volatile() needs >= 3.18.4 or the row throws on import.
  assert.equal(manifest.dependencies?.['@deepseek-ai/schemastery'], '^3.18.4')
  assert.equal(manifest.exports?.['./client']?.default, './client.js')
  assert.ok(manifest.files.includes('client.js'), 'client.js 必须随包发布，否则 web profile 起不来')
  assert.ok(manifest.files.includes('index.js'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
  // dsh.client.inject lists module-table deps; an unknown name prevents bundle loading.
  const inject = manifest.dsh.client.inject ?? []
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'), 'plugins.bundle.config 槽主在该包里')
  assert.ok(inject.includes('@deepseek-ai/dsh-api-remotes'),
    'remote.pluginManager 的半边在 remotes 模块表里：缺它 inject 就是装配期报错，整个 web profile 起不来')
  assert.ok(!inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), '0.1.7 的插件页归 plugin-manager 所有')
})
