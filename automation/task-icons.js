/**
 * Task glyph catalog, adapted from Tabler Icons (MIT).
 * Upstream: https://github.com/tabler/tabler-icons/tree/ed177a085b652fe04ec4f37ced867c94621e7840/icons/outline
 * Only path geometry is copied; stroke and color inherit from the tile. See ./TABLER-ICONS-LICENSE.
 */
const icon = (label, source, d) => ({ label, source, d })

export const DEFAULT_CUSTOM_ICON = 'sparkles'

/**
 * Picker order: creation first, then time, market, documents, research, portfolio.
 * These keys are persisted in task records; renaming or removing one needs a migration.
 */
export const TASK_ICON_CATALOG = {
  'sparkles': icon('灵感', 'sparkles', 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6'),
  'bell': icon('提醒', 'bell', 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6 M9 17v1a3 3 0 0 0 6 0v-1'),
  'mail': icon('消息', 'mail', 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10 M3 7l9 6l9 -6'),
  'flag': icon('里程碑', 'flag', 'M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9 M5 21v-7'),
  'calendar-event': icon('事件', 'calendar-event', 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12 M16 3l0 4 M8 3l0 4 M4 11l16 0 M8 15h2v2h-2l0 -2'),
  'clock-play': icon('盘前', 'clock-play', 'M12 7v5l2 2 M17 22l5 -3l-5 -3l0 6 M13.017 20.943a9 9 0 1 1 7.831 -7.292'),
  'sunrise': icon('早间', 'sunrise', 'M3 17h1m16 0h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7m-9.7 5.7a4 4 0 0 1 8 0 M3 21l18 0 M12 9v-6l3 3m-6 0l3 -3'),
  'sun-high': icon('午间', 'sun-high', 'M14.828 14.828a4 4 0 1 0 -5.656 -5.656a4 4 0 0 0 5.656 5.656 M6.343 17.657l-1.414 1.414 M6.343 6.343l-1.414 -1.414 M17.657 6.343l1.414 -1.414 M17.657 17.657l1.414 1.414 M4 12h-2 M12 4v-2 M20 12h2 M12 20v2'),
  'moon-stars': icon('收盘', 'moon-stars', 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008 M17 4a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2 M19 11h2m-1 -1v2'),
  'chart-line': icon('行情', 'chart-line', 'M4 19l16 0 M4 15l4 -6l4 2l4 -5l4 4'),
  'chart-bar': icon('统计', 'chart-bar', 'M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6 M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10 M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14 M4 20h14'),
  'chart-treemap': icon('行业', 'chart-treemap', 'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12 M12 4v16 M4 15h8 M12 12h8 M16 12v8 M16 16h4'),
  'chart-pie': icon('组合', 'chart-pie', 'M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0 -1 -1h-6.8a2 2 0 0 1 -2 -2v-7a.9 .9 0 0 0 -1 -.8 M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1 -1 -1v-4.5'),
  'trending-up': icon('趋势', 'trending-up', 'M3 17l6 -6l4 4l8 -8 M14 7l7 0l0 7'),
  'report-analytics': icon('财报', 'report-analytics', 'M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2 M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2 M9 17v-5 M12 17v-1 M15 17v-3'),
  'file-stack': icon('公告', 'file-stack', 'M14 3v4a1 1 0 0 0 1 1h4 M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4 M5 21h14 M5 18h14 M5 15h14'),
  'inbox': icon('收件', 'inbox', 'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12 M4 13h3l3 3h4l3 -3h3'),
  'news': icon('新闻', 'news', 'M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11 M8 8l4 0 M8 12l4 0 M8 16l4 0'),
  'clipboard-check': icon('复盘', 'clipboard-check', 'M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2 M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2 M9 14l2 2l4 -4'),
  'book': icon('阅读', 'book', 'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0 M3 6l0 13 M12 6l0 13 M21 6l0 13'),
  'search': icon('检索', 'search', 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M21 21l-6 -6'),
  'microscope': icon('深研', 'microscope', 'M5 21h14 M6 18h2 M7 18v3 M9 11l3 3l6 -6l-3 -3l-6 6 M10.5 12.5l-1.5 1.5 M17 3l3 3 M12 21a6 6 0 0 0 3.715 -10.712'),
  'bulb': icon('选题', 'bulb', 'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7 M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3 M9.7 17l4.6 0'),
  'briefcase': icon('持仓', 'briefcase', 'M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9 M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2 M12 12l0 .01 M3 13a20 20 0 0 0 18 0'),
  'wallet': icon('资金', 'wallet', 'M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12 M20 12v4h-4a2 2 0 0 1 0 -4h4'),
  'shield-check': icon('风控', 'shield-check', 'M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06 M15 19l2 2l4 -4'),
  'target': icon('目标', 'target', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0'),
  'star': icon('自选', 'star', 'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245'),
  'building-skyscraper': icon('城市', 'building-skyscraper', 'M3 21l18 0 M5 21v-14l8 -4v18 M19 21v-10l-6 -4 M9 9l0 .01 M9 12l0 .01 M9 15l0 .01 M9 18l0 .01'),
  'globe': icon('环球', 'globe', 'M7 9a4 4 0 1 0 8 0a4 4 0 0 0 -8 0 M5.75 15a8.015 8.015 0 1 0 9.25 -13 M11 17v4 M7 21h8'),
}

export const TASK_ICON_IDS = Object.keys(TASK_ICON_CATALOG)

/** Builtin templates keep a fixed glyph; custom tasks store an icon id in their config. */
export const BUILTIN_TASK_ICONS = Object.freeze({
  'us-close': 'moon-stars',
  'pre-open-filings': 'file-stack',
  'morning-brief': 'sunrise',
  'midday-snapshot': 'sun-high',
  'post-close-filings': 'inbox',
  'hk-close': 'building-skyscraper',
  'daily-review': 'clipboard-check',
  'todo-verifier-close': 'clipboard-check',
  'us-premarket': 'clock-play',
  'portfolio-weekly': 'chart-pie',
  'watchlist-weekly': 'star',
  'sector-weekly': 'chart-treemap',
  'research-topics': 'bulb',
  'earnings-tracker': 'report-analytics',
  'week-ahead-calendar': 'calendar-event',
  'market-weekly': 'chart-line',
  'portfolio-risk-monthly': 'shield-check',
})

export function builtinTaskIcon(sourceBuiltinId) {
  const icon = Object.prototype.hasOwnProperty.call(BUILTIN_TASK_ICONS, sourceBuiltinId)
    ? BUILTIN_TASK_ICONS[sourceBuiltinId]
    : undefined
  return icon ?? DEFAULT_CUSTOM_ICON
}

/** Resolve the glyph a task renders: an explicit pick wins, otherwise builtins use their fixed map. */
export function taskIconId(task) {
  const id = task?.icon
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(TASK_ICON_CATALOG, id)) return id
  if (task?.origin === 'custom') return DEFAULT_CUSTOM_ICON
  return builtinTaskIcon(task?.sourceBuiltinId)
}

