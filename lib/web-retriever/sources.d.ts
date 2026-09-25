/**
 * 具名来源的结构化取数（provider + operation）。
 *
 * 与 `web_retriever_fetch` 的分工：fetch 是"一个 URL → 一篇正文"的**检索**工作面；
 * 这里是"一个具名来源 + 业务参数 → 确定、有序、可翻页、同参可复现的结果集"的**查询**工作面。
 * 判据不是"返回 JSON 还是 HTML"（`SearchHit` 本来就带 `content?`，形状无法区分），
 * 而是结果集是否确定、是否可复现、以及"这次调用承诺了什么"——见
 * `docs/design/web-retriever-source-expansion.md` §2.2。
 *
 * 四条来源各自是一次具体实现，**不做配方注册表 / 通用适配层**：只有这样，
 * 每个来源的端点、签名、字段语义才能就地写清楚，不引入一层只为"统一"而存在的间接。
 * 出口校验（URL 合法性 + DNS 公网 IP 闸门 + 重定向重校验 + 大小/超时上限）统一复用
 * `createHttpRequester`，本文件不自建网络路径（AGENTS.md §9.7）。
 */
import { createHttpRequester } from './local-fetch.js';
import type { EastmoneyClient, EastmoneyTransport } from '../net/eastmoney-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
/** 错误信封里的上游名，也是 `provider_tally` 的键。 */
export type SourceId = 'cls' | 'wscn' | 'cninfo_irm' | 'sseinfo' | 'eastmoney' | 'ths' | 'sina';
export declare const SOURCE_IDS: readonly SourceId[];
/** 单条正文裁剪上限：条目数由各工具的 limit 参数封顶，单条长度在这里封顶。 */
export declare const MAX_ITEM_CHARS = 1200;
/** 一条工具输出里的条目上限（与工具 schema 的 maximum 一致）。 */
export declare const MAX_ITEMS = 50;
export interface SourceItem {
    [key: string]: string | number | null;
}
export interface SourceOutcome {
    source: SourceId;
    operation: string;
    items: SourceItem[];
    /** 上游给的可继续翻页游标；没有就不带这个键。 */
    next_cursor?: string;
    /** 如实记录上游口径 / 已知缺口，模型据此判断"空结果"是不是真事实。 */
    note?: string;
}
export declare class SourceError extends Error {
    readonly source: SourceId;
    readonly code: string;
    constructor(source: SourceId, code: string, message: string);
}
type Requester = ReturnType<typeof createHttpRequester>;
/** 每个来源工具调用一次；transport 惰性建、按配置缓存。 */
export declare function createSourceTransport(options: LocalFetchOptions): Requester;
/**
 * 东财客户端传输层的**闸门适配**：三个 `eastmoney_*` 工具与其余六个来源共用同一份出口校验
 * （URL 合法性 + DNS 公网 IP 闸门 + 手动重定向逐跳重校验 + 大小/超时上限），不再是第二份
 * 裸 `fetch`（AGENTS.md §9.7）。节流器不在这里——仍由进程级共享的东财节流器提供
 * （`sharedEastmoneyThrottle()`），本适配只替换"怎么发出去"。
 *
 * 带分类 `code` 的 `LocalFetchError` 原样穿过（`createEastmoneyClient` 见 code 即不包裹），
 * 取消因此保持 `ABORTED` 语义、不被降级成网络失败（§4.1）。
 */
export declare function createGatedEastmoneyTransport(requester: Requester): EastmoneyTransport;
/**
 * 财联社 v1 接口的本地签名：`sign = md5(sha1(按 key 字典序拼接的 query 串))`。
 *
 * 旧 `nodeapi/telegraphList` 于 2026-05 下线，现接口强制校验 sign，但**纯本地计算、无需任何 key**
 * （外部实践文献 5.2 节，2026-07 复活；2026-09-24 本仓按此式复现，`errno=0` 正常返回）。
 * 签名必须由代码在请求前算出——这正是"模型只给参数、不给 URL"的原因。
 */
export declare function clsSign(params: Record<string, string>): string;
export declare function clsTelegraph(transport: Requester, input: {
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
export declare function wscnLives(transport: Requester, input: {
    channel: string;
    limit: number;
    cursor?: string;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 两步取数：`keyWord=代码` → `secid`（即 orgId）→ 按 orgId 查问答。
 *
 * ⚠️ 实测坑（2026-09-24 本仓）：第二步**必须 POST**（参数放 query 串）——
 * 同一 URL 用 GET 会得到 **HTTP 405**。外部文献只写了"参数放 query string"，
 * 没写这一条，而少了 POST 就是 405。
 * 覆盖范围：只覆盖深市；沪市实测返回 0 条（走 `sseinfo_qa`）；北交所两个平台都没有。
 */
export declare function cninfoIrm(transport: Requester, input: {
    code: string;
    pageSize: number;
    pageNum: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 公司列表页：每页 32 家、按代码升序。
 *
 * ⚠️ "uid 与代码必须来自**同一个 `<a>`**"在本函数里是**结构性保证**，不是靠正则窗口长度凑的：
 * 先用 `/<a\b(?:(?!<\/a>)[\s\S])*?<\/a>/g` 切出每个 `<a>` 元素，再在**单个元素内**找 uid 与
 * `company/<6位>.png`。逐元素解析的另一个好处是**跨条目错配在结构上不可能发生**。
 *
 * 为什么不能用"一次正则 + 限制间隔长度"（本函数第一版就是这么写的，被测试当场抓住）：
 * 真实页面在 `</a>` 与 `<img>` 之间有一个 `<br/>`，而 A 条目的 `<br/>` 之后紧跟 B 条目，
 * 于是任何形如 `uid=…[\s\S]{0,N}?…png` 的写法在 **N 足够大**时都会跨到下一个条目上——
 * 实测把 `600369` 配到了前一条的 `uid=65`。窗口小则匹配 0 条（外部文献的 `[^>]*>` 就是这个下场），
 * 窗口大则错配；**只有按元素切分才是对的**。
 */
export declare function parseCompanyList(content: string): Array<{
    code: string;
    uid: string;
}>;
export declare function resetSseCachesForTest(): void;
/**
 * 一次 uid 定位的**总**时限。`REQUEST_TIMEOUT_MS` 只管单个请求，而定位一次要串行 10–13 个
 * 请求（最坏 13 × 20s ≈ 4 分钟），所以这段必须有自己的上限——工具层的超时由宿主决定，
 * 不能拿"整轮对话还剩多少"来兜一个内部元数据查询。`sseinfoQa` 的 `uidLocateBudgetMs`
 * 仅供测试注入缩短（与 `wind-client.ts` 的 `retryDelaysMs` 同一约定）。
 */
export declare const SSE_UID_LOCATE_TIMEOUT_MS = 60000;
/**
 * 代码 → uid：公司列表分页升序，用**倍增 + 二分**定位。
 *
 * ⚠️ 缓存层次是本函数最容易写错的地方（2026-09-24 实测踩坑，症状很绕）：
 * - `ssePageCache` 缓存**页**，供二分复用，不参与"这个代码是谁"的判定；
 * - `sseUidCache` 只缓存**已解析出的那个代码**，绝不在扫描页面时把整页代码灌进去。
 *
 * 为什么后者是硬约束：二分一次会扫过 ~10–13 页、每页 32 家。若把扫描到的**全部**代码都写进
 * uid 缓存，一次解析就能塞进 200+ 条，把容量占满并**淘汰掉正在解析的那个代码**——表现为
 * "单次解析成功、稍后再查同一个代码却报 NOT_FOUND"，而且只在特定调用序列下复现。
 * 因此 uid 只从"已确认命中"的那一页里取，取不到就按升序自检后的页范围继续二分。
 */
export declare function resolveSseCompanyUid(transport: Requester, code: string, signal?: AbortSignal): Promise<string>;
/**
 * 解析问答列表页。以回复块 `class="m_feed_detail m_qa"` 为界切问题段与回复段——
 * 不靠 id 区分（"最新回复"与"最新提问"两种列表的标记不同）。
 */
export declare function parseSseFeed(text: string): SourceItem[];
/**
 * 页面时间统一成「YYYY-MM-DD HH:MM」（北京时间）。
 *
 * 实测（2026-09-24 全量抽样 150 条）非绝对写法**只有三类**，必须全部支持：
 * - 相对当天：`2分钟前` / `57分钟前` / `1小时前` / `2小时前`；
 * - 相对昨天：`昨天 18:16`；
 * - 绝对：`2026年09月24日 09:30`。
 *
 * 少支持任何一类，"最新提问"列表就会因某一条认不出而**整次失败**（本仓真机冒烟两次都栽在
 * 这里：先是 `昨天 18:16`，再是 `2分钟前`）。相对写法按**北京时间**换算——host 本地时区不可依赖
 * （本仓跑在 UTC 主机上），所以先取"北京当下"再回推。
 */
export declare function sseTime(text: string, now?: Date): string | undefined;
export declare function sseinfoQa(transport: Requester, input: {
    code?: string;
    kind: string;
    page: number;
    pageSize: number;
    signal?: AbortSignal;
    uidLocateBudgetMs?: number;
}): Promise<SourceOutcome>;
/**
 * 取东财 7×24 全球快讯。媒体的独立备份来源（与 `cls_telegraph` / `wscn_lives` 互备）：
 * 三条不同源、不同风控面，一条不可用另一条仍在。
 *
 * 实测（2026-09-24）：GET + JSON，`code` 为**字符串** `"1"` 表示成功；条目含 `title` /
 * `showTime`（已是北京时间字符串）/ `summary`。服务端会把它聚合到的财联社内容一并返回，
 * 所以同一事件可能与其他来源重复——**去重由调用方按标题判断**，本工具不猜。
 */
export declare function eastmoneyFastNews(client: EastmoneyClient, input: {
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 取某只股票的东财新闻（JSONP 接口，正文在 `cmsArticleWebOld` 数组里）。
 *
 * ⚠️ 必须区分两种"没结果"（参考实践记为 #18，本仓 2026-09-24 实测为正常返回）：
 * 上游对部分 IP 间歇风控时只返回 `passportWeb`（股民资料）而**没有** `cmsArticleWebOld` 键——
 * 这与"该股确实没有新闻"（键在、数组为空）是**两件事**。本函数按**键是否存在**判定，
 * 缺键时报 `UPSTREAM`，绝不静默返回空表。
 */
export declare function eastmoneyStockNews(client: EastmoneyClient, input: {
    code: string;
    limit: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 取个股研报列表。
 *
 * ⚠️ **没有摘要可给**（2026-09-24 实测该接口 51 个字段）：列表只有标题 / 机构 / 研究员 /
 * 日期 / 评级，正文在 `pdf.dfcfw.com` 的 PDF 里，而本机直连只处理文本（`application/pdf`
 * 会被拒），**web_retriever 拿不到研报正文**。需要正文时如实说明这个边界，不要拿标题当结论。
 *
 * 有用的派生信息：每篇研报自带分析师预测 EPS（`predictThisYearEps` / `predictNextYearEps` /
 * `predictNextTwoYearEps`）与对应 PE，以及评级与评级变动（`emRatingName` / `ratingChange`）。
 *
 * ⚠️ 该接口只认**纯 6 位代码**：带 `SH` 前缀会返回 `hits=0`，看起来像"这只票没研报"。
 */
export declare function eastmoneyReports(client: EastmoneyClient, input: {
    code: string;
    pageSize: number;
    pageNo: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 取新浪研报列表（研报第二来源，与 `eastmoney_reports` 互为备份）。
 *
 * ⚠️ 两条**与参考实践不同的实测结论**（2026-09-24，本仓复核）：
 * 1. 参考实践说"两次请求间隔 <1 秒会返回假的『没有找到相关内容』空页，必须 6 秒"。
 *    本仓实测**连续 4 次无间隔全部成功**（分别为 40/39/39/38 条带序号行）——那个"限流"是误判。
 * 2. 真正会让**个股**查询返回假空页的是**缺交易所前缀**：`688017` 纯 6 位 → 假空页；
 *    `sh688017` / `sz000001` → 正常。而 `600519` 纯 6 位恰好也能用（前缀可推断），
 *    所以"纯 6 位能用"的样本会误导人。本函数**一律补前缀**。
 * ⚠️ 空页 HTTP 200 且与"真的没有研报"长得一样，因此本函数按"带序号行数"与空页提示语双重判定。
 */
export declare function sinaReports(transport: Requester, input: {
    code?: string;
    page: number;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
/**
 * 新浪研报的 symbol 参数：一律带交易所前缀（实测缺前缀会让科创板返回假空页）。
 *
 * ⚠️ 顺序要紧：`92xxxx`（北交所**新号段**，如 832982→920982）以 9 开头，若先判 `9 → sh`
 * 就会被发到上交所并拿到假空页。所以北交所号段（43/83/87/920）必须先判，
 * 只有 `900xxx`（沪市 B 股）才归 sh。
 */
export declare function sinaSymbol(code: string): string;
/**
 * 取同花顺「机构一致预期 EPS」表（HTML 表格，**GBK**）。
 *
 * ⚠️ 两个必须记住的实测结论（2026-09-24）：
 * 1. 该站声明 `content-type: text/html`（**不带 charset**）而正文是 GBK：
 *    按 UTF-8 解会得到 11,800 个替换字符，中文与正则全部失效。因此本请求显式声明 `encoding: 'gbk'`
 *    （`HttpRequest.encoding` 只允许来源实现填写，不暴露给模型）。
 * 2. 页面里有 **32 个 `<table>`**，只需认"含『每股收益』表头"的那一张（行结构固定为
 *    年度 / 预测机构数 / 最小值 / 均值 / 最大值 / 行业平均数）。**均值即机构一致预期 EPS**。
 *
 * 另附页面摘要块里的"预测机构数 + 同比增速"（与表格同源，作为交叉印证）。
 */
export declare function thsEpsForecast(transport: Requester, input: {
    code: string;
    signal?: AbortSignal;
}): Promise<SourceOutcome>;
export {};
