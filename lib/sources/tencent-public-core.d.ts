export declare const QUOTE_URL = "https://qt.gtimg.cn/q=";
export declare const SMARTBOX_URL = "https://smartbox.gtimg.cn/s3/";
/**
 * 腾讯出口的**唯一**节流链（进程级）。行情快照、分笔、K 线每一次换机、港美股快照、smartbox
 * 检索全部过这一条链——它们打的是同一家，按 IP 风控（429 / 空 data / 静默限流）。
 * 间隔取 120ms：与最早那版分笔翻页的节奏同量级。
 */
export declare const TENCENT_MIN_INTERVAL_MS = 120;
export declare const tencentThrottle: <T>(task: () => Promise<T>) => Promise<T>;
export type JsonRecord = Record<string, unknown>;
export declare function isRecord(value: unknown): value is JsonRecord;
export declare function numberOrNull(value: unknown): number | null;
export declare function requiredNumber(value: unknown, field: string): number;
export declare function sourceError(message: string, code?: string): Error;
/**
 * 腾讯出口的取文本：取消不排队（队首那个请求挂住时，把这次取消塞进队列等于把它吞掉，
 * `docs/dev/web-retriever.md` §4.2「取消原样抛出」），排队与最小间隔由节流链负责。
 */
export declare function tencentGetText(url: string, signal: AbortSignal, encoding?: 'utf-8' | 'gbk', init?: RequestInit): Promise<string>;
/**
 * 港美股快照与 A 股快照**不能共用一份字段表**：实测腾讯在同一个 `~` 分隔串里换了列位——
 * 币种 A 股根本没有、港股在第 75 位、美股在第 35 位；换手率港股在第 59 位（分母是**总股本**）、
 * 美股在第 38 位（分母是**流通股本**）；成交额在港股**指数行**是万元级而个股行是元级。
 * 所以这两张表各自映射，并且只收能用算术或量级证明的列（docs/dev/tool-schema.md §10.2：口径猜错就是话说错）。
 */
export declare const HK_QUOTE_FIELDS = 78;
export declare const US_QUOTE_FIELDS = 73;
/**
 * 腾讯港美股时间戳是**交易所当地时间**。分隔符**按行漂移**：2026-10-05 那批同一份响应里，
 * 一行给 `YYYY/MM/DD HH:mm:ss`、另一行给 `YYYY-MM-DD HH:mm:ss`——所以两种都吃，输出统一成横杠那一种。
 * （写成占位符而不是真日期：这两个形状在源码里只差一个字符，肉眼读注释分不出来。）
 */
export declare function offshoreQuoteTime(value: unknown): string | null;
/** 逐行拆出 `v_<symbol>="…"`；symbol 就是请求里写出去的那串，所以请求与回执能一对一核对。 */
export declare function snapshotRows(text: string, requested: Set<string>): Array<{
    symbol: string;
    fields: string[];
}>;
/** 港美股代码：HK 是 5 位数字（实测 `hk700`/`hk0700` 被上游静默丢掉，必须左补零），指数别名一律拒收。 */
export declare function normalizeHkCode(value: unknown, name: string): string;
/**
 * 美股写法照原样收下（`AAPL` / `BRK.B` / `BABA.N` / `AAPL.OQ` 都是真实存在的说法），
 * 消歧交给上游（见 `usSymbolVariants`）：实测腾讯**快照只认不带后缀的写法**（`usBABA.N` 整行不回，
 * `usBABA` 认），而 K 线只认**带正确后缀**的写法（`usAAPL` 回一列 2011 年的陌生序列、
 * `usAAPL.NS` 静默 0 行）。点号既可能是级别码（BRK.B / BF.B）也可能是交易所后缀（.N / .OQ），
 * 从字面上分不出来——所以不猜。
 */
export declare function normalizeUsCode(value: unknown, name: string): string;
/** 依次尝试的写法：原样 → 每次剥掉最后一段点号，最多剥两段（BRK.B.N → BRK.B → BRK）。 */
export declare function usSymbolVariants(ticker: string): string[];
export declare function parseHkQuoteRows(text: string, requested: Set<string>): JsonRecord[];
export declare function parseUsQuoteRows(text: string, requested: Set<string>): Array<{
    symbol: string;
    row: JsonRecord;
}>;
/**
 * **港美股指数快照**：只收点位那一族能证明的列。
 *
 * 为什么必须另开一张表（而不是复用个股那张）：实测指数行的量纲列不可读——
 * 港 `hkHSI` 的第 6 / 36 / 37 位两列相等且量级像万元，美 `usIXIC` 的第 37 位给了 2.1e14、
 * 第 38 / 44 / 45 / 62 / 63 位是空。把这些列收进输出表就等于承诺一个我们证明不了的口径。
 *
 * 也**不收币种**：上游确实在第 75 / 35 位塞了 `HKD` / `USD`，但点位是无量纲的数，
 * 替它标货币单位是替上游说话（`docs/design/watchlist-hk-us.md` §3.5）。
 *
 * 身份守卫是形状而非猜测：指数行第 2 位美股回 `.IXIC`（**前导点**）、港股回 `HSI`（**纯字母**）；
 * 个股行美股回 `AAPL.OQ`（点在中间）、港股回 `00700`（5 位数字）。2026-10-07 实测踩到过
 * `usSSPX` 回的是 `SSPX.AM`（一只 ETF）——所以猜写法拿指数必错，而这一层的形状核对是最后一道闸。
 */
export declare function parseOffshoreIndexRows(text: string, requested: Set<string>, market: 'hk' | 'us'): JsonRecord[];
/** 港美股指数代码：HK 是字母码（HSI / HSTECH / HSCEI），美是裸字母码（IXIC / DJI / INX，请求时不带那个前导点）。 */
export declare function normalizeOffshoreIndexCode(value: unknown, name: string, market: 'hk' | 'us'): string;
/**
 * 港美股快照的**唯一**取数编排（能力侧与自选股面板共用）。
 * 港股一次批量问完；美股先按原写法问一轮，**没回行**的那几只才用剥掉后缀的写法再问，
 * 所以正常路径（纯字母 ticker）一次请求都不多花。
 */
export declare function fetchOffshoreQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]>;
/** 港美股指数快照的取数编排：字母码没有"剥后缀重问"这一说，所以一轮问完。 */
export declare function fetchOffshoreIndexQuotes(market: 'hk' | 'us', codes: string[], signal: AbortSignal): Promise<JsonRecord[]>;
/** 美股 K 线入口需要的带后缀身份：先从快照拿上游自己的第 2 位（能力侧用，形状判据同一条）。 */
export declare function resolveUsKlineSymbol(ticker: string, signal: AbortSignal): Promise<string>;
/**
 * smartbox（腾讯公开检索）的一行候选。
 *
 * 回包形状是 `v_hint="市场~代码~名称~拼音~类型^…"`：ASCII 的 `\uXXXX` 转义（**不需要 GBK**）、
 * `^` 分行、`~` 分列，最多约 10 条。无命中与**非法 `t` 值**都回 `N` 这一个哨兵（实测
 * `t=hk,us` 这种列表形态也落进 `N`），所以解析器把它当零条、调用方把 `t` 钉成常量。
 */
export interface SmartboxCandidate {
    market: string;
    code: string;
    name: string;
    pinyin: string;
    type: string;
}
export declare function parseSmartbox(text: string): SmartboxCandidate[];
/** smartbox 检索：市场段只能是上游认的单值（`hk` / `us` / `all`），列表形态实测失效。 */
export declare const SMARTBOX_MARKETS: string[];
export declare function fetchSmartbox(query: string, market: string, signal: AbortSignal): Promise<SmartboxCandidate[]>;
