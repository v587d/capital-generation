/**
 * 腾讯公开接口的最小内核：**零 import 的叶子模块**（只依赖 `net/throttle.js`，它自己也是叶子）。
 *
 * 为什么单独一份：host 平面的自选股（`capital-watchlist/index.js`）与插件侧的行情能力
 * （`tencent-http.ts`）必须共用三样东西——同一条出口节流链、同一份港美股字段位序表、同一套守卫。
 * 两条独立节流等于没有限流（东财那次的教训），两份位序表迟早只会修好一份（AGENTS.md §9.7）。
 * 这一层一旦被别的模块拖进来，host 半边就会顺带加载整棵插件依赖树，所以这里不放能力定义、
 * 不放 Dataset 依赖、也不放任何类型依赖。
 *
 * 错误文案与判定形状逐字保持历史形态（Agent 与用户看到的字符串不能因抽取而漂移）。
 */
import { createRequestThrottle } from '../net/throttle.js';
export const QUOTE_URL = 'https://qt.gtimg.cn/q=';
export const SMARTBOX_URL = 'https://smartbox.gtimg.cn/s3/';
/**
 * 腾讯出口的**唯一**节流链（进程级）。行情快照、分笔、K 线每一次换机、港美股快照、smartbox
 * 检索全部过这一条链——它们打的是同一家，按 IP 风控（429 / 空 data / 静默限流）。
 * 间隔取 120ms：与最早那版分笔翻页的节奏同量级。
 */
export const TENCENT_MIN_INTERVAL_MS = 120;
export const tencentThrottle = createRequestThrottle(TENCENT_MIN_INTERVAL_MS);
export function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function numberOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value === 'boolean')
        throw new Error('source returned boolean where a number was expected');
    const number = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(number) ? number : null;
}
export function requiredNumber(value, field) {
    const number = numberOrNull(value);
    if (number === null)
        throw new Error(`source returned an invalid ${field}`);
    return number;
}
export function sourceError(message, code = 'tencent_source_error') {
    const error = new Error(message);
    error.code = code;
    return error;
}
async function readResponse(response, encoding) {
    const bytes = await response.arrayBuffer();
    return new TextDecoder(encoding).decode(bytes);
}
/**
 * 腾讯出口的取文本：取消不排队（队首那个请求挂住时，把这次取消塞进队列等于把它吞掉，
 * `docs/dev/web-retriever.md` §4.2「取消原样抛出」），排队与最小间隔由节流链负责。
 */
export async function tencentGetText(url, signal, encoding = 'utf-8', init = {}) {
    signal.throwIfAborted();
    return tencentThrottle(async () => {
        const response = await fetch(url, {
            ...init,
            headers: { 'User-Agent': 'Mozilla/5.0', ...(init.headers ?? {}) },
            signal,
        });
        const text = await readResponse(response, encoding);
        if (!response.ok)
            throw sourceError(`Tencent HTTP ${response.status} for ${url}`, response.status === 429 ? 'tencent_rate_limit' : 'tencent_http_error');
        return text;
    });
}
/**
 * 港美股快照与 A 股快照**不能共用一份字段表**：实测腾讯在同一个 `~` 分隔串里换了列位——
 * 币种 A 股根本没有、港股在第 75 位、美股在第 35 位；换手率港股在第 59 位（分母是**总股本**）、
 * 美股在第 38 位（分母是**流通股本**）；成交额在港股**指数行**是万元级而个股行是元级。
 * 所以这两张表各自映射，并且只收能用算术或量级证明的列（docs/dev/tool-schema.md §10.2：口径猜错就是话说错）。
 */
export const HK_QUOTE_FIELDS = 78;
export const US_QUOTE_FIELDS = 73;
/**
 * 腾讯港美股时间戳是**交易所当地时间**。分隔符**按行漂移**：2026-10-05 那批同一份响应里，
 * 一行给 `YYYY/MM/DD HH:mm:ss`、另一行给 `YYYY-MM-DD HH:mm:ss`——所以两种都吃，输出统一成横杠那一种。
 * （写成占位符而不是真日期：这两个形状在源码里只差一个字符，肉眼读注释分不出来。）
 */
export function offshoreQuoteTime(value) {
    const match = /^(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(value ?? '').trim());
    return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : null;
}
/** 逐行拆出 `v_<symbol>="…"`；symbol 就是请求里写出去的那串，所以请求与回执能一对一核对。 */
export function snapshotRows(text, requested) {
    const rows = [];
    for (const line of text.split(';')) {
        const match = /^v_([\w.]+)="([^"]*)"/.exec(line.trim());
        if (!match)
            continue;
        if (!requested.has(match[1].toLowerCase()))
            continue;
        rows.push({ symbol: match[1], fields: match[2].split('~') });
    }
    return rows;
}
/** 港美股代码：HK 是 5 位数字（实测 `hk700`/`hk0700` 被上游静默丢掉，必须左补零），指数别名一律拒收。 */
export function normalizeHkCode(value, name) {
    const raw = String(value ?? '').trim().toUpperCase();
    const digits = /^(?:HK)?(\d{1,5})(?:\.HK)?$/.exec(raw)?.[1];
    if (!digits)
        throw new Error(`parameter ${name} must be a five-digit Hong Kong stock code (for example 00700, hk00700 or 700); HK index codes such as HSI/HSTECH are not supported here`);
    return digits.padStart(5, '0');
}
/**
 * 美股写法照原样收下（`AAPL` / `BRK.B` / `BABA.N` / `AAPL.OQ` 都是真实存在的说法），
 * 消歧交给上游（见 `usSymbolVariants`）：实测腾讯**快照只认不带后缀的写法**（`usBABA.N` 整行不回，
 * `usBABA` 认），而 K 线只认**带正确后缀**的写法（`usAAPL` 回一列 2011 年的陌生序列、
 * `usAAPL.NS` 静默 0 行）。点号既可能是级别码（BRK.B / BF.B）也可能是交易所后缀（.N / .OQ），
 * 从字面上分不出来——所以不猜。
 */
export function normalizeUsCode(value, name) {
    const raw = String(value ?? '').trim().toUpperCase();
    const match = /^(?:US)?([A-Z]{1,6}(?:\.[A-Z]{1,3}){0,2})$/.exec(raw);
    if (!match)
        throw new Error(`parameter ${name} must be a US equity ticker such as AAPL, BRK.B or BABA.N (a Tencent exchange suffix like .OQ is accepted and re-resolved from the snapshot)`);
    // 两位以上的点号尾段（.OQ/.AM/.NS）在腾讯那里一定是交易所后缀，直接剥掉，于是 AAPL 与 AAPL.OQ
    // 是同一只票、只请求一次。**单字母尾段**（BRK.B 的级别码 vs BABA.N 的交易所码）字面上分不开，
    // 就照原样留着，交给上游逐个写法裁决——猜错一次只是多一轮请求，猜错第二次就是把数据挂错标的。
    return match[1].replace(/\.[A-Z]{2,3}$/u, '');
}
/** 依次尝试的写法：原样 → 每次剥掉最后一段点号，最多剥两段（BRK.B.N → BRK.B → BRK）。 */
export function usSymbolVariants(ticker) {
    const variants = [`us${ticker}`];
    let current = ticker;
    for (let depth = 0; depth < 2; depth += 1) {
        const dot = current.lastIndexOf('.');
        if (dot <= 0)
            break;
        current = current.slice(0, dot);
        variants.push(`us${current}`);
    }
    return variants;
}
export function parseHkQuoteRows(text, requested) {
    const rows = [];
    for (const { symbol, fields } of snapshotRows(text, requested)) {
        if (fields.length < HK_QUOTE_FIELDS)
            throw sourceError(`Tencent HK quote ${symbol} returned ${fields.length} fields, expected at least ${HK_QUOTE_FIELDS}`, 'tencent_invalid_response');
        // 只收个股：指数行的第 6/37 位在实测里既不是"股"也不是"港元"（hkHSI 两列相等、量级像万元），
        // 两种量纲不许进同一列；参数层已经拒掉字母指数，这里再核对一次上游没把行串错。
        if (!/^\d{5}$/.test(fields[2] ?? ''))
            throw sourceError(`Tencent HK quote ${symbol} is not a five-digit stock code (got ${JSON.stringify(fields[2] ?? '')})`, 'tencent_invalid_response');
        const quoteTime = offshoreQuoteTime(fields[30]);
        if (quoteTime === null)
            throw sourceError(`Tencent HK quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response');
        const value = (index) => numberOrNull(fields[index]);
        const row = {
            code: fields[2],
            tencent_symbol: `hk${fields[2]}`,
            name: fields[1] ?? '',
            english_name: fields[46] ?? '',
            currency: fields[75] ?? '',
            price: value(3),
            last_close: value(4),
            open: value(5),
            high: value(33),
            low: value(34),
            change_amt: value(31),
            change_pct: value(32),
            amplitude_pct: value(43),
            volume_shares: value(6),
            amount_hkd: value(37),
            avg_price: value(73),
            turnover_pct: value(59),
            total_shares: value(69),
            market_cap_yi_hkd: value(45),
            board_lot_shares: value(60),
            quote_time: quoteTime,
        };
        const stale = row.amount_hkd === 0 && row.price !== null && row.price === row.last_close;
        row.is_stale = stale;
        row.stale_reason = stale ? 'zero turnover and price equals previous close' : null;
        rows.push(row);
    }
    return rows;
}
export function parseUsQuoteRows(text, requested) {
    const rows = [];
    for (const { symbol, fields } of snapshotRows(text, requested)) {
        if (fields.length < US_QUOTE_FIELDS)
            throw sourceError(`Tencent US quote ${symbol} returned ${fields.length} fields, expected at least ${US_QUOTE_FIELDS}`, 'tencent_invalid_response');
        // 上游在 2 号位回交易所后缀（AAPL.OQ / BABA.N），这是 K 线入口要用的身份，缺了就无法核对。
        // 交易所后缀实测有**一个字母**的（NYSE：BABA.N / BRK.B.N），把下限写成 2 会把真代码判成畸形。
        if (!/^[A-Z][A-Z.]{0,9}\.[A-Z]{1,3}$/.test(fields[2] ?? ''))
            throw sourceError(`Tencent US quote ${symbol} has an unexpected code ${JSON.stringify(fields[2] ?? '')}`, 'tencent_invalid_response');
        const quoteTime = offshoreQuoteTime(fields[30]);
        if (quoteTime === null)
            throw sourceError(`Tencent US quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response');
        const value = (index) => numberOrNull(fields[index]);
        const row = {
            code: fields[2],
            tencent_symbol: `us${fields[2]}`,
            exchange_code: fields[2].slice(fields[2].lastIndexOf('.') + 1),
            name: fields[1] ?? '',
            english_name: fields[46] ?? '',
            currency: fields[35] ?? '',
            price: value(3),
            last_close: value(4),
            open: value(5),
            high: value(33),
            low: value(34),
            change_amt: value(31),
            change_pct: value(32),
            amplitude_pct: value(43),
            volume_shares: value(6),
            amount_usd: value(37),
            avg_price: value(67),
            turnover_pct: value(38),
            total_shares: value(62),
            float_shares: value(63),
            float_market_cap_yi_usd: value(44),
            market_cap_yi_usd: value(45),
            quote_time: quoteTime,
        };
        const stale = row.amount_usd === 0 && row.price !== null && row.price === row.last_close;
        row.is_stale = stale;
        row.stale_reason = stale ? 'zero turnover and price equals previous close' : null;
        // symbol 是"哪个写法换来了这一行"，只给上面的重试判定用，不出现在行里。
        rows.push({ symbol, row });
    }
    return rows;
}
/**
 * **港美股指数快照**：只收点位那一族能证明的列。
 *
 * 为什么必须另开一张表（而不是复用个股那张）：实测指数行的量纲列不可读——
 * 港 `hkHSI` 的第 6 / 36 / 37 位两列相等且量级像万元，美 `usIXIC` 的第 37 位给了 2.1e14、
 * 第 38 / 44 / 45 / 62 / 63 位是空。把这些列收进输出表就等于承诺一个我们证明不了的口径。
 *
 * 也**不收币种**：上游确实在第 75 / 35 位塞了 `HKD` / `USD`，但点位是无量纲的数，
 * 替它标货币单位是替上游说话（`docs/design/watchlist-hk-us.md` §3.5）。
 *
 * 身份守卫是形状而非猜测：指数行第 2 位美股回 `.IXIC`（**前导点**）、港股回 `HSI`（**纯字母**）；
 * 个股行美股回 `AAPL.OQ`（点在中间）、港股回 `00700`（5 位数字）。2026-10-07 实测踩到过
 * `usSSPX` 回的是 `SSPX.AM`（一只 ETF）——所以猜写法拿指数必错，而这一层的形状核对是最后一道闸。
 */
export function parseOffshoreIndexRows(text, requested, market) {
    const fieldFloor = market === 'hk' ? HK_QUOTE_FIELDS : US_QUOTE_FIELDS;
    const codeOf = (code) => (market === 'hk' ? code : code.replace(/^./u, ''));
    const rows = [];
    for (const { symbol, fields } of snapshotRows(text, requested)) {
        if (fields.length < fieldFloor)
            throw sourceError(`Tencent ${market} index quote ${symbol} returned ${fields.length} fields, expected at least ${fieldFloor}`, 'tencent_invalid_response');
        const raw = String(fields[2] ?? '');
        // 港：字母指数码；美：`.字母`。两种都明确排除个股形状（数字 / 点在中间的后缀形式）。
        const shapeOk = market === 'hk' ? /^[A-Z][A-Z0-9.]{1,9}$/u.test(raw) : /^\.[A-Z][A-Z0-9.]{1,9}$/u.test(raw);
        if (!shapeOk)
            throw sourceError(`Tencent ${market} index quote ${symbol} is not an index code (got ${JSON.stringify(raw)})`, 'tencent_invalid_response');
        const quoteTime = offshoreQuoteTime(fields[30]);
        if (quoteTime === null)
            throw sourceError(`Tencent ${market} index quote ${symbol} has an unreadable timestamp ${JSON.stringify(fields[30] ?? '')}`, 'tencent_invalid_response');
        const value = (index) => numberOrNull(fields[index]);
        rows.push({
            code: codeOf(raw),
            tencent_symbol: symbol,
            name: fields[1] ?? '',
            english_name: fields[46] ?? '',
            price: value(3),
            last_close: value(4),
            open: value(5),
            high: value(33),
            low: value(34),
            change_amt: value(31),
            change_pct: value(32),
            amplitude_pct: value(43),
            quote_time: quoteTime,
        });
    }
    return rows;
}
/** 港美股指数代码：HK 是字母码（HSI / HSTECH / HSCEI），美是裸字母码（IXIC / DJI / INX，请求时不带那个前导点）。 */
export function normalizeOffshoreIndexCode(value, name, market) {
    const raw = String(value ?? '').trim().toUpperCase().replace(/^(?:HK|US)/u, '');
    const stem = raw.replace(/^\./u, '').replace(/\.(?:HK|US)$/u, '');
    if (market === 'hk' && /^(?:\d{1,5}|hk\d{1,5})$/u.test(raw)) {
        throw new Error(`parameter ${name} must be a Hong Kong index code such as HSI or HSTECH (five-digit codes belong to tencent_hk_quote: 实测指数行与个股行的量纲列不同)`);
    }
    if (!/^[A-Z][A-Z0-9.]{1,9}$/u.test(stem)) {
        throw new Error(`parameter ${name} must be an index code letters only (for example HSI, HSTECH for HK or IXIC, DJI, INX for US) — 实测腾讯不认 usSPX / usNDQ / usSOX / usRUT，写法只认检索回来的那个`);
    }
    return stem;
}
/**
 * 港美股快照的**唯一**取数编排（能力侧与自选股面板共用）。
 * 港股一次批量问完；美股先按原写法问一轮，**没回行**的那几只才用剥掉后缀的写法再问，
 * 所以正常路径（纯字母 ticker）一次请求都不多花。
 */
export async function fetchOffshoreQuotes(market, codes, signal) {
    if (market === 'hk') {
        const symbols = codes.map((code) => `hk${code}`);
        const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk');
        const rows = parseHkQuoteRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())));
        if (rows.length === 0)
            throw sourceError(`Tencent returned no HK quote rows for ${symbols.join(',')}`, 'tencent_empty_response');
        return rows;
    }
    const pending = codes.map((ticker) => usSymbolVariants(ticker));
    const rows = [];
    const tried = new Set();
    for (let round = 0; round < 3 && pending.some((list) => list.length > 0); round += 1) {
        const symbols = pending.map((list) => list.shift()).filter((symbol) => Boolean(symbol));
        for (const symbol of symbols)
            tried.add(symbol.toLowerCase());
        const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk');
        const found = parseUsQuoteRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())));
        // 上游把变量名原样回显（实测送 `usBRK.B` 回 `v_usBRK.B`），但"这一只没回行"的判断不该押在大小写上：
        // 比不中就会对一只已经拿到数的票再问一轮剥短写法，白烧一次出网。
        const hit = new Set(found.map((item) => item.symbol.toLowerCase()));
        rows.push(...found.map((item) => item.row));
        for (let index = 0; index < symbols.length; index += 1) {
            if (hit.has(symbols[index].toLowerCase())) {
                pending[index] = [];
                continue;
            }
            // 快照没认这个写法：剥一段点号再看；剥无可剥就只能认定腾讯不认识这只（不编造身份）。
            const next = pending[index].find((variant) => !tried.has(variant.toLowerCase()));
            if (next !== undefined)
                pending[index] = [next, ...pending[index].filter((variant) => variant !== next)];
        }
    }
    if (rows.length === 0)
        throw sourceError(`Tencent returned no US quote rows for ${codes.join(',')}`, 'tencent_empty_response');
    return rows;
}
/** 港美股指数快照的取数编排：字母码没有"剥后缀重问"这一说，所以一轮问完。 */
export async function fetchOffshoreIndexQuotes(market, codes, signal) {
    const symbols = codes.map((code) => `${market}${code}`);
    const text = await tencentGetText(`${QUOTE_URL}${symbols.join(',')}`, signal, 'gbk');
    const rows = parseOffshoreIndexRows(text, new Set(symbols.map((symbol) => symbol.toLowerCase())), market);
    if (rows.length === 0)
        throw sourceError(`Tencent returned no ${market} index quote rows for ${symbols.join(',')}`, 'tencent_empty_response');
    return rows;
}
/** 美股 K 线入口需要的带后缀身份：先从快照拿上游自己的第 2 位（能力侧用，形状判据同一条）。 */
export async function resolveUsKlineSymbol(ticker, signal) {
    for (const symbol of usSymbolVariants(ticker)) {
        const text = await tencentGetText(`${QUOTE_URL}${symbol}`, signal, 'gbk');
        const [row] = snapshotRows(text, new Set([symbol.toLowerCase()]));
        if (!row || row.fields.length < US_QUOTE_FIELDS)
            continue;
        const code = row.fields[2];
        if (!/^[A-Z][A-Z.]{0,9}\.[A-Z]{1,3}$/.test(code))
            throw sourceError(`Tencent returned an unreadable US code ${JSON.stringify(code)}`, 'tencent_invalid_response');
        return `us${code}`;
    }
    throw new Error(`Tencent does not recognize US ticker ${ticker}; no spelling of it returned a snapshot to resolve an exchange`);
}
export function parseSmartbox(text) {
    const match = /v_hint="([\s\S]*)"/.exec(text);
    const body = match?.[1] ?? '';
    if (body === 'N' || body.length === 0)
        return [];
    const candidates = [];
    for (const entry of body.split('^')) {
        const parts = unescapeHint(entry).split('~');
        if (parts.length < 5)
            continue;
        const [market, code, name, pinyin, type] = parts;
        if (!market || !code)
            continue;
        candidates.push({ market: market.toLowerCase(), code: code.toUpperCase(), name, pinyin, type });
    }
    return candidates;
}
/** 回包里的名称是 `\uXXXX` 字面转义（实测），解一次转义；解不动就原样返回，不编造名称。 */
function unescapeHint(value) {
    if (!value.includes('\\u'))
        return value;
    try {
        return value.replace(/\\u([\da-f]{4})/giu, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    }
    catch {
        return value;
    }
}
/** smartbox 检索：市场段只能是上游认的单值（`hk` / `us` / `all`），列表形态实测失效。 */
export const SMARTBOX_MARKETS = ['all', 'hk', 'us'];
export async function fetchSmartbox(query, market, signal) {
    if (!SMARTBOX_MARKETS.includes(market))
        throw new Error(`smartbox market must be one of ${SMARTBOX_MARKETS.join('/')}; got ${JSON.stringify(market)}（列表形态实测回 N 哨兵，等于查无此票）`);
    const url = `${SMARTBOX_URL}?v=2&t=${encodeURIComponent(market)}&q=${encodeURIComponent(query)}`;
    // 名称是 `\uXXXX` 字面转义、正文全 ASCII，所以走 utf-8；'ascii' 这个标签在 Encoding Standard 里
    // 映射的是 windows-1252，不是 US-ASCII，拿来解 ASCII 正文是个埋着的坑。
    const text = await tencentGetText(url, signal);
    return parseSmartbox(text);
}
