/**
 * Bounded HTML -> GFM markdown for the local-fetch fallback. Ported from the
 * official web_fetch renderer, plus `stripInvisibleText` because turndown keeps
 * script/style, ignores hidden elements, and recurses (stack/deadline risk at
 * depth); conversion is abandoned past `MAX_CONVERSION_DEPTH`.
 */
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
/** Hard nesting limit: past it conversion is skipped. Robustness, not a tunable. */
export const MAX_CONVERSION_DEPTH = 512;
// Invisible character stripping (shared by every external-content entry)
/**
 * Some characters render as nothing yet reach the model and citations: C0/C1
 * controls, soft hyphen/zero-width/BOM (keyword checks miss them), bidi overrides
 * and isolates (Trojan Source display spoofing), U+2028/2029. Deleting preserves
 * order; keep \n, \r and \t for markdown.
 */
const INVISIBLE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
export function stripInvisibleText(value) {
    return value.replace(INVISIBLE_PATTERN, '');
}
/**
 * One module-scope turndown instance (stateless across calls). Rule order matters:
 * gfm, then remove rules, then table rules; table rules must come last to override
 * the plugin's colspan expansion.
 */
const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});
turndown.use(gfm);
/** Match => drop the whole block; script/style/hidden content never reaches output. */
turndown.addRule('removeNonVisibleContent', {
    filter(node) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.nodeName))
            return true;
        if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden')?.toLowerCase() === 'true')
            return true;
        if (node.nodeName === 'INPUT' && node.getAttribute('type')?.toLowerCase() === 'hidden')
            return true;
        const declarations = node.getAttribute('style')?.split(';') ?? [];
        return declarations.some((declaration) => {
            const separator = declaration.indexOf(':');
            if (separator === -1)
                return false;
            const property = declaration.slice(0, separator).trim().toLowerCase();
            const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important\s*$/u, '');
            return (property === 'display' && value === 'none')
                || (property === 'visibility' && (value === 'hidden' || value === 'collapse'));
        });
    },
    replacement() {
        return '';
    },
});
/** Render one GFM cell; HTML colspan is deliberately not interpreted. */
function renderTableCell(content, index) {
    const prefix = index === 0 ? '| ' : ' ';
    const escaped = content.trim().replace(/\n\r/g, '<br>').replace(/\n/g, '<br>').replace(/\|+/g, '\\|').padEnd(3, ' ');
    return `${prefix}${escaped} |`;
}
/** Whether this row is the markdown header row of its table. */
function isTableHeadingRow(row) {
    const cells = Array.from(row.cells);
    const section = row.parentElement;
    const table = section.parentElement;
    return (section.nodeName === 'THEAD' || table.rows[0] === row)
        && cells.every(cell => cell.nodeName === 'TH');
}
/** Map HTML cell alignment to a GFM separator. */
function tableBorder(cell) {
    const alignment = (cell.getAttribute('align') || cell.style.textAlign || '').toLowerCase();
    if (alignment === 'left')
        return ':---';
    if (alignment === 'right')
        return '---:';
    if (alignment === 'center')
        return ':---:';
    return '---';
}
turndown.addRule('tableCellWithoutSpanExpansion', {
    filter: ['th', 'td'],
    replacement(content, node) {
        const cell = node;
        const row = cell.parentNode;
        // GFM cannot express colspan; ignoring it keeps output proportional to source
        // text instead of the numeric attribute (the gfm rule expands empty cells).
        return renderTableCell(content, Array.from(row.childNodes).indexOf(cell));
    },
});
turndown.addRule('tableRowWithoutSpanExpansion', {
    filter: 'tr',
    replacement(content, node) {
        const row = node;
        const border = isTableHeadingRow(row)
            ? Array.from(row.cells, (cell, index) => renderTableCell(tableBorder(cell), index)).join('')
            : '';
        return `\n${content}${border.length > 0 ? `\n${border}` : ''}`;
    },
});
// Nesting-depth guard (ported from official fetch.ts)
/** Elements that never take a closing tag: kept out of the lexical stack. */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** Text until the matching close tag is raw text, not markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript']);
/** Whether a char can follow a raw-text close tag name. */
function isTagBoundary(char) {
    return char === undefined || char === '>' || char === '/' || /\s/.test(char);
}
/** Find a raw-text close tag, ignoring markup-like text inside the body. */
function findRawTextEnd(lowerHtml, name, from) {
    const prefix = `</${name}`;
    let candidate = lowerHtml.indexOf(prefix, from);
    while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) {
        candidate = lowerHtml.indexOf(prefix, candidate + prefix.length);
    }
    return candidate;
}
/**
 * Reject HTML whose lexical element stack exceeds the depth limit. Single pass:
 * ignores close tags in comments, skips raw text, respects quoted `>`, only pops a
 * matching top-of-stack, so malformed input over-counts rather than hides nesting.
 */
function exceedsConversionDepth(html) {
    const lowerHtml = html.toLowerCase();
    const openElements = [];
    let offset = 0;
    let inComment = false;
    while (offset < html.length) {
        const start = html.indexOf('<', offset);
        if (inComment) {
            const end = html.indexOf('-->', offset);
            if (end !== -1 && (start === -1 || end < start)) {
                inComment = false;
                offset = end + 3;
                continue;
            }
        }
        if (start === -1)
            break;
        if (!inComment && html.startsWith('<!--', start)) {
            inComment = true;
            offset = start + 4;
            continue;
        }
        let cursor = start + 1;
        const closing = html[cursor] === '/';
        if (closing)
            cursor += 1;
        const nameStart = cursor;
        while (/[a-zA-Z0-9-]/.test(html[cursor] ?? ''))
            cursor += 1;
        if (cursor === nameStart || !/[a-zA-Z]/.test(html.charAt(nameStart))) {
            offset = start + 1;
            continue;
        }
        const name = lowerHtml.slice(nameStart, cursor);
        let quote;
        while (cursor < html.length) {
            const char = html[cursor];
            cursor += 1;
            if (quote !== undefined) {
                if (char === quote)
                    quote = undefined;
            }
            else if (char === '"' || char === "'") {
                quote = char;
            }
            else if (char === '>') {
                break;
            }
        }
        if (html[cursor - 1] !== '>')
            break;
        if (closing) {
            if (!inComment && openElements.at(-1) === name)
                openElements.pop();
        }
        else {
            let last = cursor - 2;
            while (/\s/.test(html.charAt(last)))
                last -= 1;
            if (!VOID_ELEMENTS.has(name) && html[last] !== '/') {
                openElements.push(name);
                if (openElements.length > MAX_CONVERSION_DEPTH)
                    return true;
                if (!inComment && RAW_TEXT_ELEMENTS.has(name)) {
                    const end = findRawTextEnd(lowerHtml, name, cursor);
                    if (end === -1)
                        break;
                    offset = end;
                    continue;
                }
            }
        }
        offset = cursor;
    }
    return false;
}
// Title extraction
/** Scan only the opening window: `<title>` lives in head, avoid full-document scans. */
const TITLE_SCAN_CHARS = 2048;
const TITLE_PATTERN = /<title[^>]*>([^<]*)<\/title>/i;
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp|#[0-9]+|#[xX][0-9a-fA-F]+);/g;
const NAMED_ENTITIES = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['nbsp', '\u00a0'],
]);
/** Decode a numeric character reference; invalid code point => null (keep text). */
function decodeNumericEntity(body) {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!(code >= 0 && code <= 0x10ffff))
        return null;
    return String.fromCodePoint(code);
}
/** Single-pass entity decode: `&amp;lt;` becomes `&lt;`, never `<`. */
function decodeEntities(text) {
    return text.replace(ENTITY_PATTERN, (match) => {
        const body = match.slice(1, -1);
        const named = NAMED_ENTITIES.get(body);
        if (named !== undefined)
            return named;
        return decodeNumericEntity(body) ?? match;
    });
}
/**
 * Extract `<title>` from the document head and decode entities. The title text is
 * left in the markdown body (matching official behavior); this only feeds the field.
 */
export function extractTitle(html) {
    const match = TITLE_PATTERN.exec(html.slice(0, TITLE_SCAN_CHARS));
    if (match === null)
        return undefined;
    const title = stripInvisibleText(decodeEntities(match[1])).replace(/\s+/g, ' ').trim();
    return title === '' ? undefined : title;
}
// Entry point
/** Fixed marker returned when conversion is unsafe (too deep or turndown threw). */
const OMITTED_MARKDOWN = '[HTML content omitted: unable to convert safely.]';
function omittedResult(title, sourceTruncated, maxChars) {
    const outputTruncated = OMITTED_MARKDOWN.length > maxChars;
    return {
        ...(title !== undefined ? { title } : {}),
        markdown: outputTruncated ? OMITTED_MARKDOWN.slice(0, maxChars) : OMITTED_MARKDOWN,
        truncated: sourceTruncated || outputTruncated,
        omitted: true,
    };
}
/**
 * Convert HTML to bounded GFM markdown. Source is cut to `maxChars` first; unsafe
 * conversion returns the omission marker; output is stripped of invisibles and cut
 * to `maxChars`. Title always comes from the original HTML.
 */
export function htmlToMarkdown(html, maxChars) {
    const title = extractTitle(html);
    const content = html.slice(0, maxChars);
    const sourceTruncated = content.length !== html.length;
    if (exceedsConversionDepth(content)) {
        return omittedResult(title, sourceTruncated, maxChars);
    }
    let converted;
    try {
        converted = turndown.turndown(content);
    }
    catch {
        // The lexical guard cannot model every malformed tree; RangeError => same marker.
        return omittedResult(title, sourceTruncated, maxChars);
    }
    const sanitized = stripInvisibleText(converted);
    const outputTruncated = sanitized.length > maxChars;
    return {
        ...(title !== undefined ? { title } : {}),
        markdown: outputTruncated ? sanitized.slice(0, maxChars) : sanitized,
        truncated: sourceTruncated || outputTruncated,
        omitted: false,
    };
}
