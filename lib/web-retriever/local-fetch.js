/**
 * SSRF-gated local HTTP fetcher used after AnySearch extraction fails.
 *
 * Known limitation: DNS is resolved before each request, but the resolved IP is
 * not pinned into the subsequent HTTP connection. A DNS rebinding window remains
 * between validation and connect. Closing that window would require a custom
 * dispatcher; this module keeps the same explicit trade-off as dsh-search-first.
 */
import { htmlToMarkdown, stripInvisibleText } from './html-markdown.js';
export const LOCAL_FETCH_CLIENT_VERSION = '2.2.0';
export const LOCAL_FETCH_MAX_URL_LENGTH = 2048;
export class LocalFetchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'LocalFetchError';
    }
}
class OperationAborted extends Error {
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPT_HEADER = 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8';
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function parseIpv4(address) {
    const parts = address.split('.');
    if (parts.length !== 4)
        return null;
    const values = parts.map((part) => {
        if (!/^\d{1,3}$/u.test(part))
            return -1;
        const value = Number(part);
        return value >= 0 && value <= 255 ? value : -1;
    });
    return values.some((value) => value < 0) ? null : values;
}
function parseIpv6(address) {
    let input = address.toLowerCase();
    if (input.includes('%'))
        return null;
    if (input.includes('.')) {
        const separator = input.lastIndexOf(':');
        if (separator < 0)
            return null;
        const ipv4 = parseIpv4(input.slice(separator + 1));
        if (ipv4 === null)
            return null;
        const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
        const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
        input = `${input.slice(0, separator)}:${high}:${low}`;
    }
    const compression = input.indexOf('::');
    if (compression !== -1 && input.indexOf('::', compression + 2) !== -1)
        return null;
    const parseGroups = (part) => {
        if (part === '')
            return [];
        const groups = part.split(':');
        if (groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group)))
            return [];
        return groups.map((group) => Number.parseInt(group, 16));
    };
    if (compression === -1) {
        const groups = parseGroups(input);
        return groups.length === 8 ? groups : null;
    }
    const left = parseGroups(input.slice(0, compression));
    const right = parseGroups(input.slice(compression + 2));
    if (left.length + right.length >= 8)
        return null;
    return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
}
function isPrivateIpv4(address) {
    const [first, second, third] = address;
    // 100.64/10 覆盖 100.64.0.0 ~ 100.127.255.255，因此阿里云元数据端点
    // 100.100.100.200 已被 `first===100 && second>=64 && second<=127` 这条挡住。
    return first === 0
        || first === 10
        || first === 127
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 0 && third === 0)
        || (first === 192 && second === 0 && third === 2)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || (first === 198 && second === 51 && third === 100)
        || (first === 203 && second === 0 && third === 113)
        || first >= 224;
}
/** 两个 16 位组 → 点分 IPv4（用于 6to4 / Teredo 内嵌地址解出）。 */
function groupsToIpv4(high, low) {
    return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}
/** Return true only for an address safe to use as a public outbound target. */
export function isPublicIp(address) {
    const ipv4 = parseIpv4(address);
    if (ipv4 !== null)
        return !isPrivateIpv4(ipv4);
    const groups = parseIpv6(address);
    if (groups === null)
        return false;
    if (groups.every((group) => group === 0))
        return false;
    if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1)
        return false;
    const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
    if (isMappedIpv4)
        return !isPrivateIpv4(groupsToIpv4(groups[6], groups[7]));
    // 6to4（2002::/16）把 IPv4 明文嵌在第 2、3 组：`2002:7f00:0001::` 即 127.0.0.1。
    if (groups[0] === 0x2002)
        return !isPrivateIpv4(groupsToIpv4(groups[1], groups[2]));
    // Teredo（2001:0000::/32）的客户端 IPv4 在第 7、8 组按位取反存储（服务端 IPv4 在第 3、4 组，
    // 一并校验）：解出内嵌 v4 后递归判定，否则 `2001::` 前缀会绕过整张私网 v4 表。
    if (groups[0] === 0x2001 && groups[1] === 0x0000) {
        const client = groupsToIpv4(~groups[6] & 0xffff, ~groups[7] & 0xffff);
        const server = groupsToIpv4(groups[2], groups[3]);
        return !isPrivateIpv4(client) && !isPrivateIpv4(server);
    }
    const first = groups[0];
    if ((first & 0xfe00) === 0xfc00)
        return false;
    if ((first & 0xffc0) === 0xfe80)
        return false;
    if ((first & 0xff00) === 0xff00)
        return false;
    return true;
}
function hostnameOf(url) {
    return url.hostname.startsWith('[') && url.hostname.endsWith(']')
        ? url.hostname.slice(1, -1)
        : url.hostname;
}
function isIpLiteral(hostname) {
    return parseIpv4(hostname) !== null || parseIpv6(hostname) !== null;
}
function validateUrl(input) {
    if (typeof input !== 'string' || input.length > LOCAL_FETCH_MAX_URL_LENGTH) {
        throw new LocalFetchError('INVALID_URL', `URL must be at most ${LOCAL_FETCH_MAX_URL_LENGTH} characters`);
    }
    let url;
    try {
        url = new URL(input);
    }
    catch {
        throw new LocalFetchError('INVALID_URL', 'invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new LocalFetchError('INVALID_URL', 'URL must use http or https');
    }
    if (url.username || url.password) {
        throw new LocalFetchError('INVALID_URL', 'URL credentials are not allowed');
    }
    return url;
}
/** 可展示链接的形态：字面 http(s) 开头，且整串不含空白与控制符。 */
const HYPERLINK_PATTERN = /^https?:\/\/[^\s\u0000-\u001F\u007F-\u009F]+$/u;
/**
 * 上游返回的 URL 字段（搜索结果的 `url`、各来源条目的 `url`）会**变成用户可点击的
 * markdown 链接**（docs/dev/web-retriever.md §4 回传引用格式），所以这里按"要展示"的口径再收一道；
 * `validateUrl` 是"要请求"的口径，抛错语义不适合逐条字段。
 * 返回 `''` 表示这个值不配成为链接，调用方据此**丢字段**（不是丢条目）：
 * - 非 http(s) 协议：`javascript:` / `data:` 点下去就是执行；
 * - 含空白或控制符：换行能把后半截甩出链接语法，变成正文里的新内容；
 * - 带凭据：`https://sseinfo.com.cn@evil.example/` 显示的是官方域名、跳的是别的站；
 * - 超长串：不是链接该占的体积（条目的输出预算见 `tools.ts` 的 `SOURCE_OUTPUT_BUDGET_CHARS`）。
 * 返回**剥完不可见字符的原串**而不是 `url.toString()`：后者会把非 ASCII 路径按
 * percent-encoding 展开（中文 URL 一字 9 字符），模型引用时白白吃掉预算。
 */
export function safeUrl(value, maxChars = LOCAL_FETCH_MAX_URL_LENGTH) {
    if (typeof value !== 'string')
        return '';
    const raw = stripInvisibleText(value.trim());
    if (raw === '' || raw.length > maxChars || !HYPERLINK_PATTERN.test(raw))
        return '';
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return '';
    }
    if (url.username !== '' || url.password !== '')
        return '';
    return raw;
}
function getDns() {
    const processLike = globalThis.process;
    return processLike?.getBuiltinModule?.('node:dns/promises');
}
function waitForAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(new OperationAborted());
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(new OperationAborted());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(value);
        }, (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        });
    });
}
async function defaultResolveAddresses(hostname, signal) {
    const dns = getDns();
    if (!dns || typeof dns.lookup !== 'function') {
        throw new LocalFetchError('DNS', 'DNS resolver is unavailable');
    }
    try {
        return await waitForAbort(dns.lookup(hostname, { all: true, order: 'verbatim' }), signal);
    }
    catch (error) {
        if (error instanceof OperationAborted)
            throw error;
        throw new LocalFetchError('DNS', `DNS lookup failed for ${hostname}: ${errorText(error)}`);
    }
}
async function assertAllowedHost(url, options, signal) {
    if (signal.aborted)
        throw new OperationAborted();
    const hostname = hostnameOf(url);
    if (isIpLiteral(hostname)) {
        if (!options.allowPrivate && !isPublicIp(hostname)) {
            throw new LocalFetchError('BLOCKED_URL', `private or reserved IP is not allowed: ${hostname}`);
        }
        return;
    }
    const resolve = options.resolveAddresses ?? defaultResolveAddresses;
    let addresses;
    try {
        addresses = await waitForAbort(resolve(hostname, signal), signal);
    }
    catch (error) {
        if (error instanceof OperationAborted)
            throw error;
        if (error instanceof LocalFetchError)
            throw error;
        throw new LocalFetchError('DNS', `DNS lookup failed for ${hostname}: ${errorText(error)}`);
    }
    if (addresses.length === 0)
        throw new LocalFetchError('DNS', `DNS lookup returned no addresses for ${hostname}`);
    if (!options.allowPrivate && addresses.some(({ address }) => !isPublicIp(address))) {
        throw new LocalFetchError('BLOCKED_URL', `DNS result for ${hostname} contains a private or reserved address`);
    }
}
function contentType(response) {
    const header = response.headers.get('content-type') ?? '';
    const [rawMime] = header.split(';', 1);
    const mime = rawMime.trim().toLowerCase();
    const charsetMatch = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/iu.exec(header);
    return { mime, charset: charsetMatch?.[1] ?? charsetMatch?.[2] };
}
function isSupportedContentType(mime) {
    return mime.startsWith('text/')
        || mime === 'application/xhtml+xml'
        || mime === 'application/xml'
        || isJsonMime(mime)
        || mime.endsWith('+xml');
}
/**
 * 兼容性放行：把 JSON 当成 `text/javascript` 风格的 MIME 也算 JSON。
 *
 * 为什么需要它：2026-09-24 实测 `sns.sseinfo.com/allcompany.do`（上证e互动公司列表）返回
 * `json/javascript;charset=UTF-8`，正文是标准 JSON。严格按 `application/json` 判定会把
 * 一个**正常的 JSON 接口**判成 `UNSUPPORTED_CONTENT_TYPE`——本仓此前只见过
 * `application/json` / `+json`，所以这条是接入该来源时才暴露的。安全性不受影响：
 * 正文仍要 `JSON.parse` 通过，解析失败照旧报错，只是不再因为 MIME 拼法而误拒。
 */
function isJsonMime(mime) {
    return mime === 'application/json'
        || mime.endsWith('+json')
        || mime === 'json/javascript'
        || mime === 'application/javascript'
        || mime === 'text/javascript';
}
/**
 * 响应头**完全缺失** Content-Type 时的保守嗅探。
 *
 * 为什么需要它：实测 `https://www.cls.cn/detail/2188659` 的 GET 响应**不带任何
 * Content-Type**（同一 URL 的 HEAD 却带 `text/html`），而正文是完好的 SSR HTML。
 * 原实现"缺头即拒"会把这类站点误判成 `UNSUPPORTED_CONTENT_TYPE`。
 *
 * 边界（有意保守）：只在**缺头**时启用；头存在但不支持的类型（如 `application/pdf`）
 * 仍然照旧拒绝，不放宽既有内容类型闸门。判定只认正文开头的明确标记，认不出就维持失败。
 */
function sniffMissingContentType(text) {
    const head = text.slice(0, 512).replace(/^\uFEFF/u, '').trimStart().toLowerCase();
    if (/^(?:<!doctype|<html|<\?xml|<!--|<[a-z][a-z0-9-]*(?:\s|\/|>))/u.test(head))
        return 'html';
    if (head.startsWith('{') || head.startsWith('['))
        return 'json';
    return undefined;
}
function createDecoder(charset) {
    try {
        return new TextDecoder(charset || 'utf-8');
    }
    catch {
        throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', `unsupported charset: ${charset ?? '(default)'}`);
    }
}
async function readBody(response, charset, maxBytes, maxContentChars, signal) {
    const decoder = createDecoder(charset);
    const chunks = [];
    let totalBytes = 0;
    let byteTruncated = false;
    const consume = (chunk) => {
        const remaining = Math.max(0, maxBytes - totalBytes);
        if (chunk.byteLength > remaining) {
            if (remaining > 0)
                chunks.push(decoder.decode(chunk.slice(0, remaining), { stream: true }));
            totalBytes = maxBytes;
            byteTruncated = true;
            return;
        }
        totalBytes += chunk.byteLength;
        chunks.push(decoder.decode(chunk, { stream: true }));
    };
    const body = response.body;
    if (body !== null) {
        const reader = body.getReader();
        try {
            while (true) {
                if (signal.aborted)
                    throw new OperationAborted();
                const item = await waitForAbort(reader.read(), signal);
                if (item.done)
                    break;
                consume(item.value);
                if (byteTruncated) {
                    try {
                        await reader.cancel();
                    }
                    catch {
                        // The byte limit has already been enforced; a cancellation failure is harmless.
                    }
                    break;
                }
            }
        }
        finally {
            reader.releaseLock?.();
        }
    }
    else if (typeof response.text === 'function') {
        const text = await waitForAbort(response.text(), signal);
        consume(new TextEncoder().encode(text));
    }
    const decoded = byteTruncated ? chunks.join('') : chunks.join('') + decoder.decode();
    const charTruncated = decoded.length > maxContentChars;
    return {
        text: charTruncated ? decoded.slice(0, maxContentChars) : decoded,
        byteTruncated,
        charTruncated,
    };
}
export function createHttpRequester(options) {
    async function requestOnce(input, callerSignal) {
        if (callerSignal?.aborted)
            throw new LocalFetchError('ABORTED', 'request aborted');
        const controller = new AbortController();
        let timedOut = false;
        const onCallerAbort = () => controller.abort();
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, options.timeoutMs);
        try {
            let current = validateUrl(input.url);
            let redirects = 0;
            while (true) {
                if (callerSignal?.aborted)
                    throw new LocalFetchError('ABORTED', 'request aborted');
                if (controller.signal.aborted)
                    throw new OperationAborted();
                await assertAllowedHost(current, options, controller.signal);
                if (callerSignal?.aborted)
                    throw new LocalFetchError('ABORTED', 'request aborted');
                let response;
                try {
                    response = await waitForAbort(globalThis.fetch(current.toString(), {
                        method: input.method ?? 'GET',
                        redirect: 'manual',
                        headers: {
                            'user-agent': options.userAgent,
                            accept: input.accept ?? ACCEPT_HEADER,
                            ...(input.body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
                            ...(input.headers ?? {}),
                        },
                        ...(input.body === undefined ? {} : { body: input.body }),
                        signal: controller.signal,
                    }), controller.signal);
                }
                catch (error) {
                    if (error instanceof OperationAborted)
                        throw error;
                    throw new LocalFetchError('HTTP', `local fetch failed: ${errorText(error)}`);
                }
                if (REDIRECT_STATUSES.has(response.status)) {
                    if (redirects >= options.maxRedirects) {
                        throw new LocalFetchError('REDIRECT', `redirect limit exceeded (${options.maxRedirects})`);
                    }
                    const location = response.headers.get('location');
                    if (!location)
                        throw new LocalFetchError('REDIRECT', 'redirect response has no Location header');
                    try {
                        current = validateUrl(new URL(location, current).toString());
                    }
                    catch (error) {
                        if (error instanceof LocalFetchError && error.code === 'INVALID_URL') {
                            throw new LocalFetchError('REDIRECT', `invalid redirect target: ${error.message}`);
                        }
                        throw new LocalFetchError('REDIRECT', `invalid redirect target: ${errorText(error)}`);
                    }
                    redirects += 1;
                    continue;
                }
                if (response.status >= 400) {
                    throw new LocalFetchError('HTTP', `local fetch returned HTTP ${response.status}`);
                }
                const type = contentType(response);
                // 缺头（mime 为空）不当场拒绝：正文读进来嗅探后再判。头存在但不支持的类型
                // 仍然在读正文前直接拒绝（保持既有闸门与快速失败）。
                const missingContentType = type.mime === '';
                if (!missingContentType && !isSupportedContentType(type.mime)) {
                    throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', `unsupported content type: ${type.mime}`);
                }
                const body = await readBody(response, 
                // 工具内部的显式声明优先于响应头：实测存在"头不带 charset 但正文是 GBK"的站点
                // （`basic.10jqka.com.cn`），按 UTF-8 解会整页变成替换字符（见 `HttpRequest.encoding`）。
                input.encoding ?? type.charset, options.maxBytes, options.maxContentChars, controller.signal);
                if (missingContentType && sniffMissingContentType(body.text) === undefined) {
                    throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', 'unsupported content type: (missing)');
                }
                return {
                    url: current.toString(),
                    status: response.status,
                    text: body.text,
                    truncated: body.byteTruncated || body.charTruncated,
                };
            }
        }
        catch (error) {
            if (error instanceof OperationAborted) {
                if (callerSignal?.aborted)
                    throw new LocalFetchError('ABORTED', 'request aborted');
                if (timedOut)
                    throw new LocalFetchError('TIMEOUT', 'local fetch timed out');
                throw new LocalFetchError('ABORTED', 'request aborted');
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener('abort', onCallerAbort);
        }
    }
    return { request: requestOnce };
}
/**
 * 回退链用的抓取器：GET 取回后按内容类型决定**呈现**（JSON 原文直通、HTML 转 markdown）。
 *
 * 出口校验 / 重定向 / 上限 / 取消语义全部委托给 {@link createHttpRequester}——
 * 这里只保留"如何呈现正文"这一层，避免同一套闸门出现第二份实现（见 `HttpRequest` 注释）。
 */
export function createLocalFetcher(options) {
    const requester = createHttpRequester(options);
    async function fetchLocal(input, callerSignal) {
        // accept 头由 requester 统一设置（与既有断言一致：HTML/文本优先、JSON 兜底）。
        const outcome = await requester.request({ url: input }, callerSignal);
        const head = outcome.text.slice(0, 512).replace(/^\uFEFF/u, '').trimStart().toLowerCase();
        const looksHtml = /^(?:<!doctype|<html|<\?xml|<!--|<[a-z][a-z0-9-]*(?:\s|\/|>))/u.test(head);
        // JSON 必须**原文直通**，不得走 markdown 化。
        //
        // 2026-09 实测缺陷：此前所有正文一律交给 htmlToMarkdown，而转义器会把 JSON 改坏——
        // 数组括号变 `\[ ... \]`（`JSON.parse` 不再成立）、字段名 `content_text` 变
        // `content\_text`（按字段名读取不可靠）、`<script>` 内容被当标签删掉（数据丢失）。
        // 内容类型闸门与 skill 都向模型承诺支持 JSON，此前的行为是"承诺收下、交付却改坏"。
        //
        // ⚠️ 呈现判据**只看正文**，不看响应头：requester 已按内容类型闸门决定"收不收"，
        // 而实测存在响应头与正文不一致的站点（`sniffMissingContentType` 的注释记着
        // cls.cn 详情页的实测案例），与其再信一次头，不如直接认正文。
        // JSON 原样返回：用**正文**判据而不是响应头——实测 `json/javascript` 这类 MIME
        // 在严格 `application/json` 判定下不算 JSON（见 `isJsonMime` 的记录），
        // 且 JSON 正文必然以 `{` / `[` 开头，判定是确定的。
        const looksJson = head.startsWith('{') || head.startsWith('[');
        if (looksJson || !looksHtml) {
            return {
                url: outcome.url,
                status: outcome.status,
                markdown: outcome.text,
                truncated: outcome.truncated,
            };
        }
        const rendered = htmlToMarkdown(outcome.text, options.maxContentChars);
        return {
            url: outcome.url,
            status: outcome.status,
            ...(rendered.title !== undefined ? { title: rendered.title } : {}),
            markdown: rendered.markdown,
            truncated: outcome.truncated || rendered.truncated || rendered.omitted,
        };
    }
    return { fetch: fetchLocal };
}
