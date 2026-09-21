/**
 * HTML → GFM Markdown 转换（本地直抓回退的呈现层，todo 4 `local-fetch.ts` 消费）。
 *
 * 语义逐条移植自官方 DSH `web_fetch` 渲染器
 * （`dsh-LLM-icon/.research/dsh-src/packages/web/tool-web/src/fetch.ts`）：
 * turndown + GFM 插件、`removeNonVisibleContent` 规则、无跨列展开的表格规则、
 * 512 层嵌套词法守卫与固定省略标记。官方实现里与本模块无关的呈现职责
 * （`Fetched <url>` 头、不可信内容提示、截断脚注、WeakMap memoization）一律不搬。
 *
 * 为什么必须补这三道保护（turndown 的已知缺口）：
 * - turndown 默认**不删** `<script>/<style>`，其正文会当文本带进输出；
 * - turndown 完全**不处理**隐藏元素；
 * - turndown 的转换按元素递归，超深嵌套下可能爆栈或长时间占用事件循环——
 *   官方实测：嵌套 512 层 ≈ 0.15s、2000 层 ≈ 2s、20000 层 ≈ 5s，期间协作式
 *   超时定时器无法触发，所以超过 512 层直接放弃转换。
 */
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
/** 嵌套深度上限：超过则跳过转换、返回固定省略标记。健壮性不变量，不是可调参数。 */
export const MAX_CONVERSION_DEPTH = 512;
/**
 * 模块作用域唯一的 turndown 实例。官方注释明说该实例跨 `turndown()` 调用无状态、
 * 可共享；规则只注册一次，全部转换复用（测试用幂等用例钉住这一点）。
 * 规则注册顺序与官方一致：先 `use(gfm)`，再 remove 规则，最后表格规则——
 * turndown 按后注册先匹配解析规则，表格规则因此覆盖 gfm 插件自带的跨列展开实现。
 */
const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});
turndown.use(gfm);
/** 命中即整块删除（replacement 返回空串），脚本/样式/隐藏元素的内容不进输出。 */
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
/** 渲染一个 GFM 表格单元格，不解释 HTML 的跨列计数。 */
function renderTableCell(content, index) {
    const prefix = index === 0 ? '| ' : ' ';
    const escaped = content.trim().replace(/\n\r/g, '<br>').replace(/\n/g, '<br>').replace(/\|+/g, '\\|').padEnd(3, ' ');
    return `${prefix}${escaped} |`;
}
/** 该行是否表格的 Markdown 表头行。 */
function isTableHeadingRow(row) {
    const cells = Array.from(row.cells);
    const section = row.parentElement;
    const table = section.parentElement;
    return (section.nodeName === 'THEAD' || table.rows[0] === row)
        && cells.every(cell => cell.nodeName === 'TH');
}
/** 把 HTML 单元格对齐方式映射成 GFM 分隔符。 */
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
        // GFM 无法表达跨列。忽略 colspan 让转换工作量与输出和源成正比，
        // 而不是跟数字属性走（gfm 插件自带规则会按 colspan 展开成多个空单元格）。
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
// ---------------------------------------------------------------------------
// 嵌套深度词法守卫（官方 fetch.ts:120-223 的移植）
// ---------------------------------------------------------------------------
/** 永不接收闭合标签的元素：不进词法栈。 */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
/** 正文按纯文本解析、直到匹配闭合标签的元素。 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript']);
/** 一个字符能否出现在 raw-text 闭合标签名之后。 */
function isTagBoundary(char) {
    return char === undefined || char === '>' || char === '/' || /\s/.test(char);
}
/** 找 raw-text 元素的匹配闭合标签，不把正文里长得像标记的文本当标签。 */
function findRawTextEnd(lowerHtml, name, from) {
    const prefix = `</${name}`;
    let candidate = lowerHtml.indexOf(prefix, from);
    while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) {
        candidate = lowerHtml.indexOf(prefix, candidate + prefix.length);
    }
    return candidate;
}
/**
 * 保守地拒绝词法元素栈超过转换深度上限的 HTML。单遍扫描：忽略注释里的闭合
 * 标签、跳过 raw-text 正文、尊重引号里的 `>`、只接受与栈顶同名的闭合标签——
 * 畸形输入因此只会多计嵌套，不会把嵌套藏掉。
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
// ---------------------------------------------------------------------------
// title 提取
// ---------------------------------------------------------------------------
/** 只在开头固定窗口内找 `<title>`：title 位于 head、靠文档开头，窗口上限避免对超长正文全量扫描。 */
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
/** 解码数字字符引用（十进制与十六进制）；非法码点返回 null（保留原文）。 */
function decodeNumericEntity(body) {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!(code >= 0 && code <= 0x10ffff))
        return null;
    return String.fromCodePoint(code);
}
/** 单遍解码实体：`&amp;lt;` 只解成 `&lt;`，不会第二轮再解成 `<`。 */
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
 * 从 HTML 开头提取 `<title>` 并解码实体、压空白。找不到或解码后为空返回
 * `undefined`。注意：`<title>` 的文本按官方行为仍会留在 markdown 正文里
 * （官方 remove 列表不含 TITLE），本函数只负责回执的 `title` 字段。
 */
export function extractTitle(html) {
    const match = TITLE_PATTERN.exec(html.slice(0, TITLE_SCAN_CHARS));
    if (match === null)
        return undefined;
    const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
    return title === '' ? undefined : title;
}
// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
/** 转换不安全（超深或 turndown 抛错）时返回的固定省略标记。 */
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
 * 把 HTML 转成有界 GFM markdown。
 *
 * 流程：先按 `maxChars` 截断源串（记 `truncated`，与官方 renderBody 一致）→
 * 超深或 turndown 抛错 → 固定省略标记 + `omitted: true`（不让原始标记外漏）→
 * 否则转换，再按 `maxChars` 截断输出。`title` 一律从**原始** HTML 提取。
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
        // turndown 的 DOM 遍历按元素递归；词法守卫建模不了的畸形标记仍可能抛
        // RangeError。转换失败与超深走同一个省略标记，不把源标记带回模型上下文。
        return omittedResult(title, sourceTruncated, maxChars);
    }
    const outputTruncated = converted.length > maxChars;
    return {
        ...(title !== undefined ? { title } : {}),
        markdown: outputTruncated ? converted.slice(0, maxChars) : converted,
        truncated: sourceTruncated || outputTruncated,
        omitted: false,
    };
}
