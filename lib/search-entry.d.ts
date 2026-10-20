/**
 * `tools/retrieve-search` row: anysearch_search / web_retriever_fetch / wind_docs_*.
 * Split from source and OCR rows; all share `retriever-runtime.ts` and resolve
 * credentials per call.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-retrieve-search-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
