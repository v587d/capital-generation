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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'capital-config', 'client.js')
const CLIENT_SRC = join(ROOT, 'capital-config', 'client.src.cjs')

/**
 * 0.1.7 的 settings 面里**条目 id 就是命名空间**：host 半边不再有 `settings.register`，
 * 可编辑面是条目 Config 的 `.volatile()` 投影；浏览器半边按 `configForms.get(条目 id)` 读写；
 * Plugins 页按 `<包名>#<行 id>` 寻一行的配置页（`rowConfigKey`）。于是四处字符串必须逐字相同，
 * 而漂移的表现是**卡片静默消失、零报错**（issue #3 那一族）。这里把四处钉在一起。
 */
test('条目 id 四处一致：patch 行 id ≡ host ≡ 主插件 ≡ 浏览器半边（槽 key = `<包名>#<行 id>`）', () => {
  const patch = yamlLoad(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, ''))
  const row = patch.flatMap((entry) => entry?.insert ?? []).find((item) => item?.name === './capital-config/index.js')
  assert.ok(row, 'cordis.patch.yml 必须有 capital-config 这颗 host 平面行')
  assert.equal(row.id, SETTINGS_ENTRY_ID, 'settings 命名空间就是 profile 条目 id：行 id 必须等于 SETTINGS_ENTRY_ID')
  assert.equal(SETTINGS_ENTRY_ID, CAPITAL_CONFIG_ENTRY_ID, '主插件读配置用的条目 id 必须与 host 半边一致')

  const source = readFileSync(CLIENT_SRC, 'utf8')
  const entryId = source.match(/^const ENTRY_ID = '([^']+)'/m)?.[1]
  const slotKey = source.match(/^const SLOT_KEY = '([^']+)'/m)?.[1]
  assert.equal(entryId, SETTINGS_ENTRY_ID, '浏览器半边读的条目 id 必须与 host 一致（漂移 = 卡片静默消失）')
  const bundle = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  assert.equal(slotKey, `${bundle}#${SETTINGS_ENTRY_ID}`, 'plugins.row.config 的 key 必须是 `<包名>#<行 id>`')
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
  const sandbox = { window: { __ModuleLoader__: { load(value) { entry = value } } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), sandbox)
  assert.ok(entry)
  const model = fakeModel(scope)
  return {
    model,
    mod: entry.factory((name) => {
      if (name === 'react') return {
        // 测试里把函数组件就地展开成它自己返回的节点：渲染顺序与字段 id 要从**渲染树**上读，
        // 而不是从源码字符串量（ ids 现在是模板字面量，源码匹配不到）。
        createElement(type, props, ...children) {
          const kids = children.flat(Infinity).filter(Boolean)
          if (typeof type === 'function') return type({ ...props, children: kids })
          return { type, props: { ...props, children: kids }, children: kids }
        },
      }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
        SettingsForm(props) { return { type: 'SettingsForm', props, children: props.children ?? [] } },
        SettingsSecretField(props) { return { type: 'SettingsSecretField', props, children: props.children ?? [] } },
        Switch(props) { return { type: 'Switch', props, children: props.children ?? [] } },
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
  const ctx = {
    locale: { bind: (ns) => (key) => `${ns}.${key}`, register: () => () => {} },
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
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        callback()
      },
      register(declaration, component) {
        registrations.push({ declaration, component })
        return () => {}
      },
    },
    logger: { info() {} },
  }
  return { ctx, registrations, servedCalls, writes }
}

const readyScope = (value = {}) => ({
  getSnapshot: () => ({ status: 'ready', writable: true, value, user: {}, base: {}, revision: 0 }),
  subscribe: () => () => {},
  mutate: async () => true,
})

test('capital-config Client：只依赖 slots/locale/remote/configForms，注册进 plugins.row.config 且用 shell React', () => {
  const scope = readyScope()
  const { mod, model } = loadClient({ scope })
  assert.equal(mod.name, 'capital-config')
  assert.deepEqual([...mod.inject], ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
    '0.1.7 的卡片不再注入 settingsScope；多了少了都要先对齐上游契约（账本 L15）')

  const { ctx, registrations, servedCalls } = fakeCtx({ scope })
  mod.apply(ctx)
  assert.deepEqual(servedCalls, [[SETTINGS_ENTRY_ID]], '必须经 whileServed 门控：Host 不服务该条目时不留痕迹')
  assert.equal(registrations.length, 1)
  const { declaration, component } = registrations[0]
  assert.equal(declaration.name, 'plugins.row.config')
  assert.equal(declaration.key, `@v587d/capital-generation#${SETTINGS_ENTRY_ID}`)
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

test('capital-config Client：summary 出一句话；page 渲染四个密钥行，回退开关夹在 AnySearch 与 Wind 之间', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope })
  mod.apply(ctx)
  const injected = registrations[0].declaration.inject()
  const Card = registrations[0].component
  const props = {
    t: (key) => String(key),
    useCapitalCard: (selector) => selector(injected.hooks.capitalCard.getSnapshot()),
    edit: injected.edit,
    resetField: injected.resetField,
    save: injected.save,
    discard: injected.discard,
    toggleLocalFetch: injected.toggleLocalFetch,
  }
  assert.equal(Card({ ...props, view: 'summary' }), 'description', 'summary 视图就是行的一句话说明')

  const page = Card({ ...props, view: 'page' })
  assert.equal(page.type, 'SettingsForm', 'page 视图必须走官方表单框（自带只读提示与保存控件）')
  const secrets = collect(page, 'SettingsSecretField').map((node) => node.props.id)
  assert.deepEqual(secrets, [
    'capital-config-fuyao-key',
    'capital-config-anysearch-key',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
  ], '四个密钥行的顺序与 CREDENTIAL_FIELDS 一致')
  const switches = collect(page, 'Switch')
  assert.equal(switches.length, 1, '只有一颗回退开关')
  assert.equal(switches[0].props.checked, true, '段缺省 ⇒ 默认开（与两处 schema 的 enabled:true 同语义）')
  // 顺序：AnySearch 密钥 → 开关 → Wind 密钥（需求指定的位置，按渲染树而不是按源码字符串量）。
  const order = []
  const walk = (node) => {
    if (node?.type === 'SettingsSecretField') order.push(node.props.id)
    if (node?.type === 'Switch') order.push('switch')
    for (const child of node?.children ?? []) walk(child)
  }
  walk(page)
  assert.deepEqual(order, [
    'capital-config-fuyao-key',
    'capital-config-anysearch-key',
    'switch',
    'capital-config-wind-key',
    'capital-config-paddleocr-key',
  ])
})

test('capital-config Client：Host 不服务该条目时不注册卡片', () => {
  const scope = readyScope()
  const { mod } = loadClient({ scope })
  const { ctx, registrations } = fakeCtx({ scope, served: false })
  mod.apply(ctx)
  assert.equal(registrations.length, 0, 'whileServed 没放行就不许出现卡片（部署没装配本行 ⇒ 页面上不留痕迹）')
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
  const injected = registrations[0].declaration.inject()
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
  const page = registrations[0].component({
    t: (key) => String(key),
    view: 'page',
    useCapitalCard: (selector) => selector(store.getSnapshot()),
    edit: injected.edit, save: injected.save, discard: injected.discard, resetField: injected.resetField,
    toggleLocalFetch: injected.toggleLocalFetch,
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

test('capital-config Host：schema 默认值必须与主插件 Config 完全一致（两处 schema 不能漂移）', () => {
  // 主插件用条目配置覆盖自身配置，再用自己的 Config 校验。两处 schema 一旦
  // 漂移，字段会在 条目→主插件 边界被静默改写/丢弃。默认值是最低限度的同步契约。
  // 摊平走的是 Host 自己那道 plainConfig：卡片与主插件看到的都是摊平后的值。
  assert.deepEqual(plainConfig(CapitalConfig({})), MainConfig({}))
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
  assert.ok(inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'), 'plugins.row.config 槽主在该包里')
  assert.ok(!inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), '0.1.7 的插件页归 plugin-manager 所有')
})
