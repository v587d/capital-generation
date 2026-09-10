import type { Context } from '@deepseek-ai/cordis';
import { WebRetriever } from './retriever.js';
/** 注册仅保留核心的两个模型工具：单查询 search、单 URL fetch。 */
export declare function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever): void;
