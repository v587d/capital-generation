/**
 * PaddleOCR output -> model-readable markdown (the only implementation). Upstream emits
 * tables as inline HTML with per-cell `style=`, so on a measured 15-page report ~60% of
 * characters were style boilerplate; `prettifyMarkdown`-style flags are silently ignored.
 * Normalization is lossless layout only: no text, numbers or tables are dropped.
 */
const PAGE_MARKER_PREFIX = '<!-- page:';
/** `&amp;` appears in company and account names; leaving it encoded is dirty data. */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(value) {
    return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/giu, (whole, body) => {
        const lowered = body.toLowerCase();
        if (lowered.startsWith('#x')) {
            const code = Number.parseInt(lowered.slice(2), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        if (lowered.startsWith('#')) {
            const code = Number.parseInt(lowered.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[lowered] ?? whole;
    });
}
function stripTags(value) {
    return decodeEntities(value.replace(/<[^>]*>/gu, ' '))
        .replace(/\s+/gu, ' ')
        .trim();
}
function escapeCell(value) {
    // GFM cells need escaped pipes; a split row misaligns columns silently.
    return value.replace(/\|/gu, '\\|');
}
/** Cell text from one `<tr>`; split on open tags, then cut at the matching close tag. */
function rowCells(row) {
    const cells = [];
    // Upstream header rows use `<th>`; matching only `<td` silently drops whole header rows.
    // `\b` keeps `<thead>` / `<table>` from being read as cell openers.
    for (const segment of row.split(/<t(?:d|h)\b[^>]*>/giu).slice(1)) {
        cells.push(stripTags(segment.split(/<\/t(?:d|h)\s*>/iu)[0] ?? ''));
    }
    return cells;
}
/**
 * HTML table -> GFM pipe table. Header is upstream's first row; pad every row to the
 * widest so GFM's separator count matches the header (a short row degrades the table).
 */
function tableToMarkdown(tableHtml) {
    const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)(?:<\/tr>|$)/giu)].map((match) => rowCells(match[1]));
    const kept = rows.filter((cells) => cells.length > 0);
    if (kept.length === 0)
        return stripTags(tableHtml);
    const width = Math.max(...kept.map((cells) => cells.length));
    const lines = kept.map((cells) => `| ${cells.map(escapeCell).join(' | ')}${'|'.repeat(width - cells.length)} |`);
    lines.splice(1, 0, `|${' --- |'.repeat(width)}`);
    return lines.join('\n');
}
/** Strip styles, convert HTML tables to GFM, collapse blank lines; near-identity otherwise. */
export function normalizeOcrMarkdown(source) {
    const styleMatches = source.match(/\s(?:style|class)\s*=\s*(?:"[^"]*"|'[^']*')/giu) ?? [];
    const styleCharsRemoved = styleMatches.reduce((total, match) => total + match.length, 0);
    let tables = 0;
    const withoutTables = source.replace(/<table\b[^>]*>[\s\S]*?(?:<\/table>|$)/giu, (match) => {
        tables += 1;
        return `\n${tableToMarkdown(match)}\n`;
    });
    const cleaned = withoutTables
        .replace(/<br\s*\/?\s*>/giu, ' ')
        .replace(/<\/?(?:td|th|tr|thead|tbody|tfoot|table|div|span|p|font|img|a|sup|sub|b|i|u|s|em|strong)\b[^>]*>/giu, '')
        .replace(/\s(?:style|class)\s*=\s*(?:"[^"]*"|'[^']*')/giu, '')
        // Upstream glues headings to preceding text (`2024-11-12## 盈利预测`); require a
        // space after `#` so "评级#买入" is not split.
        .replace(/(?<=\S)(#{1,6}\s+\S)/gu, '\n\n$1')
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n{3,}/gu, '\n\n');
    return { markdown: cleaned.trim(), tables, styleCharsRemoved };
}
function firstHeading(markdown) {
    for (const line of markdown.split('\n')) {
        const heading = /^#{1,6}\s+(.+)$/u.exec(line.trim());
        if (heading?.[1])
            return heading[1].trim().slice(0, 120);
    }
    return undefined;
}
/** Join per-page markdown and record page offsets, used by page reads and keyword lookup. */
export function buildOcrDocument(sourcePages) {
    const chunks = [];
    const pages = [];
    let offset = 0;
    let tables = 0;
    let images = 0;
    let styleCharsRemoved = 0;
    for (const sourcePage of sourcePages) {
        const normalized = normalizeOcrMarkdown(sourcePage.markdown);
        tables += normalized.tables;
        images += sourcePage.images;
        styleCharsRemoved += normalized.styleCharsRemoved;
        const marker = `${PAGE_MARKER_PREFIX}${sourcePage.page} -->\n`;
        const body = normalized.markdown;
        const entry = {
            page: sourcePage.page,
            start: offset + marker.length,
            end: offset + marker.length + body.length,
            chars: body.length,
        };
        const heading = firstHeading(body);
        if (heading !== undefined)
            entry.heading = heading;
        pages.push(entry);
        chunks.push(`${marker}${body}\n\n`);
        offset += marker.length + body.length + 2;
    }
    const document = chunks.join('').trimEnd();
    return { document, pages, chars: document.length, images, tables, styleCharsRemoved };
}
function pageOf(pages, at) {
    return pages.find((entry) => at >= entry.start && at < entry.end) ?? pages[pages.length - 1];
}
/**
 * `"1-3"` / `"5"` / `"2-4,9"` (1-based, inclusive). Out-of-range pages fail loudly:
 * "page absent" and "not requested" must stay distinguishable in the receipt.
 */
export function parsePageRange(spec, totalPages) {
    const taken = [];
    for (const part of spec.split(',')) {
        const trimmed = part.trim();
        if (trimmed.length === 0)
            continue;
        const span = /^(\d+)\s*(?:-|–|~)\s*(\d+)$/u.exec(trimmed);
        if (span) {
            const from = Number(span[1]);
            const to = Number(span[2]);
            if (from < 1 || to > totalPages || from > to) {
                throw new Error(`pages out of range: '${trimmed}' (document has ${totalPages} pages)`);
            }
            for (let page = from; page <= to; page += 1)
                if (!taken.includes(page))
                    taken.push(page);
            continue;
        }
        const single = /^\d+$/u.test(trimmed) ? Number(trimmed) : Number.NaN;
        if (!Number.isInteger(single) || single < 1 || single > totalPages) {
            throw new Error(`pages out of range: '${trimmed}' (document has ${totalPages} pages)`);
        }
        if (!taken.includes(single))
            taken.push(single);
    }
    if (taken.length === 0)
        throw new Error(`pages is empty after normalization: '${spec}'`);
    return taken;
}
/** Slice pages out of the stored text; never re-runs upstream. */
export function selectPages(document, pages) {
    return pages.map((page) => {
        const entry = document.pages.find((item) => item.page === page);
        if (!entry)
            throw new Error(`page ${page} is not in this document`);
        const excerpt = { page, chars: entry.chars, text: document.document.slice(entry.start, entry.end) };
        if (entry.heading !== undefined)
            excerpt.heading = entry.heading;
        return excerpt;
    });
}
/**
 * Keyword lookup over the persisted normalized text (no egress): the output budget is
 * smaller than a whole report, so callers must be able to jump. Adjacent hits merge into
 * one window, and windows never cross a page boundary — a miscited page is worse than
 * fewer hits — which also keeps `<!-- page:N -->` markers out of excerpts.
 */
export function locateQuery(document, query, limit, windowChars) {
    const haystack = document.document;
    const needle = query.trim();
    if (needle.length === 0)
        throw new Error('query must not be empty');
    const hits = [];
    const loweredNeedle = needle.toLowerCase();
    const lowered = haystack.toLowerCase();
    let cursor = 0;
    let lastEnd = -1;
    while (hits.length < limit) {
        const at = lowered.indexOf(loweredNeedle, cursor);
        if (at < 0)
            break;
        cursor = at + needle.length;
        // Merge adjacent hits: three occurrences of one sentence must not fill `limit`.
        if (at < lastEnd)
            continue;
        const entry = pageOf(document.pages, at);
        const from = Math.max(entry?.start ?? 0, at - windowChars);
        const to = Math.min(entry?.end ?? haystack.length, at + needle.length + windowChars);
        hits.push({ page: entry?.page ?? 1, at, excerpt: haystack.slice(from, to).replace(/\n+/gu, ' ⏎ ') });
        lastEnd = to;
    }
    return hits;
}
export { PAGE_MARKER_PREFIX };
