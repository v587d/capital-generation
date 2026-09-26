const { createElement: h } = require('react')
const {
  SettingsForm,
  SettingsSecretField,
  SettingsFormModel,
  Switch,
} = require('@deepseek-ai/dsh-client-ui-primitives')

/**
 * 本卡片读的**配置条目 id**。0.1.7 起 settings 命名空间就是 profile 条目 id，而 Plugins 页
 * 按 `<包名>#<行 id>` 寻址一行的配置页（`dsh-client-ui-plugin-manager` 的 `rowConfigKey`）。
 * 于是三处必须同字：`cordis.patch.yml` 的行 id、`capital-config/index.js` 的
 * `SETTINGS_ENTRY_ID`、这里的 `ENTRY_ID`——由 `test/capital-config.test.mjs` 逐一对齐。
 * 漂移的表现不是报错，而是**卡片静默消失**。
 */
const ENTRY_ID = 'capital-config'
const SLOT_KEY = '@v587d/capital-generation#capital-config'
/** 文案字典的命名空间（与配置条目 id 是两回事，按官方 settings 页的 `settings.*` 惯例）。 */
const LOCALE_NS = 'settings.capital'

const FUYAO_DEFAULT_REF = 'FUYAO_API_KEY'
const ANYSEARCH_DEFAULT_REF = 'ANYSEARCH_API_KEY'
const WIND_DEFAULT_REF = 'WIND_API_KEY'
const PADDLE_OCR_DEFAULT_REF = 'PADDLE_OCR_TOKEN'
const DOC_URLS = {
  fuyao: 'https://fuyao.aicubes.cn/docs/',
  anysearch: 'https://www.anysearch.com/docs/auth',
  wind: 'https://market.windalice.com/',
  paddleocr: 'https://aistudio.baidu.com/paddleocr',
}

/**
 * 密钥字段清单（渲染顺序 = 数组顺序）。读状态、寻 ref 名、写草稿、事件刷新都遍历这一份：
 * 加一个 Key 以前要在九处各补一遍，漏掉的那处不会报错，只会让用户填了却不生效。
 */
const CREDENTIAL_FIELDS = ['fuyao', 'anysearch', 'wind', 'paddleocr']
const DEFAULT_REFS = {
  fuyao: FUYAO_DEFAULT_REF,
  anysearch: ANYSEARCH_DEFAULT_REF,
  wind: WIND_DEFAULT_REF,
  paddleocr: PADDLE_OCR_DEFAULT_REF,
}
const freshStatus = () => Object.fromEntries(
  CREDENTIAL_FIELDS.map((field) => [field, { ref: DEFAULT_REFS[field], configured: false, writable: true }]),
)

const zh = {
  title: 'Capital 模式',
  description: '配置 Capital Generation 的服务提供商凭证。',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: '必填。同花顺 Fuyao 结构化数据接口。保存后新 Capital 会话生效。',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: '必填。AnySearch 网页搜索 / 提取接口。保存后新 Capital 会话生效。',
  localFetchLabel: '允许启动本地提取网页内容',
  localFetchHint: '开启后 AnySearch 抓取失败会自动改由本机直连抓取该页面（回执来源 local-http）；关闭则 AnySearch 失败即回传失败，且具名来源工具（财联社快讯 / 东财资讯等，均需本机直连）调用时返回"已被设置关闭"。改动即时保存，新 Capital 会话生效。',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind 金融信披类文档检索接口。保存后新 Capital 会话生效。',
  paddleocrLabel: 'PaddleOCR 文档解析 Token',
  paddleocrHint: '选填。Capital 的 ocr 工具用它把 PDF 研报 / 公告解析成正文，在 AIStudio 申请。密钥只存在凭证域，不写进会话配置；作业按整篇计费，保存后新 Capital 会话生效。',
  openDocs: '接口文档',
  configured: '已配置密钥。',
  notConfigured: '未配置密钥。',
  save: '保存',
  saving: '保存中…',
  readOnly: '本部署的设置为只读。',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  unavailable: '该插件当前未加载，暂时无法配置。',
}

const en = {
  title: 'Capital mode',
  description: 'Configure Capital Generation service provider credentials.',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: 'Required. Tonghuashun Fuyao structured-data API. Takes effect in new Capital sessions.',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'Required. AnySearch web search / extract interface. Takes effect in new Capital sessions.',
  localFetchLabel: 'Allow local web page extraction',
  localFetchHint: 'When on, an AnySearch fetch failure falls back to direct local fetching (receipt via: local-http); when off, failures are returned as-is and the named-source tools (e.g. cls_telegraph, eastmoney_724 — all local HTTP) fail with "disabled by settings". Changes save immediately and take effect in new Capital sessions.',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind financial disclosure document retrieval interface. Takes effect in new Capital sessions.',
  paddleocrLabel: 'PaddleOCR document token',
  paddleocrHint: 'Optional. The Capital ocr tool uses it to turn PDF research reports / announcements into body text; apply at AIStudio. The secret lives only in the credentials domain, never in session config. Jobs are billed per whole document; takes effect in new Capital sessions.',
  openDocs: 'API documentation',
  configured: 'A key is configured.',
  notConfigured: 'No key is configured.',
  save: 'Save',
  saving: 'Saving…',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
}

function text(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function refOf(snapshot, field) {
  if (field === 'fuyao') return text(snapshot.value?.fuyaoCredentialRef, DEFAULT_REFS.fuyao)
  if (field === 'wind') return text(snapshot.value?.retriever?.windDocs?.credentialRef, DEFAULT_REFS.wind)
  if (field === 'paddleocr') return text(snapshot.value?.retriever?.paddleOcr?.credentialRef, DEFAULT_REFS.paddleocr)
  return text(snapshot.value?.retriever?.credentialRef, DEFAULT_REFS.anysearch)
}

function installStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-capital-config]')) return () => {}
  const style = document.createElement('style')
  style.dataset.capitalConfig = 'true'
  style.textContent = `
    .capital-config-secret-row { display: flex; flex-direction: column; gap: 2px; }
    .capital-config-field { padding: 2px 0; }
    .capital-config-doc-link { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-decoration: none; }
    .capital-config-doc-link:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
    .capital-config-doc-link:focus-visible { border-radius: 3px; outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    .capital-config-switch-row { align-items: center; gap: 12px; display: flex; }
    .capital-config-switch-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .capital-config-switch-label { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
    .capital-config-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .capital-config-write-failed { margin: 0; color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

class CapitalCardController {
  /**
   * @param {object} scope - `ctx.configForms.get(ENTRY_ID)`：本条目的表单与写队列。
   * @param {object} ctx - 浏览器半边上下文，`remote.credentials` 替引用名回答密钥状态。
   */
  constructor(scope, ctx) {
    this.scope = scope
    this.ctx = ctx
    this.status = freshStatus()
    this.localFetchWriting = false
    this.localFetchFailed = false
    // 四个密钥控件都在配置段之外落盘（write-only，值从不随响应出网），所以 specs 为空：
    // 本卡片不编辑任何普通字段，唯一的配置写入是下面那个即时保存的回退开关。
    this.model = new SettingsFormModel(scope, [], CREDENTIAL_FIELDS.map((field) => ({
      field,
      write: (value) => this.writeKey(field, value),
    })))
    this.store = this.model.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      this.refreshRefs()
      this.store.set(this.projection())
      this.readCredentials()
    })
    this.refreshRefs()
    this.readCredentials()
  }

  dispose() {
    this.unsubscribe?.()
    this.model.dispose()
  }

  projection() {
    const snapshot = this.scope.getSnapshot()
    return {
      ...this.model.shell(),
      ...Object.fromEntries(CREDENTIAL_FIELDS.map((field) => [field, {
        ...this.model.field(field),
        configured: this.status[field].configured,
        writable: this.status[field].writable,
      }])),
      // 本机直连回退开关：严格渲染自条目配置（schema 解析后带默认值）。
      // `!== false` 与主插件消费点 resolveLocalFetchConfig 的默认语义逐字一致（默认开）。
      localFetch: {
        on: snapshot.value?.retriever?.localFetch?.enabled !== false,
        writing: this.localFetchWriting,
        failed: this.localFetchFailed,
      },
    }
  }

  /** 引用名可以被改配置（`fuyaoCredentialRef` 等）换掉：换了名就当没配过，草稿一并清掉。 */
  refreshRefs() {
    const snapshot = this.scope.getSnapshot()
    for (const field of CREDENTIAL_FIELDS) {
      const next = refOf(snapshot, field)
      if (this.status[field].ref !== next) {
        this.status[field] = { ref: next, configured: false, writable: true }
        this.model.edit(field, '')
      }
    }
  }

  async readCredentials() {
    const refs = CREDENTIAL_FIELDS.map((field) => this.status[field].ref)
    try {
      const response = await this.ctx.remote.credentials.describe(refs)
      if (!response?.ok) return
      // 读回来后清单已变（配置事件改了 ref 名）：这批响应不再对应当前字段，丢掉。
      if (CREDENTIAL_FIELDS.some((field, index) => refs[index] !== this.status[field].ref)) return
      const values = response.value ?? {}
      for (const field of CREDENTIAL_FIELDS) {
        const current = this.status[field]
        const view = values[current.ref]
        if (view === undefined) continue
        this.status[field] = {
          ref: current.ref,
          configured: view.configured === true,
          writable: view.writable !== false,
        }
      }
      this.store.set(this.projection())
    } catch {
      // 卡片仍可用：下一次凭证事件会重读。
    }
  }

  refresh(ref) {
    if (CREDENTIAL_FIELDS.some((field) => ref === this.status[field].ref)) this.readCredentials()
  }

  /** 保存流里写一个密钥：写进 credentials 域，随后按主机是否报"已配置"决定成败。 */
  async writeKey(field, value) {
    try {
      await this.ctx.remote.credentials.set(this.status[field].ref, value.trim())
      await this.readCredentials()
      return this.status[field].configured === true
    } catch {
      return false
    }
  }

  /**
   * 本机直连回退开关：点即保存，不走上面的 Save 流。
   *
   * - 即时写的是**条目配置**（不是密钥）：配置写入是原子的、带 revision 围栏的持久操作，
   *   不需要草稿仪式；`isVolatilePath` 只放行 schema 里标了 `.volatile()` 的路径。
   * - 嵌套路径必须走 `mutate([{ op: 'set', path: [...] }])`：`set(field)` 只支持顶层字段。
   * - 开关严格由条目快照渲染：写被拒（revision 冲突等）时快照不变、开关不翻转
   *   （`mutate` 拒绝不抛错，只做恢复读），因此这里不预判结果，只把"没落上"记成
   *   `localFetch.failed`，用 Switch 的 title 说出原因。
   */
  async toggleLocalFetch(value) {
    if (this.localFetchWriting) return
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    this.localFetchWriting = true
    this.localFetchFailed = false
    this.store.set(this.projection())
    try {
      await this.scope.mutate([{ op: 'set', path: ['retriever', 'localFetch', 'enabled'], value }])
    } catch {
      // 写请求本身失败：交给下面的落盘校验，不打断流程。
    }
    this.localFetchWriting = false
    const landed = this.scope.getSnapshot().value?.retriever?.localFetch?.enabled === value
    if (!landed) this.localFetchFailed = true
    this.store.set(this.projection())
  }

  inject() {
    return {
      hooks: {
        capitalCard: this.store,
      },
      ...this.model.actions(),
      toggleLocalFetch: (value) => this.toggleLocalFetch(value),
    }
  }
}

/**
 * 密钥行 = 官方 `SettingsSecretField`（它自己管"已配置/未配置"与留空不改写）
 * ＋ 一个接口文档链接。0.1.7 的 primitives 删掉了外链图标，所以链接是纯文字。
 */
function SecretRow({ field, label, hint, docsUrl, state, disabled, onEdit, t }) {
  return h('div', { className: 'capital-config-secret-row', key: field },
    h(SettingsSecretField, {
      id: `capital-config-${field}-key`,
      label,
      hint,
      text: state.text,
      configured: state.configured,
      stateLabel: state.configured ? t('configured') : t('notConfigured'),
      disabled,
      onEdit,
    }),
    h('a', {
      href: docsUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'capital-config-doc-link',
    }, `${label}: ${t('openDocs')}`),
  )
}

function CapitalCard(props) {
  const t = props.t
  const state = props.useCapitalCard((snapshot) => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return h(SettingsForm, {
    labels: {
      unavailable: t('unavailable'),
      readOnly: t('readOnly'),
      saveFailed: t('saveFailed'),
      save: t('save'),
      saving: t('saving'),
    },
    state,
    onSave: props.save,
    onDiscard: props.discard,
  },
    h(SecretRow, { field: 'fuyao', label: t('fuyaoLabel'), hint: t('fuyaoHint'), docsUrl: DOC_URLS.fuyao, state: state.fuyao, disabled: disabled || state.saving || !state.fuyao.writable, onEdit: (value) => props.edit('fuyao', value), t }),
    h(SecretRow, { field: 'anysearch', label: t('anysearchLabel'), hint: t('anysearchHint'), docsUrl: DOC_URLS.anysearch, state: state.anysearch, disabled: disabled || state.saving || !state.anysearch.writable, onEdit: (value) => props.edit('anysearch', value), t }),
    h('div', { className: 'capital-config-field' },
      h('div', { className: 'capital-config-switch-row' },
        h('div', { className: 'capital-config-switch-text' },
          h('span', { className: 'capital-config-switch-label' }, t('localFetchLabel')),
          h('p', { className: 'capital-config-hint' }, t('localFetchHint')),
        ),
        h(Switch, {
          label: t('localFetchLabel'),
          checked: state.localFetch?.on !== false,
          disabled: disabled || state.saving || state.localFetch?.writing === true,
          onChange: props.toggleLocalFetch,
        }),
      ),
      // 被拒的即时写不留草稿、也不进表单的 failed（那是保存流的），所以自己说一句：
      // 开关没翻转就是事实，但用户需要知道"点了、没落上"而不是以为点错了。
      state.localFetch?.failed ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed')) : null,
    ),
    h(SecretRow, { field: 'wind', label: t('windLabel'), hint: t('windHint'), docsUrl: DOC_URLS.wind, state: state.wind, disabled: disabled || state.saving || !state.wind.writable, onEdit: (value) => props.edit('wind', value), t }),
    h(SecretRow, { field: 'paddleocr', label: t('paddleocrLabel'), hint: t('paddleocrHint'), docsUrl: DOC_URLS.paddleocr, state: state.paddleocr, disabled: disabled || state.saving || !state.paddleocr.writable, onEdit: (value) => props.edit('paddleocr', value), t }),
  )
}

function apply(ctx) {
  ctx.effect(installStyles, 'capital-config: styles')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'capital-config: dictionaries')
  const card = new CapitalCardController(ctx.configForms.get(ENTRY_ID), ctx)
  ctx.effect(() => () => card.dispose(), 'capital-config: form subscription')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => card.refresh(ref)), 'capital-config: credential invalidations')
  // 只有 Host 真的在服务这个条目时才注册卡片：没装配 capital-config 的部署里不留痕迹。
  ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: SLOT_KEY,
    locale: LOCALE_NS,
    inject: () => card.inject(),
  }, CapitalCard))), 'capital-config: page')
  ctx.logger?.info?.('capital-config: settings card mounted')
}

exports.name = 'capital-config'
exports.inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
exports.apply = apply
