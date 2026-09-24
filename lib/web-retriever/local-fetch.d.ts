/**
 * SSRF-gated local HTTP fetcher used after AnySearch extraction fails.
 *
 * Known limitation: DNS is resolved before each request, but the resolved IP is
 * not pinned into the subsequent HTTP connection. A DNS rebinding window remains
 * between validation and connect. Closing that window would require a custom
 * dispatcher; this module keeps the same explicit trade-off as dsh-search-first.
 */
export declare const LOCAL_FETCH_CLIENT_VERSION = "2.2.0";
export declare const LOCAL_FETCH_MAX_URL_LENGTH = 2048;
export type LocalFetchErrorCode = 'ABORTED' | 'TIMEOUT' | 'INVALID_URL' | 'BLOCKED_URL' | 'DNS' | 'REDIRECT' | 'HTTP' | 'TOO_LARGE' | 'UNSUPPORTED_CONTENT_TYPE';
export declare class LocalFetchError extends Error {
    readonly code: LocalFetchErrorCode;
    constructor(code: LocalFetchErrorCode, message: string);
}
export interface LocalFetchOptions {
    timeoutMs: number;
    maxBytes: number;
    maxContentChars: number;
    maxRedirects: number;
    userAgent: string;
    allowPrivate?: boolean;
    resolveAddresses?: (hostname: string, signal: AbortSignal) => Promise<Array<{
        address: string;
        family: number;
    }>>;
}
export interface LocalFetchOutcome {
    url: string;
    status: number;
    title?: string;
    markdown: string;
    truncated: boolean;
}
/** Return true only for an address safe to use as a public outbound target. */
export declare function isPublicIp(address: string): boolean;
/**
 * 请求描述符：`createLocalFetcher`（GET+markdown 化，回退链用）与来源工具
 * （`src/web-retriever/sources.ts`，硬编码主机的 JSON/HTML 接口）共用同一个出口校验。
 *
 * 为什么共用而不是各写一份：出口校验（URL 合法性 + DNS 公网 IP 闸门 + 手动重定向重校验 +
 * 大小/超时上限）一旦有第二份实现，两份就会各自漂移，而**安全闸门漂移不会报错**——
 * 本仓在"同一个便利能力接在多个入口、只覆盖接好的那个"上已经踩过两次（AGENTS.md §9.7）。
 */
export interface HttpRequest {
    url: string;
    method?: 'GET' | 'POST';
    /** 额外请求头（如上证e互动要求 `Referer`）。仅由来源配方内部提供，不接受模型入参。 */
    headers?: Record<string, string>;
    /** POST 用的表单串；省略即空 body（互动易第二步要求 POST 但 body 为空）。 */
    body?: string;
    /** 覆盖本次请求的 accept 头；省略用默认。 */
    accept?: string;
    /**
     * 正文编码。省略时用响应头声明的 charset，缺省 UTF-8。
     *
     * 为什么需要**工具内部**的显式声明：2026-09-24 实测 `basic.10jqka.com.cn` 声明
     * `content-type: text/html`（**不带 charset**）而正文是 **GBK**——按 UTF-8 解会产出 11,800 个
     * U+FFFD 替换字符，中文全部不可读、正则全部失配（`gbk` 解码后 0 个替换字符）。
     * ⚠️ 这个字段**绝不能暴露成模型入参**：配错编码只会静默产出乱码，属"看起来成功"的坏形态。
     * 与 `headers` 一样，只由来源实现按硬编码知识填写。
     */
    encoding?: string;
}
export interface HttpOutcome {
    url: string;
    status: number;
    /** 正文原文，**不做任何转换**（JSON 原文直通、HTML 原样返回，由工具自己决定如何呈现）。 */
    text: string;
    truncated: boolean;
}
export declare function createHttpRequester(options: LocalFetchOptions): {
    request(request: HttpRequest, signal?: AbortSignal): Promise<HttpOutcome>;
};
/**
 * 回退链用的抓取器：GET 取回后按内容类型决定**呈现**（JSON 原文直通、HTML 转 markdown）。
 *
 * 出口校验 / 重定向 / 上限 / 取消语义全部委托给 {@link createHttpRequester}——
 * 这里只保留"如何呈现正文"这一层，避免同一套闸门出现第二份实现（见 `HttpRequest` 注释）。
 */
export declare function createLocalFetcher(options: LocalFetchOptions): {
    fetch(url: string, signal?: AbortSignal): Promise<LocalFetchOutcome>;
};
