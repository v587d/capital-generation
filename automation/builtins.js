/**
 * Builtin task templates. Code is the only definition source: a profile record stores only the
 * user override layer, so a shipped instruction fix reaches dormant/reset tasks; pre-v3
 * full-snapshot overrides are pruned on upgrade.
 */
import { BuiltinDefinitionSchema, parseStrict } from './schema.js'
import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_RUN_TIMEOUT_MINUTES,
} from './defaults.js'

const DEFAULT_LIMITS = {
  runTimeoutMinutes: DEFAULT_RUN_TIMEOUT_MINUTES,
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  maxSteps: DEFAULT_MAX_STEPS,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
}

const DEFAULT_NOTIFICATIONS = {
  inApp: true,
  onFailure: true,
  onSuccess: false,
}

const SCHEDULE_COMMON = {
  kind: 'schedule',
  cadence: 'daily',
  time: '08:30',
  timezone: 'Asia/Shanghai',
  tradingDaysOnly: true,
}

/** @type {readonly import('./schema.js').BuiltinDefinition[]} */
export const BUILTIN_DEFINITIONS = [
  {
    id: 'morning-brief',
    version: 3,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '早间资讯',
      description: '交易日开盘前汇总隔夜外盘、自选股、重要公告与政策信息，给出当日需要盯住的线索。',
      trigger: { ...SCHEDULE_COMMON, time: '08:30' },
      instruction: '生成一份交易日早间资讯简报，供开盘前阅读。覆盖隔夜外盘、自选股、重要公告与政策信息、当日事件；自选股用 get_watchlist 读取，清单为空或读取失败要分开说明。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'post-close-filings',
    version: 3,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '盘后公告',
      description: '交易日收盘后梳理当日公告与盘面异动，筛出次日需要复核的事项。',
      trigger: { ...SCHEDULE_COMMON, time: '18:30' },
      instruction: '生成一份交易日盘后公告与异动复盘，筛出次日需要复核的事项。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'daily-review',
    version: 3,
    category: 'review',
    defaults: {
      state: 'dormant',
      category: 'review',
      title: '每日复盘',
      description: '交易日收盘后复盘指数、量能、板块轮动与自选股表现，形成可验证的观察清单。',
      trigger: { ...SCHEDULE_COMMON, time: '20:00' },
      instruction: '生成一份交易日复盘，覆盖指数与量能、板块轮动、自选股表现与风险异常。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
].map((definition) => parseStrict(BuiltinDefinitionSchema, definition, 'builtin definition'))

export const BUILTIN_BY_ID = new Map(BUILTIN_DEFINITIONS.map((definition) => [definition.id, definition]))
