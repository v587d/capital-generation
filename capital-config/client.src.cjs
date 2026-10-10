const { createElement: h, useEffect, useRef, useState } = require('react')
const { createPortal } = require('react-dom')
const {
  SettingsForm,
  SettingsSecretField,
  SettingsFormModel,
  SegmentedControl,
  Switch,
  Modal,
  writeClipboard,
  IconRightUpOutlineRegular,
} = require('@deepseek-ai/dsh-client-ui-primitives')
const { SELECTED_SKILL_CATALOG, SELECTED_SKILL_TAG_LABELS } = require('../selected-skills/catalog.js')

/**
 * 卡片读的是**配置条目 id**，坐的是**组合包自己的页面**——两个不同的字符串，各自钉在不同地方：
 *
 *  - `ENTRY_ID` 是 settings 命名空间（0.1.7 起命名空间恒等于 profile 条目 id），四处必须同字：
 *    `cordis.patch.yml` 的行 id、`capital-config/index.js` 的 `SETTINGS_ENTRY_ID`、主插件
 *    `src/index.ts` 的 `CAPITAL_CONFIG_ENTRY_ID`、这里。
 *  - `BUNDLE_NAME` 是槽 `plugins.bundle.config` 的 key：页面按**组合包的包名**取该包的配置段
 *    （`renderSlot(..., { entryKey: pkg.name })`），所以它必须逐字等于根 `package.json` 的 `name`。
 *    它还被 `installStyles` 插进那两条限定"只在我们自己那一页动宿主的组件段"的选择器里 ⇒
 *    包名这条链现在管着**三处**（槽 key、页面选择器、拼出来的 npm 地址）。
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
/**
 * 三格 tab 的基 id：官方 `SegmentedControl` 按 `<id>-<value>` 画 tab、按 `<id>-<value>-panel`
 * 发 `aria-controls`（契约写在它的 `.d.ts` 里），所以三块面板的 `id` 必须逐字跟着这两个模板长。
 */
const TABS_ID = 'capital-config-tabs'
/**
 * 「详情」悬浮里那份 `SKILL.md` 原文的来路：host 半边（`capital-config/index.js`）注册的
 * 只读旁路，按 catalog 的 skill 名寻址——闭集在服务器那侧，这里只拼地址。
 * 这条字符串与 host 的 `SKILL_DOC_ROUTE` 同字（客户端 import 不到那一层，所以由测试对着
 * 两侧产物比）：漂移的表现是「详情」永远读不到，且不报错。
 */
const SKILL_DOC_ROUTE = '/capital-skills'
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
const SELECTED_SKILL_FIELDS = SELECTED_SKILL_CATALOG.map(({ key }) => key)
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
  tabsLabel: '配置分区',
  title: '数据源',
  titleUnsaved: '数据源 未保存',
  componentsTitle: '包含的组件',
  componentsHint: '组件清单由 DSH 绘制，显示在下方。',
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
  selectedSkillsTitle: '精选 Skills',
  selectedSkillsFilterLabel: '按能力筛选',
  selectedSkillsEmpty: '没有匹配这个标签的 Skill。',
  selectedSkillsCopyName: '复制技能名',
  selectedSkillsCopied: '已复制',
  selectedSkillsDetail: '详情',
  selectedSkillsDetailClose: '关闭',
  selectedSkillsDocLoading: '原文读取中…',
  selectedSkillsDocFailed: '原文读不到：这份快照没随包落地，或暂时读不出来。',
  selectedSkillsDocStale: '原文读不到：宿主进程里还没有这条读原文的通道。升级插件后要重启 DSH，重启前刷新页面也没有用。',
  selectedSkillsOpenRepo: '打开上游仓库',
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
  tabsLabel: 'Settings sections',
  title: 'Data Sources',
  titleUnsaved: 'Data Sources unsaved',
  componentsTitle: 'Components',
  componentsHint: 'The component list is drawn by DSH and appears below.',
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
  selectedSkillsTitle: 'Selected Skills',
  selectedSkillsFilterLabel: 'Filter by capability',
  selectedSkillsEmpty: 'No skills match this tag.',
  selectedSkillsCopyName: 'Copy skill name',
  selectedSkillsCopied: 'Copied',
  selectedSkillsDetail: 'Details',
  selectedSkillsDetailClose: 'Close',
  selectedSkillsDocLoading: 'Loading the source…',
  selectedSkillsDocFailed: 'The source could not be read: this snapshot is not in the installed package, or it cannot be opened right now.',
  selectedSkillsDocStale: 'The source could not be read: this host process has no route for it yet. After upgrading the plugin, restart DSH — reloading the page alone will not help.',
  selectedSkillsOpenRepo: 'Open upstream repository',
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
    /* 面板的 display 只在「没被 hidden」时声明：UA 的 [hidden]{display:none} 会输给任何作者
       display，写在 .capital-config-panel 上就等于 hidden 失效——35 颗开关与密钥输入框全留在
       Tab 序里，控件对自己说谎。两条各管一边，谁日后加 display 也漏不出来。 */
    .capital-config-panel { flex-direction: column; gap: 12px; }
    .capital-config-panel:not([hidden]) { display: flex; }
    .capital-config-panel[hidden] { display: none; }
    /* 「包含的组件」那一格是宿主的（section[data-plugin-rows]），我们没有能替换它的座位，只能收起/放行。
       只写正面式、两条各自成规则：任何一条失配（宿主改名、老宿主没这段、无 :has() 的引擎、卡片没被
       whileServed 放行、available 为假、属性值意外）都落在**宿主段落照常可见**那一侧——宁可重复，
       不能把用户的数据藏丢。写成 :not([data-capital-config-tab="components"]) 就是把一个拼错的
       属性值变成事故。回到可见一侧的结构保证：tab 条不在任何面板里，永远收不到 hidden。 */
    [data-plugin-detail="${BUNDLE_NAME}"]:has(.capital-config-card[data-capital-config-tab="sources"]) section[data-plugin-rows] { display: none; }
    [data-plugin-detail="${BUNDLE_NAME}"]:has(.capital-config-card[data-capital-config-tab="skills"]) section[data-plugin-rows] { display: none; }
    .capital-config-secret-row { display: flex; flex-direction: column; gap: 2px; }
    /* 文档链接 portal 进官方 head 行之后靠这两条摆位：官方 label 是 flex:1（会吃掉整行），
       收成 0 1 auto 才让链接紧贴其右；配置徽标拿 order + margin-left:auto 留在行尾。 */
    .capital-config-secret-row label { flex: 0 1 auto; }
    .capital-config-secret-row label ~ span { order: 1; margin-left: auto; }
    .capital-config-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
    /* 第二格是左右布局：筛选器在左、清单在右。不是为了好看——35 行的清单里往下滚，顶部横排的
       二十几个标签早就滚出视野，筛选器等于失效，所以它还要 position: sticky 跟着滚。
       padding-top: 12px 把左列第一颗按钮顶到 tab 条下方 24px，与第一格「Fuyao API Key」同一档：
       面板只有一个子元素时 flex gap 不发生作用，不补这一档就是 12px，切格子版面就跳一次。
       ⚠️ sticky 的参照是页面滚动容器、top 是它顶端还要让出的高度，两者只能在浏览器里量。 */
    .capital-config-selected-layout { display: flex; align-items: flex-start; gap: 16px; padding-top: 12px; }
    .capital-config-selected-filter { position: sticky; top: 12px; flex: 0 0 132px; display: flex; flex-direction: column; align-items: stretch; gap: 3px; }
    .capital-config-selected-filter-button { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; min-height: 26px; padding: 3px 8px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; text-align: left; cursor: pointer; }
    .capital-config-selected-filter-button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .capital-config-selected-filter-button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); color: var(--dsw-alias-label-primary); }
    /* 标签后面那个数字 = "点它会显示几行"，按 catalog 现算；不是"已开启几颗"（那是 tab 上 2/35 的口径）。 */
    .capital-config-selected-filter-count { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
    .capital-config-selected-filter-button[aria-pressed="true"] .capital-config-selected-filter-count { color: inherit; }
    .capital-config-selected-list { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .capital-config-skill-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .capital-config-skill-tag { padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
    .capital-config-skill-heading { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .capital-config-skill-actions { flex: none; display: inline-flex; align-items: center; gap: 6px; }
    /* 两个动作以前是无边框的 tertiary 灰，落在标题后面像一行说明文字，看不出可点。 */
    .capital-config-skill-action { flex: none; min-height: 22px; padding: 2px 8px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 6px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11px; line-height: 16px; white-space: nowrap; cursor: pointer; }
    .capital-config-skill-action:hover { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
    .capital-config-skill-action:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
    .capital-config-skill-repo { display: inline-flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; text-decoration: none; }
    .capital-config-skill-repo:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
    .capital-config-skill-description { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    /* 「详情」点开的是官方 Modal（portal 到 body，遮罩、Esc、右上关闭按钮与焦点归还都归它，见 §5.3）。
       它默认只有 380px——装不下一份 markdown，所以这里给宽度。选择器写成 div. 是为了在同权重竞争里
       稳赢官方散列类 .dialog：我们的样式表后注入，但"后注入"是巧合不是契约，别押上去。 */
    div.capital-config-skill-modal { width: min(820px, 100%); max-height: 100%; }
    /* 矮窗口里的保险：正文整体可滚，避免被 .dialog 的 overflow:hidden 裁掉半行。 */
    .capital-config-skill-modal-content { min-height: 0; overflow: auto; }
    /* 原文是 markdown 就按源码呈现，不做渲染——这块 UI 说的是"SKILL.md 原文"。滚动的是这一份，
       标题与关闭按钮因此一直留在原位。 */
    .capital-config-skill-doc { min-height: 0; max-height: 58vh; margin: 0; padding: 12px 14px; overflow: auto; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 17px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .capital-config-skill-doc-state { margin: 0; padding: 12px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    /* 读屏用的一句（第三格那句"清单在下方"）：画面上删掉了，但 aria-controls 指的这块面板不许是
       空的——空面板不报错，只有读屏用户付账。position:absolute ⇒ 它对布局一点贡献都没有。 */
    .capital-config-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    /* 第三格不留可见内容（宿主那段清单就在卡片下方），这条负 margin 把它的首行文字顶到与另两格
       等距。数是这样来的（浏览器实测，别照抄注释改）：面板 0 高时宿主 h4 落在 tab 条下方 44px
       = 卡片到面板的 12 + 两格之间的 32；第一格那一档是 24 ⇒ 要收回 44 − 20 = 24。
       面板 hidden 时 display: none，这条 margin 根本不参与布局，所以只有那一格在屏时才生效。 */
    .capital-config-panel[data-capital-config-panel="components"] { margin-bottom: -20px; }
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
    this.selectedSkillWriting = new Set()
    this.selectedSkillFailed = new Set()
    // 「包含的组件」的行数是**外部事实**（profile 里装了哪些行），null = 还没取到 ⇒ tab 上不画数字，
    // 绝不把"读不到"渲染成 0。rowsRequested 记的是"这张卡片真的上过屏"：没上屏就不去要这份
    // 逐个 bundle 读 manifest 的清单，事件来了也只是"该重取了"，不是"必须现在取"。
    this.bundleRows = null
    this.rowsRequested = false
    this.rowsInFlight = false
    // 密钥通过 credentials 域独立写入（write-only，值从不随响应出网），所以普通字段 specs 为空。
    // 本机回退与选用 Skill 两类开关直接 mutate volatile 路径，不进入密钥草稿流。
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
      selectedSkills: Object.fromEntries(SELECTED_SKILL_FIELDS.map((field) => [field, {
        on: snapshot.value?.selectedSkills?.[field] === true,
        writing: this.selectedSkillWriting.has(field),
        failed: this.selectedSkillFailed.has(field),
      }])),
      // `count === null` 是"还不知道"，不是"没有"：卡片据此决定 tab 文案里画不画数字。
      components: { count: this.bundleRows },
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

  async toggleSelectedSkill(field, value) {
    if (!SELECTED_SKILL_FIELDS.includes(field) || this.selectedSkillWriting.has(field)) return
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    this.selectedSkillWriting.add(field)
    this.selectedSkillFailed.delete(field)
    this.store.set(this.projection())
    try {
      await this.scope.mutate([{ op: 'set', path: ['selectedSkills', field], value }])
    } catch {
      // The saved snapshot below decides whether the switch changed.
    }
    this.selectedSkillWriting.delete(field)
    const landed = this.scope.getSnapshot().value?.selectedSkills?.[field] === value
    if (!landed) this.selectedSkillFailed.add(field)
    this.store.set(this.projection())
  }

  /**
   * 「包含的组件」的行数：唯一真相是宿主的 `pluginManager.listBundles()`（页面上那一格也是从它渲染的），
   * 我们只取 `rows.length` 当 tab 上的数字，**不重画那张清单**。
   *
   * - 只在卡片真的上过屏之后取，且在途合并：这份清单要逐个 bundle 读 manifest，不是廉价读。
   * - 失败（远端抛错、`ok: false`、清单里没有我们这个包）一律不记不缓存 ⇒ 下一次切到那一格会再试
   *   （§9.7 ⑤ 的另一半：失败也要留可重试的余地，把一次抢跑失败 memoize 住就等于钉到进程结束）。
   * - 只在数字真的变了才推 store，保住 snapshot 的引用稳定。
   */
  async ensureBundleRows() {
    this.rowsRequested = true
    if (this.bundleRows !== null) return
    await this.readBundleRows()
  }

  /** 变更事件走这条：还没上过屏就不取，上过屏才值得重取。 */
  invalidateBundleRows() {
    if (this.rowsRequested) this.readBundleRows()
  }

  async readBundleRows() {
    if (this.rowsInFlight) return
    this.rowsInFlight = true
    let count = this.bundleRows
    try {
      const answer = await this.ctx.remote.pluginManager.listBundles()
      const bundle = answer?.ok === true
        ? (answer.value ?? []).find((item) => item?.name === BUNDLE_NAME)
        : undefined
      if (Array.isArray(bundle?.rows)) count = bundle.rows.length
    } catch {
      // 读不到就维持原值（多半还是 null ⇒ tab 上不画数字），重试留给下一次切格或事件。
    }
    this.rowsInFlight = false
    if (count === this.bundleRows) return
    this.bundleRows = count
    this.store.set(this.projection())
  }

  inject() {
    return {
      hooks: {
        capitalCard: this.store,
      },
      ...this.model.actions(),
      toggleLocalFetch: (value) => this.toggleLocalFetch(value),
      toggleSelectedSkill: (field, value) => this.toggleSelectedSkill(field, value),
      ensureBundleRows: () => this.ensureBundleRows(),
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

function skillLocale() {
  const language = typeof document !== 'undefined' ? document.documentElement?.lang : ''
  return typeof language === 'string' && language.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/**
 * `SKILL.md` 原文的按需取数（「详情」悬浮用）。
 *
 * - **只缓存成功**：失败缓存等于把一次抖动钉到这次会话结束（AGENTS.md §9.7 ⑤ 的后半边），
 *   下一次悬停还得能重试。
 * - 在途的那颗 Promise 用来合并重复悬停：同一行来回进出不会打两遍同一条本机路由。
 * - 失败要分**两类**说（`error.code` 带出去给行面选文案）：回包里有我们那份 `{ error }` ⇒ 路由活着、
 *   是这条 skill 的快照读不到；回包根本不是我们的形状 ⇒ **宿主进程里就没有这条路由**（客户端 bundle
 *   每次打开页面重取，host 半边却要重启才重新 import——升级后正是这个状态）。把后者说成"刷新页面
 *   再试"是指错方向：刷新拿不到一条不存在的路由，只有重启宿主能。
 */
const skillDocs = new Map()
const skillDocRequests = new Map()

function skillDocUrl(name) {
  return `${SKILL_DOC_ROUTE}/${encodeURIComponent(name)}.md`
}

function loadSkillDoc(name) {
  const cached = skillDocs.get(name)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = skillDocRequests.get(name)
  if (pending === undefined) {
    pending = fetch(skillDocUrl(name), { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}))
          const error = new Error(typeof detail?.error === 'string' ? detail.error : `http_${response.status}`)
          error.code = typeof detail?.error === 'string'
            ? detail.error
            : (response.status === 401 || response.status === 403) ? 'unauthorized' : 'route_missing'
          throw error
        }
        const text = await response.text()
        skillDocs.set(name, text)
        return text
      })
      .finally(() => skillDocRequests.delete(name))
    skillDocRequests.set(name, pending)
  }
  return pending
}

/** 「已复制」亮多久：要够读完，又不能亮到让人以为它是个状态开关。 */
const COPIED_FLASH_MS = 1600

function SelectedSkillRow({ entry, state, disabled, onChange, t }) {
  const locale = skillLocale()
  const label = entry.label[locale]
  const repositoryUrl = `https://github.com/${entry.owner}/${entry.repository}`
  const copyTimer = useRef(null)
  const [copied, setCopied] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  // null = 还没取过；'ready' 之后不再重取，'failed' / 'loading' 允许下一次悬停再来一遍。
  const [doc, setDoc] = useState(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const copyName = async () => {
    const accepted = await writeClipboard(entry.name)
    // 浏览器拒了剪贴板就不改文案：按钮说自己"已复制"而剪贴板是空的，是控件在说谎。
    if (!accepted) return
    setCopied(true)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS)
  }
  const prefetchDoc = () => {
    if (doc?.status === 'ready' || doc?.status === 'loading') return
    if (skillDocs.has(entry.name)) {
      setDoc({ status: 'ready', text: skillDocs.get(entry.name) })
      return
    }
    setDoc({ status: 'loading' })
    loadSkillDoc(entry.name).then(
      (text) => setDoc({ status: 'ready', text }),
      (error) => {
        // 码只留在这里（卡片上那句人话不背 `skill_doc_unreadable` 这种内部名）。
        globalThis.console?.warn?.(`capital-config: SKILL.md 原文读取失败 ${entry.name}: ${String(error?.code ?? error?.message ?? error)}`)
        setDoc({ status: 'failed', code: error?.code === 'route_missing' ? 'route_missing' : 'unreadable' })
      },
    )
  }
  const detailContent = doc?.status === 'ready'
    ? h('pre', { className: 'capital-config-skill-doc' }, doc.text)
    : doc?.status === 'failed'
      ? h('p', { className: 'capital-config-skill-doc-state' }, t(doc.code === 'route_missing' ? 'selectedSkillsDocStale' : 'selectedSkillsDocFailed'))
      : h('p', { className: 'capital-config-skill-doc-state' }, t('selectedSkillsDocLoading'))
  return h('div', { className: 'capital-config-field' },
    h('div', { className: 'capital-config-switch-row' },
      h('div', { className: 'capital-config-switch-text' },
        h('div', { className: 'capital-config-skill-heading' },
          h('span', { className: 'capital-config-title' }, label),
          h('div', { className: 'capital-config-skill-actions' },
            // 复制技能名**只给已开启的行**：那串名字是给会话用的（`/技能名`），没开的技能复制了
            // 也用不上，摆在那儿只是 35 行噪音。「详情」不留这一道闸门——开之前正是要读原文的时候。
            state?.on === true ? h('button', {
              type: 'button',
              className: 'capital-config-skill-action',
              // slug 从行面上删掉了，所以无障碍名与原生提示都得带着真名字：用户要能在按下去之前
              // 知道"复制的到底是哪一串"，否则删掉那行 `code` 就是把信息藏了而不是省了。
              title: `${t('selectedSkillsCopyName')}: ${entry.name}`,
              'aria-label': `${t('selectedSkillsCopyName')}: ${entry.name}`,
              onClick: copyName,
            }, copied ? t('selectedSkillsCopied') : t('selectedSkillsCopyName')) : null,
            h('button', {
              type: 'button',
              className: 'capital-config-skill-action',
              'aria-label': `${t('selectedSkillsDetail')}: ${entry.name}`,
              'aria-haspopup': 'dialog',
              // 悬停就把原文要回来：点开那一瞬应该已经有内容，而不是先看见一句「原文读取中」。
              // 点击才是这条动作的正解——官方 HoverCard 只认 pointerenter 计时（500ms），且**点锚点
              // 会把它关掉**，所以"点详情没反应"不是故障而是那个控件的语义。
              onPointerEnter: prefetchDoc,
              onFocus: prefetchDoc,
              onClick: () => {
                prefetchDoc()
                setDetailOpen(true)
              },
            }, t('selectedSkillsDetail')),
            h(Modal, {
              open: detailOpen,
              onClose: () => setDetailOpen(false),
              title: label,
              // slug 从行面上删了，但"我在读哪一份"这个问题在打开的这一刻最该被回答：
              // 对话框的副标题就是它，也是复制要照抄的那一串。
              description: entry.name,
              closeLabel: t('selectedSkillsDetailClose'),
              className: 'capital-config-skill-modal',
              contentClassName: 'capital-config-skill-modal-content',
            }, detailContent),
          ),
        ),
        h('p', { className: 'capital-config-skill-description' }, entry.description[locale]),
        h('a', {
          className: 'capital-config-skill-repo',
          href: repositoryUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('selectedSkillsOpenRepo'),
        }, `${entry.owner}/${entry.repository}`, h(IconRightUpOutlineRegular, { size: 12 })),
        h('div', { className: 'capital-config-skill-tags' }, entry.tags.map((tag) =>
          h('span', { key: tag, className: 'capital-config-skill-tag' }, SELECTED_SKILL_TAG_LABELS[locale][tag] ?? tag))),
      ),
      h(Switch, {
        label,
        checked: state?.on === true,
        disabled: disabled || state?.writing === true,
        onChange,
      }),
    ),
    state?.failed ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed')) : null,
  )
}

/**
 * 组合包页面的配置段：页面只提供 `<section data-plugin-config>` 的容器与间距，标题体系由卡片自己给。
 * 这里是**三格 tab**（官方 `SegmentedControl`：tablist 语义、roving tabindex、←→/Home/End 走位、
 * 焦点跟随都在它里，我们一律自己实现 tablist 都不要），它**取代**当年 `h4 数据源` / `h5 精选 Skills`
 * 两级标题——面板靠 `role=tabpanel + aria-labelledby` 拿名字，名字就是用户眼里 tab 上那几个字。
 * `plugins.bundle.config` 只以 `view: 'page'` 渲染，没有 summary 一说。
 *
 * ⛔ 三块面板**全部挂载**，不在屏的那块用 `hidden` 收起而不是不渲染：`SettingsForm` 卸载即丢弃草稿
 * （填了密钥切一格再回来，密钥就没了）。宿主自己画的「包含的组件」段随 tab 收起/放行，判据是卡片根上
 * 的 `data-capital-config-tab`——所以 `available` 为假时**不画 tab 条、也不写这个属性**：属性缺席时
 * 那两条 `:has()` 认不出卡片，宿主的清单照常可见，我们藏不掉任何用户能看到的东西。
 *
 * 三格的「tab 条 → 首行文字」等距（间距真值见 installStyles 那几条 padding / margin，浏览器里量出来的）：
 * 不等距就是每切一格版面跳一次，用户会以为内容被换了。
 */
function CapitalCard(props) {
  const t = props.t
  const state = props.useCapitalCard((snapshot) => snapshot)
  const disabled = !state.writable
  const locale = skillLocale()
  const [tab, setTab] = useState('sources')
  const [tagFilter, setTagFilter] = useState('all')
  // tab 文案从一开始就带着数字，所以取数不等点击：挂载即问一次（已取到 / 在途都不会重复要）。
  // ⚠️ 所有 hook 必须排在 `if (!state.available) return` **之前**——早退在后面会让两分支的
  // hook 颗数不同，React 直接报 "Rendered fewer hooks than expected"。
  useEffect(() => { props.ensureBundleRows() }, [])
  // 已开启的行排在清单最前面，组内保持 catalog 顺序（`Array#sort` 稳定）。但这份"谁在最前"**只在
  // 进入这一格的那一刻定一次**：当场挪行等于把用户手底下那一行抽走，而"我开了哪几颗"是下次进来时
  // 才要抬头看的事。所以这里存的是一刻的名单（一组 key），不是开关的实时状态；tab 上那个
  // `已开启/总数` 仍然实时——数字当场不说谎，位置不必当场动。
  const enabledKeys = () => new Set(SELECTED_SKILL_CATALOG
    .filter((entry) => state.selectedSkills?.[entry.key]?.on === true)
    .map((entry) => entry.key))
  const [pinnedSkills, setPinnedSkills] = useState(enabledKeys)
  // 首帧可能还没读到配置文档（`available` 为假 ⇒ 那一格压根没画），那一刻量不到谁开着；补一次。
  useEffect(() => { if (state.available) setPinnedSkills(enabledKeys()) }, [state.available])
  // 筛选条按"这一档有几行"从高到低排（同数保持 catalog 里的出现顺序，Array#sort 是稳定的）：
  // 眼睛先落到的位置留给最常用的那一档。「全部」不参与排序、恒在第一格——它是"不加筛选"，
  // 不是与别的标签竞争的一个筛选值。
  const tagCounts = new Map()
  for (const entry of SELECTED_SKILL_CATALOG) {
    for (const tag of entry.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  tagCounts.set('all', SELECTED_SKILL_CATALOG.length)
  const tags = ['all', ...Array.from(tagCounts.keys())
    .filter((tag) => tag !== 'all')
    .sort((left, right) => tagCounts.get(right) - tagCounts.get(left))]
  const visibleSkills = SELECTED_SKILL_CATALOG
    .filter((entry) => tagFilter === 'all' || entry.tags.includes(tagFilter))
    .sort((left, right) => (pinnedSkills.has(left.key) ? 0 : 1) - (pinnedSkills.has(right.key) ? 0 : 1))
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
  )
  if (!state.available) return h('div', { className: 'capital-config-card' }, form)
  const localFetchSection = h('div', { className: 'capital-config-field' },
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
    state.localFetch?.failed ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed')) : null,
  )
  // 筛选条上的数字 = "点它会显示几行"，与右侧清单当场数出来的行数同一口径（都按 catalog 现算）。
  // 「按能力筛选」那句字面提示删了：这一列本来就长在清单左边，形状已经说明它是干什么的，
  // 而名字仍挂在 role=group 的 aria-label 上，读屏用户拿得到。
  const tagLabels = SELECTED_SKILL_TAG_LABELS[locale]
  const skillsFilter = h('div', { className: 'capital-config-selected-filter', role: 'group', 'aria-label': t('selectedSkillsFilterLabel') },
    ...tags.map((tag) => h('button', {
      key: tag,
      type: 'button',
      className: 'capital-config-selected-filter-button',
      'aria-pressed': tagFilter === tag ? 'true' : 'false',
      onClick: () => setTagFilter(tag),
    }, tagLabels[tag] ?? tag, h('span', { className: 'capital-config-selected-filter-count' }, String(tagCounts.get(tag))))),
  )
  const skillRows = visibleSkills.length > 0
    ? visibleSkills.map((entry) => h(SelectedSkillRow, {
      key: entry.key,
      entry,
      state: state.selectedSkills?.[entry.key],
      disabled: disabled || state.saving,
      onChange: (value) => props.toggleSelectedSkill(entry.key, value),
      t,
    }))
    : [h('p', { key: 'empty', className: 'capital-config-hint' }, t('selectedSkillsEmpty'))]
  const enabledSkills = SELECTED_SKILL_CATALOG.filter(
    (entry) => state.selectedSkills?.[entry.key]?.on === true,
  ).length
  // 行数取不到就**只留标题**：把"还不知道"画成 `0` 是控件对自己的状态说谎（数字缺席本身就是信号）。
  const withCount = (label, count) => (Number.isInteger(count) ? `${label} ${count}` : label)
  const options = [
    // 密钥草稿活在 DOM 里但保存按钮此刻看不见 ⇒ 在 tab 上说出去，别让用户以为填丢了。
    { value: 'sources', label: state.dirty ? t('titleUnsaved') : t('title') },
    { value: 'skills', label: `${t('selectedSkillsTitle')} ${enabledSkills}/${SELECTED_SKILL_CATALOG.length}` },
    { value: 'components', label: withCount(t('componentsTitle'), state.components?.count) },
  ]
  const panel = (value, children) => h('section', {
    id: `${TABS_ID}-${value}-panel`,
    role: 'tabpanel',
    'aria-labelledby': `${TABS_ID}-${value}`,
    className: 'capital-config-panel',
    'data-capital-config-panel': value,
    hidden: tab !== value,
  }, ...children)
  return h('div', { className: 'capital-config-card', 'data-capital-config-tab': tab },
    h(SegmentedControl, {
      id: TABS_ID,
      value: tab,
      options,
      label: t('tabsLabel'),
      // 不锁：一格里的写是逐字段、逐开关的，切格子不会把它们半路丢下。
      disabled: false,
      onChange: (next) => {
        setTab(next)
        // 每次切到那一格都问一次：行数已取到就什么也不做，一次失败也总能这样重试。
        if (next === 'components') props.ensureBundleRows()
        // 进「精选 Skills」这一格才重排：这一列的顺序 = 此刻开着的那些在上面。刚拨完开关再切回来，
        // 它才升到最前（切走的那一下不动，避免把手底下那一行抽走）。
        if (next === 'skills') setPinnedSkills(enabledKeys())
      },
    }),
    panel('sources', [form, localFetchSection]),
    panel('skills', [h('div', { className: 'capital-config-selected-layout' },
      skillsFilter,
      h('div', { className: 'capital-config-selected-list' }, ...skillRows),
    )]),
    // 第三块的内容是宿主自己画的那段清单（切过来才在下方显形）。画面上不再写那句"清单在下方"——
    // 用户点这一格看到的就是清单，多余的一行字只是噪音。但 `aria-controls` 指的这块面板不许是空的
    // （空面板不报错，只有读屏用户付账），所以那句话改挂在 sr-only 上：零布局贡献、读得到。
    panel('components', [h('span', { className: 'capital-config-sr-only' }, t('componentsHint'))]),
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
  // 组件行数的失效：`plugin-manager/changed` 是"装了/停了哪些行"的权威信号，重连后也重取一次
  // （卡片是模块级单例，缓存的数字活过页面来回）。disposer 必须自己合并成一颗——`ctx.effect`
  // 只认一个返回的清理函数，返回数组等于什么都没清理。
  ctx.effect(() => {
    const refresh = () => card.invalidateBundleRows()
    const disposers = [
      ctx.remote.$on('plugin-manager/changed', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'capital-config: bundle row invalidations')
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
exports.inject = ['slots', 'locale', 'remote', 'remote.credentials', 'remote.pluginManager', 'configForms']
exports.apply = apply
