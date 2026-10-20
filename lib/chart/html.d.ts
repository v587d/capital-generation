import type { ChartPayload } from './series.js';
export interface VendoredChartLibrary {
    source: string;
    version: string;
    license: string;
}
/**
 * Path is relative to import.meta.url (assets copied into lib by scripts/copy-assets.mjs);
 * a missing library is a hard, actionable error rather than silently missing script bytes.
 */
export declare function loadVendoredChartLibrary(): VendoredChartLibrary;
export interface BuildStandaloneHtmlInput {
    payload: ChartPayload;
    library: VendoredChartLibrary;
    generatedAt: number;
}
export declare function buildStandaloneHtml(input: BuildStandaloneHtmlInput): string;
export declare function escapeHtml(value: string): string;
