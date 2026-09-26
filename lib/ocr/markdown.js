/**
 * PaddleOCR 输出 → 模型可读 markdown 的归一化（`ocr` 的呈现层，唯一一份实现）。
 *
 * 为什么必须归一化（2026-09-25 拿真报文实测，贵州茅台 15 页研报）：上游把**表格输出成内联
 * HTML**，每个单元格都带 `style='text-align: center; word-wrap: break-word;'`——
 * 105,639 个字符里 63,232 个（60%）是 `style='...'` 样板，去掉再转成 GFM 管道表只剩 27,156。
 * 本仓的场景恰恰是"大量表格、图形"，不处理就等于**预算的六成买的是 HTML 属性**，
 * 而 `prettifyMarkdown` 这类 flag 在上游被静默忽略（未知键也返回 Success），帮不上。
 *
 * 归一化只做**无损排版**：不删正文、不改数字、不做摘要。数字一律照抄上游。
 */
const PAGE_MARKER_PREFIX = '<!-- page:';
/** HTML 实体：财报文档里 `&amp;` 出现在公司名与科目名里，不解开就是脏数据。 */
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
    // GFM 单元格里的竖线必须转义，否则一行被切成更多列——表格串列比报错危险（声明与正文不一致）。
    return value.replace(/\|/gu, '\\|');
}
/** 取一行 `<tr>` 里的单元格文本。 */
function rowCells(row) {
    const cells = [];
    // 先按**开**标签切：畸形行（少写 `</td>`，实测存在）也能一格一切；再按闭标签截断本段，
    // 防止 `1</td><td>2` 这类残留把下一格的内容并进来。第一格之前的 `<thead>` 碎片一律丢弃。
    // ⚠️ 单元格标签是 `<td>` **或** `<th>`（上游表头行用 `<th>`，实测）：写成 `<t(?:d|th)`
    //    只匹配得到 `<td`，`<th>` 行切不出格、整行被 `kept` 丢掉——表头静默消失。
    //    `\b` 在这里是必要的：它让 `<thead>` / `<table>` 不被误当成单元格开标签。
    for (const segment of row.split(/<t(?:d|h)\b[^>]*>/giu).slice(1)) {
        cells.push(stripTags(segment.split(/<\/t(?:d|h)\s*>/iu)[0] ?? ''));
    }
    return cells;
}
/**
 * 一张 HTML 表 → GFM 管道表。
 *
 * 表头按上游第一行处理（上游会把 `<thead><th>` 放第一行）；列数以各行最大值为准并补齐，
 * 因为 GFM 要求分隔行列数与表头一致，少一格整张表退化成裸文本。
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
/** 剥样式 + HTML 表转 GFM + 收空行。对不含 HTML 的正文近似恒等。 */
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
        // 上游会把标题粘在正文尾巴上（实测 `2024-11-12## 盈利预测`），标题不在行首就没法进索引；
        // 要求 `#` 后必须有空格，避免把 "评级#买入" 这类没有空格的井号误拆。
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
/** 把逐页 markdown 拼成一份文档，并算出**页偏移索引**（按页取回与关键词定位都靠它）。 */
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
 * 页区间解析：`"1-3"` / `"5"` / `"2-4,9"`（1 起始，闭区间）。
 * 越界页码**响亮失败**而不是静默少给——"这页没有"和"我没给"在回执里必须能区分。
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
/** 按页切出正文（纯字符串切片，不重跑上游）。 */
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
 * 关键词定位：在**已落盘的文档**里找命中，回带页号的上下文片段。
 *
 * 为什么不靠 `pages` 硬读：一份 15 页研报归一化后约 2.7 万字符，而工具输出预算 6,144——
 * 想拿财务预测表就得能"跳着看"。上游页区间不影响算力（整篇都算过），所以定位必须在这份
 * 归一化文本上做，不再出网。
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
        // 相邻命中合并成一段窗口：否则同一句话的三次命中会占满 limit，看着像三条证据其实是一条。
        if (at < lastEnd)
            continue;
        const entry = pageOf(document.pages, at);
        // 窗口**不越页**：片段被标成"第 N 页"就是要能被引用回第 N 页，跨了页就是错引（错引比少引危险）。
        // 顺带把 `<!-- page:N -->` 存储标记挡在外面——那是落盘布局，不是给模型回传正文的东西。
        const from = Math.max(entry?.start ?? 0, at - windowChars);
        const to = Math.min(entry?.end ?? haystack.length, at + needle.length + windowChars);
        hits.push({ page: entry?.page ?? 1, at, excerpt: haystack.slice(from, to).replace(/\n+/gu, ' ⏎ ') });
        lastEnd = to;
    }
    return hits;
}
export { PAGE_MARKER_PREFIX };
