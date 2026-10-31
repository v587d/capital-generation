/**
 * Wind financial-document client: JSON-RPC 2.0 (MCP wire protocol) over plain
 * HTTP. initialize -> tools/call, no session state, no SDK.
 */
export declare const DEFAULT_WIND_ENDPOINT = "https://mcp.wind.com.cn/vserver_financial_docs/mcp/";
export declare const WIND_REQUEST_TIMEOUT_MS = 60000;
export declare const WIND_MAX_CONTENT_CHARS = 20000;
/**
 * Hosted MCP servers (`server_type` -> URL). `analytics_data` is listed to record
 * that it exists but is unusable (initialize hangs), so no data source uses it.
 */
export declare const WIND_SERVER_ENDPOINTS: {
    readonly stock_data: "https://mcp.wind.com.cn/vserver_stock_data/mcp/";
    readonly fund_data: "https://mcp.wind.com.cn/vserver_fund_data/mcp/";
    readonly index_data: "https://mcp.wind.com.cn/vserver_index_data/mcp/";
    readonly bond_data: "https://mcp.wind.com.cn/vserver_bond_data/mcp/";
    readonly financial_docs: "https://mcp.wind.com.cn/vserver_financial_docs/mcp/";
    readonly economic_data: "https://mcp.wind.com.cn/vserver_economic_data/mcp/";
    readonly analytics_data: "https://mcp.wind.com.cn/vserver_analytics_data/mcp/";
};
export type WindServerType = keyof typeof WIND_SERVER_ENDPOINTS;
/**
 * Error classes drive fallback: AUTH=missing/invalid key; RATE_LIMIT=429;
 * NETWORK=network/5xx/timeout; BACKEND=API/business; INVALID=unparseable.
 */
export type WindErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'BACKEND' | 'INVALID';
export interface WindCallResult {
    ok: boolean;
    /** Parsed JSON result; string fields clipped to WIND_MAX_CONTENT_CHARS. */
    data?: unknown;
    /** Non-JSON body passed through (<= WIND_MAX_CONTENT_CHARS). */
    content?: string;
    content_chars?: number;
    error?: string;
    code?: WindErrorCode;
}
/** Must match `package.json` version; a test pins the two together. */
export declare const WIND_CLIENT_VERSION = "2.15.0";
export interface WindClient {
    callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<WindCallResult>;
}
export interface WindClientOptions {
    endpoint?: string;
    /** Re-resolve the key on every call, never cache it. */
    resolveApiKey: () => Promise<string | undefined>;
    /** Per-request timeout (initialize and tools/call separately); default 60000. */
    timeoutMs?: number;
    /** Network-error retry delays; default [300, 1000], shortened only in tests. */
    retryDelaysMs?: number[];
}
/** Endpoint is validated at construction so config errors surface immediately. */
export declare function createWindClient(options: WindClientOptions): WindClient;
