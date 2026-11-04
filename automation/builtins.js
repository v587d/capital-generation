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

/** Weekend/weekly tasks do not consult the A-share calendar: they run on fixed local days. */
const WEEKLY_TRIGGER = {
  kind: 'schedule',
  cadence: 'weekly',
  timezone: 'Asia/Shanghai',
  tradingDaysOnly: false,
}

const MONTHLY_TRIGGER = {
  kind: 'schedule',
  cadence: 'monthly',
  timezone: 'Asia/Shanghai',
  tradingDaysOnly: false,
}

// Each instruction states the coverage and the deliverable only: the runner owns the category
// output shape, data discipline and unattended policy, so repeating them here would double the
// prompt and drift out of sync. Tool names stay out too — auto mode already knows the surface.
/** @type {readonly import('./schema.js').BuiltinDefinition[]} */
export const BUILTIN_DEFINITIONS = [
  {
    id: 'us-close',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '美股收盘',
      description: '美股收盘后汇总指数、财报与盘后异动，逐只过自选股里的美股与中概，映射到 A/H 开盘。',
      // 美股周一至周五收盘对应北京时间的周二至周六清晨。
      trigger: { ...WEEKLY_TRIGGER, time: '07:00', weekdays: [2, 3, 4, 5, 6] },
      instruction: '生成美股收盘快报：覆盖上一交易日美股三大指数与费半、关键利率与美元、原油与黄金；自选股（含已标持仓）里的美股与中概逐只写涨跌、量能与盘后异动；再写当日财报与指引、重要宏观数据，以及这些变化对 A 股/港股相关标的的映射（只给条件，不下买卖结论），结尾留 2–3 个开盘后要验证的点。美股休市就直说休市，不补写行情。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'pre-open-filings',
    version: 2,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '盘前公告',
      description: '交易日开盘前汇总各市场上一交易日收盘后至今的公告，筛出自选股与全市场开盘前必须处理的事项。',
      trigger: { ...SCHEDULE_COMMON, time: '08:00' },
      instruction: '生成交易日盘前公告：覆盖各市场上一交易日收盘后至运行时刻的公告，先逐只过自选股（含已标持仓），按 A 股、港股、美股分市场全覆盖，不得只做 A 股或标「不适用」；每只股票都要有结论，指数不发公告。再补权重股、龙头与政策相关的非自选股。覆盖业绩预告、重组并购、重大合同、增减持与回购、股权激励、诉讼与风险警示、停复牌、分红。逐条写标的、事项、关键数字、影响与开盘后验证点，按「开盘前必看 / 只需知晓」分级；没有公告的自选股并成一句。只写公告，不复述隔夜外盘与大盘行情；取不到写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'morning-brief',
    version: 4,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '早间资讯',
      description: '交易日开盘前汇总隔夜外盘、自选股、重要公告与政策信息，给出当日需要盯住的线索。',
      trigger: { ...SCHEDULE_COMMON, time: '08:30' },
      instruction: '生成交易日早间资讯，供开盘前读完：开头先列今早最该知道的 3 件事，再逐档覆盖隔夜外盘、大宗商品与汇率，国内外宏观、政策与监管，自选股（含已标持仓）从昨收至今的新闻与异动、昨夜公告中会改变开盘判断的部分，今日披露、解禁、股东大会、数据与会议日程。每档都要有结论——确实没有写「无」，取不到写「未取到」并说明缺哪一块；自选股逐只过，没有新信息的并成一句。重大事件写清事实、影响与开盘后要验证什么。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'midday-snapshot',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '午间快照',
      description: 'A 股午间快照：上午指数、成交、涨跌停与板块，自选股异动与午间公告，下午关注点。',
      trigger: { ...SCHEDULE_COMMON, time: '11:35' },
      instruction: '生成 A 股午间快照：截至 11:35 的上午收盘数据——指数、两市成交额、涨跌家数与涨跌停、领涨领跌板块；自选股（含已标持仓）逐只写上午涨跌、量能与异动，并列出午间已披露的公告；最后给下午要验证的 2–3 个点。盘中数据可能延迟，注明采集时间；只写上午与午间，不重复昨日复盘和早间资讯的内容。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'post-close-filings',
    version: 4,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '当日公告',
      description: '交易日收盘后梳理截至运行时刻的已披露公告，筛出自选股与全市场次日要复核的事项，并标明信息截止。',
      trigger: { ...SCHEDULE_COMMON, time: '16:00' },
      instruction: '生成当日公告清单：以运行时刻前已公开的当日披露为准，覆盖自选股（含已标持仓）与权重股、行业龙头、政策相关的非自选股，按业绩预告、重组并购、重大合同、增减持与回购、股权激励、诉讼与风险警示、停复牌、分红逐类过一遍。逐条写标的、事项、关键数字（金额/比例/期限）、影响方向与仍需核实的点，按「次日必须处理 / 只需知晓」两级排成复核清单；没有公告的自选股并成一句。写明信息截止时刻，把截止后仍待披露的已知事项单列——别把「暂未披露」写成「没有公告」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'hk-close',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '港股收盘',
      description: '港股收盘后汇总指数、南向资金与 AH 溢价，逐只过自选股里的港股，给出明日验证点。',
      trigger: { ...SCHEDULE_COMMON, time: '16:30' },
      instruction: '生成港股收盘快报：覆盖恒生指数、恒生科技与国企指数，南向资金、成交与涨跌家数；自选股（含已标持仓）里的港股逐只写涨跌、量能与异动；再给 AH 溢价与同日 A 股联动里值得注意的偏离，以及明日要验证的 2–3 个点。港股休市就直说休市，不补写行情。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'daily-review',
    version: 4,
    category: 'review',
    defaults: {
      state: 'dormant',
      category: 'review',
      title: '每日复盘',
      description: '交易日收盘后复盘自选股当日表现与驱动，给出下一交易日的可验证观察条件。',
      trigger: { ...SCHEDULE_COMMON, time: '20:00' },
      instruction: '生成交易日复盘，主体是自选股（含已标持仓）：逐只写当天有变化的标的（价格、量能、公告或消息），交代当日涨跌、相对近 20 日区间的位置、驱动（公告、消息、板块或资金）与风险信号，按「需优先复核 / 继续跟踪」分级；没有变化的并成一句名单。指数、量能与板块轮动只作解释个股的背景，不单独成节。明日观察条件要落到具体标的与触发点。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'us-premarket',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '美股盘前',
      description: '美股开盘前提示：盘前财报、宏观事件与自选股美股/中概动态，列出今晚最该盯的事项。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:30', weekdays: [1, 2, 3, 4, 5] },
      instruction: '生成美股盘前提示：覆盖今晚美股开盘前已知的信息——盘前公布或待公布的财报与指引、宏观数据与事件、亚洲时段的消息与公告，以及自选股（含已标持仓）里的美股与中概的盘前动态；逐条写事实、来源时间与开盘后要验证的点，并给出今晚最该盯的 3 件事。盘前报价与期货取不到就写「未取到」，不要用昨收冒充盘前价；美股休市就说明休市。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'portfolio-weekly',
    version: 1,
    category: 'portfolio',
    defaults: {
      state: 'dormant',
      category: 'portfolio',
      title: '组合周报',
      description: '每周按自选股里标记的持仓复盘组合集中度、暴露与风险，列出下周要复核的事。',
      trigger: { ...WEEKLY_TRIGGER, time: '10:00', weekdays: [6] },
      instruction: '生成本周组合周报：以自选股里用户标记的持仓与自报权重为准，逐只写本周涨跌、成交与事件，再给组合层集中度（单票、行业、市场、币种）、同向暴露与最大风险；未标记的关注条目不算持仓，权重不补满 100%。没有持仓标记或权重缺失时，明确说无法做组合层计算，只做关注清单层面的观察。结尾列下周要复核的 3 件事与数据缺口。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'watchlist-weekly',
    version: 1,
    category: 'monitor',
    defaults: {
      state: 'dormant',
      category: 'monitor',
      title: '自选股周检',
      description: '每周给自选股分诊：需要立刻准备、继续跟踪或可以移出，并写下一步该做什么。',
      trigger: { ...WEEKLY_TRIGGER, time: '14:00', weekdays: [6] },
      instruction: '生成本周自选股周检：逐只过自选股（含已标持仓），按「需要立刻准备 / 继续跟踪 / 可以移出」分级——依据是下周是否有催化剂、流动性是否够用、与已有标的或持仓是否重复、证据是否还够支撑判断；每只写一句理由与下一步该做什么（补数据、读公告、等事件），重复暴露合并成一组。没有变化的并成一句，不要只按涨跌幅排序。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'sector-weekly',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '行业周报',
      description: '每周行业与主题轮动：领涨领跌、资金集中度、驱动与自选股暴露，下周景气与事件。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:00', weekdays: [6] },
      instruction: '生成本周行业周报：按可核实的行业/主题分类列出本周领涨领跌、成交与资金集中度，解释驱动（政策、数据、事件、海外映射），再点出自选股集中的行业与领涨方向的重合或偏离，最后给下周行业事件与需要验证的景气指标。分类口径写清楚，取不到就写缺口；不把单一板块的强势当成全市场结论。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'research-topics',
    version: 1,
    category: 'research',
    defaults: {
      state: 'dormant',
      category: 'research',
      title: '研究选题',
      description: '每周从自选股与市场主线里挑出 3 个值得深挖的选题，写清问题、证据与核查步骤。',
      trigger: { ...WEEKLY_TRIGGER, time: '14:00', weekdays: [7] },
      instruction: '生成下周研究选题：从自选股与本周市场主线里筛出 3 个最值得深挖的标的或主题，每个写清为什么是现在、核心问题、需要哪些证据（数据/文件/口径）、先做哪 2–3 步核查，并按时间敏感度排序；证据不足的候选直接剔除。不要写成完整研报，也不要把新闻标题当结论。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'earnings-tracker',
    version: 1,
    category: 'research',
    defaults: {
      state: 'dormant',
      category: 'research',
      title: '财报跟踪',
      description: '每周跟踪自选股已披露与即将披露的财报，对比预期、列要盯的指标与验证点。',
      trigger: { ...WEEKLY_TRIGGER, time: '16:00', weekdays: [7] },
      instruction: '生成财报跟踪：先看过去一周自选股（含已标持仓）已披露的财报——营收、利润、毛利率与指引相对一致预期的差异（预期取不到就写「未取到」）、一次性项目与会计口径变化，以及哪些判断被验证或推翻；再看未来两周的财报预约，逐只写披露日期、一致预期、要盯的 3 个指标与情景。没有自选股财报时直接说明，并给下一次披露窗口与现在该补的数据，不要硬凑。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'week-ahead-calendar',
    version: 1,
    category: 'monitor',
    defaults: {
      state: 'dormant',
      category: 'monitor',
      title: '下周事件日历',
      description: '汇总自选股与全市场的下周事件：财报、解禁、股东大会、宏观数据与政策窗口。',
      trigger: { ...WEEKLY_TRIGGER, time: '18:00', weekdays: [7] },
      instruction: '生成下周事件日历：先列自选股（含已标持仓）的财报预约、解禁、股东大会、分红与停复牌，再列宏观数据发布、重要会议与政策窗口；逐条写日期时间、影响哪个标的或板块、要提前准备什么。同一天按影响大小排序，日期不确定的标「待确认」并说明依据；没有事件的日期不用占位。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'market-weekly',
    version: 1,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '市场周报',
      description: '每周复盘指数、量能、板块轮动与资金面，给出市场状态、自选股所处环境与下周关键位。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:00', weekdays: [7] },
      instruction: '生成本周市场周报：覆盖指数与量能、涨跌家数与风格、板块轮动的一句话结论、北向与两融、ETF 申赎等可核实的资金口径；用趋势、波动、广度与事件背景给出本周市场状态的一句话判断，再写下周关键位、需要验证的假设与最大风险。数据取不到就写缺口，不用记忆里的数补位；行业与主题的细账不在这里展开，也不把单一板块的强势当成全市场结论。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'portfolio-risk-monthly',
    version: 1,
    category: 'portfolio',
    defaults: {
      state: 'dormant',
      category: 'portfolio',
      title: '组合风险月报',
      description: '每月按自选股里标记的持仓检查集中度、暴露与流动性风险，列出未评估项与要补充的信息。',
      trigger: { ...MONTHLY_TRIGGER, time: '20:30', dayOfMonth: 'last' },
      instruction: '生成月度组合风险报告：以自选股里用户标记的持仓与自报权重为准，检查单票、行业、市场与币种集中度，同向暴露、流动性与事件风险；有可靠数据时再做简单的历史情景或波动测算，并写清口径与假设，数据不足的部分标「未评估」，不填 0 也不称「安全」。结尾给下月要复核的风险点与需要用户补充的信息（成本、期限、风险预算）。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
].map((definition) => parseStrict(BuiltinDefinitionSchema, definition, 'builtin definition'))

export const BUILTIN_BY_ID = new Map(BUILTIN_DEFINITIONS.map((definition) => [definition.id, definition]))
