/**
 * Host-plane Capital policy row: call-level gates that preset composition cannot express.
 * Root convergence (visibility already closed by family rows), per-name sibling deny,
 * call-level guards for the `ocr` url form and role `interrupt_agent`, plus shell and fs
 * guards. Identity must be read per call: the host creates the Agent before selecting a
 * preset. Listens on `ctx.root`; one registration per process.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "capital-policy";
/**
 * `tools` is a hard dependency: without `inject`, boot resolves it to undefined without
 * throwing and every identity guard silently skips installation. Waiting for the fiber
 * to provide it closes that boot-time race.
 */
export declare const inject: string[];
export declare function apply(ctx: Context): void;
