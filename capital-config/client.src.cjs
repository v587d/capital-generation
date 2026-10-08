const { createElement: h, useEffect, useRef, useState } = require('react')
const { createPortal } = require('react-dom')
const {
  SettingsForm,
  SettingsSecretField,
  SettingsFormModel,
  Switch,
  IconRightUpOutlineRegular,
} = require('@deepseek-ai/dsh-client-ui-primitives')

/**
 * 卡片读的是**配置条目 id**，坐的是**组合包自己的页面**——两个不同的字符串，各自钉在不同地方：
 *
 *  - `ENTRY_ID` 是 settings 命名空间（0.1.7 起命名空间恒等于 profile 条目 id），四处必须同字：
 *    `cordis.patch.yml` 的行 id、`capital-config/index.js` 的 `SETTINGS_ENTRY_ID`、主插件
 *    `src/index.ts` 的 `CAPITAL_CONFIG_ENTRY_ID`、这里。
 *  - `BUNDLE_NAME` 是槽 `plugins.bundle.config` 的 key：页面按**组合包的包名**取该包的配置段
 *    （`renderSlot(..., { entryKey: pkg.name })`），所以它必须逐字等于根 `package.json` 的 `name`。
 *
 * 漂移的表现都不是报错，而是**卡片静默消失**；两处对齐由 `test/capital-config.test.mjs` 钉住。
 *
 * 为什么不用行级槽 `plugins.row.config`（key `<包名>#<行 id>`）：那把座位在「包含的组件」里再往
 * 下一层，填密钥要点三下；且同包的 `capital-charts` / `preset-capital-generation` 没有表单，
 * 点进去是死路。配置是「这个插件」的属性，组合包层才是它该坐的层。
 */
const ENTRY_ID = 'capital-config'
const BUNDLE_NAME = '@v587d/capital-generation'
/** 文案字典的命名空间（与配置条目 id 是两回事，按官方 settings 页的 `settings.*` 惯例）。 */
const LOCALE_NS = 'settings.capital'

/**
 * 详情页标题旁那两枚外链坐的是槽 `plugins.detail.badge`（list，`scope: root`）：页面把它渲染在
 * `.titleRow` 里**官方自己画的版本 / beta / 问题标签之后**，正是标题右侧那一格。座位是 list，
 * 注册必须带 `id`（同 id 二次注册直接抛错），且组件收到的是 owner props `subject`——
 * 同一格在**行详情页**与**官方插件页**也会渲染，所以 `subject.kind` 与包名两道都要过，
 * 否则会在别人的页面上挂自己的链接。
 *
 * 两个地址的真值各只有一处：`REPO_URL` 逐字等于根 `package.json` 的 `repository.url`（去掉
 * `git+` 前缀与 `.git` 后缀），`NPM_URL` 由 `BUNDLE_NAME` 拼出。两条同字链由
 * `test/capital-config.test.mjs` 钉住。
 */
const BADGE_SLOT = 'plugins.detail.badge'
const REPO_URL = 'https://github.com/v587d/capital-generation'
const NPM_URL = `https://www.npmjs.com/package/${BUNDLE_NAME}`

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
  title: '配置',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: '同花顺 Fuyao 结构化数据接口。保存后新 Capital 模式会话生效。',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'AnySearch 网页搜索 / 提取接口。保存后新 Capital 模式会话生效。',
  localFetchLabel: '允许启动本地提取网页内容',
  localFetchHint: '开启后本地抓取兜底（回执来源 local-http）。保存后新 Capital 模式会话生效。',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind 金融信披类文档检索接口。保存后新 Capital 模式会话生效。',
  paddleocrLabel: 'PaddleOCR 文档解析 Token',
  paddleocrHint: '配置 Token 后自动解析 PDF、图片。保存后新 Capital 模式会话生效。',
  openDocs: '官方文档',
  configured: '已配置密钥。',
  notConfigured: '未配置密钥。',
  save: '保存',
  saving: '保存中…',
  readOnly: '本部署的设置为只读。',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  githubLabel: 'GitHub 仓库',
  npmLabel: 'npm 包页面',
}

const en = {
  title: 'Configuration',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: 'Tonghuashun Fuyao structured-data API. Takes effect in new Capital mode sessions.',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'AnySearch web search / extract interface. Takes effect in new Capital mode sessions.',
  localFetchLabel: 'Allow local web page extraction',
  localFetchHint: 'When on, a failed fetch falls back to local direct fetching (receipt via: local-http). Takes effect in new Capital mode sessions.',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind financial disclosure document retrieval interface. Takes effect in new Capital mode sessions.',
  paddleocrLabel: 'PaddleOCR document token',
  paddleocrHint: 'Configure the token to parse PDFs and images automatically. Takes effect in new Capital mode sessions.',
  openDocs: 'Official docs',
  configured: 'A key is configured.',
  notConfigured: 'No key is configured.',
  save: 'Save',
  saving: 'Saving…',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  githubLabel: 'GitHub repository',
  npmLabel: 'npm package page',
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
    .capital-config-card { display: flex; flex-direction: column; gap: 12px; }
    .capital-config-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; }
    .capital-config-secret-row { display: flex; flex-direction: column; gap: 2px; }
    /* 文档链接 portal 进官方 head 行之后靠这两条摆位：官方 label 是 flex:1（会吃掉整行），
       收成 0 1 auto 才让链接紧贴其右；配置徽标拿 order + margin-left:auto 留在行尾。 */
    .capital-config-secret-row label { flex: 0 1 auto; }
    .capital-config-secret-row label ~ span { order: 1; margin-left: auto; }
    .capital-config-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
    .capital-config-doc-link { display: inline-flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; white-space: nowrap; text-decoration: none; }
    .capital-config-doc-link:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
    .capital-config-doc-link:focus-visible { border-radius: 3px; outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    .capital-config-switch-row { align-items: center; gap: 12px; display: flex; }
    .capital-config-switch-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .capital-config-switch-label { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
    .capital-config-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .capital-config-write-failed { margin: 0; color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
    /* 标题右侧的两枚外链：官方那一格是 flex-wrap + gap:8px，整组自己收成一个 inline-flex 项，
       免得标题变长时被换行拆成两截。颜色只走 --dsw-* 变量，明暗两套都跟着宿主。 */
    .capital-config-plugin-links { flex: none; align-items: center; gap: 2px; display: inline-flex; }
    .capital-config-plugin-link { border-radius: var(--dsw-radius-sm); width: 24px; height: 24px; color: var(--dsw-alias-label-tertiary); justify-content: center; align-items: center; display: inline-flex; text-decoration: none; }
    .capital-config-plugin-link:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .capital-config-plugin-link:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
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
 * 密钥行 = 官方 `SettingsSecretField`（它自己管"已配置/未配置"与留空不改写）＋ 一个官方文档链接。
 *
 * 链接要落在**标签右边同一行**，而 `SettingsSecretField` 的 `label` 只收字符串（塞不进节点），
 * 所以挂载后找到官方 head 行（`label` 的父节点）把链接 `createPortal` 进去，摆位见 installStyles
 * 那两条选择器。head 行是 React 拥有的节点，portal 由 React 负责插拔，不手工 appendChild。
 * 找不到 head（上游改了 DOM 形状）就退回渲染在本行末尾——位置退化了，但链接不消失。
 */
function SecretRow({ field, label, hint, docsUrl, state, disabled, onEdit, t }) {
  const rowRef = useRef(null)
  const [head, setHead] = useState(null)
  useEffect(() => {
    const row = rowRef.current
    const labelEl = row ? row.querySelector('label') : null
    if (labelEl && labelEl.parentElement) setHead(labelEl.parentElement)
  }, [])
  const link = h('a', {
    href: docsUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': `${label} ${t('openDocs')}`,
    'data-capital-config-doc': 'true',
    className: 'capital-config-doc-link',
  }, t('openDocs'), h(IconRightUpOutlineRegular, { size: 12 }))
  return h('div', { className: 'capital-config-secret-row', key: field, ref: rowRef },
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
    head ? createPortal(link, head) : link,
  )
}

/**
 * 组合包页面的配置段：页面只提供 `<section data-plugin-config>` 的容器与间距，小节标题由卡片
 * 自己画（与页面自绘的「包含的组件」同一字号层级）。`plugins.bundle.config` 只以 `view: 'page'`
 * 渲染，没有 summary 一说。
 */
function CapitalCard(props) {
  const t = props.t
  const state = props.useCapitalCard((snapshot) => snapshot)
  const disabled = !state.writable
  const form = h(SettingsForm, {
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
    h(SecretRow, { field: 'wind', label: t('windLabel'), hint: t('windHint'), docsUrl: DOC_URLS.wind, state: state.wind, disabled: disabled || state.saving || !state.wind.writable, onEdit: (value) => props.edit('wind', value), t }),
    h(SecretRow, { field: 'paddleocr', label: t('paddleocrLabel'), hint: t('paddleocrHint'), docsUrl: DOC_URLS.paddleocr, state: state.paddleocr, disabled: disabled || state.saving || !state.paddleocr.writable, onEdit: (value) => props.edit('paddleocr', value), t }),
    // 回退开关排在四个密钥之后：它不是密钥，夹在密钥行中间会被读成第五个 Key。
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
  )
  return h('div', { className: 'capital-config-card' },
    h('h4', { className: 'capital-config-title' }, t('title')),
    form,
  )
}

/**
 * 官方 primitives 的图标表里没有 GitHub / npm 字形（整表核过），所以两枚图标自带 path 数据，
 * 取 simple-icons（CC0）。`fill="currentColor"` + 外层 `color: var(--dsw-*)` ⇒ 明暗两套都跟
 * 宿主，功能 CSS 不写主题选择器。
 */
const GLYPHS = {
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  npm: 'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z',
}

function PluginLink({ kind, href, label }) {
  return h('a', {
    className: 'capital-config-plugin-link',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': label,
    title: label,
    'data-capital-plugin-link': kind,
  }, h('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'currentColor',
    'aria-hidden': 'true',
    focusable: 'false',
  }, h('path', { d: GLYPHS[kind] })))
}

/**
 * 标题右侧的外链组。同一格座位在**行详情页**与**官方插件页**也会渲染，所以 `subject.kind`
 * 与包名两道闸门都要过；不匹配就 `return null`（list 座位的"我对这个主题没话说"）。
 */
function PluginLinks({ subject, t }) {
  if (subject?.kind !== 'bundle' || subject.pkg?.name !== BUNDLE_NAME) return null
  return h('span', { className: 'capital-config-plugin-links' },
    h(PluginLink, { kind: 'github', href: REPO_URL, label: t('githubLabel') }),
    h(PluginLink, { kind: 'npm', href: NPM_URL, label: t('npmLabel') }),
  )
}

function apply(ctx) {
  ctx.effect(installStyles, 'capital-config: styles')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'capital-config: dictionaries')
  const card = new CapitalCardController(ctx.configForms.get(ENTRY_ID), ctx)
  ctx.effect(() => () => card.dispose(), 'capital-config: form subscription')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => card.refresh(ref)), 'capital-config: credential invalidations')
  // 只有 Host 真的在服务这个条目时才注册卡片：没装配 capital-config 的部署里不留痕迹。
  // 座位是**组合包自己的页面**，key 是包名而非 `<包名>#<行 id>`——条目 id 与槽 key 因此是两个
  // 不同的字符串，各自的同字链见文件头。
  ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_NAME,
    locale: LOCALE_NS,
    inject: () => card.inject(),
  }, CapitalCard))), 'capital-config: page')
  // 外链与配置段是同一页面的两格，但**门控不同**：链接是这个插件的属性，Host 有没有在服务
  // `capital-config` 这条配置条目与它无关，所以不进 whileServed。
  ctx.effect(() => ctx.slots.inject(BADGE_SLOT, () => ctx.slots.register({
    name: BADGE_SLOT,
    id: `${ENTRY_ID}-plugin-links`,
    locale: LOCALE_NS,
  }, PluginLinks)), 'capital-config: plugin links')
  ctx.logger?.info?.('capital-config: settings card + 标题外链 mounted')
}

exports.name = 'capital-config'
exports.inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
exports.apply = apply
