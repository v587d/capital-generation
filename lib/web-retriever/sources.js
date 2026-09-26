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
import { createHttpRequester, safeUrl } from './local-fetch.js';
import { stripInvisibleText } from './html-markdown.js';
export const SOURCE_IDS = ['cls', 'wscn', 'cninfo_irm', 'sseinfo', 'eastmoney', 'ths', 'sina'];
/** 单条正文裁剪上限：条目数由各工具的 limit 参数封顶，单条长度在这里封顶。 */
export const MAX_ITEM_CHARS = 1200;
/** 一条工具输出里的条目上限（与工具 schema 的 maximum 一致）。 */
export const MAX_ITEMS = 50;
export class SourceError extends Error {
    source;
    code;
    constructor(source, code, message) {
        super(message);
        this.source = source;
        this.code = code;
        this.name = 'SourceError';
    }
}
const REQUEST_TIMEOUT_MS = 20_000;
function createHash(algorithm) {
    const processLike = globalThis.process;
    return processLike?.getBuiltinModule?.('node:crypto')?.createHash?.(algorithm);
}
/** 每个来源工具调用一次；transport 惰性建、按配置缓存。 */
export function createSourceTransport(options) {
    return createHttpRequester({ ...options, timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS });
}
/**
 * 东财客户端传输层的**闸门适配**：三个 `eastmoney_*` 工具与其余六个来源共用同一份出口校验
 * （URL 合法性 + DNS 公网 IP 闸门 + 手动重定向逐跳重校验 + 大小/超时上限），不再是第二份
 * 裸 `fetch`（AGENTS.md §9.7）。节流器不在这里——仍由进程级共享的东财节流器提供
 * （`sharedEastmoneyThrottle()`），本适配只替换"怎么发出去"。
 *
 * 带分类 `code` 的 `LocalFetchError` 原样穿过（`createEastmoneyClient` 见 code 即不包裹），
 * 取消因此保持 `ABORTED` 语义、不被降级成网络失败（docs/dev/web-retriever.md §4.2）。
 */
export function createGatedEastmoneyTransport(requester) {
    return async (url, init) => {
        const outcome = await requester.request({ url, ...(init.headers === undefined ? {} : { headers: init.headers }) }, init.signal);
        return {
            status: outcome.status,
            text: async () => outcome.text,
            json: async () => JSON.parse(outcome.text),
        };
    };
}
/** 条目链接的最大长度：链接只是引用，不该吃掉整份输出的字符预算（`tools.ts` 的条目预算）。 */
const ITEM_URL_MAX_CHARS = 500;
function clip(text) {
    if (typeof text !== 'string')
        return '';
    // 上游字段（页面文本、JSON 正文）与抓取正文同一口径：先剥不可见字符再裁剪。
    const trimmed = stripInvisibleText(text).trim();
    return trimmed.length > MAX_ITEM_CHARS ? `${trimmed.slice(0, MAX_ITEM_CHARS)}…` : trimmed;
}
/** 条目的可点击链接：非 http(s) / 含控制符 / 带凭据 / 超长一律丢字段（不丢条目）。 */
function itemUrl(value) {
    return safeUrl(value, ITEM_URL_MAX_CHARS);
}
/**
 * 把 HTML 片段压成可读纯文本（sseinfo 的正文块里带 `<p>` / `<br/>`）。
 *
 * ⛔ 顺序必须是"先解码实体、后剥标签"：反过来时外部内容里的 `&lt;system&gt;…&lt;/system&gt;`
 * 会在剥完标签后被解码成**活标签**，进入模型上下文就是提示注入面。解码出的新标签同样要剥，
 * 所以标签剥离循环到有界轮数（双重编码的 `&amp;lt;` 解出来是字面 `&lt;`，惰性问题不大）。
 */
function stripHtml(fragment) {
    let text = stripInvisibleText(fragment)
        .replace(/&nbsp;/gu, ' ')
        .replace(/&#39;/gu, "'")
        .replace(/&quot;/gu, '"')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&amp;/gu, '&');
    for (let round = 0; round < 3; round += 1) {
        const stripped = text
            .replace(/<br\s*\/?>/giu, '\n')
            .replace(/<\/p>/giu, '\n')
            .replace(/<[^>]+>/gu, '');
        if (stripped === text)
            break;
        text = stripped;
    }
    return text
        .replace(/[ \t]{2,}/gu, ' ')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}
function cstStamp(seconds) {
    const date = new Date(seconds * 1000 + 8 * 3600 * 1000);
    return `${date.toISOString().slice(0, 19).replace('T', ' ')} CST`;
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function parseJson(text, source, what) {
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new SourceError(source, 'INVALID_RESPONSE', `${what} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
}
function requireRows(value, source, what) {
    if (!Array.isArray(value))
        throw new SourceError(source, 'INVALID_RESPONSE', `${what} 不是数组（上游结构可能已变）`);
    return value;
}
function clipItems(items) {
    return items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS) : items;
}
/**
 * 上游数值有时是**字符串**（东财 `predictThisYearEps: '1.0700000000'`，保留精度），
 * 有时是 number。按值转换而不是按类型判定，否则"字符串型数值"会被静默当成缺失。
 * 认不出（空串 / 非数值）一律 `null`——绝不猜一个数字出来。
 */
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
// ── 财联社快讯（cls.cn）───────────────────────────────────────────────────────
const CLS_URL = 'https://www.cls.cn/v1/roll/get_roll_list';
const CLS_REFERER = 'https://www.cls.cn/';
/**
 * 财联社 v1 接口的本地签名：`sign = md5(sha1(按 key 字典序拼接的 query 串))`。
 *
 * 旧 `nodeapi/telegraphList` 于 2026-05 下线，现接口强制校验 sign，但**纯本地计算、无需任何 key**
 * （外部实践文献 5.2 节，2026-07 复活；2026-09-24 本仓按此式复现，`errno=0` 正常返回）。
 * 签名必须由代码在请求前算出——这正是"模型只给参数、不给 URL"的原因。
 */
export function clsSign(params) {
    const query = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    const sha1 = createHash('sha1');
    const md5 = createHash('md5');
    if (sha1 === undefined || md5 === undefined) {
        throw new SourceError('cls', 'UPSTREAM', '运行时缺少 node:crypto，无法计算财联社签名');
    }
    return md5.update(sha1.update(query).digest('hex')).digest('hex');
}
export async function clsTelegraph(transport, input) {
    const params = {
        appName: 'CailianpressWeb',
        os: 'web',
        sv: '7.7.5',
        last_time: '',
        refresh_type: '1',
        rn: String(input.limit),
    };
    const query = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    const outcome = await transport.request({ url: `${CLS_URL}?${query}&sign=${clsSign(params)}`, headers: { referer: CLS_REFERER } }, input.signal);
    const body = asRecord(parseJson(outcome.text, 'cls', '财联社响应'));
    if (!body)
        throw new SourceError('cls', 'INVALID_RESPONSE', '财联社响应不是对象');
    if (body.errno !== 0) {
        throw new SourceError('cls', 'UPSTREAM', `财联社返回 errno=${String(body.errno)}（上游口径变更或风控）`);
    }
    const data = asRecord(body.data);
    const rows = requireRows(data?.roll_data, 'cls', '财联社 data.roll_data');
    const items = [];
    for (const raw of rows) {
        const row = asRecord(raw);
        if (!row)
            continue;
        // 非 roll 条目（推广 / 广告位）不属于"快讯"，不得混入证据。
        if (row.in_roll === false || row.is_ad === true)
            continue;
        const ctime = typeof row.ctime === 'number' ? row.ctime : undefined;
        if (ctime === undefined)
            throw new SourceError('cls', 'INVALID_RESPONSE', '财联社条目缺 ctime（时间认不出时宁可失败，不给空时间列）');
        const brief = typeof row.brief === 'string' ? row.brief : '';
        const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title : brief;
        items.push({
            id: typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null,
            time: cstStamp(ctime),
            title: clip(title),
            content: clip(typeof row.content === 'string' && row.content.trim() !== '' ? row.content : brief),
            url: itemUrl(row.shareurl),
        });
    }
    return {
        source: 'cls',
        operation: 'telegraph',
        items: clipItems(items),
        ...(items.length > MAX_ITEMS ? { note: `已截断为前 ${MAX_ITEMS} 条` } : {}),
    };
}
// ── 华尔街见闻 7×24 快讯（api-one-wscn.awtmt.com）────────────────────────────
const WSCN_URL = 'https://api-one-wscn.awtmt.com/apiv1/content/lives';
export async function wscnLives(transport, input) {
    const params = new URLSearchParams({ channel: input.channel, limit: String(input.limit) });
    if (input.cursor !== undefined)
        params.set('cursor', input.cursor);
    const outcome = await transport.request({ url: `${WSCN_URL}?${params.toString()}` }, input.signal);
    const body = asRecord(parseJson(outcome.text, 'wscn', '华尔街见闻响应'));
    if (!body)
        throw new SourceError('wscn', 'INVALID_RESPONSE', '华尔街见闻响应不是对象');
    if (body.code !== 20000) {
        throw new SourceError('wscn', 'UPSTREAM', `华尔街见闻返回 code=${String(body.code)}`);
    }
    const data = asRecord(body.data);
    const rows = requireRows(data?.items, 'wscn', '华尔街见闻 data.items');
    const items = [];
    for (const raw of rows) {
        const row = asRecord(raw);
        if (!row)
            continue;
        const stamp = row.display_time;
        if (typeof stamp !== 'number' || !Number.isFinite(stamp)) {
            throw new SourceError('wscn', 'INVALID_RESPONSE', '华尔街见闻条目 display_time 不是数字');
        }
        items.push({
            id: typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null,
            time: cstStamp(stamp),
            title: clip(row.title),
            content: clip(row.content_text),
            // score 是见闻的重要性字段：实测 1 / 2，少量 3（越高越重要）。
            importance: typeof row.score === 'number' ? row.score : null,
            url: itemUrl(row.uri) || (typeof row.id === 'number' ? `https://wallstreetcn.com/livenews/${row.id}` : ''),
        });
    }
    const next = data?.next_cursor;
    return {
        source: 'wscn',
        operation: 'lives',
        items: clipItems(items),
        ...(typeof next === 'string' || typeof next === 'number' ? { next_cursor: String(next) } : {}),
    };
}
// ── 互动易问答（irm.cninfo.com.cn，深市）────────────────────────────────────
const IRM_KEYWORD_URL = 'https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo';
const IRM_QUESTION_URL = 'https://irm.cninfo.com.cn/newircs/company/question';
function formBody(fields) {
    return new URLSearchParams(fields).toString();
}
/**
 * 两步取数：`keyWord=代码` → `secid`（即 orgId）→ 按 orgId 查问答。
 *
 * ⚠️ 实测坑（2026-09-24 本仓）：第二步**必须 POST**（参数放 query 串）——
 * 同一 URL 用 GET 会得到 **HTTP 405**。外部文献只写了"参数放 query string"，
 * 没写这一条，而少了 POST 就是 405。
 * 覆盖范围：只覆盖深市；沪市实测返回 0 条（走 `sseinfo_qa`）；北交所两个平台都没有。
 */
export async function cninfoIrm(transport, input) {
    const keyword = await transport.request({ url: IRM_KEYWORD_URL, method: 'POST', body: formBody({ keyWord: input.code }) }, input.signal);
    const keywordBody = asRecord(parseJson(keyword.text, 'cninfo_irm', '互动易代码查询响应'));
    const matches = Array.isArray(keywordBody?.data) ? keywordBody.data : [];
    const first = asRecord(matches[0]);
    const orgId = typeof first?.secid === 'string' ? first.secid : undefined;
    if (orgId === undefined) {
        throw new SourceError('cninfo_irm', 'NOT_FOUND', `互动易查不到 ${input.code}（该代码不在深市，或代码有误）`);
    }
    const params = new URLSearchParams({
        _t: '1',
        stockcode: input.code,
        orgId,
        pageSize: String(input.pageSize),
        pageNum: String(input.pageNum),
        keyWord: '',
        startDay: '',
        endDay: '',
    });
    const page = await transport.request({ url: `${IRM_QUESTION_URL}?${params.toString()}`, method: 'POST', body: '' }, input.signal);
    const pageBody = asRecord(parseJson(page.text, 'cninfo_irm', '互动易问答响应'));
    const rows = requireRows(pageBody?.rows, 'cninfo_irm', '互动易 rows');
    const total = typeof pageBody?.total === 'number' ? pageBody.total : undefined;
    const items = [];
    for (const raw of rows) {
        const row = asRecord(raw);
        if (!row)
            continue;
        const stamp = row.pubDate;
        if (typeof stamp !== 'number' || !Number.isFinite(stamp)) {
            throw new SourceError('cninfo_irm', 'INVALID_RESPONSE', '互动易条目 pubDate 不是毫秒时间戳');
        }
        const answer = typeof row.attachedContent === 'string' ? clip(row.attachedContent) : '';
        const question = clip(row.mainContent);
        items.push({
            code: typeof row.stockCode === 'string' ? row.stockCode : input.code,
            company: typeof row.companyShortName === 'string' ? row.companyShortName : '',
            question,
            answer,
            // 空串与"未回复"必须分开表达：未回复是事实，空正文是缺口。
            status: answer === '' ? 'unanswered' : 'answered',
            answerer: typeof row.attachedAuthor === 'string' ? row.attachedAuthor : '',
            time: cstStamp(stamp / 1000),
        });
    }
    return {
        source: 'cninfo_irm',
        operation: 'questions',
        items: clipItems(items),
        note: `深市专用：互动易对沪市公司返回 0 条，沪市问答请用 sseinfo_qa${total === undefined ? '' : `；公司累计问答 ${total} 条`}`,
    };
}
// ── 上证e互动（sns.sseinfo.com，沪市）──────────────────────────────────────
const SSE_BASE = 'https://sns.sseinfo.com';
const SSE_REFERER = `${SSE_BASE}/`;
const SSE_KIND = { answered: 11, questions: 10 };
/** 公司列表末页之后固定返回这句话（外部文献实测第 74 页起）。 */
const SSE_COMPANY_END = '没有任何上市公司的信息';
const SSE_EMPTY_NOTE = /class="m_feed_note"[^>]*>[^<]*(暂无|暂时没有)[^<]*</u;
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
export function parseCompanyList(content) {
    const pairs = [];
    for (const match of content.matchAll(/<a\b(?:(?!<\/a>)[\s\S])*?<\/a>/gu)) {
        const element = match[0];
        const uid = /uid=['"]?(\d+)['"]?/u.exec(element);
        const code = /company\/(\d{6})\.png/u.exec(element);
        if (uid !== null && code !== null)
            pairs.push({ uid: uid[1], code: code[1] });
    }
    return pairs.sort((left, right) => left.code.localeCompare(right.code));
}
/**
 * 代码 → uid：公司列表分页升序，用倍增 + 二分定位；结果缓存在**模块级有界 Map**。
 *
 * 为什么允许这个缓存：一次定位要 10–13 个请求（外部文献口径），且映射是**代码→uid 的元数据**，
 * 不是内容、不是检索结果，不存在"串了别人的材料"的风险。仍按 SSE_UID_CACHE_LIMIT 封顶，
 * 且**每次使用前都做升序自检**——宁可失败也不返回错配的问答。
 */
const SSE_UID_CACHE_LIMIT = 200;
const sseUidCache = new Map();
const ssePageCache = new Map();
export function resetSseCachesForTest() {
    sseUidCache.clear();
    ssePageCache.clear();
}
async function sseCompanyPage(transport, page, signal) {
    const cached = ssePageCache.get(page);
    if (cached !== undefined)
        return cached;
    const outcome = await transport.request({ url: `${SSE_BASE}/allcompany.do`, method: 'POST', body: formBody({ code: '0', order: '2', areaId: '0', page: String(page) }), headers: { referer: SSE_REFERER } }, signal);
    const body = asRecord(parseJson(outcome.text, 'sseinfo', '上证e互动公司列表响应'));
    const content = typeof body?.content === 'string' ? body.content : undefined;
    if (content === undefined) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页没有 content 字符串（页面结构可能已变）`);
    }
    const pairs = parseCompanyList(content);
    if (pairs.length === 0 && page === 1) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', '上证e互动公司列表第 1 页解析出 0 家公司（页面格式可能已变）');
    }
    if (pairs.length === 0 && !content.includes(SSE_COMPANY_END)) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页既没有公司也没有末页提示（页面格式可能已变）`);
    }
    // 兑现"每次使用前做升序自检"：页面进二分包面前先验序。parseCompanyList 已按 code 排序，
    // 因此这里真正抓的是**重复 code**（正则配对错位、一家公司配了两次不同 uid）——
    // 二分会据此定位 uid，宁可响亮失败也不返回错配的问答。
    assertAscending(pairs, page);
    if (ssePageCache.size >= SSE_UID_CACHE_LIMIT) {
        // 逐条淘汰最旧的一项，**不能整表 clear()**：解析一次公司可能扫过十几页，
        // 而整表清空会把**本次刚刚定位到的** uid 一起丢掉 ⇒ 下一次调用（或同一函数后半段）
        // 又变成 NOT_FOUND。实测形态：单个 resolve 成功、紧接着的 sseinfoQa 却报"没有 600000"。
        const oldest = ssePageCache.keys().next().value;
        if (oldest !== undefined)
            ssePageCache.delete(oldest);
    }
    ssePageCache.set(page, pairs);
    // 这里**只**缓存页面本身。曾把整页的 code→uid 也灌进 uid 缓存，结果一次解析就塞满容量并
    // 淘汰掉正在解析的代码（见 `resolveSseCompanyUid` 的注释）。uid 缓存只由"确认命中"写入。
    return pairs;
}
function assertAscending(pairs, page) {
    for (let index = 1; index < pairs.length; index += 1) {
        if (pairs[index - 1].code >= pairs[index].code) {
            throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页不是按代码升序（配对可能错位，拒绝据此定位 uid）`);
        }
    }
}
/**
 * 一次 uid 定位的**总**时限。`REQUEST_TIMEOUT_MS` 只管单个请求，而定位一次要串行 10–13 个
 * 请求（最坏 13 × 20s ≈ 4 分钟），所以这段必须有自己的上限——工具层的超时由宿主决定，
 * 不能拿"整轮对话还剩多少"来兜一个内部元数据查询。`sseinfoQa` 的 `uidLocateBudgetMs`
 * 仅供测试注入缩短（与 `wind-client.ts` 的 `retryDelaysMs` 同一约定）。
 */
export const SSE_UID_LOCATE_TIMEOUT_MS = 60_000;
/** 给"一串串行请求"套一个总时限，并与调用方的取消信号复合。 */
function startDeadline(outer, budgetMs) {
    const controller = new AbortController();
    let fired = false;
    const timer = setTimeout(() => {
        fired = true;
        controller.abort(new Error(`deadline after ${budgetMs}ms`));
    }, budgetMs);
    const onOuterAbort = () => controller.abort(outer?.reason);
    if (outer) {
        if (outer.aborted)
            onOuterAbort();
        else
            outer.addEventListener('abort', onOuterAbort, { once: true });
    }
    return {
        signal: controller.signal,
        exceeded: () => fired && outer?.aborted !== true,
        dispose: () => {
            clearTimeout(timer);
            outer?.removeEventListener('abort', onOuterAbort);
        },
    };
}
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
export async function resolveSseCompanyUid(transport, code, signal) {
    const cached = sseUidCache.get(code);
    if (cached !== undefined)
        return cached;
    let high = 1;
    // 倍增找到"最后一条 ≥ code"（或空页）的第一页。
    for (let guard = 0; guard < 16; guard += 1) {
        const pairs = await sseCompanyPage(transport, high, signal);
        if (pairs.length === 0 || pairs[pairs.length - 1].code >= code)
            break;
        high *= 2;
    }
    let low = 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const pairs = await sseCompanyPage(transport, mid, signal);
        if (pairs.length === 0 || code < pairs[0].code) {
            high = mid - 1;
            continue;
        }
        if (code > pairs[pairs.length - 1].code) {
            low = mid + 1;
            continue;
        }
        const hit = pairs.find((pair) => pair.code === code);
        if (hit !== undefined) {
            if (sseUidCache.size >= SSE_UID_CACHE_LIMIT) {
                const oldest = sseUidCache.keys().next().value;
                if (oldest !== undefined)
                    sseUidCache.delete(oldest);
            }
            sseUidCache.set(code, hit.uid);
            return hit.uid;
        }
        break;
    }
    throw new SourceError('sseinfo', 'NOT_FOUND', `上证e互动没有 ${code}（该公司不在上交所，或已退市）`);
}
/**
 * 解析问答列表页。以回复块 `class="m_feed_detail m_qa"` 为界切问题段与回复段——
 * 不靠 id 区分（"最新回复"与"最新提问"两种列表的标记不同）。
 */
export function parseSseFeed(text) {
    const items = [];
    const chunks = text.split(/<div class="m_feed_item[^"]*" id="item-/u).slice(1);
    for (const chunk of chunks) {
        const numbered = /^(\d+)/u.exec(chunk);
        if (!numbered) {
            throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动条目 id 不是数字（页面结构可能已变）：${chunk.slice(0, 60)}`);
        }
        const itemId = numbered[1];
        const [askPart, answerPart = ''] = chunk.split('class="m_feed_detail m_qa"');
        const question = /<div class="m_feed_txt"[^>]*>\s*<a[^>]*>:(.*?)\((\d{6})\)<\/a>(.*?)<\/div>/su.exec(askPart);
        const askTime = /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/u.exec(askPart);
        if (!question || !askTime) {
            throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条结构改变，无法解析问题或时间`);
        }
        let answer = '';
        let answerTime = '';
        if (answerPart !== '') {
            const body = /<div class="m_feed_txt"[^>]*>(.*?)<\/div>/su.exec(answerPart);
            const when = /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/u.exec(answerPart);
            if (!body || !when) {
                throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条有回复块但解析不出回复内容或时间`);
            }
            answer = clip(stripHtml(body[1]));
            answerTime = sseTime(when[1]) ?? '';
            if (answerTime === '') {
                throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条的回复时间认不出：${when[1]}`);
            }
        }
        const questionTime = sseTime(askTime[1]);
        if (questionTime === undefined) {
            throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条的提问时间认不出：${askTime[1]}`);
        }
        items.push({
            id: itemId,
            code: question[2],
            question: clip(stripHtml(question[3])),
            answer,
            status: answer === '' ? 'unanswered' : 'answered',
            time: questionTime,
            answer_time: answerTime,
        });
    }
    return items;
}
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
export function sseTime(text, now = new Date()) {
    const absolute = /(\d{4})年(\d{2})月(\d{2})日\s*(\d{2}:\d{2})/u.exec(text);
    if (absolute !== null) {
        return `${absolute[1]}-${absolute[2]}-${absolute[3]} ${absolute[4]}`;
    }
    const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
    const stamp = () => beijing.toISOString().slice(0, 16).replace('T', ' ');
    const relative = /(今天|昨天)\s*(\d{2}:\d{2})/u.exec(text);
    if (relative !== null) {
        if (relative[1] === '昨天')
            beijing.setUTCDate(beijing.getUTCDate() - 1);
        return `${beijing.toISOString().slice(0, 10)} ${relative[2]}`;
    }
    const elapsed = /(\d+)\s*(分钟|小时)前/u.exec(text);
    if (elapsed !== null) {
        const amount = Number(elapsed[1]) * (elapsed[2] === '小时' ? 60 : 1);
        beijing.setUTCMinutes(beijing.getUTCMinutes() - amount);
        return stamp();
    }
    // 「刚刚」没有分钟精度，按当前分钟处理；其余一律返回 undefined（调用方据此失败，不猜）。
    return /^刚刚$/u.test(text.trim()) ? stamp() : undefined;
}
export async function sseinfoQa(transport, input) {
    const type = SSE_KIND[input.kind];
    let text;
    if (input.code === undefined) {
        const params = new URLSearchParams({
            type: String(type),
            pageSize: String(input.pageSize),
            lastid: '-1',
            show: '1',
            page: String(input.page),
        });
        const outcome = await transport.request({ url: `${SSE_BASE}/ajax/feeds.do?${params.toString()}`, headers: { referer: SSE_REFERER } }, input.signal);
        text = outcome.text;
    }
    else {
        const budgetMs = input.uidLocateBudgetMs ?? SSE_UID_LOCATE_TIMEOUT_MS;
        const deadline = startDeadline(input.signal, budgetMs);
        let uid;
        try {
            uid = await resolveSseCompanyUid(transport, input.code, deadline.signal);
        }
        catch (error) {
            // 总时限到点是"这个来源查得慢"，不是调用方取消：必须翻成 SourceError，
            // 否则工具层会按 ABORTED 原样上抛，上层误读成"用户中断了这一轮"。
            if (deadline.exceeded()) {
                throw new SourceError('sseinfo', 'TIMEOUT', `上证e互动公司 uid 定位超过 ${Math.round(budgetMs / 1000)}s（一次定位需 10–13 个串行请求）；稍后重试，或先用不带 code 的 sseinfo_qa 取全市场问答`);
            }
            throw error;
        }
        finally {
            deadline.dispose();
        }
        const params = new URLSearchParams({
            typeCode: 'company',
            type: String(type),
            pageSize: String(input.pageSize),
            uid,
            page: String(input.page),
        });
        const outcome = await transport.request({ url: `${SSE_BASE}/ajax/userfeeds.do?${params.toString()}`, method: 'POST', body: '', headers: { referer: SSE_REFERER } }, input.signal);
        text = outcome.text;
    }
    const parsed = parseSseFeed(text);
    // 只有页面明确写着「暂无 / 暂时没有」才算真没有问答；解析出 0 条又没这句话，是结构变了。
    if (parsed.length === 0 && !SSE_EMPTY_NOTE.test(text)) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', '上证e互动页面既没有问答也没有「暂无」提示（结构可能已变）');
    }
    const notes = [];
    let items = parsed;
    if (input.code !== undefined) {
        // ⚠️ 上游有数据漂移：2026-09-24 实测 `600519`（uid 518）在 `kind='questions'` 下返回的是
        // **600518** 的问答。此处**按条过滤**而不是整次失败——整次失败会把该公司页面上真实存在的
        // 问答一起丢掉，比"少一条被污染的数据"更糟。丢弃条数与原因写进 note，绝不静默。
        const foreign = parsed.filter((item) => item.code !== input.code);
        items = parsed.filter((item) => item.code === input.code);
        if (foreign.length > 0) {
            notes.push(`已丢弃 ${foreign.length} 条非 ${input.code} 的问答（上游返回了 ${[...new Set(foreign.map((item) => String(item.code)))].join('/')}，疑似上游数据漂移）`);
        }
        if (items.length === 0 && foreign.length > 0) {
            throw new SourceError('sseinfo', 'INVALID_RESPONSE', `${input.code} 本次返回的问答全部属于其他公司（上游数据漂移），已全部丢弃且无可用条目`);
        }
        notes.push('平台只开放近期问答（公司维度实测约近 1 个月）；北交所公司两个平台都没有');
    }
    return {
        source: 'sseinfo',
        operation: input.code === undefined ? `market_${input.kind}` : `company_${input.kind}`,
        items: clipItems(items),
        ...(notes.length > 0 ? { note: notes.join('；') } : {}),
    };
}
// ── 东财全球资讯 7×24（np-weblist）──────────────────────────────────────────
const EM_724_URL = 'https://np-weblist.eastmoney.com/comm/web/getFastNewsList';
const EM_REFERER = 'https://kuaixun.eastmoney.com/';
/**
 * 取东财 7×24 全球快讯。媒体的独立备份来源（与 `cls_telegraph` / `wscn_lives` 互备）：
 * 三条不同源、不同风控面，一条不可用另一条仍在。
 *
 * 实测（2026-09-24）：GET + JSON，`code` 为**字符串** `"1"` 表示成功；条目含 `title` /
 * `showTime`（已是北京时间字符串）/ `summary`。服务端会把它聚合到的财联社内容一并返回，
 * 所以同一事件可能与其他来源重复——**去重由调用方按标题判断**，本工具不猜。
 */
export async function eastmoneyFastNews(client, input) {
    const params = new URLSearchParams({
        client: 'web',
        biz: 'web_724',
        fastColumn: '102',
        sortEnd: '',
        pageSize: String(input.limit),
        req_trace: emTraceId(),
    });
    const outcome = await client.fetchText(`${EM_724_URL}?${params.toString()}`, {
        headers: { referer: EM_REFERER },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财 7×24 响应'));
    const data = asRecord(body?.data);
    // 上游用字符串 "1" 表示成功（不是数字 1）：按字符串比较，避免把成功判成失败。
    if (String(body?.code ?? '') !== '1') {
        throw new SourceError('eastmoney', 'UPSTREAM', `东财 7×24 返回 code=${String(body?.code)}（上游口径变更或风控）`);
    }
    const rows = requireRows(data?.fastNewsList, 'eastmoney', '东财 7×24 data.fastNewsList');
    const items = [];
    for (const raw of rows) {
        const row = asRecord(raw);
        if (!row)
            continue;
        items.push({
            time: clip(row.showTime),
            title: clip(row.title),
            content: clip(row.summary),
            url: itemUrl(row.url),
        });
    }
    return { source: 'eastmoney', operation: 'fast_news', items: clipItems(items) };
}
/** 请求去噪用的随机串（东财要求，缺失不影响正确性）。 */
function emTraceId() {
    return `${Date.now().toString(16)}-${Math.floor(Math.random() * 1e16).toString(16)}`;
}
// ── 东财个股新闻（search-api-web，JSONP）────────────────────────────────────
const EM_STOCK_NEWS_URL = 'https://search-api-web.eastmoney.com/search/jsonp';
const EM_SO_REFERER = 'https://so.eastmoney.com/';
/**
 * 取某只股票的东财新闻（JSONP 接口，正文在 `cmsArticleWebOld` 数组里）。
 *
 * ⚠️ 必须区分两种"没结果"（参考实践记为 #18，本仓 2026-09-24 实测为正常返回）：
 * 上游对部分 IP 间歇风控时只返回 `passportWeb`（股民资料）而**没有** `cmsArticleWebOld` 键——
 * 这与"该股确实没有新闻"（键在、数组为空）是**两件事**。本函数按**键是否存在**判定，
 * 缺键时报 `UPSTREAM`，绝不静默返回空表。
 */
export async function eastmoneyStockNews(client, input) {
    const inner = JSON.stringify({
        uid: '',
        keyword: input.code,
        type: ['cmsArticleWebOld'],
        client: 'web',
        clientType: 'web',
        clientVersion: 'curr',
        param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: input.limit, preTag: '', postTag: '' } },
    });
    const params = new URLSearchParams({ cb: 'jQuery_news', param: inner });
    const outcome = await client.fetchText(`${EM_STOCK_NEWS_URL}?${params.toString()}`, {
        headers: { referer: EM_SO_REFERER },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const open = outcome.text.indexOf('(');
    const close = outcome.text.lastIndexOf(')');
    if (open < 0 || close <= open) {
        throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财个股新闻不是 JSONP 形态（上游结构可能已变）');
    }
    const body = asRecord(parseJson(outcome.text.slice(open + 1, close), 'eastmoney', '东财个股新闻响应'));
    const result = asRecord(body?.result);
    const articles = result?.cmsArticleWebOld;
    if (!Array.isArray(articles)) {
        throw new SourceError('eastmoney', 'UPSTREAM', `东财个股新闻未返回文章列表（result 键：${Object.keys(result ?? {}).join('/') || '无'}）——通常是上游对该 IP 的间歇风控，隔几分钟或换网络再试，别当成"该股没有新闻"`);
    }
    const items = [];
    for (const raw of articles) {
        const row = asRecord(raw);
        if (!row)
            continue;
        items.push({
            time: clip(row.date),
            title: clip(stripHtml(typeof row.title === 'string' ? row.title : '')),
            content: clip(stripHtml(typeof row.content === 'string' ? row.content : '')),
            media: clip(row.mediaName),
            url: itemUrl(row.url),
        });
    }
    return { source: 'eastmoney', operation: 'stock_news', items: clipItems(items) };
}
// ── 东财研报列表（reportapi）──────────────────────────────────────────────
const EM_REPORT_URL = 'https://reportapi.eastmoney.com/report/list';
const EM_DATA_REFERER = 'https://data.eastmoney.com/';
const EM_PDF_BASE = 'https://pdf.dfcfw.com/pdf/';
/**
 * 研报 PDF 直链由 `infoCode` 派生：`H3_<infoCode>_1.pdf`（`_1` = 第一个附件，个股研报都是
 * `H3` 类）。2026-09-25 实测三个不同年份的 `infoCode` 全部 `HTTP 200` + `application/pdf`、
 * 无需 Referer。
 *
 * 形状不认识就**不给链接**（宁缺勿造）：从上游文本里拼一条可能指向别人文档的 URL，
 * 比让模型说"这条没直链"危险得多。
 */
function emReportPdfUrl(infoCode) {
    return typeof infoCode === 'string' && /^AP\d{6,}$/u.test(infoCode) ? `${EM_PDF_BASE}H3_${infoCode}_1.pdf` : undefined;
}
/**
 * 取个股研报列表。
 *
 * ⚠️ **没有摘要可给**（2026-09-24 实测该接口 51 个字段）：列表只有标题 / 机构 / 研究员 /
 * 日期 / 评级。正文在那份 PDF 里——本机直连只处理文本（`application/pdf` 会被
 * `web_retriever_fetch` 拒），要走 `ocr` 解析（§4.3）。所以本函数把**每条的 PDF 直链**交出去
 * （`pdf_url`），通路才是完整的：没有它，模型手上没有任何稳定 `.pdf` URL，而人设又禁止编链接。
 *
 * 有用的派生信息：每篇研报自带分析师预测 EPS（`predictThisYearEps` / `predictNextYearEps` /
 * `predictNextTwoYearEps`）与对应 PE，以及评级与评级变动（`emRatingName` / `ratingChange`）。
 *
 * ⚠️ 该接口只认**纯 6 位代码**：带 `SH` 前缀会返回 `hits=0`，看起来像"这只票没研报"。
 */
export async function eastmoneyReports(client, input) {
    const params = new URLSearchParams({
        industryCode: '*',
        pageSize: String(input.pageSize),
        industry: '*',
        rating: '*',
        ratingChange: '*',
        beginTime: '2000-01-01',
        endTime: '2030-01-01',
        pageNo: String(input.pageNo),
        fields: '',
        qType: '0',
        orgCode: '',
        code: input.code,
        rcode: '',
        p: String(input.pageNo),
        pageNum: String(input.pageNo),
        pageNumber: String(input.pageNo),
    });
    const outcome = await client.fetchText(`${EM_REPORT_URL}?${params.toString()}`, {
        headers: { referer: EM_DATA_REFERER },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财研报响应'));
    const rows = Array.isArray(body?.data) ? body.data : [];
    const totalPage = typeof body?.TotalPage === 'number' ? body.TotalPage : 1;
    const hits = typeof body?.hits === 'number' ? body.hits : rows.length;
    const items = [];
    for (const raw of rows) {
        const row = asRecord(raw);
        if (!row)
            continue;
        const pdfUrl = emReportPdfUrl(row.infoCode);
        items.push({
            date: typeof row.publishDate === 'string' ? row.publishDate.slice(0, 10) : '',
            title: clip(row.title),
            org: clip(row.orgSName),
            researcher: clip(row.researcher),
            rating: clip(row.emRatingName),
            rating_change: typeof row.ratingChange === 'number' ? row.ratingChange : null,
            // ⚠️ 实测该字段是**字符串**（`'1.0700000000'`，保留精度），不是 number——
            // 早先按 `typeof === 'number'` 判定会让它**恒为 null**（看起来像"这篇研报没有预测"）。
            eps_this_year: toNumber(row.predictThisYearEps),
            eps_next_year: toNumber(row.predictNextYearEps),
            info_code: clip(row.infoCode),
            // 列表把正文的**入口**一并交出来：没有 `pdf_url`，模型手上就没有任何稳定 `.pdf` 直链，
            // 而 `ocr` 这条通路只吃直链或本地文件。
            ...(pdfUrl === undefined ? {} : { pdf_url: pdfUrl }),
            attach_pages: typeof row.attachPages === 'number' && Number.isFinite(row.attachPages) ? row.attachPages : null,
        });
    }
    return {
        source: 'eastmoney',
        operation: 'reports',
        items: clipItems(items),
        ...(totalPage > input.pageNo ? { next_cursor: String(input.pageNo + 1) } : {}),
        note: `东财研报库共 ${hits} 篇；列表不含摘要，正文在各条的 pdf_url（研报 PDF）里，交 ocr 解析（整篇一次算完）`,
    };
}
// ── 新浪研报列表（第二来源）───────────────────────────────────────────────
const SINA_REPORT_URL = 'https://vip.stock.finance.sina.com.cn/q/go.php/vReport_List/kind';
const SINA_REFERER = 'https://finance.sina.com.cn/';
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
export async function sinaReports(transport, input) {
    const params = new URLSearchParams();
    let url;
    if (input.code === undefined) {
        url = `${SINA_REPORT_URL}/lastest/index.phtml`;
        params.set('p', String(input.page));
    }
    else {
        url = `${SINA_REPORT_URL}/search/index.phtml`;
        // 科创板/创业板等必须显式带交易所前缀，否则上游返回假空页（见上文实测第 2 条）。
        params.set('symbol', sinaSymbol(input.code));
        params.set('t1', 'all');
        params.set('p', String(input.page));
    }
    const outcome = await transport.request({ url: `${url}?${params.toString()}`, headers: { referer: SINA_REFERER }, encoding: 'gbk' }, input.signal);
    const text = outcome.text;
    const emptyPage = text.includes('没有找到相关内容');
    const numbered = (text.match(/<tr>\s*<td>\d+<\/td>/gu) ?? []).length;
    const rowPattern = /<tr>\s*<td>\d+<\/td>\s*<td class="tal f14">\s*<a[^>]*?title="([^"]*)"[^>]*?href="([^"]*?\/rptid\/(\d+)\/[^"]*)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gu;
    const items = [];
    for (const match of text.matchAll(rowPattern)) {
        const href = match[2];
        // 页面偶尔给协议相对链接（`//host/...`）：补成 https 后走同一份链接口径。
        const url = itemUrl(href.startsWith('//') ? `https:${href}` : href);
        items.push({
            // ⚠️ 列顺序按**页面表头**实测为准：序号 / 标题 / **报告类型** / **发布日期** / 机构 / 研究员。
            // 即第 4 列是类型、第 5 列才是日期。早先按"日期在前"的想当然写反了，
            // 产出 `date:"公司"`、`type:"2026-09-01"` —— 每列都有值、却整行错位，比报错危险。
            date: clip(match[5]),
            title: clip(stripHtml(match[1])),
            type: clip(match[4]),
            org: clip(stripHtml(match[6])),
            researcher: clip(stripHtml(match[7])),
            report_id: match[3],
            url,
        });
    }
    // 结构自检：带序号的行必须全部解析出来，否则是页面结构变了（不是"没有研报"）。
    if (items.length !== numbered) {
        throw new SourceError('sina', 'INVALID_RESPONSE', `新浪研报页有 ${numbered} 行带序号、只解析出 ${items.length} 条（页面行结构可能已变）`);
    }
    if (items.length === 0 && !emptyPage) {
        throw new SourceError('sina', 'INVALID_RESPONSE', '新浪研报页没有研报也没有「没有找到相关内容」提示（页面结构可能已变）');
    }
    return {
        source: 'sina',
        operation: input.code === undefined ? 'latest' : 'by_stock',
        items: clipItems(items),
        ...(items.length === 0 ? { note: '上游明确返回「没有找到相关内容」：该标的近期无研报，或已翻过末页' } : {}),
    };
}
/**
 * 新浪研报的 symbol 参数：一律带交易所前缀（实测缺前缀会让科创板返回假空页）。
 *
 * ⚠️ 顺序要紧：`92xxxx`（北交所**新号段**，如 832982→920982）以 9 开头，若先判 `9 → sh`
 * 就会被发到上交所并拿到假空页。所以北交所号段（43/83/87/920）必须先判，
 * 只有 `900xxx`（沪市 B 股）才归 sh。
 */
export function sinaSymbol(code) {
    if (/^(920|43|83|87)/u.test(code))
        return `bj${code}`;
    if (/^(6|9)/u.test(code))
        return `sh${code}`;
    if (/^(0|2|3)/u.test(code))
        return `sz${code}`;
    if (/^4/u.test(code))
        return `bj${code}`;
    return code;
}
// ── 同花顺机构一致预期 EPS（basic.10jqka.com.cn）─────────────────────────
const THS_EPS_URL = 'https://basic.10jqka.com.cn/new';
const THS_REFERER = 'https://basic.10jqka.com.cn/';
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
export async function thsEpsForecast(transport, input) {
    const outcome = await transport.request({ url: `${THS_EPS_URL}/${input.code}/worth.html`, headers: { referer: THS_REFERER }, encoding: 'gbk' }, input.signal);
    const html = outcome.text;
    // 认表头而不是认位置：页面里有 30+ 张表，只有这张的列里有「每股收益 / EPS、均值 / mean」。
    // 同时接受中英两种表头写法——真实页面是中文，但按"结构"而不是"某一个字面词"识别更耐改版。
    const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gu)]
        .find((match) => /每股收益|EPS|每股收益\(元\)/iu.test(match[0]) && /均值|mean/iu.test(match[0]));
    if (table === undefined) {
        throw new SourceError('ths', 'INVALID_RESPONSE', '同花顺页面里没有含「每股收益 / 均值」列的表格（页面结构可能已变）');
    }
    const items = [];
    for (const rowMatch of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gu)) {
        const cells = [...rowMatch[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gu)]
            .map((cell) => stripHtml(cell[1]).replace(/\s+/gu, ' ').trim());
        const year = cells[0] ?? '';
        if (!/^\d{4}$/u.test(year))
            continue;
        const num = (value) => {
            const parsed = Number(value);
            return value === undefined || value === '' || !Number.isFinite(parsed) ? null : parsed;
        };
        items.push({
            year,
            institutions: num(cells[1]),
            eps_min: num(cells[2]),
            // 「均值」就是机构一致预期 EPS —— 这是本工具的核心产出。
            eps_mean: num(cells[3]),
            eps_max: num(cells[4]),
            industry_average: num(cells[5]),
        });
    }
    if (items.length === 0) {
        throw new SourceError('ths', 'INVALID_RESPONSE', '同花顺一致预期表没有解析出任何年度行（页面结构可能已变）');
    }
    const institutionCount = /共有\s*<strong>(\d+)<\/strong>\s*家机构/u.exec(html);
    return {
        source: 'ths',
        operation: 'eps_forecast',
        items: clipItems(items),
        note: `${institutionCount === null ? '' : `页面摘要：${institutionCount[1]} 家机构作出预测；`}eps_mean 即机构一致预期 EPS；预测机构数偏少（<3）时一致预期参考价值有限——请把 institutions 一并向用户披露`,
    };
}
