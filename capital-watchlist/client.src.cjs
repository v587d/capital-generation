/**
 * `@v587d/capital-watchlist` 的浏览器半边。
 *
 * 两个 surface，缺一都不成立：
 *  1. `ctx.commandUi` 的一条 **contribution**（不是 decoration——我们没有同名宿主命令），
 *     `available(session)` 按会话的 agent preset 收敛：`ClientSessionContext` 只带
 *     `sessionId`，preset 要从 `ctx.sessions.list` 的投影里读（官方 `AgentPresetLabel` 同一读法）。
 *  2. `conversation.input.overlay` 的一条 list entry（`kind:'list'` / `scope:'session'`），
 *     弹窗由官方 `Modal` 以 `headless` 卡片渲染（遮罩 / Esc / 焦点进出是官方的，内部几何是自己的），
 *     开合状态住在 `createSnapshotStore` 里经 `hooks` 交给组件——
 *     `run(session)` 在 React 之外触发，没有 store 就没有通道。
 *
 * ⛔ 座位是常驻的：这个组件在**每个**会话页都会 mount（bundle 挂 host 平面，与 preset 无关），
 * 所以关闭时必须 `return null` 且 mount 期间零 fetch——"只在 Capital 出现"到这里才真正落地。
 *
 * ⛔ 不占 turn-tail 座位、不自造会话事件（本仓 2026-09-18 事故，判据见
 * docs/dev/chart-delivery-events.md §6.3 与 AGENTS.md §7）。
 *
 * 出网：只由用户动作触发（打开面板一次批量刷新 + 手动「刷新报价」+ 添加完顺手刷一次），
 * 无轮询、无自动重试；`/search` 那一路另有三条闸（尾部防抖 / IME 合成期不发 / 同一个词不重发，
 * 见 `onQueryChange`）——把"每敲一个键出一次网"压成"每次真正改词才出网"。全组件唯一的定时器
 * 就是那个防抖。请求打 host 平面的 `/capital-watchlist/*`（`webServer` 前缀路由不在 typed
 * remote 命名空间表里，所以用 `fetch`，与 `chart-ui` 取序列同一写法）。
 *
 * 行内「更多」菜单用官方 `Menu` primitive（`portal: true`）：清单区是滚动容器，就地渲染的浮层
 * 会被它裁掉；portal 模式把菜单挂到 `document.body`（官方 `.portal` = `z-index: 1100`，压在
 * 模态的 1000 之上），Escape / Tab / 焦点归还 / 点到外面收起全归它自己，且它按官方的模态层
 * 契约在 capture 阶段吃掉 Escape——弹窗本体因此不会跟着一起关。我们只提供锚点按钮与
 * `items`（置顶 / 删除），不自己写浮层几何。
 *
 * 失败显示：**两档颜色、四个落点，位置跟着 cause 走**（2026-09-29 用户点名：整批刷新的红字飘在
 * 输入框下方、离它指的按钮隔了一整张表，而同样是"没成"的两个通道一个红一个黄）：
 *  - **黄 = 你这一下动作没成**：搜索失败占下拉的 hint 位（与「搜索中…」「没有匹配的标的」同一个
 *    槽，所以它**替换** noHit 而不是并排多出一条——同一屏不许同时说"没有这个票"和"服务限流"）；
 *    添加失败（`list_full` / `ambiguous`）留在搜索区下方。这两条是**两个字段**：`list_full` 与
 *    输入无关，改一个字就把它抹掉是错的。
 *  - **红 = 数据不可信**：整批刷新失败跟在「刷新报价」按钮下面（跟着动词走），逐标的失败只在这一
 *    行的价格位标红——且**只有这一行从来没有过值**才标 `—`。取数失败不等于没有价：上一次成功的
 *    快照仍在域里（后端 `doRefresh` 只写成功的那几条），面板就把那个值照画，只是降一档色 +
 *    tooltip 说清它是哪一刻的快照。底部那个时间是整批共用的，不替单行背书。
 */
const { createElement: h, useEffect, useState } = require('react')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
// 图标只从官方集取（98 个 Icon*Regular/Medium，没有 Star / Bookmark 类收藏图标）。
// 不用 primitives 的 Button：面板里的每个动作都有自带几何（圆形关闭、描边刷新、行内省略号），
// 套官方 Button 反而要对抗它的 sm/md 高度与 variant 调色。
const { IconChecklistOutlineRegular, IconCloseOutlineRegular, IconEllipsisOutlineRegular, IconPinOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, Menu, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')

const ENTRY_NAME = 'capital-watchlist'
const NS = 'capital.watchlist'
const SLOT = 'conversation.input.overlay'
const ROUTE = '/capital-watchlist'
const PRESET = 'capital-generation'
const SEARCH_DEBOUNCE_MS = 300
const STYLE_TAG = 'capital-watchlist-css'

const zh = {
  'command.label': '自选股',
  'command.description': '添加 / 查看 / 删除自选股',
  title: '自选股',
  close: '关闭',
  searchPlaceholder: '输入证券代码或中文名，支持A股/指数/ETF',
  add: '添加',
  added: '已添加',
  refreshing: '刷新中…',
  refresh: '刷新报价',
  loading: '正在读取清单…',
  empty: '还没有自选股，用上面的输入框添加。',
  colName: '名称',
  colQuote: '最新价 / 涨跌幅',
  updated: '更新时间',
  notRefreshed: '未刷新',
  /** 陈旧值的 tooltip：「……限流，请稍后再试 · 上一次快照 09-29 19:04」。 */
  stale: '上一次快照',
  remove: '移除',
  more: '更多',
  pin: '置顶',
  searching: '搜索中…',
  clearInput: '清空输入',
  confirmTitle: '确认移除？',
  confirmDescPrefix: '确定将 ',
  confirmDescSuffix: ' 从自选中移除吗？',
  confirmCancel: '取消',
  confirmOk: '确认移除',
  truncated: '候选超过 10 条，请输入准确证券代码或名称。',
  noHit: '没有匹配的标的（支持沪深 A 股 / 指数 / 场内 ETF）。',
  'error.invalid_query': '输入不被接受',
  'error.not_found': '没有找到该标的',
  'error.ambiguous': '命中多条，请从候选里选一条',
  'error.list_full': '自选股最多 10 条，先删一条再加',
  'error.credential_missing': '未配置 Fuyao 密钥：在「插件」页的 Capital 模式卡片里填 API Key',
  'error.rate_limited': '行情服务限流，请稍后再试',
  'error.fuyao_unavailable': '行情服务暂时不可用，请稍后再试',
  'error.quote_unavailable': '该标的没有可用报价',
  'error.store_unavailable': '自选股存储不可用',
  errorSuffix: '（其他标的仍是上一次成功快照）',
}

const en = {
  'command.label': 'Watchlist',
  'command.description': 'Add / view / remove watched symbols',
  title: 'Watchlist',
  close: 'Close',
  searchPlaceholder: 'Symbol code or Chinese name — A-share / index / ETF',
  add: 'Add',
  added: 'Added',
  refreshing: 'Refreshing…',
  refresh: 'Refresh quotes',
  loading: 'Loading list…',
  empty: 'No symbols yet — use the input above to add one.',
  colName: 'Symbol',
  colQuote: 'Last / change',
  updated: 'Updated',
  notRefreshed: 'Not refreshed',
  stale: 'last snapshot',
  remove: 'Remove',
  more: 'More',
  pin: 'Pin to top',
  searching: 'Searching…',
  clearInput: 'Clear input',
  confirmTitle: 'Remove this symbol?',
  confirmDescPrefix: 'Remove ',
  confirmDescSuffix: ' from your watchlist?',
  confirmCancel: 'Cancel',
  confirmOk: 'Remove',
  truncated: 'More than 10 candidates — enter the exact code or name.',
  noHit: 'No matching symbol (A-share / index / on-exchange ETF).',
  'error.invalid_query': 'Input not accepted',
  'error.not_found': 'Symbol not found',
  'error.ambiguous': 'Multiple hits — pick one candidate',
  'error.list_full': 'Watchlist holds 10 symbols — remove one first',
  'error.credential_missing': 'No Fuyao API key: set it on the Capital card in the Plugins page',
  'error.rate_limited': 'Quote service is rate limited — try again later',
  'error.fuyao_unavailable': 'Quote service unavailable — try again later',
  'error.quote_unavailable': 'No quote for this symbol',
  'error.store_unavailable': 'Watchlist storage unavailable',
  errorSuffix: ' (other symbols still show their last good snapshot)',
}

/** `asset_type` → 类型徽标文案（枚举与文案在这里一次对齐，别在渲染处各写一遍）。 */
const TYPE_LABELS = { 'a-share': '股票', 'a-share-index': '指数', 'fund-etf': 'ETF' }
/** 类型徽标的配色：股票=橙、指数=蓝、ETF=绿，与候选行共用同一组类。 */
const TYPE_TONES = { 'a-share': 'capital-watchlist-tag-stock', 'a-share-index': 'capital-watchlist-tag-index', 'fund-etf': 'capital-watchlist-tag-etf' }

/**
 * 面板几何。
 *
 * 官方 `Modal` 的 `.dialog` / `.header` / `.body` 是 CSS Module 的**散列类**（本机
 * `dsh-web-frontend` 产物里是 `_body_17vb8_5` 这种），插件 CSS 够不着它们——所以弹窗用
 * `headless: true`（官方 props 之一：卡片、遮罩、Esc、aria-label 都还在，只去掉默认
 * header/body/footer 骨架），几何全部由下面这些自有类承担。
 * 唯一还需要压官方的是**卡片本身**：`.capital-watchlist-dialog` 与官方类同落在 dialog 元素上，
 * 双类名选择器（重复一次类名）把 specificity 抬到 0-2-0 才赢得过 `.dialog` 的默认宽/内边距/圆角。
 *
 * 颜色一律取宿主 design token，而且**按角色取**、不按"看着深浅"取：官方规则（`docs/web-styling`）
 * 是功能 CSS 不得写主题选择器、不得写颜色字面量，明暗两套值由 token 自己翻。浅色踩坑的三条：
 *  1. `--dsw-alias-label-dimmed` 在浅色解析成 `#e1e5ee`（深色是 `#43454a`）——压在白卡片上等于隐形，
 *     所以**凡是承载信息的文字**都走 `label-secondary` / `label-tertiary`，`dimmed` 只留给
 *     "看不见也无所谓"的东西（我们的面板里它一处都不剩）。
 *  2. `bg-layer-1/2/3` 在浅色**同为纯白**：控件底面要反差就用 `bg-module-platform`
 *     （浅 `#f5f6f7` / 深 `#353638`，官方 `.selector`、`.badge` 都是这一条）。浮层用
 *     `--dsw-specific-menu` + `--dsw-elevation-prominent`——官方口径是高层级表面 `border: 0`、
 *     靠 0.5px 描边投影分离，**不得**把 `border-l*` 与 elevation 投影配对。
 *     ⚠️ `--dsw-specific-menu` 是**半透明**菜单材质（浅 `#f8f9fa94` = 58%、深 `#43454a73` = 45%，
 *     只有 macOS 才近不透明），官方规则要求画它的表面**必须**同时声明
 *     `backdrop-filter: var(--dsw-menu-backdrop-filter)`（`blur(40px) saturate(150%)`）：
 *     只拿填充不拿模糊，浮层底下的清单行会直接透视上来（`MenuSurface .material`、会话侧
 *     `.media` 滚动面板都是这一对）。深色那档描边不用我们分支——宿主有
 *     `body[data-ds-dark-theme] [data-menu-material] { …border-l3 }`，节点挂上
 *     `data-menu-material="translucent"`（官方 `MenuSurface` 的挂法）就自动翻，功能 CSS
 *     写主题选择器是违规的。
 *  3. `interactive-bg-hover` 在浅色只有 6% 不透明度，画不出"常态灰底"，只配当 hover；
 *     常态灰底用 `bg-module-platform`，hover 加深用 `interactive-bg-hover-accent`。
 * 只有 A 股口径的**红涨绿跌**两个色是字面量——涨跌语义不在宿主调色板里，宿主也没逐元素声明
 * `color-scheme`（`light-dark()` 用不了），所以浅深两套共用一对值：#d1493f / #17a063 在
 * 「浅卡 / 深卡」四种组合里最差的一档是 3.14:1（涨 on 深卡），已是最优折中。
 */
const CSS = `
/* 宽 420 / 圆角 18 / 无内边距（内边距住在各段自己头上，好让表头与分隔线对齐）。
   限高按官方口径走 max-height: 100%（对 .root 的 padding box），不自己算 vh。 */
.capital-watchlist-dialog.capital-watchlist-dialog { width: min(420px, 92vw); max-height: 100%; padding: 0; gap: 0; border-radius: 18px; }
/* 底色与投影归官方 .dialog；滚动条按官方契约只在容器上重绑 l2 那一对，不自己写 scrollbar-* 选择器。 */
.capital-watchlist-card { position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden; border-radius: 18px; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.capital-watchlist-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 18px 20px 14px; }
.capital-watchlist-title { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: .3px; color: var(--dsw-alias-label-primary); }
/* 圆形灰底键：灰底 bg-module-platform + glyph label-secondary，两套主题都拉得开；正圆须配 corner-shape: round。 */
.capital-watchlist-close { flex: none; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.capital-watchlist-close:hover { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
/* 搜索段：position:relative 是下拉的包含块（下拉 top: calc(100% - 8px) 贴着输入框下沿）。 */
.capital-watchlist-search { position: relative; padding: 0 20px 16px; }
.capital-watchlist-field { position: relative; display: flex; align-items: center; height: 42px; padding: 0 14px 0 40px; border: none; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); transition: box-shadow .2s var(--ds-ease-in-out); }
/* 聚焦用 inset 投影而不是 border（官方 .selector 这类控件就没有 border，加了会顶出 1px 抖动）；
   颜色 brand-primary 浅=近黑、深=近白，与官方 Input 的 focus-within 同一支笔。 */
.capital-watchlist-field:focus-within { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.capital-watchlist-searchicon { position: absolute; left: 14px; display: inline-flex; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.capital-watchlist-input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; }
/* 占位符比官方 Input 提一档到 tertiary：dimmed / caption 压在浅底只有 1.26 / 1.97:1，
   而这一行是面板里唯一告诉用户"这里能输入什么"的地方。 */
.capital-watchlist-input::placeholder { color: var(--dsw-alias-label-tertiary); }
/* 清空键：与关闭键同一支笔，按 42px 的框缩一档。底面不能用 bg-module-platform——它正坐在
   同色的输入框底上会糊成一片，所以走 interactive-bg-hover，hover 再深一档到 hover-accent。 */
.capital-watchlist-clear { flex: none; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.capital-watchlist-clear:hover { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
/* 下拉候选：官方半透明菜单材质。--dsw-specific-menu 浅 58% / 深 45%，**必须**与
   --dsw-menu-backdrop-filter（blur40 saturate150）成对声明——只拿填充不拿模糊，底下的清单行会
   直接透视上来（官方滚动浮层 .media 面板与 MenuSurface .material 都是这一对）。border: 0 +
   elevation-prominent 分离；描边浅色重绑 l1，深色由宿主 [data-menu-material] 规则翻成 l3。 */
.capital-watchlist-dropdown { position: absolute; top: calc(100% - 8px); left: 20px; right: 20px; z-index: 20; max-height: 380px; overflow-y: auto; background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); border: 0; border-radius: 12px; --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); animation: capital-watchlist-drop .18s var(--ds-ease-in-out); }
@keyframes capital-watchlist-drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes capital-watchlist-breathe { 0% { opacity: 1; } 40% { opacity: .6; } 80%, 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .capital-watchlist-dropdown { animation: none; } .capital-watchlist-skeleton { animation: none; } }
.capital-watchlist-option { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border: none; border-bottom: .5px solid var(--dsw-alias-border-l2); background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
.capital-watchlist-option:last-of-type { border-bottom: none; }
.capital-watchlist-option:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
.capital-watchlist-option:disabled { opacity: .45; cursor: not-allowed; }
/* 键盘焦点走官方表达式：环色由宿主按主题与输入模态管好（指针模态自动透明），不自己造环。 */
.capital-watchlist-close:focus-visible, .capital-watchlist-clear:focus-visible, .capital-watchlist-option:focus-visible, .capital-watchlist-more:focus-visible, .capital-watchlist-refresh:focus-visible, .capital-watchlist-confirmbtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.capital-watchlist-optionmain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.capital-watchlist-optionname { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.capital-watchlist-optioncode { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-tag { flex: none; display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 11px; line-height: 14px; font-weight: 500; }
/* 类型徽标 = 官方状态徽标那对写法：底色用 state-*-tertiary（主题包为"状态色的底"准备的实心档，
   自己 color-mix 出来的透明档压在白卡片上等于没混），文字用同色系 primary；
   amber 例外走 warn-label——warn-primary 压白底只有 2:1，官方"状态色当文字"另有 label 一档。 */
.capital-watchlist-tag-index { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }
.capital-watchlist-tag-stock { color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); }
.capital-watchlist-tag-etf { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); }
/* 表头与数据行共用同一个 grid 定义：宽度只在这一处，两处各自排版就会串行（实机踩过）。
   类型徽标从独立列并进名称列（2026-09-29 用户反馈"类型这一列挺累赘"），所以三列：
   名称 + 第二行的「代码 · 徽标」/ 报价 / 行内更多键。 */
.capital-watchlist-grid { display: grid; grid-template-columns: 2.1fr 1.2fr 36px; gap: 8px; align-items: center; }
.capital-watchlist-head { padding: 0 20px 8px; font-size: 12px; line-height: 18px; letter-spacing: .2px; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-list { max-height: 300px; padding: 0 12px 8px; overflow-y: auto; }
.capital-watchlist-row { padding: 11px 8px; border-radius: 10px; transition: background .15s var(--ds-ease-in-out); }
.capital-watchlist-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.capital-watchlist-namewrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.capital-watchlist-name { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 代码与类型徽标同处第二行：gap 是这一对唯一的间距来源，徽标自带内边距，别再各写 margin。 */
.capital-watchlist-codeline { display: flex; align-items: center; gap: 6px; min-width: 0; }
.capital-watchlist-code { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* 最新价在上、涨跌幅在下，右对齐：两行都同一列里排，列宽才不需要跟着涨跌位数抖。 */
.capital-watchlist-quote { min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
.capital-watchlist-price { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.capital-watchlist-change { margin-top: 1px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.capital-watchlist-up { color: #d1493f; }
.capital-watchlist-down { color: #17a063; }
.capital-watchlist-flat { color: var(--dsw-alias-label-secondary); }
/* 这一行本次没取到报价、且从来没有过值：破折号标红（红 = 数据不可信，与整批刷新同一档）。
   写在 up/down/flat 之后，与 .capital-watchlist-price 同 specificity 靠源码序赢——不靠 !important 抢。 */
.capital-watchlist-quotefailed { color: var(--dsw-alias-state-error-primary); }
/* 本次没取到、但上一次成功的快照还在（后端只覆写成功的那几条）：值照画，两行都降到 secondary。
   红涨绿跌是"当前"的语义，一个陈旧值不该借用；它是哪一刻的写在 tooltip 里。 */
.capital-watchlist-stale { color: var(--dsw-alias-label-secondary); }
/* 骨架条：bg-skeleton 在浅色只有 4%，官方那一条（.skeletonBar）也是配 2s 呼吸一起用的。 */
.capital-watchlist-skeleton { display: block; height: 12px; margin: 2px 0 0 auto; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); animation: capital-watchlist-breathe 2s cubic-bezier(.36, 0, .64, 1) infinite; }
.capital-watchlist-skeleton-price { width: 68px; }
.capital-watchlist-skeleton-change { width: 44px; height: 10px; }
/* 「更多」键：dimmed 在浅底等于图标整个消失，所以常态取 label-tertiary，hover 提亮到 primary
   （破坏性的「移除」降级成菜单里的一条 danger 行，行内不再常驻一个红色动作）。 */
.capital-watchlist-more { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.capital-watchlist-more:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.capital-watchlist-more:disabled { opacity: .45; cursor: not-allowed; }
/* 官方 Menu 的锚点包着一层 span（.root 是 inline-flex），它才是 grid 第三格：贴右缘靠 justify-content
   ——旧版删除键是格子本身，用 margin-left:auto；包一层之后 auto 外边距落在 span 自己身上，已无效果。 */
.capital-watchlist-actions { justify-content: flex-end; }
/* 底部一行：左列是「刷新报价」动词 + 它自己的整批失败行，右列是共用的更新时间。
   flex-start 而不是 center：失败行出现时左列变高，居中的话更新时间会跟着往下坠。 */
.capital-watchlist-footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 20px 18px; border-top: .5px solid var(--dsw-alias-border-l2); }
.capital-watchlist-footcol { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
/* 刷新按钮底走官方 Tag 的 info 配方（state 色 + color-mix 透明档，要的是"轻"，实心 tertiary 在按钮上
   会糊成一块色斑）；边框按口径例外：状态色 border 保持 1px，0.5px 那条只管中性 border。 */
.capital-watchlist-refresh { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
.capital-watchlist-refresh:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
.capital-watchlist-refresh:disabled { opacity: .45; cursor: not-allowed; }
/* 34px = 刷新按钮的高度：与它同一行的时间按按钮高度行高居中，左列多出失败行也不受影响。 */
.capital-watchlist-updated { font-size: 12px; line-height: 34px; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-hint { padding: 8px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
/* 黄 = 动作没成。两条黄字都用 warn-label：官方"状态色用作文字"给的是 label 那一档，
   warn-primary 压在浅底上只有 2:1，报错文字反而是最不该看不见的一行。 */
/* 搜索失败：占下拉的 hint 位（与「搜索中…」「没有匹配的标的」同一个槽，替换而非并列）。
   不写 padding——它骑在 .capital-watchlist-hint 的 8px 14px 上，只改颜色。 */
.capital-watchlist-searcherror { color: var(--dsw-alias-state-warn-label); }
/* 添加失败（list_full / ambiguous）：与输入无关，跟着搜索区坐着，改字不清它。 */
.capital-watchlist-adderror { padding: 0 20px 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label); }
/* 整批刷新失败：红 = 数据不可信，贴在「刷新报价」下面（跟着动词走），不再居中飘到输入框下方。 */
.capital-watchlist-notice { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.capital-watchlist-empty { padding: 24px 20px; text-align: center; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
/* 删除二次确认：贴在卡片内的绝对层（.dialog 的 overflow:hidden 顺带裁掉圆角外沿）。
   常驻挂载 + 类切换，才有淡入淡出；visibility:hidden 的子节点天然退出 Tab 序。 */
.capital-watchlist-confirm { position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; border-radius: 18px; background: var(--dsw-alias-bg-mask-1); opacity: 0; visibility: hidden; transition: opacity .2s var(--ds-ease-in-out), visibility .2s; }
.capital-watchlist-confirm-open { opacity: 1; visibility: visible; }
/* 确认盒是浮层，按官方模态卡口径画：border:0 + layer-2 + elevation-prominent，
   不自己拿 bg-mask 当影子（浅底下 16% 描边 + 24% 黑影会糊成一团脏边）。 */
.capital-watchlist-confirmbox { width: 280px; padding: 22px 20px 18px; border: 0; border-radius: 14px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); text-align: center; transform: scale(.95); transition: transform .2s var(--ds-ease-in-out); }
.capital-watchlist-confirm-open .capital-watchlist-confirmbox { transform: scale(1); }
.capital-watchlist-confirmtitle { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.capital-watchlist-confirmdesc { margin-top: 8px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.capital-watchlist-confirmdesc strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.capital-watchlist-confirmactions { display: flex; gap: 10px; margin-top: 20px; }
/* 次要按钮灰底用 button-primary-dimmed（官方给"次要按钮"的实心档）：
   interactive-bg-hover 在浅色只有 6%，两只按钮在白色确认盒上就只剩边框里的空气。 */
.capital-watchlist-confirmbtn { flex: 1 1 0; height: 36px; border: none; border-radius: 10px; background: var(--dsw-alias-button-primary-dimmed); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
.capital-watchlist-confirmbtn:hover { background: var(--dsw-alias-interactive-bg-hover-accent); }
.capital-watchlist-confirmdanger { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 15%, transparent); color: var(--dsw-alias-state-error-primary); }
.capital-watchlist-confirmdanger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent); }
`

function installStyles() {
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== 'function') return undefined
  if (doc.querySelector(`style[data-${STYLE_TAG}]`)) return undefined
  const node = doc.createElement('style')
  node.setAttribute(`data-${STYLE_TAG}`, '')
  node.textContent = CSS
  const host = doc.head ?? doc.body
  if (host === undefined || typeof host.appendChild !== 'function') return undefined
  host.appendChild(node)
  return () => node.remove()
}

/** 与 host 路由的唯一出口：JSON 进、JSON 出，业务失败按 code 上抛（HTTP 401/403 也上抛）。 */
async function call(path, { query, body, signal } = {}) {
  const url = query !== undefined ? `${ROUTE}${path}?${query}` : `${ROUTE}${path}`
  const init = body === undefined
    ? { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', signal }
  const response = await fetch(url, init)
  const text = await response.text()
  let payload = {}
  try {
    payload = text.length > 0 ? JSON.parse(text) : {}
  } catch {
    throw new Error(`HTTP ${response.status}`)
  }
  if (!response.ok && payload.code === undefined) payload = { ...payload, code: 'fuyao_unavailable' }
  if (payload.ok === false || (payload.code !== undefined && payload.code !== null)) {
    const error = new Error(payload.code ?? 'fuyao_unavailable')
    error.code = payload.code ?? 'fuyao_unavailable'
    error.candidates = payload.candidates
    throw error
  }
  return payload
}

const blank = () => ({
  open: false,
  loading: false,
  refreshing: false,
  searching: false,
  items: [],
  candidates: [],
  truncated: false,
  query: '',
  /** 下拉是否盖在清单上：由输入打开、由选中/点到框外收起（Esc 也收，见组件的 onKeyDown）。 */
  dropdownOpen: false,
  /**
   * 行内「更多」菜单开在哪一行（`thscode`；null = 都关着）。开合状态住 store 而不是组件的
   * `useState`：面板关掉再打开时，`open()` 的 `...blank()` 会把上一轮的菜单一起收走。
   */
  rowMenu: null,
  /** 整批共用的一次刷新时刻（底部那一行就报它）。 */
  refreshed_at: null,
  /** 整批级失败：红字跟在「刷新报价」下面（数据不可信那一档）。 */
  error: null,
  /**
   * 搜索这一路失败（限流 / 服务不可用）：黄字占下拉的 hint 位。
   * 与 `addError` **分开两个字段**是刻意的——两者清空的时机不同（见 `onQueryChange`）。
   */
  searchError: null,
  /** 添加动作的失败（list_full / ambiguous）：与输入无关，显示在搜索区下方，改字不清它。 */
  addError: null,
  /** 逐标的失败：只影响那一行。 */
  failures: {},
})

/**
 * 一个会话一个 surface（座位是 session scope，`inject(sessionId)` 每会话调一次）。
 * 开合与数据全住在这一个 store 里，组件通过 `useDialog` 订阅。
 */
class WatchlistSurface {
  constructor() {
    this.store = createSnapshotStore(blank())
    this.searchController = null
    this.timer = null
    this.pending = null
    /** 上一次**真正发出去**的查询词（去重用；`composing` 期间的拼音片段不算发过）。 */
    this.lastQuery = null
    this.composing = false
  }

  get state() {
    return this.store
  }

  get snapshot() {
    return this.store.getSnapshot()
  }

  patch(changes) {
    this.store.update((draft) => Object.assign(draft, changes))
  }

  /** 打开即一次数据请求：清单先出，报价同一次动作里刷一次（空清单不出网）。 */
  open() {
    this.patch({ ...blank(), open: true, loading: true })
    this.load().then(() => this.refresh(), () => this.patch({ loading: false }))
  }

  close() {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.searchController !== null) this.searchController.abort()
    this.lastQuery = null
    this.composing = false
    this.patch({ open: false, rowMenu: null })
  }

  async load() {
    const payload = await call('/list')
    this.patch({ items: payload.items ?? [], seeded_at: payload.seeded_at, loading: false })
  }

  /** 单闸门：开面板与手动刷新共用，重复点击不会排第二个请求。 */
  refresh() {
    if (this.pending !== null) return this.pending
    this.patch({ refreshing: true })
    const running = call('/refresh', { body: {} })
      .then((payload) => {
        const failures = {}
        for (const item of payload.failures ?? []) failures[item.thscode] = item.code
        this.patch({
          items: payload.items ?? this.snapshot.items,
          // 整批一条都没落地时宿主回 `null`：底部那行时间讲的是"最后一次真取到数"，
          // 跟着一次失败的点击往前走，就成了每一行都陈旧、只有页脚是新的。
          refreshed_at: payload.refreshed_at ?? this.snapshot.refreshed_at,
          failures,
          error: payload.error ? { code: payload.error.code, partial: true } : null,
        })
      })
      .catch((error) => {
        this.patch({ error: { code: error.code ?? 'fuyao_unavailable', partial: this.snapshot.items.length > 0 } })
      })
      .finally(() => {
        this.patch({ refreshing: false })
        this.pending = null
      })
    this.pending = running
    return running
  }

  /**
   * 输入框每敲一下都走这里，但**敲字 ≠ 要查**——`/search` 直连上游且无缓存，一次输入
   * 逐字母出网就是"打爆上游"的那条路（中文尤其明显）。三条闸：
   *  1. 尾部防抖：停手 `SEARCH_DEBOUNCE_MS` 才发，中途的字符只作废上一个定时器；
   *  2. IME 合成期不发：拼音输入法逐字母敲的是 `input` 事件，`ning` / `ningd` 那串片段
   *     既查不出东西（每次都是"没有匹配的标的"闪一下），又不是用户要的词；
   *  3. 同一个词不重发：清空重打、光标移位、compositionend 之后浏览器再补一次 `input`，
   *     都不该多出一次网。
   * 永远只有一条在途请求（`search` 里 abort 上一条）。
   */
  onQueryChange(query) {
    const trimmed = query.trim()
    // 改字清的是"上一次搜索没成"（那一行正被新的在途请求取代）；**不清** `addError`——
    // `list_full` 讲的是清单，跟输入框里是什么字无关。
    this.patch({ query, searchError: null, dropdownOpen: trimmed.length > 0 })
    if (this.timer !== null) clearTimeout(this.timer)
    if (trimmed.length === 0) {
      if (this.searchController !== null) this.searchController.abort()
      this.lastQuery = null
      this.patch({ candidates: [], truncated: false, searching: false })
      return
    }
    if (this.composing === true || trimmed === this.lastQuery) return
    this.timer = setTimeout(() => this.search(trimmed), SEARCH_DEBOUNCE_MS)
  }

  /** 合成开始：这段输入不是查询词，先把在途的防抖撤掉（上一次上屏的词已经没有意义了）。 */
  beginComposition() {
    this.composing = true
    if (this.timer !== null) clearTimeout(this.timer)
  }

  /** 上屏：这一刻才拿真正的词走一次正常路径。 */
  endComposition(query) {
    this.composing = false
    this.onQueryChange(query)
  }

  hideDropdown() {
    this.patch({ dropdownOpen: false })
  }

  /** 行内「更多」键：再点一次就收起（同一个键既开又关，不用去别处找关闭入口）。 */
  toggleRowMenu(thscode) {
    this.patch({ rowMenu: this.snapshot.rowMenu === thscode ? null : thscode })
  }

  /** 官方 Menu 的 onClose（点到外面 / Escape）与选中之后都走这里。 */
  closeRowMenu() {
    if (this.snapshot.rowMenu !== null) this.patch({ rowMenu: null })
  }

  async search(query) {
    this.lastQuery = query
    if (this.searchController !== null) this.searchController.abort()
    const controller = new AbortController()
    this.searchController = controller
    this.patch({ searching: true, searchError: null })
    try {
      const payload = await call('/search', { query: `q=${encodeURIComponent(query)}`, signal: controller.signal })
      this.patch({ candidates: payload.items ?? [], truncated: payload.truncated === true, searching: false })
    } catch (error) {
      if (error.name === 'AbortError') return
      // 失败不记在"这个词查过了"的账上：同样几个字重打一遍还得能再出网。
      if (this.lastQuery === query) this.lastQuery = null
      // 走 `searchError` 而不是 `addError`：它占下拉的 hint 位，替换掉「没有匹配的标的」——
      // 同一屏不许一边说"没有这个票"、一边说"服务限流"（候选清空了，noHit 本来就会亮起来）。
      this.patch({ candidates: [], truncated: false, searching: false, searchError: { code: error.code ?? 'fuyao_unavailable' } })
    }
  }

  async add(candidate) {
    try {
      await call('/add', { body: { thscode: candidate.thscode } })
      this.patch({ addError: null, candidates: [], query: '', dropdownOpen: false })
      this.lastQuery = null
      await this.load()
      // 添加是一次完整动作：读完清单顺手刷一次报价，新行当场就有价。停在「未刷新」
      // 等于把用户刚加的东西留成半成品——开面板那一步本来就是同一套 load→refresh。
      await this.refresh()
    } catch (error) {
      // 歧义与超限是"添加"这个动作的失败：留在搜索区（黄），不去占刷新那条红字的位置。
      this.patch({ addError: { code: error.code ?? 'fuyao_unavailable', candidates: error.candidates } })
      if (error.candidates !== undefined) this.patch({ candidates: error.candidates, truncated: false })
    }
  }

  async remove(thscode) {
    const before = this.snapshot.items
    this.patch({ items: before.filter((row) => row.thscode !== thscode), rowMenu: null })
    try {
      await call('/remove', { body: { thscode } })
    } catch {
      this.patch({ items: before })
    }
  }

  /**
   * 置顶：先把这一行提到第一行（乐观），再让宿主把 `pinned_at` 写进域。
   * 失败回滚成原顺序——与 `remove` 同一条口径：面板不弹错框，行自己弹回去就是回执。
   * 返回的 `items` 是宿主的排序真值（服务端只记时间戳，顺序由读法决定）。
   */
  async pin(thscode) {
    const before = this.snapshot.items
    const target = before.find((row) => row.thscode === thscode)
    if (target === undefined) return
    this.patch({ items: [target, ...before.filter((row) => row.thscode !== thscode)], rowMenu: null })
    try {
      const payload = await call('/pin', { body: { thscode } })
      if (Array.isArray(payload.items)) this.patch({ items: payload.items })
    } catch {
      this.patch({ items: before })
    }
  }

  /**
   * 留档后门：**面板上没有按钮**（用户反馈"挺那个啥的"）。真要用的时候，
   * 从 devtools 拿到该会话的 surface 调 `await surface.copyToClipboard()`。
   */
  async copyToClipboard() {
    const lines = this.snapshot.items.map((row) => [
      row.thscode,
      row.name,
      TYPE_LABELS[row.asset_type] ?? row.asset_type,
      row.quote?.price ?? '',
      row.quote?.change_pct ?? '',
      row.quote?.captured_at ?? '',
    ].join('\t')).join('\n')
    await navigator.clipboard.writeText(lines)
    return lines
  }

  dispose() {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.searchController !== null) this.searchController.abort()
  }
}

function formatTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const date = new Date(value)
  const pad = (input) => String(input).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 类型徽标：候选行与数据行共用同一支笔（文案与配色都在 TYPE_* 里一次对齐）。 */
function TypeTag({ assetType }) {
  return h('span', { className: `capital-watchlist-tag ${TYPE_TONES[assetType] ?? 'capital-watchlist-tag-stock'}` }, TYPE_LABELS[assetType] ?? assetType)
}

/**
 * 最新价在上、涨跌幅在下，右对齐；两位小数，红涨绿跌按 A 股习惯。
 * "这一行本次没取到数"**不是**"这一行没有数"：后端只覆写成功的记录，上一次成功的快照仍在
 * `quote` 里，所以画法是四态而不是两态——
 *  1. 在途且还没有任何值 → skeleton；
 *  2. 本次失败、从来没有过值 → 红色 `—`（数据不可信那一档）+ 原因；
 *  3. 本次失败、但手上有旧快照 → 值照画，两行降一档色，tooltip 说清是哪一刻的；
 *  4. 从没刷过 → 「未刷新」。
 */
function QuoteCell({ quote, failureCode, refreshing, t }) {
  const stale = failureCode !== undefined
  if (quote === null || quote === undefined) {
    if (refreshing === true) {
      return h('div', { className: 'capital-watchlist-quote' },
        h('span', { className: 'capital-watchlist-skeleton capital-watchlist-skeleton-price' }),
        h('span', { className: 'capital-watchlist-skeleton capital-watchlist-skeleton-change' }))
    }
    if (stale) {
      return h('div', { className: 'capital-watchlist-quote', title: t(`error.${failureCode}`) },
        h('div', { className: 'capital-watchlist-price capital-watchlist-quotefailed' }, '—'))
    }
    return h('div', { className: 'capital-watchlist-quote' }, h('div', { className: 'capital-watchlist-price' }, t('notRefreshed')))
  }
  const pct = `${quote.change_pct > 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%`
  const tone = stale
    ? 'capital-watchlist-stale'
    : quote.change_pct > 0 ? 'capital-watchlist-up' : quote.change_pct < 0 ? 'capital-watchlist-down' : 'capital-watchlist-flat'
  return h('div', {
    className: 'capital-watchlist-quote',
    title: stale ? `${t(`error.${failureCode}`)} · ${t('stale')} ${formatTime(quote.captured_at)}` : undefined,
  },
    h('div', { className: stale ? 'capital-watchlist-price capital-watchlist-stale' : 'capital-watchlist-price' }, quote.price.toFixed(2)),
    h('div', { className: `capital-watchlist-change ${tone}` }, pct))
}

function WatchlistDialog({ useDialog, surface, t }) {
  const state = useDialog((value) => value)
  const [busy, setBusy] = useState(false)
  /**
   * 待移除的那一行，走面板内的二次确认层——不是 `window.confirm`：那是宿主窗口级别的系统弹窗，
   * 样式与语言都不归插件管，而且会把"从自选中移除"这件事从面板里搬出去。
   */
  const [pendingRemove, setPendingRemove] = useState(null)

  useEffect(() => () => surface.dispose(), [surface])
  if (!state.open) return null

  const showDropdown = state.dropdownOpen === true
  const confirming = pendingRemove !== null

  // Esc 的归属：确认层 > 下拉 > 整个弹窗（最后一个是官方 Modal 自己的 document 监听）。
  // stopPropagation 让事件不再走到那一层，写法照官方 headless 对话框（directory-picker-browse）。
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    if (confirming) {
      event.stopPropagation()
      setPendingRemove(null)
      return
    }
    if (showDropdown) {
      event.stopPropagation()
      surface.hideDropdown()
    }
  }
  // 点到框外就收起下拉：判据是"焦点离开**搜索段**"，而候选行就住在搜索段里，
  // 所以鼠标点行的那一下（focus 收进 option）不算离开。
  const onBlur = (event) => {
    if (!showDropdown) return
    const next = event.relatedTarget
    if (next !== null && next !== undefined && event.currentTarget?.contains?.(next) === true) return
    surface.hideDropdown()
  }

  const error = state.error
  const notice = error === null || error === undefined
    ? null
    : h('p', { className: 'capital-watchlist-notice', role: 'alert', 'data-code': error.code },
      `${t(`error.${error.code}`)}${error.partial === true ? t('errorSuffix') : ''}`)

  const dropdown = !showDropdown
    ? null
    : h('div', { className: 'capital-watchlist-dropdown', role: 'listbox', 'aria-label': t('title'), 'data-menu-material': 'translucent' },
      state.candidates.map((candidate) => h('button', {
        key: candidate.thscode,
        type: 'button',
        role: 'option',
        className: 'capital-watchlist-option',
        // 整行就是"添加"这个动词（点行选中），title 把这个 affordance 说出来；
        // 已在清单里的候选标 `已添加`（幂等）并整行禁用。
        title: candidate.in_list === true ? t('added') : t('add'),
        disabled: candidate.in_list === true || busy,
        onClick: () => { setBusy(true); surface.add(candidate).finally(() => setBusy(false)) },
      },
        h('span', { className: 'capital-watchlist-optionmain' },
          h('span', { className: 'capital-watchlist-optionname' }, candidate.name),
          h('span', { className: 'capital-watchlist-optioncode' },
            candidate.in_list === true ? `${candidate.ticker} · ${t('added')}` : candidate.ticker)),
        h(TypeTag, { assetType: candidate.asset_type }))),
      state.searching === true
        ? h('div', { className: 'capital-watchlist-hint' }, t('searching'))
        : state.searchError !== null && state.searchError !== undefined
          // **替换** noHit 而不是并排多一条：限流的时候说"没有匹配的标的"，是把服务的故障
          // 说成用户查错了。同一个 hint 槽、同一档材质，只换颜色与 role。
          ? h('div', { className: 'capital-watchlist-hint capital-watchlist-searcherror', role: 'alert', 'data-code': state.searchError.code }, t(`error.${state.searchError.code}`))
          : state.candidates.length === 0
            ? h('div', { className: 'capital-watchlist-hint' }, t('noHit'))
            : null,
      state.truncated ? h('div', { className: 'capital-watchlist-hint' }, t('truncated')) : null)

  const head = state.items.length === 0
    ? null
    : h('div', { className: 'capital-watchlist-grid capital-watchlist-head' },
      // 类型不再是独立一列（并进名称列第二行），所以表头也只剩三格。
      h('span', null, t('colName')),
      // 表头只借报价列的右对齐，不复用数据列的类（那是 14px 与 label-primary，混用一张表头三种字号）。
      h('span', { className: 'capital-watchlist-quote' }, t('colQuote')),
      h('span', { 'aria-hidden': true }, ' '))

  const list = state.loading
    ? h('p', { className: 'capital-watchlist-empty' }, t('loading'))
    : state.items.length === 0
      ? h('p', { className: 'capital-watchlist-empty' }, t('empty'))
      : h('div', { className: 'capital-watchlist-list' }, state.items.map((item, index) => h('div', {
        key: item.thscode,
        className: 'capital-watchlist-grid capital-watchlist-row',
        'data-thscode': item.thscode,
      },
        h('span', { className: 'capital-watchlist-namewrap' },
          h('span', { className: 'capital-watchlist-name', title: `${item.name} ${item.ticker}` }, item.name),
          // 代码与类型徽标同处第二行（用户反馈：类型单占一列太累赘）。
          h('span', { className: 'capital-watchlist-codeline' },
            h('span', { className: 'capital-watchlist-code' }, item.ticker),
            h(TypeTag, { assetType: item.asset_type }))),
        h(QuoteCell, { quote: item.quote, failureCode: state.failures[item.thscode], refreshing: state.refreshing, t }),
        // 行内动作收进官方 Menu（portal）：就地在滚动容器里画会被裁掉，见文件头。
        h(Menu, {
          open: state.rowMenu === item.thscode,
          anchor: h('button', {
            type: 'button',
            className: 'capital-watchlist-more',
            disabled: busy,
            title: t('more'),
            'aria-label': `${t('more')} ${item.name}`,
            'aria-haspopup': 'menu',
            'aria-expanded': state.rowMenu === item.thscode,
            onClick: () => surface.toggleRowMenu(item.thscode),
          }, h(IconEllipsisOutlineRegular, { size: 14 })),
          items: [
            // 已经在第一行就没有可置顶的位移：这一条置灰，菜单不长出一堆 "取消置顶" 的反向动作。
            { id: 'pin', label: t('pin'), icon: h(IconPinOutlineRegular, { size: 14 }), disabled: index === 0 },
            { id: 'remove', label: t('remove'), icon: h(IconTrashOutlineRegular, { size: 14 }), danger: true },
          ],
          onSelect: (id) => {
            surface.closeRowMenu()
            if (id === 'pin') surface.pin(item.thscode)
            else setPendingRemove(item)
          },
          onClose: () => surface.closeRowMenu(),
          align: 'end',
          portal: true,
          className: 'capital-watchlist-actions',
        }))))

  const confirm = h('div', {
    className: confirming ? 'capital-watchlist-confirm capital-watchlist-confirm-open' : 'capital-watchlist-confirm',
    'aria-hidden': confirming ? undefined : 'true',
  },
    h('div', { className: 'capital-watchlist-confirmbox', role: confirming ? 'alertdialog' : undefined, 'aria-label': t('confirmTitle') },
      h('div', { className: 'capital-watchlist-confirmtitle' }, t('confirmTitle')),
      confirming
        ? h('p', { className: 'capital-watchlist-confirmdesc' },
          t('confirmDescPrefix'), h('strong', null, `${pendingRemove.name} · ${pendingRemove.ticker}`), t('confirmDescSuffix'))
        : null,
      h('div', { className: 'capital-watchlist-confirmactions' },
        h('button', { type: 'button', className: 'capital-watchlist-confirmbtn', onClick: () => setPendingRemove(null) }, t('confirmCancel')),
        h('button', {
          type: 'button',
          className: 'capital-watchlist-confirmbtn capital-watchlist-confirmdanger',
          onClick: () => {
            const row = pendingRemove
            setPendingRemove(null)
            if (row !== null) surface.remove(row.thscode)
          },
        }, t('confirmOk')))))

  return h(Modal, {
    open: true,
    onClose: () => surface.close(),
    title: t('title'),
    // headless：卡片、遮罩、Esc、焦点进出（含 data-modal-autofocus 的回焦）都是官方的，
    // 只有默认 header/body/footer 骨架让给下面这套几何。见 CSS 顶部注释。
    headless: true,
    shortcutModal: 'watchlist',
    className: 'capital-watchlist-dialog',
  },
    h('div', { className: 'capital-watchlist-card', onKeyDown },
      h('div', { className: 'capital-watchlist-header' },
        h('h2', { className: 'capital-watchlist-title' }, t('title')),
        h('button', {
          type: 'button',
          className: 'capital-watchlist-close',
          'aria-label': t('close'),
          onClick: () => surface.close(),
        }, h(IconCloseOutlineRegular, { size: 14 }))),

      h('div', { className: 'capital-watchlist-search', onBlur },
        h('div', { className: 'capital-watchlist-field' },
          h('span', { className: 'capital-watchlist-searchicon' }, h(IconSearchOutlineRegular, { size: 16 })),
          h('input', {
            className: 'capital-watchlist-input',
            'data-modal-autofocus': true,
            value: state.query,
            placeholder: t('searchPlaceholder'),
            onChange: (event) => surface.onQueryChange(event.target.value),
            onCompositionStart: () => surface.beginComposition(),
            onCompositionEnd: (event) => surface.endComposition(event.target.value),
          }),
          // 有字才有清空键（空框再挂一个 X 是纯噪音）。按下不吃焦点：清完接着打字。
          state.query.length > 0
            ? h('button', {
              type: 'button',
              className: 'capital-watchlist-clear',
              title: t('clearInput'),
              'aria-label': t('clearInput'),
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => surface.onQueryChange(''),
            }, h(IconCloseOutlineRegular, { size: 12 }))
            : null),
        dropdown),

      state.addError !== null && state.addError !== undefined
        // 超限与歧义是"添加"这个动作的失败：留在搜索区下方（黄），且**不随改字消失**——
        // `list_full` 讲的是清单满不满，跟输入框里是什么字无关。
        ? h('p', { className: 'capital-watchlist-adderror', role: 'status', 'data-code': state.addError.code }, t(`error.${state.addError.code}`))
        : null,

      head,
      list,

      // 底部一行：左列 = 「刷新报价」动词 + 它自己的整批失败行（报错跟着动词走，不再飘到输入
      // 框下面、离按钮隔一整张表）；右列 = 整批共用的一次更新时间（逐行重复同一个时间是噪音，
      // 顶部再放一个「刷新报价」按钮也与这行重复）。
      h('div', { className: 'capital-watchlist-footer' },
        h('div', { className: 'capital-watchlist-footcol' },
          h('button', {
            type: 'button',
            className: 'capital-watchlist-refresh',
            disabled: state.refreshing || busy,
            onClick: () => { surface.refresh() },
          }, h(IconRefreshOutlineRegular, { size: 14 }), state.refreshing ? t('refreshing') : t('refresh')),
          notice),
        h('span', { className: 'capital-watchlist-updated' },
          `${t('updated')} ${state.refreshed_at === null || state.refreshed_at === undefined ? t('notRefreshed') : formatTime(state.refreshed_at)}`)),

      confirm),
  )
}

function apply(ctx) {
  ctx.effect(installStyles, `${ENTRY_NAME}: styles`)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${ENTRY_NAME}: dictionaries`)

  const surfaces = new Map()
  const surfaceFor = (sessionId) => {
    let surface = surfaces.get(sessionId)
    if (surface === undefined) {
      surface = new WatchlistSurface()
      surfaces.set(sessionId, surface)
    }
    return surface
  }
  ctx.effect(() => () => {
    for (const surface of surfaces.values()) surface.dispose()
    surfaces.clear()
  }, `${ENTRY_NAME}: per-session surfaces`)

  const presetOf = (sessionId) => {
    const row = ctx.sessions?.list?.getSnapshot?.().byId?.[sessionId]
    const value = row?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  }
  /**
   * 投影到达之前 `projectionValues` 整段缺席（实测：`byId` 行里没有这个键）。
   * 这里对每个会话**一次性**催读 `refreshProjections`，让菜单行在投影落地后自己出现——
   * 不是轮询，也没有定时器。
   */
  const nudged = new Set()
  const isCapitalSession = (sessionId) => {
    const preset = presetOf(sessionId)
    if (preset !== undefined) return preset === PRESET
    if (!nudged.has(sessionId)) {
      nudged.add(sessionId)
      Promise.resolve(ctx.sessions?.refreshProjections?.(sessionId)).catch(() => {})
    }
    return false
  }

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: 'capital-watchlist-dialog',
    order: 3,
    locale: NS,
    inject: (sessionId) => {
      const surface = surfaceFor(sessionId)
      return {
        hooks: { dialog: surface.state },
        surface,
      }
    },
  }, WatchlistDialog))

  ctx.inject(['commandUi'], (scope) => {
    const t = ctx.locale.bind(NS)
    scope.effect(() => scope.commandUi.register({
      name: 'watchlist',
      label: () => t('command.label'),
      // 行面上**不带**英文别名（2026-09-29 用户点名删掉）：菜单过滤只匹配 label / detail，命令名不参与，
      // 所以过去把 `watchlist` 塞进 description 换的是「/watch 打得开这行」，代价是每个中文用户都看见
      // 一行尾巴上多出的英文单词。删掉后过滤面只剩「自选股」与这句描述；typed 路径不受影响——
      // Enter 认的是与注册名**完全相等**的 bare token（`dsh-client-ui-commands`：contributions act on the
      // bare token only），`/watchlist`↵ 照开，`/watch`↵ 本来就不开（不是合法命令名）。
      description: () => t('command.description'),
      icon: IconChecklistOutlineRegular,
      available: (session) => isCapitalSession(session.sessionId),
      ui: {
        kind: 'action',
        run: (session) => { surfaceFor(session.sessionId).open() },
      },
    }), `${ENTRY_NAME}: /watchlist contribution`)
  })

  ctx.logger?.info?.(`${ENTRY_NAME}: 客户端半边已挂载（/watchlist 菜单行 + 自选股弹窗）`)
}

exports.name = ENTRY_NAME
exports.inject = ['slots', 'locale', 'commandUi', 'sessions']
exports.apply = apply
