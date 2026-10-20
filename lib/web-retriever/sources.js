/**
 * Named sources: source + business params -> ordered, pageable, reproducible rows.
 * Each stays a concrete implementation (no recipe registry); all egress goes
 * through `createHttpRequester` (SSRF/DNS/redirect/size guards, AGENTS.md §9.7).
 */
import { createHttpRequester, safeUrl } from './local-fetch.js';
import { stripInvisibleText } from './html-markdown.js';
export const SOURCE_IDS = ['cls', 'wscn', 'cninfo_irm', 'sseinfo', 'eastmoney', 'ths', 'sina'];
/** Per-item text cap; item count is capped separately by each tool's limit. */
export const MAX_ITEM_CHARS = 1200;
/** Max items per output (must match the tool schema maximum). */
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
/** Built per source-tool call; lazy transport, configured timeout. */
export function createSourceTransport(options) {
    return createHttpRequester({ ...options, timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS });
}
/**
 * Eastmoney shares the other sources' egress gate; throttling stays process-wide.
 * Coded `LocalFetchError`s pass through unwrapped so ABORTED is not downgraded.
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
/** Link cap: a link is a reference, not the bulk of the output budget. */
const ITEM_URL_MAX_CHARS = 500;
function clip(text) {
    if (typeof text !== 'string')
        return '';
    // Same as fetched body: strip invisibles, then clip.
    const trimmed = stripInvisibleText(text).trim();
    return trimmed.length > MAX_ITEM_CHARS ? `${trimmed.slice(0, MAX_ITEM_CHARS)}…` : trimmed;
}
/** Drop the field (not the item) for non-http(s), control chars, credentials or length. */
function itemUrl(value) {
    return safeUrl(value, ITEM_URL_MAX_CHARS);
}
// Decode entities before stripping tags, then strip until stable: the reverse order
// turns escaped `<system>` text into live tags (prompt injection surface).
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
/** Upstream numbers may be strings (precision); parse by value, unknown => null. */
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
const CLS_URL = 'https://www.cls.cn/v1/roll/get_roll_list';
const CLS_REFERER = 'https://www.cls.cn/';
/** Local sign `md5(sha1(query sorted by key))`; no API key, so the model passes params, never URLs. */
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
        // Promos/ads are not telegraphs; keep them out of evidence.
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
            // score is wscn's importance (observed 1-3, higher = more important).
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
const IRM_KEYWORD_URL = 'https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo';
const IRM_QUESTION_URL = 'https://irm.cninfo.com.cn/newircs/company/question';
function formBody(fields) {
    return new URLSearchParams(fields).toString();
}
/**
 * Two steps: `keyWord=code` -> `secid` (orgId) -> questions; step two must be POST
 * (GET on the same URL returns 405). Shenzhen only; SSE questions via `sseinfo_qa`.
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
            // Empty answer and "not answered yet" are different facts.
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
const SSE_BASE = 'https://sns.sseinfo.com';
const SSE_REFERER = `${SSE_BASE}/`;
const SSE_KIND = { answered: 11, questions: 10 };
/** Fixed sentence returned past the last company-list page. */
const SSE_COMPANY_END = '没有任何上市公司的信息';
const SSE_EMPTY_NOTE = /class="m_feed_note"[^>]*>[^<]*(暂无|暂时没有)[^<]*</u;
/**
 * Company list page: 32 companies, ascending by code. uid and code come from the same
 * `<a>` element, so cross-item mispairing is structurally impossible (a windowed regex
 * either misses rows or pairs across them).
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
// Code -> uid via doubling + binary search over the ascending list; the caches hold
// page metadata only (no content) and stay size-capped.
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
    // Verify ordering before binary search: parseCompanyList sorts, so this catches
    // duplicate codes (mispairing); fail loudly rather than locate the wrong uid.
    assertAscending(pairs, page);
    if (ssePageCache.size >= SSE_UID_CACHE_LIMIT) {
        // Evict only the oldest entry: clearing all would drop the uid just resolved.
        const oldest = ssePageCache.keys().next().value;
        if (oldest !== undefined)
            ssePageCache.delete(oldest);
    }
    ssePageCache.set(page, pairs);
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
 * One uid lookup = 10-13 serial requests, so no per-request timeout can bound it;
 * `uidLocateBudgetMs` exists only so tests can shorten this.
 */
export const SSE_UID_LOCATE_TIMEOUT_MS = 60_000;
/** Total deadline for a chain of serial requests, combined with caller cancel. */
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
 * Cache layering: pages feed the binary search, the uid cache holds only the resolved
 * code — caching scanned pages there would evict it and turn success into NOT_FOUND.
 */
export async function resolveSseCompanyUid(transport, code, signal) {
    const cached = sseUidCache.get(code);
    if (cached !== undefined)
        return cached;
    let high = 1;
    // Doubling phase: first page whose last code >= target, or an empty page.
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
/** Split Q/A on the reply block class; per-item id markers differ between the two list kinds. */
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
 * Normalize to Beijing "YYYY-MM-DD HH:MM" (never host local time). All three observed
 * forms (X分钟前 / 昨天 HH:MM / absolute) must parse or one row fails the page.
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
    // 「刚刚」has no minute precision: use the current minute; otherwise fail (no guessing).
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
            // Deadline expiry means upstream is slow, not that the caller cancelled:
            // map it to TIMEOUT or the tool layer reports ABORTED.
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
    // Zero rows plus no 「暂无」 note means the page structure changed.
    if (parsed.length === 0 && !SSE_EMPTY_NOTE.test(text)) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', '上证e互动页面既没有问答也没有「暂无」提示（结构可能已变）');
    }
    const notes = [];
    let items = parsed;
    if (input.code !== undefined) {
        // Upstream drift (a page can carry rows for other codes): drop + note, don't fail the call.
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
const EM_724_URL = 'https://np-weblist.eastmoney.com/comm/web/getFastNewsList';
const EM_REFERER = 'https://kuaixun.eastmoney.com/';
/**
 * Independent CLS/WSCN backup; success `code` is the string "1". The server aggregates
 * CLS content, so title dedupe is the caller's job.
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
/** Random string eastmoney asks for; absence would not break correctness. */
function emTraceId() {
    return `${Date.now().toString(16)}-${Math.floor(Math.random() * 1e16).toString(16)}`;
}
const EM_STOCK_NEWS_URL = 'https://search-api-web.eastmoney.com/search/jsonp';
const EM_SO_REFERER = 'https://so.eastmoney.com/';
/**
 * A missing `cmsArticleWebOld` key is intermittent upstream throttling, not "no news"
 * (which is a present-but-empty array); report UPSTREAM on the missing key.
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
const EM_REPORT_URL = 'https://reportapi.eastmoney.com/report/list';
const EM_DATA_REFERER = 'https://data.eastmoney.com/';
const EM_PDF_BASE = 'https://pdf.dfcfw.com/pdf/';
// PDF link = `H3_<infoCode>_1.pdf`; an unknown shape means no link — a fabricated one
// could point at someone else's document.
function emReportPdfUrl(infoCode) {
    return typeof infoCode === 'string' && /^AP\d{6,}$/u.test(infoCode) ? `${EM_PDF_BASE}H3_${infoCode}_1.pdf` : undefined;
}
/**
 * No abstract in the list; the per-item PDF link is the only path to the text (via `ocr`).
 * Only bare 6-digit codes work (a prefixed code returns hits=0); EPS fields are strings.
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
            eps_this_year: toNumber(row.predictThisYearEps),
            eps_next_year: toNumber(row.predictNextYearEps),
            info_code: clip(row.infoCode),
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
const SINA_REPORT_URL = 'https://vip.stock.finance.sina.com.cn/q/go.php/vReport_List/kind';
const SINA_REFERER = 'https://finance.sina.com.cn/';
/**
 * Always add the exchange prefix: bare codes get a fake empty page for STAR/ChiNext.
 * That page is HTTP 200 and looks like "no reports", so also verify the numbered row count.
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
        // Occasionally protocol-relative (`//host/...`): promote to https, one link form.
        const url = itemUrl(href.startsWith('//') ? `https:${href}` : href);
        items.push({
            // Column order from the page header: type is col 4, date is col 5.
            date: clip(match[5]),
            title: clip(stripHtml(match[1])),
            type: clip(match[4]),
            org: clip(stripHtml(match[6])),
            researcher: clip(stripHtml(match[7])),
            report_id: match[3],
            url,
        });
    }
    // Every numbered row must parse; mismatch means the page structure changed.
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
 * Always prefix the exchange; order matters: BJ segments (43/83/87/920) start with 9/4
 * and must be tested before `9 => sh`; only 900xxx is Shanghai B.
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
const THS_EPS_URL = 'https://basic.10jqka.com.cn/new';
const THS_REFERER = 'https://basic.10jqka.com.cn/';
/**
 * The page declares text/html without charset but is GBK, so decode explicitly
 * (`encoding` is source-only, never a model input). Of its 32 tables, pick the one
 * with 每股收益/均值 headers; the mean is the consensus EPS.
 */
export async function thsEpsForecast(transport, input) {
    const outcome = await transport.request({ url: `${THS_EPS_URL}/${input.code}/worth.html`, headers: { referer: THS_REFERER }, encoding: 'gbk' }, input.signal);
    const html = outcome.text;
    // Match by header text, not table position; accept ZH/EN spellings.
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
            // Mean = consensus EPS, the core output.
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
