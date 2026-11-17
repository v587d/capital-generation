/**
 * Browser half of `@v587d/watchlist`: a session-scoped overlay entry rendered by
 * the official headless `Modal`, plus a preset-gated `commandUi` contribution.
 * The overlay mounts in every session, so it returns null when closed and never
 * fetches while closed. No turn-tail slot and no custom session events (closed
 * vocabulary, AGENTS.md §7). Only the search debounce is a timer.
 */
const { createElement: h, useEffect, useRef, useState } = require('react')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
// Official icons only; the set has no wallet/pie/coin glyph, so stepper keys use text −/+.
// `MenuItemButton` gives the remove row official geometry and its separator line.
const { IconChecklistOutlineRegular, IconCloseOutlineRegular, IconDatabaseOutlineRegular, IconEllipsisOutlineRegular, IconGoalOutlineRegular, IconListPenOutlineRegular, IconPinOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, Menu, MenuItemButton, Modal, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')
// Holdability and ceiling come from the same module the host gate uses.
const { isHoldable, weightCeiling } = require('./holding-rules.js')

const ENTRY_NAME = 'capital-watchlist'
const NS = 'capital.watchlist'
const SLOT = 'conversation.input.overlay'
const ROUTE = '/capital-watchlist'
const PRESET = 'capital-generation'
const SEARCH_DEBOUNCE_MS = 300
/** Weight step in percentage points; no snapping (37.5 stays 37.5 ± 10). */
const HOLDING_STEP = 10
const STYLE_TAG = 'capital-watchlist-css'

const zh = {
  'command.label': '自选股',
  'command.description': '添加 / 查看 / 删除自选股',
  title: '自选股',
  close: '关闭',
  searchPlaceholder: '输入证券代码或名称，支持A股/港股/美股',
  add: '添加',
  added: '已添加',
  refreshing: '刷新中…',
  refresh: '刷新报价',
  loading: '正在读取清单…',
  empty: '还没有自选股，用上面的输入框添加。',
  colName: '名称',
  colQuote: '最新价 / 涨跌幅',
  colAction: '操作',
  updated: '更新时间',
  notRefreshed: '未刷新',
  /** Stale tooltip: failure reason · last snapshot time. */
  stale: '上一次快照',
  /** Exchange-local time, tooltip only; no timezone conversion (no offset/DST table). */
  exchangeTime: '交易所时间',
  /** Price exists but change does not (halted / not open). */
  noChangePct: '暂无涨跌数据',
  /** Badge names the market only; ETF is covered by A-share (same secondary-market quote). */
  typeAShare: 'A股',
  typeHkStock: '港股',
  typeUsStock: '美股',
  typeAIndex: 'A指',
  typeHkIndex: '港指',
  typeUsIndex: '美指',
  /** Prompt-only wording: the Agent picks an endpoint from stock / index / ETF; market comes from thscode. */
  kindStock: '股票',
  kindIndex: '指数',
  kindEtf: 'ETF',
  remove: '移除',
  more: '更多',
  pin: '置顶',
  /** User-reported holding, never broker fact; `0~N` headroom is computed, not stored in the dictionary. */
  holdingWeightLabel: '持仓比例',
  holdingStepper: '持仓比例（每档 10 个百分点）',
  holdingStepUp: '增加持仓比例',
  holdingStepDown: '减少持仓比例',
  /** Shared by row label, switch aria-label and the non-color channel (red name = red-up color). */
  holdingName: '持仓',
  predict: '预测',
  predictTip: 'AI预测',
  review: '复盘',
  reviewTip: 'AI复盘',
  /** Prompt shape is `name (thscode · kind)`; thscode and kind are data, not copy. */
  predictPromptPrefix: '请预测 ',
  predictPromptSuffix: '：未来 5 个交易日的走势与关键点位，说明依据，并给出判断的不确定性。',
  reviewPromptPrefix: '请复盘 ',
  reviewPromptSuffix: '：今日走势与量价、近 20 日趋势、基础面、消息面，给出结论和必要风险评估。',
  searching: '搜索中…',
  /** IME composition: say "wait", never "already checked, no match". */
  composingHint: '输入完成后自动搜索',
  clearInput: '清空输入',
  confirmTitle: '确认移除？',
  confirmDescPrefix: '确定将 ',
  confirmDescSuffix: ' 从自选中移除吗？',
  confirmCancel: '取消',
  confirmOk: '确认移除',
  /** "No more" means a branch filled its own cap; lives at scroll end and never names N. */
  truncated: '没有更多，请输入准确的证券代码或名称。',
  /** Client-side filter over fully fetched candidates: no refetch, no upstream param change. */
  filterAll: '全部',
  filterLabel: '按市场筛选候选',
  filterNoHit: '这个市场下没有匹配的标的。',
  noHit: '没有匹配的标的（A股 / 港股 / 美股，含指数与场内基金）。',
  'error.invalid_query': '输入不被接受',
  'error.not_found': '没有找到该标的',
  'error.ambiguous': '命中多条，请从候选里选一条',
  /** `{max}` comes from the host's `limit`; fall back to the no-number sentence. */
  'error.list_full': '自选股最多 {max} 条，先删一条再加',
  'error.list_full_noMax': '自选股已达上限，先删一条再加',
  'error.credential_missing': '未配置 Fuyao 密钥：在「插件」页的 自动模式卡片里填 API Key（只影响 A 股那一路，港美股照常用）',
  'error.rate_limited': '行情服务限流，请稍后再试',
  'error.fuyao_unavailable': 'A 股行情暂时取不到，请稍后再试',
  'error.tencent_unavailable': '港美股行情暂时取不到，请稍后再试',
  'error.quote_unavailable': '该标的没有可用报价',
  'error.refresh_timeout': '刷新超时，请稍后再试',
  'error.store_unavailable': '自选股存储不可用',
  'error.unauthorized': '登录状态已失效：请先回到宿主窗口重新登录',
  errorSuffix: '（其他标的仍是上一次成功快照）',
  /** One branch failed; other branches still return candidates. */
  'partial.a-share': 'A 股检索不可用：',
  'partial.hk': '港股检索不可用：',
  'partial.us': '美股检索不可用：',
  /* 行情工作台（左侧栏入口 + 主面板）；只读现有报价，不新增数据源。 */
  'desk.panel': '自选股',
  'desk.title': '自选股行情工作台',
  'desk.refresh': '刷新行情',
  'desk.refreshing': '刷新中…',
  'desk.loading': '正在读取自选股…',
  'desk.lastUpdate': '最近更新',
  'desk.notRefreshed': '未刷新',
  'desk.filter': '筛选标的',
  'desk.filterPlaceholder': '名称或代码',
  'desk.group': '分组',
  'desk.allGroups': '全部',
  'desk.newGroup': '分组名称',
  'desk.createGroup': '新建',
  'desk.deleteGroup': '删除分组',
  'desk.noGroup': '未分组',
  'desk.more': '更多操作',
  'desk.noGroupYet': '还没有分组',
  'desk.pin': '置顶',
  'desk.remove': '移除',
  'desk.removeHint': '再点一次删除按钮确认移除',
  'desk.cancel': '取消',
  'desk.empty': '还没有自选股',
  'desk.emptyHint': '用输入框的「自选股」面板添加标的，这里会同步显示。',
  'desk.noMatch': '没有匹配的标的',
  'desk.noMatchHint': '换个关键词，或切回「全部」分组。',
  'desk.selectHint': '选择一只标的查看详情',
  'desk.selectHintBody': '左侧列表按分组筛选；选中后这里显示报价、分时与成交量。',
  'desk.intraday': '当日分时',
  'desk.intradayEmpty': '当前行情接口只返回最新快照',
  'desk.intradayEmptyHint': '接入分时序列后，这里直接绘制当日走势。',
  'desk.volume': '成交量',
  'desk.volumeEmpty': '暂无成交量数据',
  'desk.capturedAt': '快照时间',
  'desk.sourceTime': '交易所时间',
  'desk.groupsOf': '所属分组',
  'desk.kind': '标的类型',
  'desk.colName': '名称',
  'desk.colPrice': '最新',
  'desk.colChange': '涨跌',
  'desk.colAction': '操作',
  'desk.loadFailed': '自选股服务暂不可用',
}

const en = {
  'command.label': 'Watchlist',
  'command.description': 'Add / view / remove watched symbols',
  title: 'Watchlist',
  close: 'Close',
  searchPlaceholder: 'Symbol code or name — A-share / HK / US',
  add: 'Add',
  added: 'Added',
  refreshing: 'Refreshing…',
  refresh: 'Refresh quotes',
  loading: 'Loading list…',
  empty: 'No symbols yet — use the input above to add one.',
  colName: 'Symbol',
  colQuote: 'Last / change',
  colAction: 'Actions',
  updated: 'Updated',
  notRefreshed: 'Not refreshed',
  stale: 'last snapshot',
  exchangeTime: 'exchange time',
  noChangePct: 'No change data yet',
  typeAShare: 'A-Share',
  typeHkStock: 'HK',
  typeUsStock: 'US',
  typeAIndex: 'A-Index',
  typeHkIndex: 'HK-Index',
  typeUsIndex: 'US-Index',
  kindStock: 'stock',
  kindIndex: 'index',
  kindEtf: 'ETF',
  remove: 'Remove',
  more: 'More',
  pin: 'Pin to top',
  // Holding family: five keys; row label and switch share one singular noun.
  holdingWeightLabel: 'Holding weight',
  holdingStepper: 'Holding weight, in steps of 10 percentage points',
  holdingStepUp: 'Increase holding weight',
  holdingStepDown: 'Decrease holding weight',
  holdingName: 'Holding',
  /** Predict / Review labels are constrained by the fixed 52px action column. */
  predict: 'Predict',
  predictTip: 'AI prediction',
  review: 'Review',
  reviewTip: 'AI review',
  predictPromptPrefix: 'Predict ',
  predictPromptSuffix: ' over the next 5 sessions: the likely path and key levels, the evidence behind the call, and how uncertain it is.',
  reviewPromptPrefix: 'Review ',
  reviewPromptSuffix: ' with today\'s trend and volume, the last 20 sessions, fundamental, news, then a conclusion and the necessary risks analysis.',
  searching: 'Searching…',
  composingHint: 'Search runs when you finish typing',
  clearInput: 'Clear input',
  confirmTitle: 'Remove this symbol?',
  confirmDescPrefix: 'Remove ',
  confirmDescSuffix: ' from your watchlist?',
  confirmCancel: 'Cancel',
  confirmOk: 'Remove',
  truncated: 'No more candidates — enter an accurate code or name.',
  filterAll: 'All',
  filterLabel: 'Filter candidates by market',
  filterNoHit: 'No matching symbol in this market.',
  noHit: 'No matching symbol (A-share / HK / US, including indices and listed funds).',
  'error.invalid_query': 'Input not accepted',
  'error.not_found': 'Symbol not found',
  'error.ambiguous': 'Multiple hits — pick one candidate',
  'error.list_full': 'Watchlist holds at most {max} symbols — remove one first',
  'error.list_full_noMax': 'Watchlist is full — remove one first',
  'error.credential_missing': 'No Fuyao API key: set it on the Capital card in the Plugins page (A-share quotes only — HK and US keep working)',
  'error.rate_limited': 'Quote service is rate limited — try again later',
  'error.fuyao_unavailable': 'A-share quotes unavailable — try again later',
  'error.tencent_unavailable': 'HK / US quotes unavailable — try again later',
  'error.quote_unavailable': 'No quote for this symbol',
  'error.refresh_timeout': 'Refresh timed out — try again later',
  'error.store_unavailable': 'Watchlist storage unavailable',
  'error.unauthorized': 'Session expired — sign back in to the host first',
  errorSuffix: ' (other symbols still show their last good snapshot)',
  'partial.a-share': 'A-share search unavailable: ',
  'partial.hk': 'HK search unavailable: ',
  'partial.us': 'US search unavailable: ',
  /* Market desk (sidebar entry + main panel); reads the existing quotes, no new data source. */
  'desk.panel': 'Watchlist',
  'desk.title': 'Watchlist market desk',
  'desk.refresh': 'Refresh quotes',
  'desk.refreshing': 'Refreshing…',
  'desk.loading': 'Loading watchlist…',
  'desk.lastUpdate': 'Last update',
  'desk.notRefreshed': 'Not refreshed',
  'desk.filter': 'Filter symbols',
  'desk.filterPlaceholder': 'Name or code',
  'desk.group': 'Group',
  'desk.allGroups': 'All',
  'desk.newGroup': 'Group name',
  'desk.createGroup': 'Create',
  'desk.deleteGroup': 'Delete group',
  'desk.noGroup': 'Ungrouped',
  'desk.more': 'More actions',
  'desk.noGroupYet': 'No groups yet',
  'desk.pin': 'Pin',
  'desk.remove': 'Remove',
  'desk.removeHint': 'Press remove again to confirm',
  'desk.cancel': 'Cancel',
  'desk.empty': 'No symbols yet',
  'desk.emptyHint': 'Add symbols from the watchlist panel in the composer; they appear here.',
  'desk.noMatch': 'No symbols match',
  'desk.noMatchHint': 'Try another term, or switch back to All.',
  'desk.selectHint': 'Select a symbol',
  'desk.selectHintBody': 'The left list filters by group; the quote, intraday and volume panels follow the selection.',
  'desk.intraday': 'Intraday',
  'desk.intradayEmpty': 'The quote endpoint returns a snapshot only',
  'desk.intradayEmptyHint': 'Once an intraday series is available, the same-session trend draws here.',
  'desk.volume': 'Volume',
  'desk.volumeEmpty': 'No volume data',
  'desk.capturedAt': 'Captured',
  'desk.sourceTime': 'Exchange time',
  'desk.groupsOf': 'Groups',
  'desk.kind': 'Instrument',
  'desk.colName': 'Symbol',
  'desk.colPrice': 'Last',
  'desk.colChange': 'Change',
  'desk.colAction': 'Actions',
  'desk.loadFailed': 'Watchlist service unavailable',
}

/**
 * `asset_type` → badge copy key. Six market-only badges: product type lives in the
 * prompt wording, and HK ETFs are indistinguishable from stocks at search time.
 */
const TYPE_LABEL_KEYS = {
  'a-share': 'typeAShare',
  'hk-stock': 'typeHkStock',
  'us-stock': 'typeUsStock',
  'a-share-index': 'typeAIndex',
  'hk-index': 'typeHkIndex',
  'us-index': 'typeUsIndex',
  // ETF trades on the A-share secondary market, so it shares that badge.
  'fund-etf': 'typeAShare',
}
/** Endpoint family for prompts, separate from the market badge. */
const KIND_LABEL_KEYS = {
  'a-share': 'kindStock',
  'hk-stock': 'kindStock',
  'us-stock': 'kindStock',
  'a-share-index': 'kindIndex',
  'hk-index': 'kindIndex',
  'us-index': 'kindIndex',
  'fund-etf': 'kindEtf',
}
/** Unknown types print verbatim rather than a wrong label. */
function typeLabel(assetType, t) {
  const key = TYPE_LABEL_KEYS[assetType]
  return key === undefined ? String(assetType ?? '') : t(key)
}
function kindLabel(assetType, t) {
  const key = KIND_LABEL_KEYS[assetType]
  return key === undefined ? String(assetType ?? '') : t(key)
}

/**
 * Currency is stored but not rendered; known cost: `-R` counters are HKD-market,
 * CNY-denominated and look identical to HKD quotes.
 */

/**
 * Strip zero-width and bidi controls before display; the host uses the same class
 * (`INVISIBLE_PATTERN`), and tests compare both sides verbatim.
 */
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu

function scrubInvisible(value) {
  return String(value ?? '').replace(INVISIBLE_CHARS, '')
}

/** Host rows are scrubbed once so display, tooltip, aria-label and prompt share one name. */
function cleanRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => (row === null || typeof row !== 'object' ? row : { ...row, name: scrubInvisible(row.name) })) : rows
}
/** Color encodes market only; product type is carried by the label. */const TYPE_TONES = {
  'a-share': 'capital-watchlist-tag-cn',
  'a-share-index': 'capital-watchlist-tag-cn',
  'fund-etf': 'capital-watchlist-tag-cn',
  'hk-stock': 'capital-watchlist-tag-hk',
  'hk-index': 'capital-watchlist-tag-hk',
  'us-stock': 'capital-watchlist-tag-us',
  'us-index': 'capital-watchlist-tag-us',
}

/** Client-side filter over fully fetched candidates; `exchange` stores the market. */
const MARKET_FILTERS = [{ id: 'all' }, { id: 'cn', label: 'CN' }, { id: 'hk', label: 'HK' }, { id: 'us', label: 'US' }]
const marketIdOf = (candidate) => (candidate.exchange === 'HK' ? 'hk' : candidate.exchange === 'US' ? 'us' : 'cn')

/**
 * Official Modal classes are CSS-module hashes, so the dialog uses `headless: true`
 * and our own classes; repeated class names raise specificity over `.dialog`.
 * Colors use host tokens by role; menu surfaces pair `--dsw-specific-menu` with its
 * backdrop filter. The red/green pair is the only literal color.
 */
const CSS = `
.capital-watchlist-dialog.capital-watchlist-dialog { width: min(420px, 92vw); max-height: 100%; padding: 0; gap: 0; border-radius: 18px; }
.capital-watchlist-card { position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden; border-radius: 18px; --capital-watchlist-up: #d1493f; --capital-watchlist-down: #17a063; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.capital-watchlist-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 18px 20px 14px; }
.capital-watchlist-title { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: .3px; color: var(--dsw-alias-label-primary); }
.capital-watchlist-close { flex: none; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.capital-watchlist-close:hover { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.capital-watchlist-search { position: relative; padding: 0 20px 16px; }
.capital-watchlist-field { position: relative; display: flex; align-items: center; height: 42px; padding: 0 14px 0 40px; border: none; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); transition: box-shadow .2s var(--ds-ease-in-out); }
.capital-watchlist-field:focus-within { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.capital-watchlist-searchicon { position: absolute; left: 14px; display: inline-flex; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.capital-watchlist-input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; }
.capital-watchlist-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-clear { flex: none; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.capital-watchlist-clear:hover { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
/* max-height must equal the .capital-watchlist-list-open min-height (test pins both). */
.capital-watchlist-dropdown { position: absolute; top: calc(100% - 8px); left: 20px; right: 20px; z-index: 20; display: flex; flex-direction: column; max-height: 320px; overflow: hidden; background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); border: 0; border-radius: 12px; --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); animation: capital-watchlist-drop .18s var(--ds-ease-in-out); }
.capital-watchlist-filter { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.capital-watchlist-options { flex: 0 1 auto; min-height: 0; overflow-y: auto; }
.capital-watchlist-filterbtn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border: none; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 12px; line-height: 16px; cursor: pointer; }
.capital-watchlist-filterbtn:hover { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.capital-watchlist-filterbtn[aria-pressed="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-label-primary); }
.capital-watchlist-filtercount { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
@keyframes capital-watchlist-drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes capital-watchlist-breathe { 0% { opacity: 1; } 40% { opacity: .6; } 80%, 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .capital-watchlist-dropdown { animation: none; } .capital-watchlist-skeleton { animation: none; } }
.capital-watchlist-option { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border: none; border-bottom: .5px solid var(--dsw-alias-border-l2); background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
.capital-watchlist-option:last-of-type { border-bottom: none; }
/* Reads aria-disabled, not :disabled: real disabled would drop focus and close the dropdown. */
.capital-watchlist-option:hover:not([aria-disabled="true"]) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
.capital-watchlist-option[aria-disabled="true"] { opacity: .45; cursor: not-allowed; }
.capital-watchlist-close:focus-visible, .capital-watchlist-clear:focus-visible, .capital-watchlist-option:focus-visible, .capital-watchlist-filterbtn:focus-visible, .capital-watchlist-more:focus-visible, .capital-watchlist-predict:focus-visible, .capital-watchlist-review:focus-visible, .capital-watchlist-refresh:focus-visible, .capital-watchlist-confirmbtn:focus-visible, .capital-watchlist-stepperbtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.capital-watchlist-optionmain { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.capital-watchlist-optionname { font-size: 14px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.capital-watchlist-optioncode { font-size: 12px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-addbtn { flex: none; padding: 3px 9px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); border-radius: 999px; corner-shape: round; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 15px; font-weight: 500; }
.capital-watchlist-option:hover:not([aria-disabled="true"]) .capital-watchlist-addbtn { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
.capital-watchlist-addbtn[data-state="added"] { border-color: var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.capital-watchlist-tag { flex: none; display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 11px; line-height: 14px; font-weight: 500; }
/* Badge uses a solid tertiary background; state color as text uses the label tier. */
.capital-watchlist-tag-cn { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-tertiary, color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)); }
.capital-watchlist-tag-hk { color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); }
.capital-watchlist-tag-us { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); }
/* Header and rows are separate grids, so 92px / 84px must stay fixed for column alignment. */
.capital-watchlist-grid { display: grid; grid-template-columns: 1fr 92px 84px; gap: 8px; align-items: center; }
.capital-watchlist-head { padding: 0 20px 8px; font-size: 12px; line-height: 18px; letter-spacing: .2px; white-space: nowrap; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-headaction { text-align: right; }
.capital-watchlist-list { max-height: 300px; padding: 0 12px 8px; overflow-y: auto; }
/* Must equal the dropdown max-height; min wins over max-height while open. */
.capital-watchlist-list-open { min-height: 320px; }
.capital-watchlist-row { padding: 11px 8px; border-radius: 10px; transition: background .15s var(--ds-ease-in-out); }
.capital-watchlist-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.capital-watchlist-namewrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.capital-watchlist-name { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.capital-watchlist-name-held { color: var(--capital-watchlist-up); }
.capital-watchlist-codeline { display: flex; align-items: center; gap: 10px; min-width: 0; }
.capital-watchlist-code { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* Right-aligned numbers end at the same edge, so padding-right is the only gap before actions. */
.capital-watchlist-quote { min-width: 0; padding-right: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.capital-watchlist-price { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.capital-watchlist-change { margin-top: 1px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.capital-watchlist-up { color: var(--capital-watchlist-up); }
.capital-watchlist-down { color: var(--capital-watchlist-down); }
.capital-watchlist-flat { color: var(--dsw-alias-label-secondary); }
.capital-watchlist-nodata { color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-quotefailed { color: var(--dsw-alias-state-error-primary); }
/* Failed refresh keeps the last good snapshot; the tooltip names its time. */
.capital-watchlist-stale { color: var(--dsw-alias-label-secondary); }
.capital-watchlist-skeleton { display: block; height: 12px; margin: 2px 0 0 auto; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); animation: capital-watchlist-breathe 2s cubic-bezier(.36, 0, .64, 1) infinite; }
.capital-watchlist-skeleton-price { width: 68px; }
.capital-watchlist-skeleton-change { width: 44px; height: 10px; }
.capital-watchlist-more { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.capital-watchlist-more:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.capital-watchlist-more:disabled { opacity: .45; cursor: not-allowed; }
.capital-watchlist-actions { justify-content: flex-end; }
.capital-watchlist-rowactions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; min-width: 0; }
/* 26×24 is the minimum hit target for icon-only actions. */
.capital-watchlist-review, .capital-watchlist-predict { flex: none; width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.capital-watchlist-review:hover:not(:disabled), .capital-watchlist-predict:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.capital-watchlist-review:disabled, .capital-watchlist-predict:disabled { opacity: .45; cursor: not-allowed; }
.capital-watchlist-footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 20px 18px; border-top: .5px solid var(--dsw-alias-border-l2); }
.capital-watchlist-footcol { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.capital-watchlist-refresh { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
.capital-watchlist-refresh:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
.capital-watchlist-refresh:disabled { opacity: .45; cursor: not-allowed; }
.capital-watchlist-updated { font-size: 12px; line-height: 34px; color: var(--dsw-alias-label-tertiary); }
.capital-watchlist-hint { flex: none; padding: 8px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.capital-watchlist-searcherror { color: var(--dsw-alias-state-warn-label); }
.capital-watchlist-adderror { padding: 0 20px 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label); }
.capital-watchlist-notice { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.capital-watchlist-empty { padding: 24px 20px; text-align: center; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.capital-watchlist-loaderror { color: var(--dsw-alias-state-error-primary); }
.capital-watchlist-confirm { position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; border-radius: 18px; background: var(--dsw-alias-bg-mask-1); opacity: 0; visibility: hidden; transition: opacity .2s var(--ds-ease-in-out), visibility .2s; }
.capital-watchlist-confirm-open { opacity: 1; visibility: visible; }
/* Width follows the card, or a narrow window clips the buttons inside overflow:hidden. */
.capital-watchlist-confirmbox { width: min(280px, calc(100% - 24px)); padding: 22px 20px 18px; border: 0; border-radius: 14px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); text-align: center; transform: scale(.95); transition: transform .2s var(--ds-ease-in-out); }
.capital-watchlist-confirm-open .capital-watchlist-confirmbox { transform: scale(1); }
.capital-watchlist-confirmtitle { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.capital-watchlist-confirmdesc { margin-top: 8px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.capital-watchlist-confirmdesc strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.capital-watchlist-confirmactions { display: flex; gap: 10px; margin-top: 20px; }
.capital-watchlist-confirmbtn { flex: 1 1 0; height: 36px; border: none; border-radius: 10px; background: var(--dsw-alias-button-primary-dimmed); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
.capital-watchlist-confirmbtn:hover { background: var(--dsw-alias-interactive-bg-hover-accent); }
.capital-watchlist-confirmdanger { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 15%, transparent); color: var(--dsw-alias-state-error-primary); }
.capital-watchlist-confirmdanger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent); }
/* Portal menu: selectors must be bare classes; card-scoped custom properties do not reach it. */
.capital-watchlist-checkrow { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%; min-height: 34px; padding: 6px 8px; border-radius: var(--dsw-radius-md); font-family: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); text-align: left; }
.capital-watchlist-checkicon { display: inline-flex; flex: none; width: 14px; height: 14px; align-items: center; justify-content: center; color: var(--dsw-alias-menu-icon); }
.capital-watchlist-checklabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.capital-watchlist-stepper { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 34px; padding: 6px 8px; border-radius: var(--dsw-radius-md); font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.capital-watchlist-stepperlabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.capital-watchlist-stepperline { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: none; }
.capital-watchlist-stepperbtn { flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 15px; line-height: 1; cursor: pointer; }
.capital-watchlist-stepperbtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-accent); }
.capital-watchlist-stepperbtn:disabled { opacity: .45; cursor: not-allowed; }
.capital-watchlist-stepperreadout { min-width: 46px; text-align: center; font-size: 13px; line-height: 18px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.capital-watchlist-stepperplaceholder { color: var(--dsw-alias-label-tertiary); }
/* Fixed width: content-sized growth from the stepper row shifts the whole right-aligned menu. */
.capital-watchlist-rows { width: 256px; }
/* Theme has no global border-box reset; the official item padding would overflow the list. */
.capital-watchlist-rows button { box-sizing: border-box; }
/* --- 行情工作台：左侧栏入口 + main 面板。卡片走发丝线，浮层交给官方 Menu。 --- */
.cwd-page { height: 100%; min-height: 0; overflow-y: auto; --cwd-body-h: clamp(520px, 78vh, 860px); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); --cwd-card: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); --capital-watchlist-up: #d1493f; --capital-watchlist-down: #17a063; }
.cwd-inner { max-width: 1180px; margin: 0 auto; padding: 28px 32px 44px; }
.cwd-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.cwd-title { margin: 0; font-size: 26px; line-height: 32px; font-weight: 650; letter-spacing: -.2px; }
.cwd-headactions { display: flex; align-items: center; gap: 14px; flex: none; }
.cwd-updated { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cwd-refresh { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 34px; padding: 0 14px; border: .5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; }
.cwd-refresh:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent); }
.cwd-refresh:disabled { opacity: .45; cursor: not-allowed; }
.cwd-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(430px, 1.35fr); gap: 22px; align-items: stretch; height: var(--cwd-body-h); }
.cwd-card { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; border: .5px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--cwd-card); overflow: hidden; }
.cwd-toolbar { display: flex; flex: none; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 14px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.cwd-field { display: flex; align-items: center; gap: 6px; flex: 1 1 170px; min-width: 0; height: 34px; padding: 0 10px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-tertiary); }
.cwd-field input { flex: 1 1 auto; min-width: 0; height: 100%; padding: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 13px; }
.cwd-field input::placeholder { color: var(--dsw-alias-label-tertiary); }
.cwd-pill { display: inline-flex; align-items: center; gap: 6px; flex: none; max-width: 160px; height: 34px; padding: 0 12px; border: none; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 12.5px; line-height: 20px; cursor: pointer; }
.cwd-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.cwd-pill:disabled { opacity: .45; cursor: not-allowed; }
.cwd-pill span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cwd-groupcreate { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.cwd-groupcreate input { width: 104px; height: 34px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12.5px; }
.cwd-thead, .cwd-row { display: grid; grid-template-columns: minmax(0, 1.6fr) 92px 84px 40px; gap: 10px; align-items: center; }
.cwd-thead { flex: none; padding: 8px 14px; border-bottom: .5px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 16px; letter-spacing: .2px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.cwd-right { text-align: right; }
.cwd-tablebody { flex: 1; min-height: 0; overflow-y: auto; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.cwd-row { padding: 9px 14px; border-bottom: .5px solid var(--dsw-alias-border-l2); transition: background .15s var(--ds-ease-in-out); }
.cwd-row:last-of-type { border-bottom: none; }
.cwd-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.cwd-row[aria-current="true"] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
.cwd-nameline { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cwd-cellname { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 0; border: none; background: transparent; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
.cwd-nametext { flex: 0 1 auto; min-width: 0; font-size: 14px; line-height: 19px; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cwd-codeline { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.cwd-code { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cwd-price { text-align: right; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cwd-pct { text-align: right; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cwd-up { color: var(--capital-watchlist-up); }
.cwd-down { color: var(--capital-watchlist-down); }
.cwd-flat { color: var(--dsw-alias-label-secondary); }
.cwd-stale { color: var(--dsw-alias-label-secondary); }
.cwd-rowactions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; }
.cwd-iconbtn { flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.cwd-iconbtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-label-primary); }
.cwd-iconbtn:disabled { opacity: .45; cursor: not-allowed; }
.cwd-detail { display: flex; flex: 1; flex-direction: column; gap: 14px; min-height: 0; padding: 16px; overflow-y: auto; }
.cwd-detailhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; min-width: 0; }
.cwd-detailname { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 16px; line-height: 22px; font-weight: 600; }
.cwd-detailtext { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cwd-detailcode { margin-top: 3px; font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-tertiary); }
.cwd-bigquote { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
.cwd-bigprice { font-size: 34px; line-height: 40px; font-weight: 650; font-variant-numeric: tabular-nums; }
.cwd-bigpct { font-size: 14px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cwd-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
.cwd-metaitem { min-width: 0; }
.cwd-metalabel { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.cwd-metavalue { font-size: 12.5px; line-height: 18px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cwd-block { flex: none; padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l2); }
.cwd-block-chart { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.cwd-blockhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.cwd-blocktitle { font-size: 12.5px; line-height: 18px; font-weight: 600; }
.cwd-blocknote { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.cwd-chart { flex: 1; min-height: 150px; display: grid; place-items: center; padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; background: repeating-linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-border-l2) 60%, transparent) 0 1px, transparent 1px 36px), var(--dsw-alias-bg-module-platform); text-align: center; }
.cwd-charttext { font-size: 12.5px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.cwd-charthint { margin-top: 4px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.cwd-volume { height: 92px; display: grid; place-items: center; border: 1px dashed var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); border-radius: 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.cwd-empty { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 34px 18px; text-align: center; }
.cwd-emptytitle { font-size: 14px; line-height: 20px; font-weight: 600; }
.cwd-emptyhint { margin: 6px 0 0; font-size: 12.5px; line-height: 19px; color: var(--dsw-alias-label-tertiary); }
.cwd-notice { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; border-bottom: .5px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.cwd-notice-danger { color: var(--dsw-alias-state-error-primary); }
.cwd-error { flex: none; padding: 8px 14px; border-bottom: .5px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.cwd-menuhint { padding: 6px 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.cwd-menulist { width: 208px; }
.cwd-menulist button { box-sizing: border-box; }
.cwd-field:focus-within { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.cwd-page button:focus-visible, .cwd-groupcreate input:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.cwd-skeleton { display: block; height: 12px; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); }
@media (max-width: 1040px) { .cwd-body { grid-template-columns: minmax(0, 1fr); gap: 16px; height: auto; } .cwd-card { height: auto; } .cwd-tablebody { flex: none; max-height: 60vh; } .cwd-chart { flex: none; height: 200px; } }
@media (max-width: 720px) { .cwd-inner { padding: 20px 16px 32px; } .cwd-thead, .cwd-row { grid-template-columns: minmax(0, 1.5fr) 78px 72px 36px; gap: 8px; } .cwd-thead { padding: 8px 10px; } .cwd-row { padding: 9px 10px; } }
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

/**
 * Success is `ok: true` in the body, not the HTTP status: 401 / 403 must surface
 * as unauthorized instead of an empty list or a service error.
 */
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
    payload = {}
  }
  if (response.ok === true && payload.ok === true) return payload
  const code = typeof payload.code === 'string' && payload.code.length > 0
    ? payload.code
    : (response.status === 401 || response.status === 403) ? 'unauthorized' : 'fuyao_unavailable'
  const error = new Error(code)
  error.code = code
  error.candidates = payload.candidates
  error.limit = payload.limit
  throw error
}

const blank = () => ({
  open: false,
  loading: false,
  refreshing: false,
  searching: false,
  items: [],
  candidates: [],
  truncated: false,
  /** Filter lives here so a panel reopen resets it; changing the query keeps it. */
  marketFilter: 'all',
  query: '',
  dropdownOpen: false,
  /** Menu state lives here so `open()` reset closes it. */
  rowMenu: null,
  /**
   * Must live beside `rowMenu`: closing renders null instead of unmounting, so
   * component state would survive and reopen the confirm layer on the next panel.
   */
  pendingRemove: null,
  refreshed_at: null,
  error: null,
  /** Separate from `addError`: the two clear at different times. */
  searchError: null,
  searchPartial: null,
  addError: null,
  /** A 503 must not render as an empty list. */
  loadError: null,
  failures: {},
  /** Composition must be visible to render; `isComposing` is the reset path (some IMEs drop `compositionend`). */
  composing: false,
  pendingSearch: false,
})

/** One surface per session (session-scoped slot); open state and data live in this store. */
class WatchlistSurface {
  constructor() {
    this.store = createSnapshotStore(blank())
    this.searchController = null
    this.timer = null
    this.pending = null
    this.lastQuery = null
    /**
     * Out-of-order `/holding` replies: keep only the latest `seq` and roll back one
     * row to its last host-confirmed baseline, never the whole array.
     */
    this.holdingOps = new Map()
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

  open() {
    this.patch({ ...blank(), open: true, loading: true })
    this.load().then(() => this.refresh(), () => this.patch({ loading: false }))
  }

  close() {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.searchController !== null) this.searchController.abort()
    this.lastQuery = null
    // Reset composition too: leaving it true would permanently latch searches.
    this.patch({ open: false, rowMenu: null, composing: false, pendingSearch: false })
    // In-flight holding replies no longer describe this screen.
    this.holdingOps.clear()
  }

  async load() {
    try {
      const payload = await call('/list')
      this.holdingOps.clear()
      this.patch({ items: cleanRows(payload.items) ?? [], seeded_at: payload.seeded_at, loading: false, loadError: null })
    } catch (error) {
      this.patch({ loading: false, loadError: { code: error.code ?? 'fuyao_unavailable' } })
      // `open()` uses the rejection to skip the refresh when the list never loaded.
      throw error
    }
  }

  /** Single gate shared by panel open and manual refresh. */
  refresh() {
    if (this.pending !== null) return this.pending
    this.patch({ refreshing: true })
    const running = call('/refresh', { body: {} })
      .then((payload) => {
        const failures = {}
        for (const item of payload.failures ?? []) failures[item.thscode] = item.code
        const landed = cleanRows(payload.items)
        const items = landed ?? this.snapshot.items
        // A landed list invalidates in-flight holding replies; no items leaves the screen alone.
        if (landed !== null) this.holdingOps.clear()
        this.patch({
          items,
          // `null` = nothing landed; the footer keeps the last real success time.
          refreshed_at: payload.refreshed_at ?? this.snapshot.refreshed_at,
          failures,
          // "Other symbols still show a snapshot" only when some row is actually unaffected.
          error: payload.error
            ? { code: payload.error.code, partial: items.length > 0 && items.some((row) => failures[row.thscode] === undefined) }
            : null,
        })
      })
      .catch((error) => {
        // Same rule: only claim a previous snapshot if old values are still on screen.
        this.patch({
          error: {
            code: error.code ?? 'fuyao_unavailable',
            partial: this.snapshot.items.some((row) => row.quote !== null),
          },
        })
      })
      .finally(() => {
        this.patch({ refreshing: false })
        this.pending = null
      })
    this.pending = running
    return running
  }

  /**
   * Typing is not querying: `/search` hits upstream uncached, so three gates apply —
   * trailing debounce, no send during IME composition, and no resend of the same
   * term. Only one request is in flight.
   */
  onQueryChange(query, isComposing) {
    const trimmed = query.trim()
    const composing = isComposing === undefined ? this.snapshot.composing === true : isComposing === true
    // Typing clears the failed search, never `addError` (list_full is unrelated to the query).
    this.patch({ query, searchError: null, composing, dropdownOpen: trimmed.length > 0 })
    if (this.timer !== null) clearTimeout(this.timer)
    if (trimmed.length === 0) {
      if (this.searchController !== null) this.searchController.abort()
      this.lastQuery = null
      this.patch({ candidates: [], truncated: false, searching: false, pendingSearch: false })
      return
    }
    // Old results are not candidates for the new term; a landed same-term reply is reused.
    if (trimmed === this.lastQuery && this.snapshot.pendingSearch === false) return
    this.patch({ candidates: [], truncated: false, pendingSearch: !composing })
    if (composing === true) return
    this.timer = setTimeout(() => this.search(trimmed), SEARCH_DEBOUNCE_MS)
  }

  beginComposition() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.patch({ composing: true })
  }

  endComposition(query) {
    this.onQueryChange(query, false)
  }

  hideDropdown() {
    this.patch({ dropdownOpen: false })
  }

  /** Display-only filter; unknown ids are ignored so a typo cannot blank the dropdown. */
  setMarketFilter(filter) {
    if (!MARKET_FILTERS.some((entry) => entry.id === filter)) return
    this.patch({ marketFilter: filter })
  }

  toggleRowMenu(thscode) {
    this.patch({ rowMenu: this.snapshot.rowMenu === thscode ? null : thscode })
  }

  closeRowMenu() {
    if (this.snapshot.rowMenu !== null) this.patch({ rowMenu: null })
  }

  setPendingRemove(item) {
    this.patch({ pendingRemove: item ?? null })
  }

  /** Overwrite one row with the host's copy; the server owns `marked_at`; scrub the name again. */
  replaceRow(row) {
    const [clean] = cleanRows([row])
    if (clean === undefined || typeof clean?.thscode !== 'string') return
    this.patch({ items: this.snapshot.items.map((entry) => (entry.thscode === clean.thscode ? clean : entry)) })
  }

  async search(query) {
    this.lastQuery = query
    if (this.searchController !== null) this.searchController.abort()
    const controller = new AbortController()
    this.searchController = controller
    this.patch({ searching: true, searchError: null, searchPartial: null })
    // Drop results for a term the user already changed; let the new debounce run.
    const stillCurrent = () => this.snapshot.query.trim() === query
    try {
      const payload = await call('/search', { query: `q=${encodeURIComponent(query)}`, signal: controller.signal })
      if (!stillCurrent()) {
        this.patch({ searching: false })
        return
      }
      this.patch({ candidates: cleanRows(payload.items) ?? [], truncated: payload.truncated === true, searching: false, pendingSearch: false, searchPartial: Array.isArray(payload.partial) && payload.partial.length > 0 ? payload.partial : null })
    } catch (error) {
      if (error.name === 'AbortError') return
      // A failure is not "this term was checked": retyping it must search again.
      if (this.lastQuery === query) this.lastQuery = null
      if (!stillCurrent()) return
      // Search errors replace the no-hit hint; the same screen must not say both.
      this.patch({ candidates: [], truncated: false, searching: false, pendingSearch: false, searchError: { code: error.code ?? 'fuyao_unavailable' }, searchPartial: null })
    }
  }

  async add(candidate) {
    try {
      await call('/add', { body: { thscode: candidate.thscode } })
    } catch (error) {
      // Ambiguity / cap are add failures: stay in the search area, not the refresh notice.
      this.patch({ addError: { code: error.code ?? 'fuyao_unavailable', candidates: error.candidates, limit: error.limit } })
      if (error.candidates !== undefined) this.patch({ candidates: error.candidates, truncated: false })
      return
    }
    // After success, later failures must not be reported as add failures (the symbol is
    // already stored). Keep the dropdown and query open for consecutive adds; the row is
    // marked added and disabled, and `lastQuery` stays so the same term is not resent.
    this.patch({
      addError: null,
      candidates: this.snapshot.candidates.map((row) => (row.thscode === candidate.thscode ? { ...row, in_list: true } : row)),
    })
    await this.load().catch(() => {})
    // Adding is a full action: reload and refresh so the new row has a quote immediately.
    await this.refresh()
    // The refresh can be folded into an in-flight batch that never asked this row. If it has
    // no quote and no recorded failure, ask once more — still only inside this user action.
    const landed = this.snapshot.items.find((item) => item.thscode === candidate.thscode)
    if (landed !== undefined && landed.quote === null && this.snapshot.failures[candidate.thscode] === undefined) {
      await this.refresh()
    }
  }

  async remove(thscode) {
    const before = this.snapshot.items
    this.patch({ items: before.filter((row) => row.thscode !== thscode), rowMenu: null })
    try {
      await call('/remove', { body: { thscode } })
      // A successful removal frees a slot, so a stale `list_full` no longer applies.
      if (this.snapshot.addError?.code === 'list_full') this.patch({ addError: null })
    } catch {
      this.patch({ items: before })
    }
  }

  /**
   * Pin optimistically, then let the host write `pinned_at`; failure restores only
   * the order, never row contents changed by other actions meanwhile.
   */
  async pin(thscode) {
    const before = this.snapshot.items
    const target = before.find((row) => row.thscode === thscode)
    if (target === undefined) return
    this.patch({ items: [target, ...before.filter((row) => row.thscode !== thscode)], rowMenu: null })
    try {
      const payload = await call('/pin', { body: { thscode } })
      if (Array.isArray(payload.items)) this.patch({ items: cleanRows(payload.items) })
    } catch {
      // Restore order only; other rows may have landed changes. Keep new rows at the end.
      const current = this.snapshot.items
      const ordered = before.map((row) => current.find((entry) => entry.thscode === row.thscode)).filter(Boolean)
      const known = new Set(ordered.map((row) => row.thscode))
      this.patch({ items: [...ordered, ...current.filter((row) => !known.has(row.thscode))] })
    }
  }

  /**
   * Only write path for holding: optimistic row → exactly one `/holding` → replace
   * with the host row, or roll that single row back. Never touches `rowMenu`.
   */
  async writeHolding(thscode, body, nextRow) {
    const target = this.snapshot.items.find((row) => row.thscode === thscode)
    if (target === undefined) return
    const op = this.holdingOps.get(thscode) ?? { seq: 0, baseline: target }
    this.holdingOps.set(thscode, op)
    const seq = ++op.seq
    this.patch({ items: this.snapshot.items.map((row) => (row.thscode === thscode ? nextRow(row) : row)) })
    const stale = () => this.holdingOps.get(thscode) !== op || op.seq !== seq
    try {
      const payload = await call('/holding', { body })
      if (stale()) return
      this.replaceRow(payload.item)
      op.baseline = payload.item ?? nextRow(target)
      this.holdingOps.delete(thscode)
    } catch {
      if (stale()) return
      this.replaceRow(op.baseline)
      this.holdingOps.delete(thscode)
    }
  }

  /** `null` means held without a weight; 0 is a distinct real value. */
  markHolding(thscode, weightPct) {
    return this.writeHolding(thscode, { thscode, weight_pct: weightPct },
      (row) => ({ ...row, holding: { weight_pct: weightPct, marked_at: Date.now() } }))
  }

  clearHolding(thscode) {
    return this.writeHolding(thscode, { thscode, clear: true }, (row) => {
      const next = { ...row }
      delete next.holding
      return next
    })
  }

  /**
   * No snapping: 37.5 ± 10 stays 47.5 / 27.5, never rounded. The ceiling is the
   * same single-row / remaining-total rule the host enforces.
   */
  stepHolding(thscode, delta) {
    const rows = this.snapshot.items
    const current = rows.find((entry) => entry.thscode === thscode)?.holding?.weight_pct
    if (typeof current !== 'number' && delta < 0) return
    const next = Math.min(weightCeiling(rows, thscode), Math.max(0, (typeof current === 'number' ? current : 0) + delta))
    if (next === current) return
    return this.markHolding(thscode, next)
  }

  /** Dev-only escape hatch: no panel button; call `surface.copyToClipboard()` from devtools. */
  async copyToClipboard() {
    const lines = this.snapshot.items.map((row) => [
      row.thscode,
      scrubInvisible(row.name),
      row.asset_type,
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

function TypeTag({ assetType, t }) {
  return h('span', { className: `capital-watchlist-tag ${TYPE_TONES[assetType] ?? 'capital-watchlist-tag-cn'}` }, typeLabel(assetType, t))
}

/**
 * Prompt shape `<prefix>name (thscode · kind)<suffix>`; kind is endpoint family.
 * The Agent picks an endpoint from stock / index / ETF; market comes from thscode.
 */
function promptOf(item, t, kind) {
  const name = scrubInvisible(item.name)
  return `${t(`${kind}PromptPrefix`)}${name} (${item.thscode} · ${kindLabel(item.asset_type, t)})${t(`${kind}PromptSuffix`)}`
}

/**
 * Quote has four states: skeleton, red dash with no prior value, last good snapshot
 * (dimmed + tooltip), or "not refreshed".
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
  // Missing change is missing, never 0.00% (0 is a real flat day).
  const hasPct = typeof quote.change_pct === 'number' && Number.isFinite(quote.change_pct)
  const pct = hasPct ? `${quote.change_pct > 0 ? '+' : ''}${quote.change_pct.toFixed(2)}%` : '—'
  const tone = stale
    ? 'capital-watchlist-stale'
    : !hasPct
      ? 'capital-watchlist-nodata'
      : quote.change_pct > 0 ? 'capital-watchlist-up' : quote.change_pct < 0 ? 'capital-watchlist-down' : 'capital-watchlist-flat'
  /** Failure reason + snapshot time, plus exchange-local time when provided. */
  const exchange = typeof quote.source_time === 'string' && quote.source_time.length > 0
    ? `${t('exchangeTime')} ${quote.source_time}`
    : ''
  const tips = []
  if (stale) tips.push(`${t(`error.${failureCode}`)} · ${t('stale')} ${formatTime(quote.captured_at)}`)
  else if (!hasPct) tips.push(t('noChangePct'))
  if (exchange.length > 0) tips.push(exchange)
  return h('div', {
    className: 'capital-watchlist-quote',
    title: tips.length === 0 ? undefined : tips.join(' · '),
  },
    h('div', { className: stale ? 'capital-watchlist-price capital-watchlist-stale' : 'capital-watchlist-price' }, quote.price.toFixed(2)),
    h('div', { className: `capital-watchlist-change ${tone}` }, pct))
}

/** `list_full` uses the host's `limit`; never print the `{max}` placeholder. */
function addErrorText(t, addError) {
  if (addError.code !== 'list_full') return t(`error.${addError.code}`)
  const limit = addError.limit
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return t('error.list_full_noMax')
  return t('error.list_full').replace('{max}', String(limit))
}

/**
 * User-reported weight, printed as entered; no market value exists to justify
 * reformatting. Red is not the only channel: the name tooltip repeats this.
 */
function holdingLabel(holding, t) {
  const weight = holding?.weight_pct
  if (weight === null || weight === undefined) return t('holdingName')
  return `${t('holdingName')} ${weight}%`
}

function nameTitle(item, t) {
  const base = `${item.name} ${item.ticker}`
  return item.holding === null || item.holding === undefined ? base : `${base} · ${holdingLabel(item.holding, t)}`
}

function WatchlistDialog({ useDialog, surface, t, inputActions }) {
  const state = useDialog((value) => value)
  const [busy, setBusy] = useState(false)
  /**
   * Which row's add is in flight. Separate from `busy`: candidates disable only
   * themselves so consecutive adds are not interrupted.
   */
  const [addingThscode, setAddingThscode] = useState(null)
  /**
   * In-panel confirm, not `window.confirm`; state lives in the store because closing
   * renders null instead of unmounting.
   */
  const pendingRemove = state.pendingRemove ?? null

  useEffect(() => () => surface.dispose(), [surface])
  if (!state.open) return null

  const showDropdown = state.dropdownOpen === true
  const confirming = pendingRemove !== null

  // Esc ownership: confirm layer, then dropdown; the official Menu handles its own Escape.
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    if (confirming) {
      event.stopPropagation()
      surface.setPendingRemove(null)
      return
    }
    if (showDropdown) {
      event.stopPropagation()
      surface.hideDropdown()
    }
  }
  // Focus leaving the search section closes the dropdown; candidates live inside it.
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

  /**
   * Append to the draft instead of submitting; keep the panel open when `insertText`
   * refuses (revision guard or locked editor).
   */
  const appendPrompt = (item, kind) => {
    if (inputActions.insertText(promptOf(item, t, kind), inputActions.captureInsertion()) !== true) return
    surface.close()
  }

  // Filtering is display-only; counts show each market's real total.
  const visibleCandidates = state.marketFilter === 'all'
    ? state.candidates
    : state.candidates.filter((candidate) => marketIdOf(candidate) === state.marketFilter)
  const filterCounts = { all: state.candidates.length, cn: 0, hk: 0, us: 0 }
  for (const candidate of state.candidates) filterCounts[marketIdOf(candidate)] += 1
  const filterBar = state.candidates.length === 0
    ? null
    : h('div', { className: 'capital-watchlist-filter', role: 'group', 'aria-label': t('filterLabel') },
      MARKET_FILTERS.map((entry) => h('button', {
        key: entry.id,
        type: 'button',
        className: 'capital-watchlist-filterbtn',
        'aria-pressed': state.marketFilter === entry.id,
        onClick: () => surface.setMarketFilter(entry.id),
      },
        h('span', { className: 'capital-watchlist-filterlabel' }, entry.id === 'all' ? t('filterAll') : entry.label),
        h('span', { className: 'capital-watchlist-filtercount' }, String(filterCounts[entry.id])))))

  const dropdown = !showDropdown
    ? null
    : h('div', { className: 'capital-watchlist-dropdown', 'aria-label': t('title'), 'data-menu-material': 'translucent' },
      // Filter bar stays out of the scroll area; the listbox holds only options.
      filterBar,
      h('div', { className: 'capital-watchlist-options', role: 'listbox', 'aria-label': t('title') },
        visibleCandidates.map((candidate) => h('button', {
          key: candidate.thscode,
          type: 'button',
          role: 'option',
          className: 'capital-watchlist-option',
          // Native tooltip exposes the full name; CSS truncates long US names.
          title: candidate.name,
          // aria-disabled, not disabled: real disabled drops focus to body and closes the dropdown.
          'aria-disabled': candidate.in_list === true || addingThscode === candidate.thscode,
          onClick: () => {
            if (candidate.in_list === true || addingThscode === candidate.thscode) return
            setBusy(true)
            setAddingThscode(candidate.thscode)
            surface.add(candidate).finally(() => { setBusy(false); setAddingThscode(null) })
          },
        },
          h('span', { className: 'capital-watchlist-optionmain' },
            h('span', { className: 'capital-watchlist-optionname' }, candidate.name),
            // Second line shows the full canonical code; a bare `00700` collides with
            // `000700.SZ`, and HSI / HSIGTR / HSINTR are all real indices.
            h('span', { className: 'capital-watchlist-codeline' },
              h('span', { className: 'capital-watchlist-optioncode' }, candidate.thscode),
              h(TypeTag, { assetType: candidate.asset_type, t }))),
          // The label is this button's visible verb, not a nested button; state lives on `data-state`.
          h('span', { className: 'capital-watchlist-addbtn', 'data-state': candidate.in_list === true ? 'added' : 'idle' },
            candidate.in_list === true ? t('added') : t('add')))),
        // "No more" scrolls at the end of the list; only shown when this filter has rows.
        state.truncated === true && visibleCandidates.length > 0
          ? h('div', { className: 'capital-watchlist-hint capital-watchlist-endhint' }, t('truncated'))
          : null),
      // Status hints stay outside the scroll area so they cannot scroll out of sight.
      state.composing === true
        // During composition, say what happens next; never claim "no match".
        ? h('div', { className: 'capital-watchlist-hint' }, t('composingHint'))
        : state.searching === true || state.pendingSearch === true
          // Debounce pending or request in flight both mean "searching", not "no match".
          ? h('div', { className: 'capital-watchlist-hint' }, t('searching'))
          : state.searchError !== null && state.searchError !== undefined
            // Replaces noHit: a service failure must not read as "you typed it wrong".
            ? h('div', { className: 'capital-watchlist-hint capital-watchlist-searcherror', role: 'alert', 'data-code': state.searchError.code }, t(`error.${state.searchError.code}`))
            : state.candidates.length === 0
              ? h('div', { className: 'capital-watchlist-hint' }, t('noHit'))
              : visibleCandidates.length === 0
                // Filtered to zero while candidates exist: a filter miss, not "not found".
                ? h('div', { className: 'capital-watchlist-hint', 'data-filter': state.marketFilter }, t('filterNoHit'))
                : null,
      // Per-branch failure: separate from the "does this screen have a match" hint.
      ...(state.searchPartial ?? []).map((branch) => h('div', {
        key: `partial-${branch.market}`,
        className: 'capital-watchlist-hint capital-watchlist-searcherror',
        role: 'status',
        'data-market': branch.market,
        'data-code': branch.code,
      }, `${t(`partial.${branch.market}`)}${t(`error.${branch.code}`)}`)))

  const head = state.items.length === 0
    ? null
    : h('div', { className: 'capital-watchlist-grid capital-watchlist-head' },
      h('span', null, t('colName')),
      h('span', { className: 'capital-watchlist-quote' }, t('colQuote')),
      h('span', { className: 'capital-watchlist-headaction' }, t('colAction')))

  /** A 503 is not an empty watchlist. */
  const emptyState = state.loadError !== null && state.loadError !== undefined
    ? h('p', { className: 'capital-watchlist-empty capital-watchlist-loaderror', role: 'alert', 'data-code': state.loadError.code }, t(`error.${state.loadError.code}`))
    : h('p', { className: 'capital-watchlist-empty' }, t('empty'))

  const list = state.loading
    ? h('p', { className: 'capital-watchlist-empty' }, t('loading'))
    : state.items.length === 0
      ? emptyState
      : h('div', { className: showDropdown ? 'capital-watchlist-list capital-watchlist-list-open' : 'capital-watchlist-list' }, state.items.map((item, index) => {
        const held = item.holding !== null && item.holding !== undefined
        const weight = item.holding?.weight_pct
        // `|| held` keeps legacy index holdings removable; host gate shares `isHoldable`.
        const markable = isHoldable(item) || held
        // Same ceiling rule as the host; unset weight has no numeric floor.
        const ceiling = weightCeiling(state.items, item.thscode)
        const atFloor = !held || weight === null || weight === undefined || weight <= 0
        const atCeil = (typeof weight === 'number' ? weight : 0) + HOLDING_STEP > ceiling
        return h('div', {
          key: item.thscode,
          className: 'capital-watchlist-grid capital-watchlist-row',
          'data-thscode': item.thscode,
        },
          h('span', { className: 'capital-watchlist-namewrap' },
            // Held rows tint the name red; title repeats the holding as the non-color channel.
            h('span', {
              className: held ? 'capital-watchlist-name capital-watchlist-name-held' : 'capital-watchlist-name',
              title: nameTitle(item, t),
            }, item.name),
            // Second line is code + market badge only; currency and holding stay out.
            h('span', { className: 'capital-watchlist-codeline' },
              h('span', { className: 'capital-watchlist-code' }, item.ticker),
              h(TypeTag, { assetType: item.asset_type, t }))),
          h(QuoteCell, { quote: item.quote, failureCode: state.failures[item.thscode], refreshing: state.refreshing, t }),
          h('span', { className: 'capital-watchlist-rowactions' },
            h('button', {
              type: 'button',
              className: 'capital-watchlist-predict',
              disabled: busy,
              title: t('predictTip'),
              'aria-label': `${t('predict')} ${item.name}`,
              onClick: () => appendPrompt(item, 'predict'),
            }, h(IconGoalOutlineRegular, { size: 14 })),
            h('button', {
              type: 'button',
              className: 'capital-watchlist-review',
              disabled: busy,
              title: t('reviewTip'),
              'aria-label': `${t('review')} ${item.name}`,
              onClick: () => appendPrompt(item, 'review'),
            }, h(IconListPenOutlineRegular, { size: 14 })),
            // Menu is portaled (in-place would be clipped): items = pin, children = holding + remove.
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
                { id: 'pin', label: t('pin'), icon: h(IconPinOutlineRegular, { size: 14 }), disabled: index === 0 },
              ],
              children: [
                // Holding row: official Switch only; role=group keeps it from posing as a menuitem.
                ...(markable ? [h('div', {
                  key: 'holding-check',
                  role: 'group',
                  'aria-label': t('holdingName'),
                  className: 'capital-watchlist-checkrow',
                },
                  h('span', { className: 'capital-watchlist-checkicon', 'aria-hidden': 'true' }, h(IconDatabaseOutlineRegular, { size: 14 })),
                  h('span', { className: 'capital-watchlist-checklabel' }, t('holdingName')),
                  h(Switch, {
                    checked: held,
                    disabled: busy,
                    label: t('holdingName'),
                    onChange: (next) => (next ? surface.markHolding(item.thscode, null) : surface.clearHolding(item.thscode)),
                  }))] : []),
                ...(held && isHoldable(item) ? [h('div', {
                  key: 'holding-step',
                  className: 'capital-watchlist-stepper',
                  role: 'group',
                  'aria-label': t('holdingStepper'),
                },
                  h('span', { className: 'capital-watchlist-stepperlabel' }, t('holdingWeightLabel')),
                  h('span', { className: 'capital-watchlist-stepperline' },
                    h('button', {
                      type: 'button',
                      className: 'capital-watchlist-stepperbtn',
                      'aria-label': t('holdingStepDown'),
                      disabled: atFloor,
                      onClick: () => surface.stepHolding(item.thscode, -HOLDING_STEP),
                    }, '−'),
                    // role=status announces the readout; unset shows headroom, not "unset".
                    h('span', {
                      className: typeof weight === 'number' ? 'capital-watchlist-stepperreadout' : 'capital-watchlist-stepperreadout capital-watchlist-stepperplaceholder',
                      role: 'status',
                    }, typeof weight === 'number' ? `${weight}%` : `0~${ceiling}`),
                    h('button', {
                      type: 'button',
                      className: 'capital-watchlist-stepperbtn',
                      'aria-label': t('holdingStepUp'),
                      // Disabled key explains the current ceiling on itself, not on the readout.
                      title: `0~${ceiling}`,
                      disabled: atCeil,
                      onClick: () => surface.stepHolding(item.thscode, HOLDING_STEP),
                    }, '+')))] : []),
                // Remove last with a separator; it must close the menu (portal z 1100 > confirm z 50).
                h(MenuItemButton, {
                  key: 'remove',
                  danger: true,
                  separatorBefore: true,
                  icon: h(IconTrashOutlineRegular, { size: 14 }),
                  onSelect: () => {
                    surface.closeRowMenu()
                    surface.setPendingRemove(item)
                  },
                }, t('remove')),
              ],
              onSelect: (id) => {
                // Only pin reaches this handler; closing on other actions would yank the menu away.
                if (id !== 'pin') return
                surface.closeRowMenu()
                surface.pin(item.thscode)
              },
              onClose: () => surface.closeRowMenu(),
              align: 'end',
              portal: true,
              listClassName: 'capital-watchlist-rows',
              className: 'capital-watchlist-actions',
            })))
      }))
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
        h('button', { type: 'button', className: 'capital-watchlist-confirmbtn', onClick: () => surface.setPendingRemove(null) }, t('confirmCancel')),
        h('button', {
          type: 'button',
          className: 'capital-watchlist-confirmbtn capital-watchlist-confirmdanger',
          onClick: () => {
            const row = pendingRemove
            surface.setPendingRemove(null)
            if (row !== null) surface.remove(row.thscode)
          },
        }, t('confirmOk')))))

  return h(Modal, {
    open: true,
    onClose: () => surface.close(),
    title: t('title'),
    // headless: official chrome, Escape and focus handling; geometry is ours.
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
            onChange: (event) => surface.onQueryChange(event.target.value, event.isComposing),
            onCompositionStart: () => surface.beginComposition(),
            onCompositionEnd: (event) => surface.endComposition(event.target.value),
          }),
          // Clear key only with text; keep focus so typing can continue.
          state.query.length > 0
            ? h('button', {
              type: 'button',
              className: 'capital-watchlist-clear',
              title: t('clearInput'),
              'aria-label': t('clearInput'),
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => surface.onQueryChange('', false),
            }, h(IconCloseOutlineRegular, { size: 12 }))
            : null),
        dropdown),

      state.addError !== null && state.addError !== undefined
        // Add failures stay in the search area and survive typing.
        ? h('p', { className: 'capital-watchlist-adderror', role: 'status', 'data-code': state.addError.code }, addErrorText(t, state.addError))
        : null,

      head,
      list,

      // Footer: refresh verb + its batch error on the left, shared timestamp on the right.
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

/* ---------------------------------------------------------------------------
 * 行情工作台：左侧栏「自选股」入口 + main 面板。
 * 报价仍只走 /capital-watchlist（同一 host 路由、同一套失败码）；分组只落本机。
 * 分时与成交量目前没有数据源，画占位并写明原因，不补造走势。
 * ------------------------------------------------------------------------ */
const DESK_PANEL_ID = `${ENTRY_NAME}:desk`
const DESK_GROUPS_KEY = 'capital.watchlist.desk.groups.v1'
const DESK_ALL = '__all__'

function readDeskGroups() {
  const empty = { names: [], assignments: {} }
  try {
    const parsed = JSON.parse(localStorage.getItem(DESK_GROUPS_KEY) ?? '{}')
    if (parsed === null || typeof parsed !== 'object') return empty
    if (!Array.isArray(parsed.names)) return empty
    if (parsed.assignments === null || typeof parsed.assignments !== 'object') return empty
    return {
      names: parsed.names.filter((name) => typeof name === 'string' && name.length > 0).slice(0, 20),
      assignments: parsed.assignments,
    }
  } catch {
    return empty
  }
}

function writeDeskGroups(value) {
  try {
    localStorage.setItem(DESK_GROUPS_KEY, JSON.stringify(value))
  } catch {
    // Private mode: groups stay in memory for this page.
  }
}

const deskGroupsOf = (groups, thscode) => {
  const names = groups.assignments[thscode]
  return Array.isArray(names) ? names : []
}

/** Missing change is missing (holiday / halted), never 0.00%. */
const deskPctOf = (quote) => (quote !== null && quote !== undefined && typeof quote.change_pct === 'number' && Number.isFinite(quote.change_pct) ? quote.change_pct : null)
const deskToneOf = (value) => (value === null ? 'cwd-flat' : value > 0 ? 'cwd-up' : value < 0 ? 'cwd-down' : 'cwd-flat')
const deskPctText = (value) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`)
/** Comma grouping is the market convention here, so it does not follow the UI locale. */
const deskPriceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const deskPriceText = (quote) => (quote !== null && quote !== undefined && typeof quote.price === 'number' && Number.isFinite(quote.price) ? deskPriceFormat.format(quote.price) : '—')

/** Sidebar glyph: an axis plus a rising line reads as quotes without inventing a wallet/pie shape. */
function WatchlistDeskIcon({ size = 18 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
    h('path', { d: 'M4 19V5' }),
    h('path', { d: 'M4 19h16' }),
    h('path', { d: 'm7 15 3-4 3 2 5-7' }),
    h('circle', { cx: 18, cy: 6, r: 1.4, fill: 'currentColor', stroke: 'none' }))
}

function WatchlistDeskPage({ t }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [failures, setFailures] = useState({})
  const [error, setError] = useState(null)
  const [groups, setGroups] = useState(readDeskGroups)
  const [activeGroup, setActiveGroup] = useState(DESK_ALL)
  const [groupOpen, setGroupOpen] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [rowMenu, setRowMenu] = useState(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => { writeDeskGroups(groups) }, [groups])

  /** One refresh reply feeds the list, per-row failure marks and the footer time. */
  const applyRefresh = (payload) => {
    const landed = cleanRows(payload.items)
    if (Array.isArray(landed)) setItems(landed)
    const next = {}
    for (const item of payload.failures ?? []) {
      if (item !== null && typeof item === 'object' && typeof item.thscode === 'string') next[item.thscode] = item.code
    }
    setFailures(next)
    if (typeof payload.refreshed_at === 'number') setRefreshedAt(payload.refreshed_at)
    setError(payload.error !== undefined && payload.error !== null && typeof payload.error.code === 'string' ? payload.error.code : null)
  }

  // Opening the panel is the user request: read the list, then quote it once. No polling.
  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        const listed = await call('/list')
        if (cancelled) return
        const landed = cleanRows(listed.items) ?? []
        setItems(landed)
        // The detail panel is the main area: start on the first symbol instead of an empty aside.
        setSelected((value) => (value !== null ? value : (typeof landed[0]?.thscode === 'string' ? landed[0].thscode : null)))
      } catch (failure) {
        if (!cancelled) setError(failure.code ?? 'load_failed')
        return
      } finally {
        if (!cancelled) setLoading(false)
      }
      try {
        const payload = await call('/refresh', { body: {} })
        if (!cancelled) applyRefresh(payload)
      } catch (failure) {
        if (!cancelled) setError(failure.code ?? 'fuyao_unavailable')
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [])

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const payload = await call('/refresh', { body: {} })
      if (alive.current) applyRefresh(payload)
    } catch (failure) {
      if (alive.current) setError(failure.code ?? 'fuyao_unavailable')
    } finally {
      if (alive.current) setRefreshing(false)
    }
  }

  const removeRow = async (thscode) => {
    const before = items
    setPendingRemove(null)
    setItems(before.filter((row) => row.thscode !== thscode))
    if (selected === thscode) setSelected(null)
    try {
      await call('/remove', { body: { thscode } })
    } catch {
      // Put the row back exactly where it was; the host never confirmed the removal.
      if (alive.current) setItems(before)
    }
  }

  const pinRow = async (thscode) => {
    const before = items
    const target = before.find((row) => row.thscode === thscode)
    if (target === undefined) return
    setItems([target, ...before.filter((row) => row.thscode !== thscode)])
    try {
      const payload = await call('/pin', { body: { thscode } })
      if (Array.isArray(payload.items) && alive.current) setItems(cleanRows(payload.items))
    } catch {
      if (alive.current) setItems(before)
    }
  }

  const createGroup = () => {
    const name = newGroup.trim()
    if (name.length === 0 || name === DESK_ALL || groups.names.includes(name)) return
    setGroups({ names: [...groups.names, name], assignments: groups.assignments })
    setNewGroup('')
    setActiveGroup(name)
  }

  const deleteGroup = (name) => {
    if (name === DESK_ALL) return
    const assignments = {}
    for (const [thscode, names] of Object.entries(groups.assignments)) {
      const kept = (Array.isArray(names) ? names : []).filter((entry) => entry !== name)
      if (kept.length > 0) assignments[thscode] = kept
    }
    setGroups({ names: groups.names.filter((entry) => entry !== name), assignments })
    setActiveGroup(DESK_ALL)
    setGroupOpen(false)
  }

  const toggleGroup = (thscode, name) => {
    const current = deskGroupsOf(groups, thscode)
    const next = current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]
    const assignments = { ...groups.assignments }
    if (next.length === 0) delete assignments[thscode]
    else assignments[thscode] = next
    setGroups({ names: groups.names, assignments })
  }

  const term = query.trim().toLowerCase()
  const visible = items.filter((item) => {
    if (activeGroup !== DESK_ALL && !deskGroupsOf(groups, item.thscode).includes(activeGroup)) return false
    if (term.length === 0) return true
    return [item.name, item.thscode, item.ticker].some((value) => typeof value === 'string' && value.toLowerCase().includes(term))
  })
  const current = selected === null ? null : (items.find((item) => item.thscode === selected) ?? null)

  const groupMenuItems = [{ id: DESK_ALL, label: t('desk.allGroups'), icon: activeGroup === DESK_ALL ? h(IconChecklistOutlineRegular, { size: 14 }) : undefined }]
    .concat(groups.names.map((name) => ({ id: name, label: name, icon: activeGroup === name ? h(IconChecklistOutlineRegular, { size: 14 }) : undefined })))

  const rows = visible.map((item, index) => {
    const pct = deskPctOf(item.quote)
    const failure = failures[item.thscode]
    const names = deskGroupsOf(groups, item.thscode)
    const isSelected = selected === item.thscode
    const quoteTitle = failure === undefined ? undefined : t(`error.${failure}`)
    const menuOpen = rowMenu === item.thscode
    return h('div', {
      key: item.thscode,
      className: 'cwd-row',
      role: 'listitem',
      'aria-current': isSelected ? 'true' : undefined,
      onClick: (event) => { if (event.target.closest('.cwd-rowactions') === null) setSelected(item.thscode) },
    },
      h('button', {
        type: 'button',
        className: 'cwd-cellname',
        'aria-pressed': isSelected,
        onClick: () => setSelected(item.thscode),
      },
        h('span', { className: 'cwd-nameline' },
          h('span', { className: 'cwd-nametext', title: item.name }, scrubInvisible(item.name)),
          h(TypeTag, { assetType: item.asset_type, t })),
        h('span', { className: 'cwd-codeline' }, h('span', { className: 'cwd-code' }, item.thscode))),
      h('div', { className: failure === undefined ? 'cwd-price' : 'cwd-price cwd-stale', title: quoteTitle }, deskPriceText(item.quote)),
      h('div', { className: `cwd-pct ${deskToneOf(pct)}`, title: quoteTitle }, deskPctText(pct)),
      // One trigger per row: pin, group checkboxes and remove live in the official Menu.
      h('div', { className: 'cwd-rowactions' },
        h(Menu, {
          open: menuOpen,
          anchor: h('button', {
            type: 'button',
            className: 'cwd-iconbtn',
            title: t('desk.more'),
            'aria-label': `${t('desk.more')} ${item.name}`,
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen,
            onClick: () => { setPendingRemove(null); setRowMenu(menuOpen ? null : item.thscode) },
          }, h(IconEllipsisOutlineRegular, { size: 16 })),
          items: [{ id: 'pin', label: t('desk.pin'), icon: h(IconPinOutlineRegular, { size: 14 }), disabled: index === 0 }],
          children: [
            ...(groups.names.length === 0
              ? [h('div', { key: 'no-group', className: 'cwd-menuhint' }, t('desk.noGroupYet'))]
              : groups.names.map((name) => h(MenuItemButton, {
                key: `group:${name}`,
                icon: names.includes(name) ? h(IconChecklistOutlineRegular, { size: 14 }) : undefined,
                onSelect: () => toggleGroup(item.thscode, name),
              }, name))),
            h(MenuItemButton, {
              key: 'remove',
              danger: true,
              separatorBefore: true,
              icon: h(IconTrashOutlineRegular, { size: 14 }),
              onSelect: () => { setRowMenu(null); setPendingRemove(item) },
            }, t('desk.remove')),
          ],
          onSelect: (id) => {
            if (id !== 'pin') return
            setRowMenu(null)
            void pinRow(item.thscode)
          },
          onClose: () => setRowMenu(null),
          align: 'end',
          portal: true,
          listClassName: 'cwd-menulist',
        }))
    )
  })

  const listBody = loading
    ? h('div', { className: 'cwd-empty' }, h('div', { className: 'cwd-emptytitle' }, t('desk.loading')))
    : items.length === 0
      ? h('div', { className: 'cwd-empty' }, h('div', { className: 'cwd-emptytitle' }, t('desk.empty')), h('p', { className: 'cwd-emptyhint' }, t('desk.emptyHint')))
      : visible.length === 0
        ? h('div', { className: 'cwd-empty' }, h('div', { className: 'cwd-emptytitle' }, t('desk.noMatch')), h('p', { className: 'cwd-emptyhint' }, t('desk.noMatchHint')))
        : h('div', { className: 'cwd-tablebody', role: 'list', 'aria-label': t('desk.title') }, rows)

  const detailNames = current === null ? [] : deskGroupsOf(groups, current.thscode)
  const detailPct = current === null ? null : deskPctOf(current.quote)
  const detail = current === null
    ? h('div', { className: 'cwd-card' }, h('div', { className: 'cwd-empty' },
      h('div', { className: 'cwd-emptytitle' }, t('desk.selectHint')),
      h('p', { className: 'cwd-emptyhint' }, t('desk.selectHintBody'))))
    : h('div', { className: 'cwd-card' }, h('div', { className: 'cwd-detail' },
      h('div', { className: 'cwd-detailhead' },
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'cwd-detailname' },
            h('span', { className: 'cwd-detailtext', title: current.name }, scrubInvisible(current.name)),
            h(TypeTag, { assetType: current.asset_type, t })),
          h('div', { className: 'cwd-detailcode' }, current.thscode))),
      h('div', { className: 'cwd-bigquote' },
        h('span', { className: 'cwd-bigprice' }, deskPriceText(current.quote)),
        h('span', { className: `cwd-bigpct ${deskToneOf(detailPct)}` }, deskPctText(detailPct))),
      h('div', { className: 'cwd-meta' },
        h('div', { className: 'cwd-metaitem' }, h('div', { className: 'cwd-metalabel' }, t('desk.capturedAt')), h('div', { className: 'cwd-metavalue' }, current.quote === null || current.quote === undefined ? t('desk.notRefreshed') : (formatTime(current.quote.captured_at) || t('desk.notRefreshed')))),
        h('div', { className: 'cwd-metaitem' }, h('div', { className: 'cwd-metalabel' }, t('desk.sourceTime')), h('div', { className: 'cwd-metavalue' }, typeof current.quote?.source_time === 'string' && current.quote.source_time.length > 0 ? current.quote.source_time : '—')),
        h('div', { className: 'cwd-metaitem' }, h('div', { className: 'cwd-metalabel' }, t('desk.groupsOf')), h('div', { className: 'cwd-metavalue' }, detailNames.length === 0 ? t('desk.noGroup') : detailNames.join(' / '))),
        h('div', { className: 'cwd-metaitem' }, h('div', { className: 'cwd-metalabel' }, t('desk.kind')), h('div', { className: 'cwd-metavalue' }, typeLabel(current.asset_type, t)))),
      h('div', { className: 'cwd-block cwd-block-chart' },
        h('div', { className: 'cwd-blockhead' },
          h('span', { className: 'cwd-blocktitle' }, t('desk.intraday')),
          h('span', { className: 'cwd-blocknote' }, refreshedAt === null ? t('desk.notRefreshed') : formatTime(refreshedAt))),
        h('div', { className: 'cwd-chart' },
          h('div', null,
            h('div', { className: 'cwd-charttext' }, t('desk.intradayEmpty')),
            h('div', { className: 'cwd-charthint' }, t('desk.intradayEmptyHint'))))),
      h('div', { className: 'cwd-block' },
        h('div', { className: 'cwd-blockhead' }, h('span', { className: 'cwd-blocktitle' }, t('desk.volume'))),
        h('div', { className: 'cwd-volume' }, t('desk.volumeEmpty')))))

  return h('div', { className: 'cwd-page' },
    h('div', { className: 'cwd-inner' },
      h('header', { className: 'cwd-head' },
        h('h1', { className: 'cwd-title' }, t('desk.title')),
        h('div', { className: 'cwd-headactions' },
          h('span', { className: 'cwd-updated' },
            `${t('desk.lastUpdate')} ${refreshedAt === null ? t('desk.notRefreshed') : formatTime(refreshedAt)}`),
          h('button', { type: 'button', className: 'cwd-refresh', disabled: refreshing, onClick: () => { void refresh() } },
            h(IconRefreshOutlineRegular, { size: 14 }),
            refreshing ? t('desk.refreshing') : t('desk.refresh')))),
      h('div', { className: 'cwd-body' },
        h('section', { className: 'cwd-card' },
          h('div', { className: 'cwd-toolbar' },
            h('label', { className: 'cwd-field' },
              h(IconSearchOutlineRegular, { size: 14 }),
              h('input', { type: 'text', value: query, placeholder: t('desk.filterPlaceholder'), 'aria-label': t('desk.filter'), onChange: (event) => setQuery(event.target.value) })),
            h(Menu, {
              open: groupOpen,
              anchor: h('button', {
                type: 'button',
                className: 'cwd-pill',
                'aria-haspopup': 'menu',
                'aria-expanded': groupOpen,
                'aria-label': t('desk.group'),
                onClick: () => setGroupOpen(!groupOpen),
              }, h(IconGoalOutlineRegular, { size: 14 }), h('span', null, activeGroup === DESK_ALL ? t('desk.allGroups') : activeGroup)),
              items: groupMenuItems,
              children: activeGroup === DESK_ALL ? [] : [h(MenuItemButton, {
                key: 'delete-group',
                danger: true,
                separatorBefore: true,
                icon: h(IconTrashOutlineRegular, { size: 14 }),
                onSelect: () => deleteGroup(activeGroup),
              }, t('desk.deleteGroup'))],
              onSelect: (id) => { setGroupOpen(false); setActiveGroup(id) },
              onClose: () => setGroupOpen(false),
              align: 'start',
              portal: true,
              listClassName: 'cwd-menulist',
            }),
            h('div', { className: 'cwd-groupcreate' },
              h('input', {
                type: 'text',
                value: newGroup,
                maxLength: 20,
                placeholder: t('desk.newGroup'),
                'aria-label': t('desk.newGroup'),
                onChange: (event) => setNewGroup(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') createGroup() },
              }),
              h('button', { type: 'button', className: 'cwd-pill', disabled: newGroup.trim().length === 0, onClick: createGroup }, t('desk.createGroup')))),
          error === null ? null : h('div', { className: 'cwd-error', role: 'alert' }, error === 'load_failed' ? t('desk.loadFailed') : t(`error.${error}`)),
          pendingRemove === null ? null : h('div', { className: 'cwd-notice cwd-notice-danger' },
            h('span', null, `${t('desk.removeHint')} · ${scrubInvisible(pendingRemove.name)}`),
            h('button', { type: 'button', className: 'cwd-pill', onClick: () => setPendingRemove(null) }, t('desk.cancel'))),
          h('div', { className: 'cwd-thead', role: 'row' },
            h('span', null, t('desk.colName')),
            h('span', { className: 'cwd-right' }, t('desk.colPrice')),
            h('span', { className: 'cwd-right' }, t('desk.colChange')),
            h('span', { className: 'cwd-right' }, t('desk.colAction'))),
          listBody),
        h('aside', null, detail)),
    ))
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
  /** Projections can arrive late; nudge once per session, no polling or timer. */
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

  // Desk shell: one sidebar entry + its main panel. Quotes still come from the host
  // route the dialog uses; the page never fetches anything the dialog would not.
  // Registered after the overlay so the dialog stays the first seat this plugin adds.
  const deskT = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: DESK_PANEL_ID,
    locale: NS,
  }, WatchlistDeskPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: DESK_PANEL_ID,
    order: 12,
    locale: NS,
    label: () => deskT('desk.panel'),
  }, WatchlistDeskIcon))

  ctx.inject(['commandUi'], (scope) => {
    const t = ctx.locale.bind(NS)
    scope.effect(() => scope.commandUi.register({
      name: 'watchlist',
      label: () => t('command.label'),
      // No English alias in the row: filtering matches label/detail, and the bare token still works.
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
