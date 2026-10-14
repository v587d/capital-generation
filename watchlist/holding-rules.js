/**
 * 自选股的**类型表**与**持仓规则**——host 半边与浏览器半边共用这一份。
 *
 * 为什么单独成一个文件而不是各写各的：这两件事各自决定两处行为——
 *  · 「哪些标的能被标成持仓」决定面板的「更多」菜单画不画那一行，与 `POST /holding` 收不收这一格；
 *  · 「持仓比例加起来不能超过多少」决定步进器的 `+` 什么时候置灰，与宿主什么时候拒绝写入。
 * 两处各抄一份的结局是"菜单里能点、宿主说 invalid_query"或反过来"菜单没得点、直接打路由却写进去了"，
 * 而两种都是不报错的错（AGENTS.md §9.7：同一知识只许有一份实现）。
 * `client.src.cjs` 用 `require()` 引它，esbuild 在构建期把本文件内联进 `client.js`；
 * `index.js` 用 `import` 引它。⛔ 本文件必须列进 `package.json` 的 `files`——
 * 漏了的表现是装出去的插件 `ERR_MODULE_NOT_FOUND`、整条 `/capital-watchlist/*` 起不来，
 * 而本机测试全绿（文件就在磁盘上）。闸门：`test/packaging.test.mjs`。
 */
export const ASSET_TYPES = ['a-share', 'a-share-index', 'fund-etf', 'hk-stock', 'hk-index', 'us-stock', 'us-index']

/**
 * 可以是一个**仓位**的类型：个股与场内基金。三种指数不在表上——指数不是一个可持有、
 * 可配比率的标的（它是市场读数，不是券），所以它没有"持仓比例"这件事可言。
 *
 * ⛔ 这是**白名单**而不是"排除 `*-index`"：未知或缺失的 `asset_type` 一律不可标。
 * 判据写成反选时，将来往 `ASSET_TYPES` 里加任何一档都会自动获得持仓入口，
 * 而那一步没人复核过；写成正选，新档默认没有这个入口，要给它就得改这一行——改这一行会红。
 */
export const HOLDABLE_ASSET_TYPES = ['a-share', 'fund-etf', 'hk-stock', 'us-stock']

/** 这一条记录能不能被标成持仓（只看类型，不看它现在标没标：已标的取消走另一条路）。 */
export const isHoldable = (row) => HOLDABLE_ASSET_TYPES.includes(row?.asset_type)

/** 单只标的的占比上限（百分比）。 */
export const MAX_ROW_WEIGHT_PCT = 100

/**
 * 全组合的占比合计上限：**只做多、不算 put**，所以留出 20 个百分点的余地给"用户自报的数
 * 本来就凑不满 100%"与保证金敞口，再往上就不是一个说得出口的组合了（2026-10-09 用户点名：
 * 面板原来允许两只各 100%，那明显不合理）。
 *
 * ⚠️ 这句话在四处得是同一条口径：这一行、`markHolding` 的拒绝、步进器的 `+` 置灰与
 * `get_watchlist` 的 `description`。宿主是权威，面板只是提前把没额度这件事画出来。
 */
export const MAX_TOTAL_WEIGHT_PCT = 120

/**
 * 这一条占掉的权重（百分点）。**未填比例的持仓算 0**：勾上但没说数字，就没有任何敞口，
 * 它与"这个数是零"在面板上仍是两句话（读数是 `0~上限` 而不是 `0%`），但在合计里都是 0。
 * ⛔ `?? 0` 之前必须先判 `holding` 这一格在不在——`weight_pct: null` 与没有 `holding` 是两种状态。
 */
export const holdingWeight = (row) => (
  row?.holding === null || row?.holding === undefined ? 0 : (row?.holding?.weight_pct ?? 0)
)

/** 除这一条之外，其余持仓已经占掉的权重（百分点）——面板与宿主算额度的**同一个**减法。 */
export const otherHeldWeightPct = (rows, thscode) => rows.reduce(
  (total, row) => (row?.thscode === thscode ? total : total + holdingWeight(row)),
  0,
)

/**
 * 这一条最多能填到多少：单只上限与"总额度减去其余持仓"取小的，往下托到 0。
 * 步进器用它决定 `+` 置灰与 `0~N` 这句提示；宿主用同一条减法拒绝写入。
 */
export const weightCeiling = (rows, thscode) => Math.max(
  0,
  Math.min(MAX_ROW_WEIGHT_PCT, MAX_TOTAL_WEIGHT_PCT - otherHeldWeightPct(rows, thscode)),
)
