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

// Each instruction names the scan boundary, the coverage and the deliverable, plus one exclusion
// that separates it from the neighbouring template. The runner owns the category output shape,
// data discipline and unattended policy, so repeating them here would double the prompt and drift
// out of sync. Tool names stay out too — auto mode already knows the surface.
/** @type {readonly import('./schema.js').BuiltinDefinition[]} */
export const BUILTIN_DEFINITIONS = [
  {
    id: 'us-close',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '美股收盘',
      description: '隔夜美股、中概与盘后异动，逐只过自选股，映射今天 A/H 开盘的观察点。',
      // 美股周一至周五收盘对应北京时间的周二至周六清晨。
      trigger: { ...WEEKLY_TRIGGER, time: '07:00', weekdays: [2, 3, 4, 5, 6] },
      instruction: '只做隔夜美股：三大指数、美元与利率、原油与黄金；自选股（含持仓）里的美股与中概逐只写涨跌、量能与盘后异动；再写这些标的的当日财报与重要宏观数据，并把影响落到 A/H 自选股的开盘条件上。结尾给 3 个开盘后要验证的点。不写 A/H 行情与公告明细；数据取不到写「未取到」，美股休市直接说明，不补写行情。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'pre-open-filings',
    version: 3,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '盘前公告',
      description: '只看自选股隔夜公告：上一交易日 16:00 后至开盘前，按「开盘前必看 / 只需知晓」给出动作。',
      trigger: { ...SCHEDULE_COMMON, time: '08:00' },
      instruction: '只做自选股公告增量：窗口为上一交易日 16:00 后至运行时刻，只写隔夜新增与状态变化；A 股、港股、美股分开逐只过（含持仓），每只都要有结论，指数不发公告。覆盖业绩预告、重组并购、重大合同、增减持与回购、股权激励、诉讼与风险警示、停复牌、分红。每条写标的、事项、关键数字、开盘前要做的动作（先读/挂条件/回避），按「开盘前必看 / 只需知晓」分级，没有公告的并成一句。不写行情、外盘与宏观；取不到写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'morning-brief',
    version: 5,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '早间资讯',
      description: '开盘前把隔夜消息、宏观政策与今日日程，压成自选股可用的 3 件事。',
      trigger: { ...SCHEDULE_COMMON, time: '08:30' },
      instruction: '只做开盘前的消息面：先列今早最该知道的 3 件事（优先 A/H 时段新增的政策、公司新闻与日程），每条一句结论、一条关键依据与对自选股或大盘的含义；自选股（含持仓）从昨收到现在的新闻、研报与互动消息逐只核过，没进 3 件事的并成一句。隔夜外盘、商品与汇率只写会改变这 3 件事判断的方向与幅度，不复述美股收盘的读数、结论与验证点；宏观、政策、监管只写会改变今日交易的事实。末尾列今日自选股的披露、解禁、股东大会与数据日程。公告明细交给盘前公告，不写个股行情与复盘；没有内容写「无」，缺数据写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'midday-snapshot',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '午间快照',
      description: 'A 股上午收盘的指数、量能、涨跌停家数与自选股异动，附午间公告与下午验证点。',
      trigger: { ...SCHEDULE_COMMON, time: '11:35' },
      instruction: '只做 A 股上午收盘行情：截至 11:35 的指数、两市成交额、涨跌家数与涨跌停家数、领涨领跌板块各取前 3，数值带采集时间。自选股（含持仓）里的 A 股逐只写上午涨跌、量能、相对板块强弱与异动原因，只列午间新披露的公告标题。结尾给下午开盘后要验证的 3 个点。不写港股与美股，不写宏观与隔夜消息，不重复昨日复盘；数据延迟就注明，取不到写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'post-close-filings',
    version: 5,
    category: 'news',
    defaults: {
      state: 'dormant',
      category: 'news',
      title: '当日公告',
      description: '只看自选股当日公告：关键数字、影响、信息截止时刻与次日复核清单。',
      trigger: { ...SCHEDULE_COMMON, time: '16:00' },
      instruction: '只做自选股当日公告：窗口为当日 00:00 至运行时刻，16:00 后的披露留给次日盘前公告；A 股、港股、美股分开逐只过（含持仓）。按业绩预告、重组并购、重大合同、增减持与回购、股权激励、诉讼与风险警示、停复牌、分红逐类检查；每条写标的、事项、关键数字、对基本面或交易的影响、仍需核实什么，按「次日必须处理 / 只需知晓」排成复核清单，没有公告的并成一句。写明信息截止时刻，把截止后待披露的已知事项单列，不把「暂未披露」写成「没有公告」；不写行情与市场综述，取不到写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'hk-close',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '港股收盘',
      description: '港股收盘的指数、南向资金与恒生 AH 溢价，逐只过自选股里的港股。',
      trigger: { ...SCHEDULE_COMMON, time: '16:30' },
      instruction: '只做港股收盘：恒生指数、恒生科技、国企指数的涨跌与成交，南向资金净流入与成交（取最近已披露交易日并注明 as-of），恒生 AH 溢价指数（HSAHP）的点位与当日涨跌。自选股（含持仓）里的港股逐只写涨跌、量能、相对恒指/恒科强弱与异动原因；只对自选股里同时有 A/H 两腿的配对做背离比较，写明偏离幅度。不写美股与 A 股大盘，不复述公告明细，不写明日条件（交给每日复盘）；休市直接说明，取不到写「未取到」。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'daily-review',
    version: 5,
    category: 'review',
    defaults: {
      state: 'dormant',
      category: 'review',
      title: '每日复盘',
      description: '收盘后逐只复盘自选股：涨跌与驱动、风险信号、下一交易日的观察条件。',
      trigger: { ...SCHEDULE_COMMON, time: '20:00' },
      instruction: '只复盘自选股（含持仓）：逐只写当天有变化的标的——涨跌、量能、相对近 20 日区间的位置、驱动（公告、新闻、板块或资金）、风险信号；没有变化的并成一句名单。按「需优先复核 / 继续跟踪」分级，每只给一句结论。指数、成交量与板块只用来解释个股，不单独成节，也不复述公告原文与盘面快照。结尾把明日观察条件落到具体标的与触发价或触发事件；数据不足就写明缺什么，不猜。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'todo-verifier-close',
    version: 2,
    category: 'monitor',
    defaults: {
      // Operational task: TODO tracking is useless if the verifier has to be added manually.
      state: 'active',
      category: 'monitor',
      title: 'TODO 核验',
      description: '交易日 A/H 收盘后主动核验看板中的候选 TODO：自选股与跨市场条件、公告和资金数据，触发或数据不足时通知。',
      trigger: { ...SCHEDULE_COMMON, time: '17:00' },
      instruction: '只核验候选 TODO：A 股用当日收盘、港股用 16:00 收盘，公告以运行前已披露为准；同标的、同口径、同时点，缺数据、只见到转述或条件有歧义一律判 insufficient。每条候选都必须返回结果；evidence 必须能在工具结果中找到依据，evidence 与 source 只写用户可读的结论、关键数字与来源/时间口径，不写数据集 ID、工具名、captured_at 或 as-of。最终按约定 JSON 输出 `brief` 与逐条 `results`；没有触发就直说，不要编造。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'us-premarket',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '美股盘前',
      description: '今晚美股开盘前：财报、宏观事件与自选股里美股/中概的盘前动态，列今晚最该盯的 3 件事。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:30', weekdays: [1, 2, 3, 4, 5] },
      instruction: '只做今晚美股开盘前：自选股（含持仓）里美股与中概的盘前财报、指引与公司消息；只补会影响大盘的宏观数据与事件，不扫非自选股的财报。逐只写盘前动态与今晚要盯的事件，逐条写事实、来源时间与验证点，最后给今晚最该盯的 3 件事。盘前价格与期货取不到就写「未取到」，不拿昨收冒充盘前价；不写 A/H 行情与公告；美股休市就说明休市。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'portfolio-weekly',
    version: 2,
    category: 'portfolio',
    defaults: {
      state: 'dormant',
      category: 'portfolio',
      title: '组合周报',
      description: '按自选股里标记的持仓复盘组合：集中度变化、同向暴露、收益贡献与下周复核项。',
      trigger: { ...WEEKLY_TRIGGER, time: '10:00', weekdays: [6] },
      instruction: '只做自选股里用户标记的持仓（含自报权重）的本周组合表现：逐只写本周涨跌、成交与事件，算清本周收益贡献前 3 与拖累前 3；再给集中度相对上周的变化（单票、行业、市场、币种）与同向暴露变化，权重不补满 100%。不测流动性、事件与情景（交给组合风险月报）。关注清单不算持仓，只在与持仓重复时点名。没有持仓标记或权重缺失就说明无法做组合层计算，退化为持仓名单观察。结尾列下周要复核的 3 件事与数据缺口；不做市场综述。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'watchlist-weekly',
    version: 2,
    category: 'monitor',
    defaults: {
      state: 'dormant',
      category: 'monitor',
      title: '自选股周检',
      description: '每周给自选股分诊：需要立刻准备、继续跟踪还是可以移出，并写下周动作。',
      trigger: { ...WEEKLY_TRIGGER, time: '14:00', weekdays: [6] },
      instruction: '只做自选股清单维护：逐只（含持仓）按「需要立刻准备 / 继续跟踪 / 可以移出」分诊——看下周是否有催化剂、流动性是否够用、与已有持仓或彼此是否重复、证据是否还支撑跟踪。每只写一句理由与下一步动作（补数据、读公告、等事件、设条件）；同类重复暴露合并成一组，先给需要动作的名单。不做组合权重与收益归因，不做选题与核查计划（交给研究选题），不写市场综述；没有变化的并成一句，不按涨跌幅排序。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'sector-weekly',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '行业周报',
      description: '只看自选股所在行业与主题：本周强弱、资金与驱动，分清行业 β 与个股 α。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:00', weekdays: [6] },
      instruction: '只看自选股（含持仓）所在行业与主题，不扫非自选股的行业，也不写市场级两融、指数判断（交给市场周报）：先列这些行业/主题本周涨跌、成交与资金变化，各给一句驱动；A 股按申万一级做行业 β/α 粗分解（个股涨跌减行业涨跌），映射不到标「未分类」；港股/美股只做同业对比，不硬算。再指出与行业方向背离的标的及可能原因。最后给下周这些行业要验证的景气指标与事件。行业归属以可核实资料为准并写清；自选股未覆盖的行业不展开，取不到写缺口。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'research-topics',
    version: 2,
    category: 'research',
    defaults: {
      state: 'dormant',
      category: 'research',
      title: '研究选题',
      description: '从自选股的未决问题里挑 3 个研究选题，写清假设、证据与核查步骤。',
      trigger: { ...WEEKLY_TRIGGER, time: '14:00', weekdays: [7] },
      instruction: '只从自选股（含持仓）里挑 3 个研究选题，优先用本周分诊标为「需要立刻准备 / 继续跟踪」的标的：每个写清为什么现在做、核心问题与可证伪的假设、需要哪些证据（数据、公告、口径）、先做哪 2–3 步核查、做完能支持什么决定；按时间敏感度排序，并说明与其他两个选题的边界。证据不足或已被行情回答的候选剔除。不复述分诊名单，不写完整研报、不铺市场全景，也不重复财报跟踪与行业周报的结论。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'earnings-tracker',
    version: 2,
    category: 'research',
    defaults: {
      state: 'dormant',
      category: 'research',
      title: '财报跟踪',
      description: '只跟踪自选股财报：已披露的预期差，与下一场披露的一致预期和验证指标。',
      trigger: { ...WEEKLY_TRIGGER, time: '16:00', weekdays: [7] },
      instruction: '只做自选股（含持仓）财报：先看过去一周已披露的——营收、利润、毛利率、指引相对一致预期的差异（A 股一致预期取 EPS，港美股取不到写「未取到」）、一次性项目与会计口径变化，并判断此前哪些假设被验证或推翻；再给每只下一场披露的日期、一致预期、要盯的 3 个指标与乐观/中性/悲观情景，没有可靠日期就写明依据。没有自选股财报时直接说明，并给下一次披露窗口与现在该补的数据，不硬凑，也不写非自选股财报。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'week-ahead-calendar',
    version: 2,
    category: 'monitor',
    defaults: {
      state: 'dormant',
      category: 'monitor',
      title: '下周事件日历',
      description: '下周会打到自选股的事件日历：财报、解禁、股东大会与宏观窗口。',
      trigger: { ...WEEKLY_TRIGGER, time: '18:00', weekdays: [7] },
      instruction: '只做会打到自选股（含持仓）的下周事件日历：逐只列财报预约、解禁、股东大会、分红、停复牌，再列会影响这些标的的宏观数据、会议与政策窗口。每条写日期时间、影响哪只标的或哪个行业、要提前准备什么（读什么、算什么、设什么条件）；同一天按影响大小排序。日期不确定标「待确认」并写依据，没有事件的日期不占位。只列日历与准备动作，不做预期差分析（交给财报跟踪），不扫非自选股。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'market-weekly',
    version: 2,
    category: 'market',
    defaults: {
      state: 'dormant',
      category: 'market',
      title: '市场周报',
      description: '每周市场级读数：指数、量能、资金与风险偏好，落到自选股环境与下周关键位。',
      trigger: { ...WEEKLY_TRIGGER, time: '20:00', weekdays: [7] },
      instruction: '只做市场级读数，不扫个股：覆盖沪深300、中证500、创业板指与恒指/恒生科技的量价，涨跌家数与风格，两融与沪深港通成交等可核实口径，用趋势、波动、广度、风险偏好与事件背景给本周市场状态一句话判断；再给下周关键位、最需要验证的假设与最大风险。只写市场状态对自选股风格与风险偏好的含义，不逐只、不写行业细账。资金口径取不到就写缺口，不用记忆补数；行业与主题细账交给行业周报，自选股表现交给每日复盘，这里不重复。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
  {
    id: 'portfolio-risk-monthly',
    version: 2,
    category: 'portfolio',
    defaults: {
      state: 'dormant',
      category: 'portfolio',
      title: '组合风险月报',
      description: '每月按自选股里的标记持仓查风险：集中度、流动性、事件暴露与未评估项。',
      trigger: { ...MONTHLY_TRIGGER, time: '20:30', dayOfMonth: 'last' },
      instruction: '只做自选股里用户标记的持仓（含自报权重）的月度风险检查：集中度水平（单票、行业、市场、币种）、流动性（成交额、停牌、涨跌停）与事件暴露（解禁、财报、政策）；有可靠数据时做一次简单情景或波动测算，写清口径与假设。数据不足的部分标「未评估」并列出缺什么，不填 0、不写「安全」。再给与上月相比变化最大的 3 项（无上月数据就说明），以及下月要复核的风险点与需要用户补充的成本、期限、风险预算。不重列周报的收益归因与逐只表现，不写个股推荐。',
      cwdKind: 'profile',
      limits: { ...DEFAULT_LIMITS },
      notifications: { ...DEFAULT_NOTIFICATIONS },
    },
  },
].map((definition) => parseStrict(BuiltinDefinitionSchema, definition, 'builtin definition'))

export const BUILTIN_BY_ID = new Map(BUILTIN_DEFINITIONS.map((definition) => [definition.id, definition]))
