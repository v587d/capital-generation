import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Internal plugin name used by the Capital mode preset. */
export declare const name = "capital-generation";
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
/** web_retriever 会话配置：anysearch（广度）+ wind_docs（public_document 精准）。 */
export interface RetrieverConfig {
    baseURL?: string;
    credentialRef?: string;
    windDocs?: WindDocsConfig;
    localFetch?: LocalFetchConfig;
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
export declare const Config: z<Schemastery.ObjectS<{
    customPersona: z<string, string>;
    fuyaoCredentialRef: z<string, string>;
    retriever: z<Schemastery.ObjectS<{
        baseURL: z<string, string>;
        credentialRef: z<string, string>;
        windDocs: z<Schemastery.ObjectS<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>, Schemastery.ObjectT<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>>;
        localFetch: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>>;
    }>, Schemastery.ObjectT<{
        baseURL: z<string, string>;
        credentialRef: z<string, string>;
        windDocs: z<Schemastery.ObjectS<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>, Schemastery.ObjectT<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>>;
        localFetch: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>>;
    }>>;
}>, Schemastery.ObjectT<{
    customPersona: z<string, string>;
    fuyaoCredentialRef: z<string, string>;
    retriever: z<Schemastery.ObjectS<{
        baseURL: z<string, string>;
        credentialRef: z<string, string>;
        windDocs: z<Schemastery.ObjectS<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>, Schemastery.ObjectT<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>>;
        localFetch: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>>;
    }>, Schemastery.ObjectT<{
        baseURL: z<string, string>;
        credentialRef: z<string, string>;
        windDocs: z<Schemastery.ObjectS<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>, Schemastery.ObjectT<{
            endpoint: z<string, string>;
            credentialRef: z<string, string>;
            timeoutMs: z<number, number>;
        }>>;
        localFetch: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            timeoutMs: z<number, number>;
            maxBytes: z<number, number>;
            maxContentChars: z<number, number>;
            maxRedirects: z<number, number>;
            userAgent: z<string, string>;
        }>>;
    }>>;
}>>;
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
