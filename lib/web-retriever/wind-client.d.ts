/**
 * Wind 金融文档检索客户端（JSON-RPC over HTTP，零依赖）。
 *
 * 线格式为 JSON-RPC 2.0（即 MCP 线协议）：initialize → tools/call，无会话态、
 * 无 SDK、无框架依赖——与 fuyao-rest / anysearch engines 同构的普通 HTTP 客户端。
 * 协议蓝本（Wind 官方 CLI）：github.com/Wind-Alice/AliceMarket 的
 * skills/wind-mcp-skill/scripts/cli.mjs（本地参考副本在 docs/reference/，不入库）。
 */
export declare const DEFAULT_WIND_ENDPOINT = "https://mcp.wind.com.cn/vserver_financial_docs/mcp/";
export declare const WIND_REQUEST_TIMEOUT_MS = 60000;
export declare const WIND_MAX_CONTENT_CHARS = 20000;
/**
 * 错误分类（persona/主 Agent 依据它决定 fallback）：
 * AUTH=Key 缺失或无效；RATE_LIMIT=429；NETWORK=网络错误/5xx/超时；
 * BACKEND=接口层与业务错误；INVALID=响应不可解析。
 */
export type WindErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'BACKEND' | 'INVALID';
export interface WindCallResult {
    ok: boolean;
    /** 成功且正文可解析为 JSON 时：Wind 返回结果（字符串字段裁剪到 WIND_MAX_CONTENT_CHARS）。 */
    data?: unknown;
    /** 成功但正文非 JSON 时：原文透传（≤WIND_MAX_CONTENT_CHARS）。 */
    content?: string;
    content_chars?: number;
    error?: string;
    code?: WindErrorCode;
}
export interface WindClient {
    callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<WindCallResult>;
}
export interface WindClientOptions {
    endpoint?: string;
    /** 每次调用重新解析 Key，不缓存（与 anysearch engines 同策略）。 */
    resolveApiKey: () => Promise<string | undefined>;
    /** 单次请求超时毫秒（initialize 与 tools/call 各自适用）；默认 60000。 */
    timeoutMs?: number;
    /** 网络错误重试间隔毫秒；默认 [300, 1000]，仅供测试注入缩短。 */
    retryDelaysMs?: number[];
}
/** 创建 Wind 文档检索客户端；端点在构造时校验（配置错误立即暴露，与 anysearch 同策略）。 */
export declare function createWindClient(options: WindClientOptions): WindClient;
