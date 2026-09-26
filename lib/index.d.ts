import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Internal plugin name used by the Capital mode preset. */
export declare const name = "capital-generation";
/**
 * 取数配置所在的 **profile 条目 id**（随包的 `capital-config` 行）。0.1.7 的 settings 面
 * 以条目 id 为命名空间，本插件经 `settings.describe()` 按它读回用户配的引用名与开关。
 *
 * 这个字符串有三处必须一致：`cordis.patch.yml` 的行 id、`capital-config/index.js` 的
 * `SETTINGS_ENTRY_ID`、以及浏览器半边 `client.src.cjs` 的 `ENTRY_ID`；由
 * `test/capital-config.test.mjs` 逐一对齐（漂移的表现为卡片静默消失）。
 */
export declare const CAPITAL_CONFIG_ENTRY_ID = "capital-config";
/** Wind 文档检索配置：JSON-RPC 端点与凭据名（线格式为 MCP 线协议，零依赖适配）。 */
export interface WindDocsConfig {
    endpoint?: string;
    credentialRef?: string;
    timeoutMs?: number;
}
/** 本地直连回退配置（AnySearch 明确失败后改由本机直连抓取公开文本页面）。 */
export interface LocalFetchConfig {
    enabled?: boolean;
    timeoutMs?: number;
    maxBytes?: number;
    maxContentChars?: number;
    maxRedirects?: number;
    userAgent?: string;
}
/**
 * PaddleOCR 文档解析（`ocr` 工具）配置。
 *
 * `endpoint` / `model` 空值 = 用 `src/ocr/client.ts` 里的官方端点与模型名（真值只在那一处，
 * 与 `windDocs.endpoint` 同一口径）。`pollBudgetMs` 是**工具内部**等作业的自有预算，
 * 必须小于工具声明的 `timeoutMs: 240000`——余量留给"决定回 pending 之后把回执写出去"，
 * 撞上框架超时就没有 `doc_id` 可续查了。
 */
export interface PaddleOcrConfig {
    endpoint?: string;
    credentialRef?: string;
    model?: string;
    pollBudgetMs?: number;
}
/** web_retriever 会话配置：anysearch（广度）+ wind_docs（public_document 精准）+ 文档解析。 */
export interface RetrieverConfig {
    baseURL?: string;
    credentialRef?: string;
    windDocs?: WindDocsConfig;
    localFetch?: LocalFetchConfig;
    paddleOcr?: PaddleOcrConfig;
}
/**
 * 本地直连回退的默认值（唯一真值来源）：schema 的 `.default()` 与消费点
 * `resolveLocalFetchConfig()` 都引用它，两处不再各写一份字面量。
 *
 * 数值口径对齐官方 `dsh-web-fetch-http`（DSH 自己的同类本机抓取器）：
 * - `timeoutMs` = 30000（官方默认）。2026-09 实测：环境代理的故障转移慢路径约
 *   15.2–15.4s，15s 预算会把证券业协会官网这类站点误判成 TIMEOUT。
 * - `maxContentChars` = 100000（官方 `maxBodyChars` 默认值）。注意它切的是**转换前的
 *   原始 HTML**（见 `html-markdown.ts`），而 markdown 输出只有 HTML 的 12–33%，
 *   所以这个数必须按 HTML 体积给足；20,000 会把 109KB 的页面腰斩到 18%。
 *
 * `userAgent` 默认是产品标识（`@v587d/capital-generation`）：裸版本号是
 * WAF 眼里的典型爬虫特征。显式配成空串时消费点回落到 `LOCAL_FETCH_CLIENT_VERSION`
 * （版本号真值仍只有一处，由测试守着等于 `package.json` 的 version）。
 */
export declare const LOCAL_FETCH_DEFAULTS: Required<LocalFetchConfig>;
/**
 * `ocr`（PaddleOCR 文档解析）配置的默认值：与 `LOCAL_FETCH_DEFAULTS` 同一口径，
 * schema 的 `.default()` 与消费点都引用它，字面量只有一处。
 *
 * `endpoint` / `model` 留空是把真值让给 `src/ocr/client.ts`（那边还有 `PADDLE_OCR_MAX_PAGES`
 * 这类跟着端点走的常数）；`pollBudgetMs: 0` 同理让给客户端的 `DEFAULT_WAIT_BUDGET_MS`。
 */
export declare const PADDLE_OCR_DEFAULTS: Required<PaddleOcrConfig>;
/**
 * 消费点独立补齐默认值。`apply()` 在无 settings 的宿主/测试里拿到的是**未过 schema**
 * 的原始对象，`retriever.localFetch` 可能是 `undefined`，因此消费点不能依赖 schema 补默认值。
 */
export declare function resolveLocalFetchConfig(config?: LocalFetchConfig): Required<LocalFetchConfig>;
/** Configuration accepted by the Capital Generation plugin. */
export interface Config {
    /** Optional additive persona override; core safety guidance is preserved. */
    customPersona?: string;
    /** Fuyao credentials 引用名；空值回退到 FUYAO_API_KEY。 */
    fuyaoCredentialRef?: string;
    /** web_retriever 配置（可选；缺省使用 AnySearch 默认地址与凭据名）。 */
    retriever?: RetrieverConfig;
}
/** DSH 0.1.2-rc.1 configuration schema. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    customPersona: z<string, string, "defined">;
    fuyaoCredentialRef: z<string, string, "defined">;
    retriever: z<Schemastery.ObjectS<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    customPersona: z<string, string, "defined">;
    fuyaoCredentialRef: z<string, string, "defined">;
    retriever: z<Schemastery.ObjectS<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        baseURL: z<string, string, "defined">;
        credentialRef: z<string, string, "defined">;
        windDocs: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            timeoutMs: z<number, number, "defined">;
        }>>, "defined">;
        localFetch: z<Schemastery.ObjectS<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            enabled: z<boolean, boolean, "defined">;
            timeoutMs: z<number, number, "defined">;
            maxBytes: z<number, number, "defined">;
            maxContentChars: z<number, number, "defined">;
            maxRedirects: z<number, number, "defined">;
            userAgent: z<string, string, "defined">;
        }>>, "defined">;
        paddleOcr: z<Schemastery.ObjectS<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, Schemastery.ObjectT<NoInfer<{
            endpoint: z<string, string, "defined">;
            credentialRef: z<string, string, "defined">;
            model: z<string, string, "defined">;
            pollBudgetMs: z<number, number, "defined">;
        }>>, "defined">;
    }>>, "defined">;
}>>, "plain">;
/**
 * 把可选的用户人设文本转成独立 system-prompt section（官方 systemPrompt
 * registry 的注册对象）。空白输入返回 undefined（不注册）；超长抛错；
 * 追加不可覆盖的安全提醒。只影响表达风格与呈现。
 */
export declare function resolveUserCustomizationSection(customPersona?: string): {
    name: string;
    order: number;
    text: string;
} | undefined;
/** The system-prompt service is a hard dependency for the optional section. */
export declare const inject: string[];
/**
 * Register the Capital mode data services and tools.
 *
 * 人设文本全部由 preset 组合承载（dsh-persona 行 + 两个委派行 config.persona），
 * 不在插件代码中。本包只装配服务与工具：
 *  - datasetStore（workspace-local Dataset 持久化，7 天保留，权限失败显式报错）
 *  - dataCollectorHub（阻塞 FIFO + in-flight 合并，成功后由 store 立即落盘，
 *    只回传 DatasetRef，不保留长期 raw 缓存）
 *  - 无状态 AnySearch 网页检索（单查询 search + 单 URL fetch）
 *  - 无状态 Wind 文档检索客户端（public_document：公告/年报/招股书与权威新闻）
 *  - 各自的模型工具；时间工具。
 */
export declare function apply(ctx: Context, config: Config): void;
