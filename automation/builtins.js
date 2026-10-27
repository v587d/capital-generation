/**
 * Builtin task templates. Code is the only definition source: a profile record stores only the
 * user override layer, so a shipped instruction fix reaches every dormant/reset task.
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

const SOURCE_RULES = `数据与来源纪律：
- 结构化行情、财务与宏观数据一律委派 data_collector 取回 DatasetRef，再交 data_junior 做质检与统计；
  不在正文中复制原始数据行，不凭记忆填写数字。
- 新闻、公告与监管文件委派 web_retriever，逐条编号并标注来源、发布时间与核验状态；
  媒体转述只能作为旁证。
- 关键数值必须带采集时间与来源标签；数据缺失或过期时明确写出，不用猜测补齐。
- 不给出买卖指令、收益承诺或目标价。`

const UNATTENDED_RULES = `无人值守执行策略（automation-v1）：
- 这是定时触发的无人值守运行：不要调用 ask_user_question，不要等待审批，不要请求用户补充信息。
- 若关键输入缺失或存在歧义，选择最保守的可核查口径继续，并在答复开头用一句「需要用户确认」写明缺口。
- 只使用当前角色工具面；不尝试提权、不写文件、不修改系统配置。
- 最终答复必须自足：结论、证据与来源、局限与风险、后续观察点；不要写“见上”“已完成”这类指针句。`

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
    version: 1,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '早间资讯',
      description: '交易日开盘前汇总隔夜外盘、重要公告与政策信息，给出当日需要盯住的线索。',
      trigger: { ...SCHEDULE_COMMON, time: '08:30' },
      instruction: `任务：生成一份交易日早间资讯简报，供开盘前阅读。

覆盖范围（按重要性排序，不追求数量）：
1. 隔夜外盘：美股主要指数、原油/黄金/美元与人民币汇率的关键变化。
2. 国内政策与监管：可能影响市场风险偏好的政策、会议、监管表态。
3. 重要公司公告：业绩预告、重大合同、并购重组、减持/回购、停复牌与风险提示。
4. 当日事件：宏观数据、重要会议、限售解禁与新股申购中值得提示的部分。

输出结构：
- 三到五条「今日要点」，每条一句话并标注依据来源。
- 分节展开上述范围；没有可靠信息的条目直接说明“未取得可靠信息”，不要用旧闻填充。
- 末尾列「需要继续跟踪」与「信息缺口」。

${SOURCE_RULES}

${UNATTENDED_RULES}`,
      mode: 'news',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'post-close-filings',
    version: 1,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '盘后公告',
      description: '交易日收盘后梳理当日公告与盘面异动，筛出次日需要复核的事项。',
      trigger: { ...SCHEDULE_COMMON, time: '18:30' },
      instruction: `任务：生成一份交易日盘后公告与异动复盘。

覆盖范围：
1. 当日重要公告：业绩、订单、重组、诉讼、监管问询、股权变动、分红与回购。
2. 盘面异动：涨停/跌停、连板、成交额与换手异常的板块和个股；只描述可核查事实。
3. 公告与异动的交叉核对：哪些异动有公告支撑，哪些没有。

输出结构：
- 「次日复核清单」：逐条写明标的、事项、需要核对的下一条信息。
- 分节展开公告与异动；每条公告带交易所/公司披露来源。
- 对无法确认的传闻明确标注“未核验”，不得当作事实。

${SOURCE_RULES}

${UNATTENDED_RULES}`,
      mode: 'news',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'daily-review',
    version: 1,
    category: 'review',
    defaults: {
      state: 'dormant',
      category: 'review',
      title: '每日复盘',
      description: '交易日收盘后复盘指数、量能、板块轮动与自选股表现，形成可验证的观察清单。',
      trigger: { ...SCHEDULE_COMMON, time: '20:00' },
      instruction: `任务：生成一份交易日复盘，重点是可验证的事实与下一交易日的观察条件。

覆盖范围：
1. 指数与量能：主要指数涨跌、成交额、涨跌家数、北向/主力资金（仅在有可靠数据时）。
2. 板块轮动：涨幅与跌幅居前的行业/概念，和近 5 个交易日的相对强弱。
3. 自选股：读取当前用户自选股清单，逐只给出当日表现与相对强弱；无自选股时跳过并说明。
4. 风险与异常：放量下跌、高位股退潮、公告风险与流动性异常。

输出结构：
- 「一句话结论」与「下一交易日观察清单」，每条观察都要有触发条件和失效条件。
- 分节给出证据；数值必须来自 Dataset 或受控行情工具并标注采集时间。
- 明确写出数据缺口与无法验证的部分；不要用“可能”“大概”替代缺失数据。

${SOURCE_RULES}

${UNATTENDED_RULES}`,
      mode: 'review',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
].map((definition) => parseStrict(BuiltinDefinitionSchema, definition, 'builtin definition'))

export const BUILTIN_BY_ID = new Map(BUILTIN_DEFINITIONS.map((definition) => [definition.id, definition]))
