/**
 * SSRF-gated local HTTP fetcher, used after AnySearch extraction fails.
 * Known limit: DNS resolves per request but the IP is not pinned to the connection,
 * so a rebinding window remains (same trade-off as dsh-search-first).
 */
import { htmlToMarkdown, stripInvisibleText } from './html-markdown.js';
export const LOCAL_FETCH_CLIENT_VERSION = '2.14.1';
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
    // 100.64/10 also covers 100.100.100.200 (cloud metadata endpoint).
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
/** Two 16-bit groups -> dotted IPv4 (for 6to4 / Teredo embedded addresses). */
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
    // 6to4 (2002::/16) embeds IPv4 in groups 2-3; Teredo (2001:0::/32) in groups
    // 7-8 bitwise-negated, plus server IPv4 in 3-4 — decode, or the prefix bypasses
    // the private v4 table.
    if (groups[0] === 0x2002)
        return !isPrivateIpv4(groupsToIpv4(groups[1], groups[2]));
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
/** Display form of a link: literal http(s), no whitespace or control chars. */
const HYPERLINK_PATTERN = /^https?:\/\/[^\s\u0000-\u001F\u007F-\u009F]+$/u;
/**
 * Upstream URLs become clickable markdown, so: http(s) only (javascript:/data: execute),
 * no whitespace/control chars (newlines escape the link), no credentials (displayed host
 * != target), length cap. Raw string, not `href`, to avoid percent-encoding non-ASCII;
 * `''` means drop the field, never the item.
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
/**
 * Gate for a URL fetched by someone else (ocr url form): same shape + public-host
 * check, no request. `allowPrivate` is always false — that risk is not ours to waive.
 * Returns the raw string (href would percent-encode non-ASCII and eat budget).
 */
export async function assertPublicUrlTarget(value, signal, resolveAddresses) {
    const display = safeUrl(value);
    if (display === '')
        throw new LocalFetchError('BLOCKED_URL', 'url must be a plain http(s) URL without credentials or whitespace');
    await assertAllowedHost(validateUrl(display), { allowPrivate: false, resolveAddresses }, signal);
    return display;
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
 * Accept javascript-style MIME spellings: sseinfo returns `json/javascript`.
 * Safe because the body must still pass JSON.parse.
 */
function isJsonMime(mime) {
    return mime === 'application/json'
        || mime.endsWith('+json')
        || mime === 'json/javascript'
        || mime === 'application/javascript'
        || mime === 'text/javascript';
}
/**
 * Conservative sniff used only when Content-Type is entirely missing (some hosts
 * serve HTML without it); a present-but-unsupported type is still rejected.
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
/** Error-body excerpt cap: enough to name the cause, not a second content channel. */
const ERROR_DETAIL_MAX_CHARS = 180;
/**
 * Surface the upstream reason (e.g. HTTP 400 + `{"code":10004,...}`) in the error;
 * read failures are swallowed so the original failure is never lost.
 */
async function errorDetail(response, signal) {
    try {
        const body = await readBody(response, undefined, 1_024, ERROR_DETAIL_MAX_CHARS, signal);
        const text = body.text.replace(/[\r\n\t]+/gu, ' ').trim();
        return text.length === 0 ? '' : `：${text}`;
    }
    catch {
        return '';
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
                            ...(typeof input.body === 'string' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
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
                    throw new LocalFetchError('HTTP', `local fetch returned HTTP ${response.status}${await errorDetail(response, controller.signal)}`);
                }
                const type = contentType(response);
                // Missing Content-Type is deferred to body sniffing; a present unsupported
                // type still fails before reading the body.
                const missingContentType = type.mime === '';
                if (!missingContentType && !isSupportedContentType(type.mime)) {
                    throw new LocalFetchError('UNSUPPORTED_CONTENT_TYPE', `unsupported content type: ${type.mime}`);
                }
                const body = await readBody(response, 
                // Source-declared encoding wins: some hosts omit charset but serve GBK.
                input.encoding ?? type.charset, input.maxBytes ?? options.maxBytes, input.maxContentChars ?? options.maxContentChars, controller.signal);
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
 * Fallback fetcher: GET, then choose presentation (JSON raw, HTML -> markdown).
 * Egress, redirects, limits and cancellation all delegate to `createHttpRequester`.
 */
export function createLocalFetcher(options) {
    const requester = createHttpRequester(options);
    async function fetchLocal(input, callerSignal) {
        // The accept header is set centrally by the requester (HTML/text first, JSON last).
        const outcome = await requester.request({ url: input }, callerSignal);
        const head = outcome.text.slice(0, 512).replace(/^\uFEFF/u, '').trimStart().toLowerCase();
        const looksHtml = /^(?:<!doctype|<html|<\?xml|<!--|<[a-z][a-z0-9-]*(?:\s|\/|>))/u.test(head);
        // JSON must pass through raw: the turndown converter escapes brackets, field
        // names and drops script-like content, corrupting it. Judge by the body, not
        // the header (some hosts send mismatched or javascript-ish MIME types).
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
