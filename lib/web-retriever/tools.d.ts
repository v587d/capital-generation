import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
import type { WindClient } from './wind-client.js';
import type { LocalFetchOptions } from './local-fetch.js';
/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具。wind 工具无条件注册——Key 缺失/服务不可用只影响调用结果（错误信封），
 * 不影响工具注册与子 Agent 创建。
 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient): void;
/**
 * 注册九个具名来源工具（provider + operation 命名）。
 *
 * 为什么单独一个注册函数：这九个工具只依赖 HTTP 传输（`local-fetch` 的出口校验），
 * 不依赖 AnySearch / Wind；任何一路的配置缺失都不应连带影响另外几路的注册。
 */
export declare function registerSourceTools(ctx: Context, localFetchOptions: LocalFetchOptions): void;
