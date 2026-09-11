import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
import type { WindClient } from './wind-client.js';
/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具。wind 工具无条件注册——Key 缺失/服务不可用只影响调用结果（错误信封），
 * 不影响工具注册与子 Agent 创建。
 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient): void;
