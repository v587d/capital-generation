/**
 * `tools/ocr` row: PaddleOCR job -> markdown -> disk. The `url` vs `file` / `doc_id`
 * split is a call-level guard in `root-tool-policy` (name-level deny cannot express it).
 * Client construction is per mount; credentials resolve per call.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-ocr-tools";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
