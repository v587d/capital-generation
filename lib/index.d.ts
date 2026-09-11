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
/** web_retriever 会话配置：anysearch（广度）+ wind_docs（public_document 精准）。 */
export interface RetrieverConfig {
    baseURL?: string;
    credentialRef?: string;
    windDocs?: WindDocsConfig;
}
/** Configuration accepted by the Capital Generation plugin. */
export interface Config {
    /** Optional additive persona override; core safety guidance is preserved. */
    customPersona?: string;
    /** web_retriever 配置（可选；缺省使用 AnySearch 默认地址与凭据名）。 */
    retriever?: RetrieverConfig;
}
/** DSH 0.1.2-rc.1 configuration schema. */
export declare const Config: z<Schemastery.ObjectS<{
    customPersona: z<string, string>;
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
    }>>;
}>, Schemastery.ObjectT<{
    customPersona: z<string, string>;
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
