import type { ChartPayload } from './series.js';
export interface VendoredChartLibrary {
    source: string;
    version: string;
    license: string;
}
/**
 * 读取随包发布的 lightweight-charts standalone 构建。
 *
 * 路径相对 `import.meta.url`：编译后是 `lib/chart/vendor/...`（由 scripts/copy-assets.mjs
 * 从 `vendor/` 复制过去）。缺失时给出可操作错误，而不是让 HTML 里静默少一段脚本。
 */
export declare function loadVendoredChartLibrary(): VendoredChartLibrary;
export interface BuildStandaloneHtmlInput {
    payload: ChartPayload;
    library: VendoredChartLibrary;
    /** 生成时刻（epoch ms），仅用于页脚署名，不参与渲染。 */
    generatedAt: number;
}
export declare function buildStandaloneHtml(input: BuildStandaloneHtmlInput): string;
export declare function escapeHtml(value: string): string;
