/**
 * Bounded HTML -> GFM markdown for the local-fetch fallback. Ported from the
 * official web_fetch renderer, plus `stripInvisibleText` because turndown keeps
 * script/style, ignores hidden elements, and recurses (stack/deadline risk at
 * depth); conversion is abandoned past `MAX_CONVERSION_DEPTH`.
 */
/** Hard nesting limit: past it conversion is skipped. Robustness, not a tunable. */
export declare const MAX_CONVERSION_DEPTH = 512;
/** Result: title comes from the original HTML; omitted means conversion was skipped. */
export interface HtmlMarkdownResult {
    title?: string;
    /** GFM markdown, or the fixed omission marker when conversion is unsafe. */
    markdown: string;
    /** Source or output was cut by `maxChars`. */
    truncated: boolean;
    /** Conversion was abandoned (too deep or turndown threw). */
    omitted: boolean;
}
export declare function stripInvisibleText(value: string): string;
/**
 * Extract `<title>` from the document head and decode entities. The title text is
 * left in the markdown body (matching official behavior); this only feeds the field.
 */
export declare function extractTitle(html: string): string | undefined;
/**
 * Convert HTML to bounded GFM markdown. Source is cut to `maxChars` first; unsafe
 * conversion returns the omission marker; output is stripped of invisibles and cut
 * to `maxChars`. Title always comes from the original HTML.
 */
export declare function htmlToMarkdown(html: string, maxChars: number): HtmlMarkdownResult;
