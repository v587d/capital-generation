const { createElement: h, useEffect, useRef, useState } = require('react')
const { createPortal } = require('react-dom')
const {
  SettingsForm,
  SettingsSecretField,
  SettingsFormModel,
  SegmentedControl,
  Pill,
  Switch,
  Tag,
  Modal,
  Menu,
  IconChevronDownOutlineRegular,
  IconRightUpOutlineRegular,
} = require('@deepseek-ai/dsh-client-ui-primitives')
const { SELECTED_SKILL_CATALOG, SELECTED_SKILL_TAG_LABELS } = require('../selected-skills/catalog.js')
const {
  SELECTED_SKILL_FILTER_ALL,
  filterSelectedSkills,
  selectedSkillFacetCounts,
  selectedSkillPresetTotals,
  selectedSkillRoles,
  selectedSkillTraitOrder,
} = require('../selected-skills/filter.js')
const {
  SELECTED_SKILL_PRESETS,
  SELECTED_SKILL_PRESET_ORDER,
  SELECTED_SKILL_ROUTING,
} = require('../selected-skills/routing.js')
const { WORKSPACES_ROUTE } = require('../automation/contract.js')

/**
 * Two different strings: `ENTRY_ID` is the settings namespace (= profile entry
 * id, four places in lockstep); `BUNDLE_NAME` is the package name used as the
 * `plugins.bundle.config` key, in selectors and the npm URL. Drift silently
 * removes the card; tests pin both.
 */
const ENTRY_ID = 'capital-config'
const BUNDLE_NAME = '@v587d/capital-generation'
const LOCALE_NS = 'settings.capital'

/**
 * `plugins.detail.badge` (list, root scope) needs an `id` and also renders on row
 * detail pages, so both `subject.kind` and the package name must gate the links.
 */
const BADGE_SLOT = 'plugins.detail.badge'
const REPO_URL = 'https://github.com/v587d/capital-generation'
const NPM_URL = `https://www.npmjs.com/package/${BUNDLE_NAME}`

const FUYAO_DEFAULT_REF = 'FUYAO_API_KEY'
const FTSHARE_DEFAULT_REF = 'FTSHARE_API_KEY'
const ANYSEARCH_DEFAULT_REF = 'ANYSEARCH_API_KEY'
const WIND_DEFAULT_REF = 'WIND_API_KEY'
const PADDLE_OCR_DEFAULT_REF = 'PADDLE_OCR_TOKEN'
/** SegmentedControl contract: tab id is `<id>-<value>`, panel id is `<id>-<value>-panel`. */
const TABS_ID = 'capital-config-tabs'
/** Must match `SKILL_DOC_ROUTE` in `config/index.js`; drift = details never load. */
const SKILL_DOC_ROUTE = '/capital-skills'
/** Automation host routes; same auth plane as the workspace dropdown. */
const STORAGE_ROUTE = '/capital-automation/storage'
const STORAGE_CLEAR_ROUTE = '/capital-automation/storage/clear'
const DOC_URLS = {
  fuyao: 'https://fuyao.aicubes.cn/docs/',
  ftshare: 'https://market.ft.tech/gateway/doc/p/pb8eizu3',
  anysearch: 'https://www.anysearch.com/docs/auth',
  wind: 'https://market.windalice.com/',
  paddleocr: 'https://aistudio.baidu.com/paddleocr',
}

/** Render order = array order; one list drives status, refs, drafts and event refresh. */
const CREDENTIAL_FIELDS = ['fuyao', 'ftshare', 'anysearch', 'wind', 'paddleocr']
const AUTOMATION_FIELDS = ['tickMs', 'runTimeoutMinutes', 'idleTimeoutMinutes', 'maxSteps', 'maxToolCalls', 'inAppNotifications']
const AUTOMATION_WORKSPACE_FIELD = 'defaultWorkspaceId'
const WORKSPACE_DEDICATED_MENU_ID = '__capgen_dedicated_workspace__'
const AUTOMATION_DEFAULTS = {
  tickMs: 60_000,
  runTimeoutMinutes: 60,
  idleTimeoutMinutes: 5,
  maxSteps: 300,
  maxToolCalls: 1_200,
  inAppNotifications: true,
}
/** Mirrors `automation/defaults.js`; out-of-range values get an inline error instead of a silent clamp. */
const AUTOMATION_RANGES = {
  tickMs: { min: 30_000, max: 3_600_000, unit: 'automationUnitMs' },
  runTimeoutMinutes: { min: 5, max: 120, unit: 'automationUnitMinutes' },
  idleTimeoutMinutes: { min: 1, max: 30, unit: 'automationUnitMinutes' },
  maxSteps: { min: 100, max: 2_000, unit: 'automationUnitSteps' },
  maxToolCalls: { min: 100, max: 5_000, unit: 'automationUnitCalls' },
}
const STORAGE_CATEGORY_LABELS = {
  datasets: 'automationStorageDatasets',
  profiles: 'automationStorageProfiles',
  ocr: 'automationStorageOcr',
  charts: 'automationStorageCharts',
  runs: 'automationStorageRuns',
  other: 'automationStorageOther',
}
const SELECTED_SKILL_FIELDS = SELECTED_SKILL_CATALOG.map(({ key }) => key)
// Stable orders: facet counts change with the other dimension, but chips must not jump under the cursor.
const SELECTED_SKILL_TRAITS = selectedSkillTraitOrder()
const SELECTED_SKILL_PRESET_TOTALS = selectedSkillPresetTotals()
const DEFAULT_REFS = {
  fuyao: FUYAO_DEFAULT_REF,
  ftshare: FTSHARE_DEFAULT_REF,
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
  fuyaoHint: '同花顺 Fuyao 结构化数据接口。保存后新自动模式会话生效。',
  ftshareLabel: 'FTShare API Key',
  ftshareHint: '非凸科技 FTShare 结构化数据接口（免费档）。保存后新自动模式会话生效。',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'AnySearch 网页搜索 / 提取接口。保存后新自动模式会话生效。',
  localFetchLabel: '允许启动本地提取网页内容',
  localFetchHint: '开启后本地抓取兜底（回执来源 local-http）。保存后新自动模式会话生效。',
  automationTitle: '投研自动化',
  automationScheduleGroup: '调度',
  automationRunGroup: '单次运行上限',
  automationNotifyGroup: '通知',
  automationInAppHint: '运行结束、失败或超时后，在应用内通知里留一条记录。',
  automationTick: '自动检查间隔（毫秒）',
  automationRunTimeout: '最长运行时间（分钟）',
  automationInvalid: '请填写 {min}–{max} {unit}',
  automationUnitMs: '毫秒',
  automationUnitMinutes: '分钟',
  automationUnitSteps: '步',
  automationUnitCalls: '次',
  automationIdleTimeout: '空闲超时（分钟）',
  automationMaxSteps: '最大步骤',
  automationMaxToolCalls: '最大工具调用',
  automationInApp: '写入应用内通知',
  automationDefaultWorkspace: '默认工作区',
  automationWorkspacePath: '默认位置：{path}',
  automationWorkspaceMissing: '原工作区已被移除，运行会回退到专属默认工作区。',
  automationWorkspaceLoading: '工作区列表读取中…',
  automationWorkspaceUnavailable: '工作区列表暂时读不到；任务仍会使用默认工作区，切回本格会重试。',
  automationWorkspaceFallback: '专属默认工作区',
  automationStorageGroup: '存储',
  automationStorageWorkspace: '工作区数据',
  automationStorageCache: '可清理缓存',
  automationStorageAnalysis: '分析结果',
  automationStorageRetained: '保留',
  automationStorageSessions: '运行会话',
  automationStorageSessionsHint: '由 DSH 管理，不随「清除数据缓存」删除',
  automationStorageUnavailable: '占用读取失败；切回本格会重试。',
  automationStorageRetry: '重试',
  automationStorageStale: '刷新失败，显示上次结果。',
  automationStorageEmpty: '暂无可清理缓存',
  automationStorageClear: '清除数据缓存',
  automationStorageClearing: '清除中…',
  automationStorageConfirmTitle: '清除数据缓存',
  automationStorageConfirmBody: '将删除 {path} 中 {size} 的 capital-data 缓存（含数据集、数据档案与 OCR）。capital-analysis 中的分析结果、任务、运行记录、简报、通知和运行会话都会保留。',
  automationStorageConfirm: '清除 {size}',
  automationStorageCancel: '取消',
  automationStorageCleared: '已释放 {size}。',
  automationStorageClearedPartial: '已释放 {size}，另有 {failed} 个文件未能删除。',
  automationStorageClearFailed: '清理失败，请稍后再试。',
  automationStorageRunInProgress: '有运行正在进行，请结束后再清理。',
  automationStorageActiveHint: '有运行正在进行，结束后可清理。',
  automationStorageUnsafe: '缓存目录不是普通目录，已停止清理。',
  automationStorageDatasets: '数据集',
  automationStorageProfiles: '数据档案',
  automationStorageOcr: 'OCR',
  automationStorageCharts: '图表',
  automationStorageRuns: '分析产物',
  automationStorageOther: '其他',
  automationStorageSessionCount: '{count} 个',
  automationStorageUnreadable: '部分文件读不到，显示的是可读部分。',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind 金融信披类文档检索接口。保存后新自动模式会话生效。',
  paddleocrLabel: 'PaddleOCR 文档解析 Token',
  paddleocrHint: '配置 Token 后自动解析 PDF、图片。保存后新自动模式会话生效。',
  selectedSkillsTitle: '精选 Skills',
  selectedSkillsModeLabel: '智能装载 Skills',
  selectedSkillsModeHint: '开启后，由大模型根据用户提问，智能装载合适的精选「Skills」。',
  selectedSkillsFilterLabel: '筛选精选 Skills',
  selectedSkillsTraitGroup: 'Skill 特点',
  selectedSkillsPresetGroup: '适用预设',
  selectedSkillsAll: '全部',
  selectedSkillsEmpty: '没有符合当前筛选条件的 Skill。',
  selectedSkillsWhen: '何时使用',
  selectedSkillsKeywords: '关键词',
  selectedSkillsOpenDetail: '查看 Skill 原文',
  selectedSkillsPresetUnavailable: '该预设不加载精选 Skills',
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
  // A rejected or non-landing write (stale page revision, transport hiccup). Plain words only:
  // the typed value is still there, so the next action is retry, not a restart.
  saveFailed: '没有保存成功，请再试一次。',
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
  fuyaoHint: 'Tonghuashun Fuyao structured-data API. Takes effect in new Auto mode sessions.',
  ftshareLabel: 'FTShare API Key',
  ftshareHint: 'Feikon FTShare structured-data API (free tier). Takes effect in new Auto mode sessions.',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'AnySearch web search / extract interface. Takes effect in new Auto mode sessions.',
  localFetchLabel: 'Allow local web page extraction',
  localFetchHint: 'When on, a failed fetch falls back to local direct fetching (receipt via: local-http). Takes effect in new Auto mode sessions.',
  automationTitle: 'Research automation',
  automationScheduleGroup: 'Scheduling',
  automationRunGroup: 'Per-run limits',
  automationNotifyGroup: 'Notifications',
  automationInAppHint: 'Leave an in-app notification when a run finishes, fails, or times out.',
  automationTick: 'Auto-check interval (ms)',
  automationRunTimeout: 'Max run time (minutes)',
  automationInvalid: 'Enter a whole number from {min} to {max} {unit}',
  automationUnitMs: 'ms',
  automationUnitMinutes: 'minutes',
  automationUnitSteps: 'steps',
  automationUnitCalls: 'calls',
  automationIdleTimeout: 'Idle timeout (minutes)',
  automationMaxSteps: 'Max steps',
  automationMaxToolCalls: 'Max tool calls',
  automationInApp: 'Write in-app notifications',
  automationDefaultWorkspace: 'Default workspace',
  automationWorkspacePath: 'Location: {path}',
  automationWorkspaceMissing: 'That workspace was removed; runs fall back to the dedicated default workspace.',
  automationWorkspaceLoading: 'Loading workspaces…',
  automationWorkspaceUnavailable: 'The workspace list is unavailable; runs still use the default workspace. Re-entering this tab retries.',
  automationWorkspaceFallback: 'Dedicated default workspace',
  automationStorageGroup: 'Storage',
  automationStorageWorkspace: 'Workspace data',
  automationStorageCache: 'Clearable cache',
  automationStorageAnalysis: 'Analysis results',
  automationStorageRetained: 'Retained',
  automationStorageSessions: 'Run sessions',
  automationStorageSessionsHint: 'Managed by DSH; not removed by “Clear data cache”',
  automationStorageUnavailable: 'Could not read usage; re-enter this tab to retry.',
  automationStorageRetry: 'Retry',
  automationStorageStale: 'Refresh failed; showing the previous result.',
  automationStorageEmpty: 'No cache to clear',
  automationStorageClear: 'Clear data cache',
  automationStorageClearing: 'Clearing…',
  automationStorageConfirmTitle: 'Clear data cache',
  automationStorageConfirmBody: 'Delete {size} of capital-data cache from {path} (datasets, profiles, and OCR). Analysis results in capital-analysis, tasks, run records, briefs, notifications, and run sessions are kept.',
  automationStorageConfirm: 'Clear {size}',
  automationStorageCancel: 'Cancel',
  automationStorageCleared: 'Freed {size}.',
  automationStorageClearedPartial: 'Freed {size}; {failed} file(s) could not be removed.',
  automationStorageClearFailed: 'Cleanup failed. Please try again.',
  automationStorageRunInProgress: 'A run is in progress. Try again after it ends.',
  automationStorageActiveHint: 'A run is in progress; cleanup is available after it ends.',
  automationStorageUnsafe: 'The cache directory is not a regular directory; cleanup was stopped.',
  automationStorageDatasets: 'Datasets',
  automationStorageProfiles: 'Data profiles',
  automationStorageOcr: 'OCR',
  automationStorageCharts: 'Charts',
  automationStorageRuns: 'Runs',
  automationStorageOther: 'Other',
  automationStorageSessionCount: '{count} sessions',
  automationStorageUnreadable: 'Some files could not be read; showing readable data.',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind financial disclosure document retrieval interface. Takes effect in new Auto mode sessions.',
  paddleocrLabel: 'PaddleOCR document token',
  paddleocrHint: 'Configure the token to parse PDFs and images automatically. Takes effect in new Auto mode sessions.',
  selectedSkillsTitle: 'Selected Skills',
  selectedSkillsModeLabel: 'Auto-load Skills',
  selectedSkillsModeHint: 'When on, the model picks the relevant selected Skills for each question.',
  selectedSkillsFilterLabel: 'Filter selected Skills',
  selectedSkillsTraitGroup: 'Skill traits',
  selectedSkillsPresetGroup: 'Preset',
  selectedSkillsAll: 'All',
  selectedSkillsEmpty: 'No skills match the current filters.',
  selectedSkillsWhen: 'Use when',
  selectedSkillsKeywords: 'Keywords',
  selectedSkillsOpenDetail: 'Open skill source',
  selectedSkillsPresetUnavailable: 'This preset does not load selected Skills.',
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
  saveFailed: "That didn't save. Please try again.",
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  githubLabel: 'GitHub repository',
  npmLabel: 'npm package page',
}

function text(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function refOf(snapshot, field) {
  if (field === 'fuyao') return text(snapshot.value?.fuyaoCredentialRef, DEFAULT_REFS.fuyao)
  if (field === 'ftshare') return text(snapshot.value?.ftshareCredentialRef, DEFAULT_REFS.ftshare)
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
    /* Declare display only when not hidden, or the hidden attribute loses to author display. */
    .capital-config-panel { flex-direction: column; gap: 12px; }
    .capital-config-panel:not([hidden]) { display: flex; }
    .capital-config-panel[hidden] { display: none; }
    /* Host rows section: positive :has rules only, so any mismatch leaves it visible. */
    [data-plugin-detail="${BUNDLE_NAME}"]:has(.capital-config-card[data-capital-config-tab="sources"]) section[data-plugin-rows] { display: none; }
    [data-plugin-detail="${BUNDLE_NAME}"]:has(.capital-config-card[data-capital-config-tab="automation"]) section[data-plugin-rows] { display: none; }
    [data-plugin-detail="${BUNDLE_NAME}"]:has(.capital-config-card[data-capital-config-tab="skills"]) section[data-plugin-rows] { display: none; }
    /* Internal roles must stay declared for delegation; hide their user-selectable cards in Settings. */
    [data-agent-preset-id="capital-data-junior"],
    [data-agent-preset-id="capital-visualization-specialist"] { display: none !important; }
    .capital-config-secret-row { display: flex; flex-direction: column; gap: 2px; }
    /* Doc link is portaled into the host head row: shrink its label, keep the badge at the end. */
    .capital-config-secret-row label { flex: 0 1 auto; }
    .capital-config-secret-row label ~ span { order: 1; margin-left: auto; }
    .capital-config-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
    .capital-config-automation { display: flex; flex-direction: column; gap: 16px; padding-top: 12px; }
    .capital-config-automation-group { display: flex; flex-direction: column; gap: 8px; }
    .capital-config-automation-group > .capital-config-group-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 18px; }
    .capital-config-number { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .capital-config-workspace { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .capital-config-storage { display: flex; flex-direction: column; min-width: 0; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
    .capital-config-storage-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 14px; }
    .capital-config-storage-head > .capital-config-storage-label { font-size: 12px; }
    .capital-config-storage-head > .capital-config-storage-amount { font-size: 15px; font-weight: 600; line-height: 22px; }
    .capital-config-storage-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-top: .5px solid var(--dsw-alias-border-l2); }
    .capital-config-storage-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
    .capital-config-storage-value { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .capital-config-storage-label { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 20px; }
    .capital-config-storage-amount { display: inline-flex; align-items: baseline; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .capital-config-storage-count { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; font-weight: 400; }
    .capital-config-storage-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .capital-config-storage-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; }
    .capital-config-storage-badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }
    .capital-config-storage-meta { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 17px; overflow-wrap: anywhere; }
    .capital-config-storage-meta[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
    .capital-config-storage-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 10px 14px; border-top: .5px solid var(--dsw-alias-border-l2); }
    .capital-config-storage-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-left: auto; min-width: 0; }
    .capital-config-storage-retry { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
    .capital-config-storage-retry:hover { text-decoration: underline; }
    .capital-config-storage-retry:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    .capital-config-storage-result { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
    .capital-config-cache-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 20px; cursor: pointer; transition: background .15s, border-color .15s, opacity .15s; }
    .capital-config-cache-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
    .capital-config-cache-button[data-variant="danger"] { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
    .capital-config-cache-button[data-variant="danger"]:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
    .capital-config-cache-button:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 0; }
    .capital-config-cache-button:disabled { opacity: .5; cursor: not-allowed; }
    div.capital-config-cache-modal { width: min(480px, 100%); }
    .capital-config-cache-modal-content { min-height: 0; overflow: auto; }
    .capital-config-cache-modal-body { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 20px; }
    .capital-config-cache-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .capital-config-number-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .capital-config-number-head .capital-config-write-failed { font-size: 11px; line-height: 16px; }
    .capital-config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .capital-config-automation input[type="number"] { width: 100%; box-sizing: border-box; padding: 6px 8px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
    .capital-config-select { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-width: 0; height: 34px; padding: 0 10px 0 12px; border: 0; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 20px; text-align: left; cursor: pointer; transition: background .15s, opacity .15s; }
    .capital-config-select:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
    .capital-config-select:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 0; }
    .capital-config-select:disabled { opacity: .5; cursor: not-allowed; }
    .capital-config-selectvalue { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .capital-config-select > svg { flex: none; color: var(--dsw-alias-label-tertiary); }
    .capital-config-selected-mode { padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
    .capital-config-switch-row { align-items: center; gap: 12px; display: flex; }
    .capital-config-switch-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .capital-config-switch-label { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
    .capital-config-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .capital-config-skills-browser { display: flex; flex-direction: column; gap: 16px; }
    .capital-config-filters { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
    .capital-config-filter-row { display: flex; align-items: flex-start; gap: 12px; }
    .capital-config-filter-label { flex: 0 0 auto; min-width: 64px; padding-top: 3px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; font-weight: 500; line-height: 18px; }
    .capital-config-filter-options { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .capital-config-filter-pill { height: 22px; padding: 0 7px; gap: 5px; font-size: 11.5px; line-height: 16px; }
    .capital-config-filter-pill:disabled { opacity: 0.45; cursor: not-allowed; }
    .capital-config-filter-pill:disabled:hover { background: var(--dsw-alias-bg-layer-2); }
    .capital-config-filter-count { color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 14px; font-variant-numeric: tabular-nums; }
    .capital-config-filter-pill[aria-pressed="true"] .capital-config-filter-count { color: inherit; opacity: 0.72; }
    .capital-config-selected-list { display: flex; flex-direction: column; border-top: 0.5px solid var(--dsw-alias-border-l1); }
    .capital-config-skill-item { border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
    .capital-config-skill-row { display: flex; align-items: flex-start; gap: 16px; padding: 14px 2px; }
    .capital-config-skill-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; }
    .capital-config-skill-heading { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .capital-config-skill-name { padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; text-align: left; cursor: pointer; }
    .capital-config-skill-name:hover { color: var(--dsw-alias-brand-primary); }
    .capital-config-skill-name:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    .capital-config-skill-tags, .capital-config-skill-presets { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .capital-config-skill-tag { font-weight: 400; }
    .capital-config-skill-preset { font-weight: 500; }
    .capital-config-skill-description { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    .capital-config-skill-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: 10px; row-gap: 2px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    .capital-config-skill-meta dt { color: var(--dsw-alias-label-tertiary); font-weight: 500; white-space: nowrap; }
    .capital-config-skill-meta dd { min-width: 0; margin: 0; }
    .capital-config-skill-repo { display: inline-flex; align-items: center; gap: 3px; width: max-content; max-width: 100%; margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; text-decoration: none; }
    .capital-config-skill-repo:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
    .capital-config-selected-empty { margin: 0; padding: 28px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
    /* Official Modal defaults to 380px; the div prefix outranks the hashed .dialog class. */
    div.capital-config-skill-modal { width: min(820px, 100%); max-height: 100%; }
    /* Scroll the body so the dialog's overflow:hidden cannot clip it. */
    .capital-config-skill-modal-content { min-height: 0; overflow: auto; }
    /* Show SKILL.md as source, not rendered markdown. */
    .capital-config-skill-doc { min-height: 0; max-height: 58vh; margin: 0; padding: 12px 14px; overflow: auto; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 17px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .capital-config-skill-doc-state { margin: 0; padding: 12px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    /* aria-controls target must not be empty; absolute keeps it layout-free. */
    .capital-config-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    /* Pull the host h4 up to the same 24px rhythm as the other tabs (measured). */
    .capital-config-panel[data-capital-config-panel="components"] { margin-bottom: -20px; }
    .capital-config-doc-link { display: inline-flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; white-space: nowrap; text-decoration: none; }
    .capital-config-doc-link:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
    .capital-config-doc-link:focus-visible { border-radius: 3px; outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    .capital-config-write-failed { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
    /* Own inline-flex group so the host's wrapping never splits the two links. */
    .capital-config-plugin-links { flex: none; align-items: center; gap: 2px; display: inline-flex; }
    .capital-config-plugin-link { border-radius: var(--dsw-radius-sm); width: 24px; height: 24px; color: var(--dsw-alias-label-tertiary); justify-content: center; align-items: center; display: inline-flex; text-decoration: none; }
    .capital-config-plugin-link:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .capital-config-plugin-link:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

/**
 * Dedicated workspace is the empty value, so the dropdown can keep one "follow default"
 * entry even when the registry list is empty or the saved id has been removed.
 */
function workspaceProjection(details, rawSelected, state) {
  const selectedId = typeof rawSelected === 'string' ? rawSelected.trim() : ''
  const items = Array.isArray(details?.workspaces) ? details.workspaces : []
  const dedicated = items.find((item) => item?.dedicated === true)
  const dedicatedPath = typeof dedicated?.path === 'string' ? dedicated.path : ''
  const options = [{
    id: '',
    title: typeof dedicated?.title === 'string' ? dedicated.title : '',
    path: typeof dedicated?.displayPath === 'string' ? dedicated.displayPath : '',
    dedicated: true,
    missing: false,
  }]
  for (const item of items) {
    if (item?.dedicated === true || (dedicatedPath !== '' && item?.path === dedicatedPath) || typeof item?.id !== 'string') continue
    options.push({
      id: item.id,
      title: typeof item.title === 'string' ? item.title : item.id,
      path: typeof item.displayPath === 'string' ? item.displayPath : '',
      dedicated: false,
      missing: false,
    })
  }
  const missing = selectedId !== '' && !options.some((option) => option.id === selectedId)
  if (missing) options.push({ id: selectedId, title: '', path: '', dedicated: false, missing: true })
  const current = options.find((option) => option.id === selectedId) ?? options[0]
  return { options, selectedId, current, missing, ...state }
}

/**
 * DSH General-settings style selector: same filled pill + host `Menu` surface as the
 * automation page. Native `<select>` is avoided so light/dark themes follow host tokens.
 */
function WorkspaceSelect({ value, options, onChange, disabled, label, describedBy }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const currentValue = typeof value === 'string' ? value : ''
  const items = options.map((option) => ({
    id: option.id === '' ? WORKSPACE_DEDICATED_MENU_ID : option.id,
    label: option.label,
  }))
  const menuValue = currentValue === '' ? WORKSPACE_DEDICATED_MENU_ID : currentValue
  const current = items.find((item) => item.id === menuValue) ?? items[0]
  useEffect(() => {
    if (disabled === true && open) setOpen(false)
  }, [disabled, open])
  const closeMenu = () => setOpen(false)
  const selectValue = (id) => {
    setOpen(false)
    triggerRef.current?.focus?.({ preventScroll: true })
    const next = id === WORKSPACE_DEDICATED_MENU_ID ? '' : id
    if (next === currentValue) return undefined
    return onChange(next)
  }
  const trigger = h('button', {
    ref: triggerRef,
    type: 'button',
    className: 'capital-config-select',
    disabled,
    'aria-label': current?.label ? `${label}：${current.label}` : label,
    'aria-haspopup': 'menu',
    'aria-expanded': open ? 'true' : 'false',
    'aria-describedby': describedBy,
    title: current?.label,
    onClick: () => setOpen((currentOpen) => !currentOpen),
  },
  h('span', { className: 'capital-config-selectvalue', title: current?.label }, current?.label ?? ''),
  h(IconChevronDownOutlineRegular, { size: 14 }))
  return h(Menu, {
    open,
    anchor: trigger,
    items,
    selectedId: menuValue,
    onSelect: selectValue,
    onClose: closeMenu,
    align: 'start',
    portal: true,
  })
}

class CapitalCardController {
  constructor(scope, ctx) {
    this.scope = scope
    this.ctx = ctx
    this.status = freshStatus()
    this.localFetchWriting = false
    this.localFetchFailed = false
    this.selectedSkillWriting = new Set()
    this.selectedSkillFailed = new Set()
    this.selectedSkillsModeWriting = false
    this.selectedSkillsModeFailed = false
    this.automationWriting = new Set()
    this.automationFailed = new Set()
    this.automationInvalid = new Set()
    this.workspaceWriting = false
    this.workspaceFailed = false
    this.workspaceDetails = null
    this.workspacesInFlight = false
    this.workspacesFailed = false
    this.storage = null
    this.storageInFlight = false
    this.storageQueued = false
    this.storageFailed = false
    this.storageClearing = false
    this.storageClearError = null
    this.storageClearedBytes = null
    this.storageClearedFailed = 0
    this.storageRequestId = 0
    // Row count is external: null = unknown, never 0; fetch only after the card is shown.
    this.bundleRows = null
    this.rowsRequested = false
    this.rowsInFlight = false
    // Keys are write-only via the credentials domain; switches mutate volatile paths directly.
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
      // Strictly from the entry snapshot; `!== false` matches `resolveLocalFetchConfig`.
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
      selectedSkillsMode: {
        auto: snapshot.value?.selectedSkillsMode === 'auto',
        writing: this.selectedSkillsModeWriting,
        failed: this.selectedSkillsModeFailed,
      },
      automation: Object.fromEntries(AUTOMATION_FIELDS.map((field) => [field, {
        value: snapshot.value?.automation?.[field] ?? AUTOMATION_DEFAULTS[field],
        on: snapshot.value?.automation?.[field] !== false,
        writing: this.automationWriting.has(field),
        failed: this.automationFailed.has(field),
        invalid: this.automationInvalid.has(field),
      }])),
      workspace: workspaceProjection(this.workspaceDetails, snapshot.value?.automation?.[AUTOMATION_WORKSPACE_FIELD], {
        loading: this.workspacesInFlight,
        unavailable: this.workspacesFailed && this.workspaceDetails === null,
        writing: this.workspaceWriting,
        failed: this.workspaceFailed,
      }),
      storage: {
        data: this.storage,
        loading: this.storageInFlight || (this.storage === null && this.storageFailed !== true),
        failed: this.storageFailed,
        unavailable: this.storageFailed && this.storage === null,
        stale: this.storageFailed && this.storage !== null,
        clearing: this.storageClearing,
        error: this.storageClearError,
        clearedBytes: this.storageClearedBytes,
        clearedFailed: this.storageClearedFailed,
      },
      // `count === null` means unknown, not zero: the card decides whether to draw it.
      components: { count: this.bundleRows },
    }
  }

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
      // Refs changed while reading: discard this batch.
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
      // The next credential event retries.
    }
  }

  refresh(ref) {
    if (CREDENTIAL_FIELDS.some((field) => ref === this.status[field].ref)) this.readCredentials()
  }

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
   * Immediate entry-config write (not a key): atomic, revision-fenced, no draft;
   * nested paths need `mutate`. The switch renders from the snapshot, so a rejected
   * write leaves it unflipped and sets `failed`.
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
      // The landed check below reports the failure.
    }
    this.localFetchWriting = false
    const landed = this.scope.getSnapshot().value?.retriever?.localFetch?.enabled === value
    if (!landed) this.localFetchFailed = true
    this.store.set(this.projection())
  }

  async toggleSelectedSkillsMode(auto) {
    if (this.selectedSkillsModeWriting) return
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    this.selectedSkillsModeWriting = true
    this.selectedSkillsModeFailed = false
    this.store.set(this.projection())
    try {
      await this.scope.mutate([{ op: 'set', path: ['selectedSkillsMode'], value: auto ? 'auto' : 'manual' }])
    } catch {
      // The landed check below reports the failure.
    }
    this.selectedSkillsModeWriting = false
    const landed = (this.scope.getSnapshot().value?.selectedSkillsMode === 'auto') === auto
    if (!landed) this.selectedSkillsModeFailed = true
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

  /** Returns why the write did or did not land: the card restores the input only for `invalid`. */
  async writeAutomation(field, value) {
    if (!AUTOMATION_FIELDS.includes(field) || this.automationWriting.has(field)) return 'ignored'
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return 'ignored'
    let next
    if (field === 'inAppNotifications') {
      next = value === true
    } else {
      const { min, max } = AUTOMATION_RANGES[field]
      const raw = typeof value === 'string' ? value.trim() : value
      next = Number(raw)
      if (raw === '' || raw === null || raw === undefined || !Number.isInteger(next) || next < min || next > max) {
        // Point at the range and write nothing; the card puts the saved value back.
        this.automationInvalid.add(field)
        this.automationFailed.delete(field)
        this.store.set(this.projection())
        return 'invalid'
      }
      this.automationInvalid.delete(field)
    }
    this.automationWriting.add(field)
    this.automationFailed.delete(field)
    this.store.set(this.projection())
    try {
      // Only leaves are volatile: writing the `automation` container is rejected by the settings
      // service even though every child field is editable.
      await this.scope.mutate([{ op: 'set', path: ['automation', field], value: next }])
    } catch {
      // The landed check below reports the failure.
    }
    this.automationWriting.delete(field)
    const landed = this.scope.getSnapshot().value?.automation?.[field] ?? AUTOMATION_DEFAULTS[field]
    if (landed !== next) this.automationFailed.add(field)
    this.store.set(this.projection())
    return landed === next ? 'saved' : 'failed'
  }

  clearAutomationInvalid(field) {
    if (!this.automationInvalid.delete(field)) return
    this.store.set(this.projection())
  }

  /**
   * Count comes only from `pluginManager.listBundles()`. Merge in-flight reads;
   * failures are not cached (the next tab switch retries); push only on change.
   */
  async ensureBundleRows() {
    this.rowsRequested = true
    if (this.bundleRows !== null) return
    await this.readBundleRows()
  }

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
      // Keep the old value (usually null); retry on the next tab switch or event.
    }
    this.rowsInFlight = false
    if (count === this.bundleRows) return
    this.bundleRows = count
    this.store.set(this.projection())
  }

  /**
   * Workspace ids come from the automation route (same auth plane as its page), never from
   * a path in settings. Failures are not cached: re-entering the tab retries.
   */
  async ensureWorkspaces() {
    if (this.workspaceDetails !== null || this.workspacesInFlight) return
    this.workspacesInFlight = true
    this.workspacesFailed = false
    this.store.set(this.projection())
    try {
      if (typeof fetch !== 'function') throw new Error('fetch_unavailable')
      const response = await fetch(WORKSPACES_ROUTE, { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      if (!response?.ok) throw new Error(`http_${response?.status ?? 0}`)
      const payload = await response.json()
      if (!Array.isArray(payload?.workspaces)) throw new Error('invalid_payload')
      this.workspaceDetails = {
        workspaces: payload.workspaces.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string'),
      }
    } catch {
      this.workspacesFailed = true
    }
    this.workspacesInFlight = false
    this.store.set(this.projection())
  }

  /**
   * Workspace usage is read from the automation route. Dirty cache is harmless: the
   * server caps the scan and the card still allows a retry. A forced read merges with
   * an in-flight one so a workspace switch cannot race an older response.
   */
  async ensureStorage(force = false) {
    if (this.storageInFlight) {
      if (force) this.storageQueued = true
      return
    }
    if (!force && this.storage !== null && !this.storageFailed) return
    const requestId = (this.storageRequestId += 1)
    this.storageInFlight = true
    this.storageFailed = false
    this.store.set(this.projection())
    try {
      if (typeof fetch !== 'function') throw new Error('fetch_unavailable')
      const response = await fetch(STORAGE_ROUTE, { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
      if (!response?.ok) throw new Error(`http_${response?.status ?? 0}`)
      const payload = await response.json()
      const storage = payload?.storage
      if (storage === null || typeof storage !== 'object' || Array.isArray(storage)) throw new Error('invalid_payload')
      if (requestId === this.storageRequestId) {
        this.storage = storage
        this.storageFailed = false
      }
    } catch {
      if (requestId === this.storageRequestId) this.storageFailed = true
    } finally {
      if (requestId === this.storageRequestId) this.storageInFlight = false
      this.store.set(this.projection())
      if (this.storageQueued) {
        this.storageQueued = false
        void this.ensureStorage(true)
      }
    }
  }

  async clearStorage() {
    if (this.storageClearing) return 'ignored'
    this.storageClearing = true
    this.storageClearError = null
    this.storageClearedBytes = null
    this.storageClearedFailed = 0
    this.store.set(this.projection())
    try {
      if (typeof fetch !== 'function') throw new Error('fetch_unavailable')
      const response = await fetch(STORAGE_CLEAR_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        credentials: 'same-origin',
      })
      const payload = await response.json().catch(() => null)
      if (!response?.ok || payload?.ok !== true) {
        const code = payload?.code
        this.storageClearError = code === 'run_in_progress'
          ? 'run_in_progress'
          : code === 'cache_root_unsafe' ? 'unsafe' : 'failed'
        return 'failed'
      }
      const cleared = payload?.cleared
      if (Number.isSafeInteger(cleared?.bytes) && cleared.bytes >= 0) this.storageClearedBytes = cleared.bytes
      if (Array.isArray(cleared?.failed)) this.storageClearedFailed = cleared.failed.length
      await this.ensureStorage(true)
      return 'cleared'
    } catch {
      this.storageClearError = 'failed'
      return 'failed'
    } finally {
      this.storageClearing = false
      this.store.set(this.projection())
    }
  }

  async writeAutomationWorkspace(value) {
    if (this.workspaceWriting) return 'ignored'
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return 'ignored'
    const next = typeof value === 'string' ? value.trim() : ''
    this.workspaceWriting = true
    this.workspaceFailed = false
    this.store.set(this.projection())
    try {
      await this.scope.mutate([{ op: 'set', path: ['automation', AUTOMATION_WORKSPACE_FIELD], value: next }])
    } catch {
      // The landed check below reports the failure.
    }
    this.workspaceWriting = false
    const landed = (this.scope.getSnapshot().value?.automation?.[AUTOMATION_WORKSPACE_FIELD] ?? '') === next
    if (!landed) this.workspaceFailed = true
    this.store.set(this.projection())
    if (landed) {
      // A different workspace has a different cache; drop the old numbers before refetching.
      this.storage = null
      this.storageFailed = false
      this.storageClearError = null
      this.storageClearedBytes = null
      this.storageClearedFailed = 0
      void this.ensureStorage(true)
    }
    return landed ? 'saved' : 'failed'
  }

  inject() {
    return {
      hooks: {
        capitalCard: this.store,
      },
      ...this.model.actions(),
      toggleLocalFetch: (value) => this.toggleLocalFetch(value),
      writeAutomation: (field, value) => this.writeAutomation(field, value),
      clearAutomationInvalid: (field) => this.clearAutomationInvalid(field),
      toggleSelectedSkill: (field, value) => this.toggleSelectedSkill(field, value),
      toggleSelectedSkillsMode: (auto) => this.toggleSelectedSkillsMode(auto),
      ensureBundleRows: () => this.ensureBundleRows(),
      ensureWorkspaces: () => this.ensureWorkspaces(),
      ensureStorage: (force) => this.ensureStorage(force),
      clearStorage: () => this.clearStorage(),
      writeAutomationWorkspace: (value) => this.writeAutomationWorkspace(value),
    }
  }
}

/**
 * Key row = official `SettingsSecretField` plus a docs link. `label` only takes a
 * string, so the link is portaled into the host head row, falling back inline.
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
 * On-demand SKILL.md fetch. Cache successes only, merge in-flight requests. Our
 * `{ error }` body means the snapshot is unreadable; a foreign body means the host
 * process has no route (restart, not reload).
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

function presetLabel(role, locale) {
  return SELECTED_SKILL_PRESETS[role]?.[locale] ?? role
}

/** Routing text stays one sentence; split the keyword tail so both lines share a type scale. */
function splitUseWhen(value, locale) {
  const marker = locale === 'en' ? 'Triggers on ' : '；关键词：'
  const index = value.lastIndexOf(marker)
  if (index <= 0) return { when: value, keywords: '' }
  return {
    when: value.slice(0, index).trim(),
    keywords: value.slice(index + marker.length).trim().replace(locale === 'en' ? /\.$/ : /。$/, ''),
  }
}

function SelectedSkillRow({ entry, state, disabled, onChange, t }) {
  const locale = skillLocale()
  const label = entry.label[locale]
  const repositoryUrl = `https://github.com/${entry.owner}/${entry.repository}`
  const [detailOpen, setDetailOpen] = useState(false)
  const [doc, setDoc] = useState(null)
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
  const { when, keywords } = splitUseWhen(SELECTED_SKILL_ROUTING[entry.name]?.useWhen?.[locale] ?? '', locale)
  const roles = entry.roles ?? []
  return h('div', { className: 'capital-config-skill-item' },
    h('div', { className: 'capital-config-skill-row' },
      h('div', { className: 'capital-config-skill-main' },
        h('div', { className: 'capital-config-skill-heading' },
          h('button', {
            type: 'button',
            className: 'capital-config-skill-name',
            title: t('selectedSkillsOpenDetail'),
            'aria-haspopup': 'dialog',
            // Prefetch on hover / focus so the modal opens with content; click is the action.
            onPointerEnter: prefetchDoc,
            onFocus: prefetchDoc,
            onClick: () => {
              prefetchDoc()
              setDetailOpen(true)
            },
          }, label),
          h('div', { className: 'capital-config-skill-tags', role: 'group', 'aria-label': t('selectedSkillsTraitGroup') },
            entry.tags.map((tag) => h(Tag, {
              key: tag,
              tone: 'neutral',
              className: 'capital-config-skill-tag',
            }, SELECTED_SKILL_TAG_LABELS[locale][tag] ?? tag))),
          roles.length > 0 ? h('div', { className: 'capital-config-skill-presets', role: 'group', 'aria-label': t('selectedSkillsPresetGroup') },
            roles.map((role) => h(Tag, {
              key: role,
              tone: 'info',
              className: 'capital-config-skill-preset',
            },
            h('span', { className: 'capital-config-sr-only' }, `${t('selectedSkillsPresetGroup')}：`),
            presetLabel(role, locale)))) : null,
          h(Modal, {
            open: detailOpen,
            onClose: () => setDetailOpen(false),
            title: label,
            description: entry.name,
            closeLabel: t('selectedSkillsDetailClose'),
            className: 'capital-config-skill-modal',
            contentClassName: 'capital-config-skill-modal-content',
          }, detailContent),
        ),
        h('p', { className: 'capital-config-skill-description' }, entry.description[locale]),
        h('dl', { className: 'capital-config-skill-meta' },
          h('dt', { key: 'when-label' }, t('selectedSkillsWhen')),
          h('dd', { key: 'when' }, when),
          keywords ? h('dt', { key: 'keywords-label' }, t('selectedSkillsKeywords')) : null,
          keywords ? h('dd', { key: 'keywords' }, keywords) : null,
        ),
        h('a', {
          className: 'capital-config-skill-repo',
          href: repositoryUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('selectedSkillsOpenRepo'),
        }, `${entry.owner}/${entry.repository}`, h(IconRightUpOutlineRegular, { size: 12 })),
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
 * Bundle config page. Inactive panels stay mounted and only `hidden` (unmounting
 * `SettingsForm` discards drafts). The host rows section collapses on
 * `data-capital-config-tab`, so when unavailable we draw neither tabs nor that
 * attribute and the host list stays visible.
 */
function formatBytes(value) {
  const bytes = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = -1
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(1)} ${units[unit]}`
}

function ClearCacheModal({ open, bytes, displayPath, clearing, error, onCancel, onConfirm, t }) {
  const size = formatBytes(bytes)
  const errorText = error === 'run_in_progress'
    ? t('automationStorageRunInProgress')
    : error === 'unsafe' ? t('automationStorageUnsafe') : error === 'failed' ? t('automationStorageClearFailed') : null
  return h(Modal, {
    open,
    onClose: () => { if (!clearing) onCancel() },
    title: t('automationStorageConfirmTitle'),
    closeLabel: t('automationStorageCancel'),
    className: 'capital-config-cache-modal',
    contentClassName: 'capital-config-cache-modal-content',
    footer: h('div', { className: 'capital-config-cache-actions' },
      h('button', {
        type: 'button',
        className: 'capital-config-cache-button',
        disabled: clearing,
        onClick: onCancel,
      }, t('automationStorageCancel')),
      h('button', {
        type: 'button',
        className: 'capital-config-cache-button',
        'data-variant': 'danger',
        'aria-busy': clearing ? 'true' : undefined,
        disabled: clearing,
        onClick: onConfirm,
      }, clearing ? t('automationStorageClearing') : t('automationStorageConfirm', { size })),
    ),
  },
  h('p', { className: 'capital-config-cache-modal-body' },
    t('automationStorageConfirmBody', { size, path: displayPath || t('automationStorageWorkspace') })),
  errorText ? h('p', { role: 'alert', className: 'capital-config-write-failed' }, errorText) : null)
}

function CapitalCard(props) {
  const t = props.t
  const state = props.useCapitalCard((snapshot) => snapshot)
  const disabled = !state.writable
  const autoMode = state.selectedSkillsMode?.auto === true
  const locale = skillLocale()
  const [tab, setTab] = useState('sources')
  const [clearCacheOpen, setClearCacheOpen] = useState(false)
  const [traitFilter, setTraitFilter] = useState(SELECTED_SKILL_FILTER_ALL)
  const [presetFilter, setPresetFilter] = useState(SELECTED_SKILL_FILTER_ALL)
  // Fetch on mount: tab labels carry numbers; hooks must precede the unavailable return.
  useEffect(() => { props.ensureBundleRows() }, [])
  // The workspace list and storage usage live behind the automation route; fetch when its tab opens.
  useEffect(() => {
    if (tab !== 'automation') return
    props.ensureWorkspaces()
    props.ensureStorage()
  }, [tab])
  // Pinned order is snapshotted on tab entry so rows never move under the cursor.
  const enabledKeys = () => new Set(SELECTED_SKILL_CATALOG
    .filter((entry) => state.selectedSkills?.[entry.key]?.on === true)
    .map((entry) => entry.key))
  const [pinnedSkills, setPinnedSkills] = useState(enabledKeys)
  useEffect(() => {
    if (state.available && !autoMode) setPinnedSkills(enabledKeys())
  }, [state.available, autoMode])
  const facetCounts = selectedSkillFacetCounts({ trait: traitFilter, preset: presetFilter })
  const visibleSkills = filterSelectedSkills({ trait: traitFilter, preset: presetFilter })
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
    h(SecretRow, { field: 'ftshare', label: t('ftshareLabel'), hint: t('ftshareHint'), docsUrl: DOC_URLS.ftshare, state: state.ftshare, disabled: disabled || state.saving || !state.ftshare.writable, onEdit: (value) => props.edit('ftshare', value), t }),
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
  const automationNumber = (field, label) => {
    const { min, max, unit } = AUTOMATION_RANGES[field]
    const stored = state.automation?.[field]?.value
    const invalid = state.automation?.[field]?.invalid === true
    const error = invalid
      ? t('automationInvalid', { min, max, unit: t(unit) })
      : state.automation?.[field]?.failed ? t('saveFailed') : null
    return h('label', { className: 'capital-config-number' },
      // Error sits on the title row (the card's usual spot), not under the box.
      h('span', { className: 'capital-config-number-head' },
        h('span', { className: 'capital-config-switch-label' }, t(label)),
        error ? h('span', {
          id: `capital-config-automation-${field}-error`,
          role: invalid ? 'alert' : 'status',
          className: 'capital-config-write-failed',
        }, error) : null,
      ),
      h('input', {
        type: 'number',
        min,
        max,
        step: 1,
        defaultValue: stored,
        disabled: disabled || state.saving,
        'aria-invalid': invalid ? 'true' : undefined,
        'aria-describedby': error ? `capital-config-automation-${field}-error` : undefined,
        onFocus: () => props.clearAutomationInvalid(field),
        onBlur: (event) => {
          const input = event.target
          return Promise.resolve(props.writeAutomation(field, input.value)).then((outcome) => {
            if (outcome === 'invalid' && stored !== undefined) input.value = String(stored)
          })
        },
      }),
    )
  }
  const automationGroup = (labelKey, children) => h('div', { className: 'capital-config-automation-group' },
    h('span', { className: 'capital-config-group-label' }, t(labelKey)),
    ...children,
  )
  const workspaceState = state.workspace ?? {
    options: [],
    selectedId: '',
    current: null,
    missing: false,
    loading: false,
    unavailable: false,
    writing: false,
    failed: false,
  }
  const workspacePathId = 'capital-config-automation-workspace-path'
  const namedWorkspaceOptions = workspaceState.options.map((option) => ({
    id: option.id,
    path: option.path,
    label: option.id === ''
      ? (option.title || t('automationWorkspaceFallback'))
      : option.missing ? t('automationWorkspaceMissing') : option.title,
  }))
  const workspaceLabelCounts = new Map()
  for (const option of namedWorkspaceOptions) {
    workspaceLabelCounts.set(option.label, (workspaceLabelCounts.get(option.label) ?? 0) + 1)
  }
  const workspaceOptions = namedWorkspaceOptions.map((option) => {
    if (option.id === '' || !option.path || (workspaceLabelCounts.get(option.label) ?? 0) < 2) return option
    // Two registered workspaces may legitimately share a title; path keeps the menu unambiguous.
    return { ...option, label: `${option.label} · ${option.path}` }
  })
  const workspaceSection = h('div', { className: 'capital-config-workspace' },
    h('span', { className: 'capital-config-number-head' },
      h('span', { className: 'capital-config-switch-label' }, t('automationDefaultWorkspace')),
      workspaceState.failed
        ? h('span', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed'))
        : null,
    ),
    h(WorkspaceSelect, {
      value: workspaceState.selectedId,
      options: workspaceOptions,
      onChange: (next) => props.writeAutomationWorkspace(next),
      disabled: disabled || state.saving || workspaceState.writing,
      label: t('automationDefaultWorkspace'),
      describedBy: workspaceState.current?.path ? workspacePathId : undefined,
    }),
    workspaceState.unavailable
      ? h('p', { role: 'status', className: 'capital-config-hint' }, t('automationWorkspaceUnavailable'))
      : workspaceState.loading
        ? h('p', { className: 'capital-config-hint' }, t('automationWorkspaceLoading'))
        : workspaceState.missing
          ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('automationWorkspaceMissing'))
          : workspaceState.current?.path
            ? h('p', { id: workspacePathId, className: 'capital-config-hint' }, t('automationWorkspacePath', { path: workspaceState.current.path }))
            : null,
  )
  const storageState = state.storage ?? {
    data: null,
    loading: false,
    failed: false,
    unavailable: false,
    stale: false,
    clearing: false,
    error: null,
    clearedBytes: null,
    clearedFailed: 0,
  }
  const storageData = storageState.data
  const cacheBytes = Number.isSafeInteger(storageData?.cache?.bytes) ? storageData.cache.bytes : 0
  const analysisBytes = Number.isSafeInteger(storageData?.analysis?.bytes) ? storageData.analysis.bytes : 0
  const workspaceBytes = cacheBytes + analysisBytes
  const sessions = storageData?.sessions
  const sessionBytes = Number.isSafeInteger(sessions?.bytes) ? sessions.bytes : 0
  const sessionCount = Number.isSafeInteger(sessions?.count) ? sessions.count : 0
  const storageAmount = (value, truncated) => `${truncated === true ? '≥ ' : ''}${formatBytes(value)}`
  const chipsOf = (categories, ids) => ids
    .map((id) => ({ id, value: Number.isSafeInteger(categories?.[id]?.bytes) ? categories[id].bytes : 0 }))
    .filter((item) => item.value > 0)
    .map((item) => h('span', { key: item.id, className: 'capital-config-storage-chip' }, `${t(STORAGE_CATEGORY_LABELS[item.id])} ${formatBytes(item.value)}`))
  const cacheChips = storageData === null ? [] : chipsOf(storageData.cache?.categories, ['datasets', 'profiles', 'ocr', 'other'])
  const analysisChips = storageData === null ? [] : chipsOf(storageData.analysis?.categories, ['charts', 'runs', 'other'])
  const cacheBlocked = storageData?.canClear === false
  const canClearCache = cacheBytes > 0 && !cacheBlocked && storageState.loading !== true && storageState.clearing !== true
  const clearError = storageState.error === 'run_in_progress'
    ? t('automationStorageRunInProgress')
    : storageState.error === 'unsafe' ? t('automationStorageUnsafe')
      : storageState.error === 'failed' ? t('automationStorageClearFailed') : null
  const cacheMetaTone = storageData?.cache?.unsafe === true || (storageData?.activeRuns ?? 0) > 0 ? 'warn' : undefined
  const cacheMeta = storageState.loading || storageState.unavailable || storageState.stale
    ? null
    : storageData?.cache?.unsafe === true ? t('automationStorageUnsafe')
      : (storageData?.activeRuns ?? 0) > 0 ? t('automationStorageActiveHint')
        : cacheBytes === 0 ? t('automationStorageEmpty')
          : storageData?.cache?.unreadable > 0 ? t('automationStorageUnreadable') : null
  const footNote = storageState.unavailable ? t('automationStorageUnavailable') : storageState.stale ? t('automationStorageStale') : null
  const clearedHint = storageState.clearedBytes === null
    ? null
    : storageState.clearedFailed > 0
      ? t('automationStorageClearedPartial', { size: formatBytes(storageState.clearedBytes), failed: storageState.clearedFailed })
      : t('automationStorageCleared', { size: formatBytes(storageState.clearedBytes) })
  const storageSection = automationGroup('automationStorageGroup', [
    h('div', { className: 'capital-config-storage' },
      h('div', { className: 'capital-config-storage-head' },
        h('span', { className: 'capital-config-storage-label' }, t('automationStorageWorkspace')),
        h('span', { className: 'capital-config-storage-amount' }, storageData === null
          ? '—'
          : storageAmount(workspaceBytes, storageData?.cache?.truncated === true || storageData?.analysis?.truncated === true)),
      ),
      h('div', { className: 'capital-config-storage-item' },
        h('div', { className: 'capital-config-storage-row' },
          h('span', { className: 'capital-config-storage-label' }, t('automationStorageCache')),
          h('span', { className: 'capital-config-storage-amount' }, storageData === null
            ? '—'
            : storageAmount(cacheBytes, storageData?.cache?.truncated === true)),
        ),
        cacheChips.length > 0 ? h('div', { className: 'capital-config-storage-chips' }, ...cacheChips) : null,
        cacheMeta ? h('p', { className: 'capital-config-storage-meta', 'data-tone': cacheMetaTone }, cacheMeta) : null,
      ),
      h('div', { className: 'capital-config-storage-item' },
        h('div', { className: 'capital-config-storage-row' },
          h('span', { className: 'capital-config-storage-label' }, t('automationStorageAnalysis')),
          h('span', { className: 'capital-config-storage-value' },
            h('span', { className: 'capital-config-storage-amount' }, storageData === null
              ? '—'
              : storageAmount(analysisBytes, storageData?.analysis?.truncated === true)),
            storageData === null ? null : h('span', { className: 'capital-config-storage-badge' }, t('automationStorageRetained')),
          ),
        ),
        analysisChips.length > 0 ? h('div', { className: 'capital-config-storage-chips' }, ...analysisChips) : null,
      ),
      h('div', { className: 'capital-config-storage-item' },
        h('div', { className: 'capital-config-storage-row' },
          h('span', { className: 'capital-config-storage-label' }, t('automationStorageSessions')),
          h('span', { className: 'capital-config-storage-value' },
            h('span', { className: 'capital-config-storage-amount' },
              storageData === null || sessions?.available === false ? '—' : formatBytes(sessionBytes),
            ),
            storageData === null || sessions?.available === false
              ? null
              : h('span', { className: 'capital-config-storage-count' }, t('automationStorageSessionCount', { count: sessionCount })),
          ),
        ),
        h('p', { className: 'capital-config-storage-meta' }, t('automationStorageSessionsHint')),
      ),
      h('div', { className: 'capital-config-storage-foot' },
        h('button', {
          type: 'button',
          className: 'capital-config-cache-button',
          'data-variant': 'danger',
          'aria-busy': storageState.clearing ? 'true' : undefined,
          disabled: !canClearCache,
          onClick: () => setClearCacheOpen(true),
        }, storageState.clearing ? t('automationStorageClearing') : t('automationStorageClear')),
        h('div', { className: 'capital-config-storage-status' },
          clearedHint ? h('p', { role: 'status', className: 'capital-config-storage-result' }, clearedHint) : null,
          clearError && storageState.clearing !== true ? h('p', { role: 'alert', className: 'capital-config-write-failed' }, clearError) : null,
          footNote ? h('p', { className: 'capital-config-storage-meta' }, footNote) : null,
          storageState.unavailable || storageState.stale
            ? h('button', {
              type: 'button',
              className: 'capital-config-storage-retry',
              onClick: () => props.ensureStorage(true),
            }, t('automationStorageRetry'))
            : null,
        ),
      ),
    ),
  ])
  const automationSection = h('div', { className: 'capital-config-automation' },
    workspaceSection,
    automationGroup('automationScheduleGroup', [
      h('div', { className: 'capital-config-grid' },
        automationNumber('tickMs', 'automationTick'),
      ),
    ]),
    automationGroup('automationRunGroup', [
      h('div', { className: 'capital-config-grid' },
        automationNumber('runTimeoutMinutes', 'automationRunTimeout'),
        automationNumber('idleTimeoutMinutes', 'automationIdleTimeout'),
        automationNumber('maxSteps', 'automationMaxSteps'),
        automationNumber('maxToolCalls', 'automationMaxToolCalls'),
      ),
    ]),
    automationGroup('automationNotifyGroup', [
      h('div', { className: 'capital-config-switch-row' },
        h('div', { className: 'capital-config-switch-text' },
          h('span', { className: 'capital-config-switch-label' }, t('automationInApp')),
          h('p', { className: 'capital-config-hint' }, t('automationInAppHint')),
        ),
        h(Switch, {
          label: t('automationInApp'),
          checked: state.automation?.inAppNotifications?.on !== false,
          disabled: disabled || state.saving || state.automation?.inAppNotifications?.writing === true,
          onChange: (value) => props.writeAutomation('inAppNotifications', value),
        }),
      ),
      state.automation?.inAppNotifications?.failed ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed')) : null,
    ]),
    storageSection,
  )
  const modeSection = h('div', { className: 'capital-config-selected-mode' },
    h('div', { className: 'capital-config-switch-row' },
      h('div', { className: 'capital-config-switch-text' },
        h('span', { className: 'capital-config-switch-label' }, t('selectedSkillsModeLabel')),
        h('p', { className: 'capital-config-hint' }, t('selectedSkillsModeHint')),
      ),
      h(Switch, {
        label: t('selectedSkillsModeLabel'),
        checked: autoMode,
        disabled: disabled || state.saving || state.selectedSkillsMode?.writing === true,
        onChange: props.toggleSelectedSkillsMode,
      }),
    ),
    state.selectedSkillsMode?.failed ? h('p', { role: 'status', className: 'capital-config-write-failed' }, t('saveFailed')) : null,
  )
  const traitLabels = SELECTED_SKILL_TAG_LABELS[locale]
  const filterRow = (label, pills) => h('div', { className: 'capital-config-filter-row' },
    h('span', { className: 'capital-config-filter-label' }, label),
    h('div', { className: 'capital-config-filter-options', role: 'group', 'aria-label': label }, ...pills),
  )
  const traitPills = SELECTED_SKILL_TRAITS.map((trait) => h(Pill, {
    key: trait,
    type: 'button',
    className: 'capital-config-filter-pill',
    active: traitFilter === trait,
    'aria-pressed': traitFilter === trait ? 'true' : 'false',
    onClick: () => setTraitFilter(trait),
  },
  trait === SELECTED_SKILL_FILTER_ALL ? t('selectedSkillsAll') : (traitLabels[trait] ?? trait),
  h('span', { className: 'capital-config-filter-count' }, String(facetCounts.traits.get(trait) ?? 0))))
  const presetPills = [SELECTED_SKILL_FILTER_ALL, ...SELECTED_SKILL_PRESET_ORDER].map((preset) => {
    const total = preset === SELECTED_SKILL_FILTER_ALL
      ? SELECTED_SKILL_CATALOG.length
      : SELECTED_SKILL_PRESET_TOTALS.get(preset) ?? 0
    const unavailable = preset !== SELECTED_SKILL_FILTER_ALL && total === 0
    return h(Pill, {
      key: preset,
      type: 'button',
      className: 'capital-config-filter-pill',
      active: presetFilter === preset,
      'aria-pressed': presetFilter === preset ? 'true' : 'false',
      disabled: unavailable,
      title: unavailable ? t('selectedSkillsPresetUnavailable') : undefined,
      onClick: () => setPresetFilter(preset),
    },
    preset === SELECTED_SKILL_FILTER_ALL ? t('selectedSkillsAll') : presetLabel(preset, locale),
    h('span', { className: 'capital-config-filter-count' }, String(facetCounts.presets.get(preset) ?? 0)))
  })
  const skillsFilter = h('div', { className: 'capital-config-filters', role: 'group', 'aria-label': t('selectedSkillsFilterLabel') },
    filterRow(t('selectedSkillsTraitGroup'), traitPills),
    filterRow(t('selectedSkillsPresetGroup'), presetPills),
  )
  // No cap: the user builds the set; the role prompt caps only how many it lists.
  const skillRows = visibleSkills.length > 0
    ? visibleSkills.map((entry) => h(SelectedSkillRow, {
      key: entry.key,
      entry: { ...entry, roles: selectedSkillRoles(entry) },
      state: state.selectedSkills?.[entry.key],
      disabled: disabled || state.saving,
      onChange: (value) => props.toggleSelectedSkill(entry.key, value),
      t,
    }))
    : [h('p', { key: 'empty', className: 'capital-config-selected-empty' }, t('selectedSkillsEmpty'))]
  // No cap banner: the icon is the only explanation. Unknown count prints no number.
  const withCount = (label, count) => (Number.isInteger(count) ? `${label} ${count}` : label)
  const options = [
    // A dirty draft while Save is off-screen must be announced on the tab.
    { value: 'sources', label: state.dirty ? t('titleUnsaved') : t('title') },
    { value: 'automation', label: t('automationTitle') },
    { value: 'skills', label: t('selectedSkillsTitle') },
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
      disabled: false,
      onChange: (next) => {
        setTab(next)
        // Re-read on every switch to this tab: a previous failure retries here.
        if (next === 'components') props.ensureBundleRows()
        if (next === 'automation') props.ensureWorkspaces()
        // Re-pin only when entering Skills, so the row under the cursor never jumps.
        if (next === 'skills') setPinnedSkills(enabledKeys())
      },
    }),
    panel('sources', [form, localFetchSection]),
    panel('automation', [automationSection]),
    panel('skills', autoMode
      ? [modeSection]
      : [modeSection, h('div', { className: 'capital-config-skills-browser' },
        skillsFilter,
        h('div', { className: 'capital-config-selected-list' }, ...skillRows),
      )]),
    // The panel is the host's rows list; keep the aria-controls target non-empty via sr-only.
    panel('components', [h('span', { className: 'capital-config-sr-only' }, t('componentsHint'))]),
    clearCacheOpen ? h(ClearCacheModal, {
      open: true,
      bytes: cacheBytes,
      displayPath: storageData?.workspace?.displayPath ?? workspaceState.current?.path ?? '',
      clearing: storageState.clearing,
      error: storageState.error,
      onCancel: () => { if (!storageState.clearing) setClearCacheOpen(false) },
      onConfirm: () => {
        Promise.resolve(props.clearStorage()).then((result) => {
          if (result === 'cleared') setClearCacheOpen(false)
        })
      },
      t,
    }) : null,
  )
}

/** Official icons have no GitHub / npm glyph; paths come from simple-icons (CC0), currentColor follows the theme. */
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

/** The same slot renders on row detail and plugin pages: gate on subject.kind and package name. */
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
  // `plugin-manager/changed` is authoritative; re-read after reconnect too. Merge disposers into one cleanup.
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
  // Register the card only while the host serves this entry; slot key is the bundle name.
  ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_NAME,
    locale: LOCALE_NS,
    inject: () => card.inject(),
  }, CapitalCard))), 'capital-config: page')
  // Links are a plugin property, unrelated to whether the config entry is served.
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
