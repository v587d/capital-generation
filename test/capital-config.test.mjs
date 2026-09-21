import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { apply, Config as CapitalConfig, SETTINGS_NAMESPACE } from '../capital-config/index.js'
import { Config as MainConfig } from '../lib/index.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'capital-config', 'client.js')

function hostCtx(settings) {
  const injected = []
  const logs = []
  const ctx = {
    get(name) {
      if (name === 'settings') return settings
      return undefined
    },
    inject(deps, callback) {
      injected.push({ deps, callback })
    },
    logger: { info(message) { logs.push(message) } },
  }
  return { ctx, injected, logs }
}

test('capital-config Host：注册 capital-generation settings 命名空间并声明 restart 语义', () => {
  const registrations = []
  const settings = {
    register(ns, schema, options) {
      registrations.push({ ns, schema, options })
      return {}
    },
  }
  const { ctx, logs } = hostCtx(settings)
  apply(ctx, {
    fuyaoCredentialRef: 'CUSTOM_FUYAO',
    retriever: { credentialRef: 'CUSTOM_ANYSEARCH', windDocs: { credentialRef: 'CUSTOM_WIND' } },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].ns, SETTINGS_NAMESPACE)
  assert.equal(registrations[0].options.applies, 'restart')
  assert.equal(registrations[0].options.base.fuyaoCredentialRef, 'CUSTOM_FUYAO')
  assert.equal(registrations[0].options.base.retriever.credentialRef, 'CUSTOM_ANYSEARCH')
  assert.equal(registrations[0].options.base.retriever.windDocs.credentialRef, 'CUSTOM_WIND')
  assert.ok(logs.some((message) => message.includes('settings namespace registered')))
})

test('capital-config Host：settings 缺席时等待 settings 服务，不在 preset fiber 注册全局命名空间', () => {
  const { ctx, injected } = hostCtx(undefined)
  apply(ctx, {})
  assert.deepEqual(injected.map((item) => item.deps), [['settings']])
})

function loadClient() {
  let entry
  const sandbox = { window: { __ModuleLoader__: { load(value) { entry = value } } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), sandbox)
  assert.ok(entry)
  return entry.factory((name) => {
    if (name === 'react') return {
      createElement(type, props, ...children) { return { type, props, children } },
      useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
      useEffect() {},
      useRef(initial) { return { current: initial } },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
      Tag(props, ...children) { return { type: 'Tag', props, children } },
      IconChevronDownOutline14(props) { return { type: 'IconChevronDownOutline14', props, children: [] } },
      IconRightUpOutline16(props) { return { type: 'IconRightUpOutline16', props, children: [] } },
    }
    if (name === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore(initial) {
        let value = initial
        const listeners = new Set()
        return {
          getSnapshot: () => value,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
          set(next) { value = next; for (const listener of listeners) listener() },
        }
      },
    }
    throw new Error(`unexpected client dependency: ${name}`)
  })
}

test('capital-config Client：bundle 注册到 settings.plugin.item 且使用 shell React/client-store', () => {
  const mod = loadClient()
  assert.equal(mod.name, 'capital-config')
  assert.deepEqual([...mod.inject], ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope'])

  const registrations = []
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({ status: 'ready', writable: true, value: {}, user: {}, base: {}, revision: 0 }),
        subscribe: () => () => {},
      }),
    },
    remote: {
      credentials: {
        describe: async () => ({ ok: true, value: {} }),
        set: async () => {},
      },
      $on: () => () => {},
    },
    effect(callback) { return callback() || (() => {}) },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.plugin.item')
        callback()
      },
      register(declaration, component) {
        registrations.push({ declaration, component })
        return () => {}
      },
    },
    logger: { info() {} },
  }
  mod.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].declaration.name, 'settings.plugin.item')
  assert.equal(registrations[0].declaration.key, SETTINGS_NAMESPACE)
  assert.equal(typeof registrations[0].component, 'function')
  const injected = registrations[0].declaration.inject()
  const store = injected.hooks.capitalCard
  assert.equal(store.getSnapshot(), store.getSnapshot(), '卡片 snapshot 必须在无更新时保持同一引用')
  const rendered = registrations[0].component({
    t: (key) => key,
    useCapitalCard: (selector) => selector({
      available: true,
      writable: true,
      saving: false,
      failed: false,
      dirty: false,
      fuyao: { ref: 'FUYAO_API_KEY', configured: false, draft: '' },
      anysearch: { ref: 'ANYSEARCH_API_KEY', configured: false, draft: '' },
       wind: { ref: 'WIND_API_KEY', configured: false, draft: '' },
    }),
    edit() {},
    save() {},
    discard() {},
  })
  assert.ok(rendered, 'Settings slot 应能实际渲染 CapitalCard')
})

test('capital-config Host：schema 默认值必须与主插件 Config 完全一致（两处 schema 不能漂移）', () => {
  // 主插件用 settings 解析值覆盖自身配置，再用自己的 Config 校验。两处 schema 一旦
  // 漂移，字段会在 settings→主插件 边界被静默改写/丢弃。默认值是最低限度的同步契约。
  assert.deepEqual(CapitalConfig({}), MainConfig({}))
})

test('capital-config 包清单：声明运行期 schemastery 依赖，且客户端 bundle 会随包发布', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'capital-config', 'package.json'), 'utf8'))
  // index.js 顶部 `import z from '@deepseek-ai/schemastery'` 是运行期外部导入，必须声明。
  assert.equal(manifest.dependencies?.['@deepseek-ai/schemastery'], '^3.18.2')
  // 声明了 dsh.client 就必须有 exports["./client"]，且 bundle 出现在 files 里（L2 闸门同口径）。
  assert.equal(manifest.exports?.['./client']?.default, './client.js')
  assert.ok(manifest.files.includes('client.js'), 'client.js 必须随包发布，否则 web profile 起不来')
  assert.ok(manifest.files.includes('index.js'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
})
