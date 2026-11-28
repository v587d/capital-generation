/** SEC EDGAR sources: ticker→CIK, submissions, daily index, full-text search and XBRL frames.
 * Contract probes stay shadow until a live SEC egress passes; fixtures mirror official payloads.
 */
import { buildDataKey, outputSchemaIssues } from '../data-collector/hub.js';
import { getDataTimeContract } from '../time/tools.js';
import { createRequestThrottle } from '../net/throttle.js';
const SEC_WWW = 'https://www.sec.gov';
const SEC_DATA = 'https://data.sec.gov';
const SEC_EFTS = 'https://efts.sec.gov';
const DEFAULT_USER_AGENT = 'capital-generation (+https://github.com/v587d/capital-generation)';
/** SEC allows 10 req/s; 8/s keeps a margin for retries and other SEC consumers on the same IP. */
const SEC_MIN_INTERVAL_MS = 125;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const secThrottle = createRequestThrottle(SEC_MIN_INTERVAL_MS);
function userAgent() {
    const env = globalThis.process?.env;
    const override = env?.SEC_USER_AGENT?.trim();
    return override !== undefined && override.length > 0 ? override : DEFAULT_USER_AGENT;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function sourceError(message, code = 'sec_invalid_response') {
    const error = new Error(message);
    error.code = code;
    return error;
}
function assertKnown(params, allowed) {
    for (const key of Object.keys(params)) {
        if (!allowed.includes(key))
            throw new Error(`unsupported parameter: ${key} (allowed: ${allowed.join(', ')})`);
    }
}
function calendarDate(value, name) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!DATE_PATTERN.test(text))
        throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`);
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)
        throw new Error(`parameter ${name} must be a valid YYYY-MM-DD date`);
    return text;
}
function numberOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}
function textOrNull(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length === 0 ? null : text;
}
function boolOrNull(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value === 'boolean')
        return value;
    const text = String(value).trim().toLowerCase();
    if (text === '1' || text === 'true' || text === 'y')
        return true;
    if (text === '0' || text === 'false' || text === 'n')
        return false;
    return null;
}
/** CIK is printed padded to 10 digits everywhere; the JSON `cik` field is unpadded. */
function padCik(value) {
    const digits = String(value ?? '').trim().replace(/^0+/, '');
    if (!/^\d{1,10}$/.test(digits))
        throw sourceError(`CIK is not numeric: ${JSON.stringify(String(value ?? ''))}`);
    return digits.padStart(10, '0');
}
async function secText(url, signal, label) {
    signal.throwIfAborted();
    return secThrottle(async () => {
        let response;
        try {
            response = await fetch(url, {
                headers: { 'User-Agent': userAgent(), Accept: 'application/json, text/plain, */*', 'Accept-Encoding': 'gzip, deflate' },
                signal,
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw error;
            throw sourceError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`, 'sec_http_error');
        }
        if (response.status === 403)
            throw sourceError(`${label} returned HTTP 403: SEC requires a declarative User-Agent (set SEC_USER_AGENT) and no more than 10 req/s`, 'sec_forbidden');
        if (response.status === 404)
            throw sourceError(`${label} returned HTTP 404: no such filing day, CIK or endpoint`, 'sec_not_found');
        if (!response.ok)
            throw sourceError(`${label} returned HTTP ${response.status}`, 'sec_http_error');
        return response.text();
    });
}
async function secJson(url, signal, label) {
    const text = await secText(url, signal, label);
    try {
        return JSON.parse(text);
    }
    catch {
        throw sourceError(`${label} returned non-JSON: ${JSON.stringify(text.slice(0, 120))}`);
    }
}
/** company_tickers.json is ~1MB and changes rarely; one in-process copy per TTL is enough. */
const TICKER_CACHE_TTL_MS = 3_600_000;
let tickerCache;
async function tickerMap(signal) {
    if (tickerCache !== undefined && Date.now() - tickerCache.at < TICKER_CACHE_TTL_MS)
        return tickerCache.map;
    const payload = await secJson(`${SEC_WWW}/files/company_tickers.json`, signal, 'SEC company_tickers');
    if (!isRecord(payload))
        throw sourceError('SEC company_tickers response is not an object');
    const map = new Map();
    for (const value of Object.values(payload)) {
        if (!isRecord(value))
            continue;
        const ticker = textOrNull(value.ticker);
        const title = textOrNull(value.title);
        const cik = value.cik_str;
        if (ticker === null || title === null || cik === undefined || cik === null)
            continue;
        map.set(ticker.toUpperCase(), { cik: padCik(cik), title });
    }
    if (map.size === 0)
        throw sourceError('SEC company_tickers response has no ticker rows');
    tickerCache = { at: Date.now(), map };
    return map;
}
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] };
const nullableBoolean = { oneOf: [{ type: 'boolean' }, { type: 'null' }] };
const tickerCikRow = {
    type: 'object',
    properties: {
        ticker: { type: 'string' },
        cik: nullableString,
        company_name: nullableString,
        found: { type: 'boolean' },
    },
    required: ['ticker', 'found'],
    additionalProperties: false,
};
function normalizeTickers(params) {
    assertKnown(params, ['tickers']);
    if (!Array.isArray(params.tickers) || params.tickers.length === 0)
        throw new Error('tickers must be a non-empty array');
    if (params.tickers.length > 20)
        throw new Error('tickers exceeds maximum 20');
    const tickers = [...new Set(params.tickers.map((value) => {
            if (typeof value !== 'string')
                throw new Error('tickers[] must be a string');
            const ticker = value.trim().toUpperCase();
            if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker))
                throw new Error(`tickers[] must be a US ticker, got ${JSON.stringify(value)}`);
            return ticker;
        }))];
    return { tickers };
}
async function executeTickerCik(params, signal) {
    const map = await tickerMap(signal);
    const rows = params.tickers.map((ticker) => {
        const entry = map.get(ticker);
        return entry === undefined
            ? { ticker, cik: null, company_name: null, found: false }
            : { ticker, cik: entry.cik, company_name: entry.title, found: true };
    });
    return { data: rows, schema: tickerCikRow };
}
// ── submissions (recent filings) ─────────────────────────────────────────────
const filingRow = {
    type: 'object',
    properties: {
        cik: { type: 'string' },
        company_name: { type: 'string' },
        form: { type: 'string' },
        filing_date: { type: 'string' },
        report_date: nullableString,
        acceptance_datetime: nullableString,
        accession_number: { type: 'string' },
        primary_document: nullableString,
        primary_doc_description: nullableString,
        items: nullableString,
        size: nullableNumber,
        is_xbrl: nullableBoolean,
        is_inline_xbrl: nullableBoolean,
        file_number: nullableString,
        film_number: nullableString,
        url: nullableString,
    },
    required: ['cik', 'company_name', 'form', 'filing_date', 'accession_number'],
    additionalProperties: false,
};
function normalizeFilings(params) {
    assertKnown(params, ['ticker', 'cik', 'form', 'limit']);
    const ticker = params.ticker === undefined ? undefined : String(params.ticker).trim().toUpperCase();
    const cik = params.cik === undefined ? undefined : String(params.cik).trim();
    if ((ticker === undefined) === (cik === undefined))
        throw new Error('exactly one of ticker or cik is required');
    if (ticker !== undefined && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker))
        throw new Error('ticker must be a US ticker');
    if (cik !== undefined && !/^\d{1,10}$/.test(cik))
        throw new Error('cik must be 1 to 10 digits');
    const form = params.form === undefined ? undefined : String(params.form).trim().toUpperCase();
    const limit = params.limit === undefined ? 20 : Number(params.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error('limit must be an integer from 1 to 100');
    return { ...(ticker === undefined ? {} : { ticker }), ...(cik === undefined ? {} : { cik }), ...(form === undefined ? {} : { form }), limit };
}
function filingsUrl(cik, accession, primaryDocument) {
    if (primaryDocument === null)
        return null;
    return `${SEC_WWW}/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${primaryDocument}`;
}
async function executeFilings(params, signal) {
    let cik;
    if (params.ticker !== undefined) {
        const entry = (await tickerMap(signal)).get(String(params.ticker));
        if (entry === undefined)
            throw sourceError(`SEC ticker ${String(params.ticker)} is not in company_tickers.json`, 'sec_unknown_ticker');
        cik = entry.cik;
    }
    else {
        cik = padCik(params.cik);
    }
    const payload = await secJson(`${SEC_DATA}/submissions/CIK${cik}.json`, signal, `SEC submissions ${cik}`);
    if (!isRecord(payload))
        throw sourceError('SEC submissions response is not an object');
    const companyName = textOrNull(payload.entityName) ?? textOrNull(payload.name) ?? '';
    const filings = isRecord(payload.filings) && isRecord(payload.filings.recent) ? payload.filings.recent : undefined;
    if (filings === undefined)
        throw sourceError('SEC submissions response has no filings.recent block');
    const column = (name) => {
        const value = filings[name];
        if (!Array.isArray(value))
            throw sourceError(`SEC submissions filings.recent.${name} is not an array`);
        return value;
    };
    const accessions = column('accessionNumber');
    const forms = column('form');
    const filingDates = column('filingDate');
    if (accessions.length !== forms.length || accessions.length !== filingDates.length)
        throw sourceError('SEC submissions recent columns have different lengths');
    const reportDates = column('reportDate');
    const acceptance = column('acceptanceDateTime');
    const primaryDocuments = column('primaryDocument');
    const primaryDescriptions = column('primaryDocDescription');
    const items = column('items');
    const sizes = column('size');
    const xbrl = column('isXBRL');
    const inlineXbrl = column('isInlineXBRL');
    const fileNumbers = column('fileNumber');
    const filmNumbers = column('filmNumber');
    const wantedForm = params.form === undefined ? undefined : String(params.form);
    const rows = [];
    for (let index = 0; index < accessions.length && rows.length < Number(params.limit); index += 1) {
        const form = textOrNull(forms[index]);
        if (form === null)
            throw sourceError(`SEC submissions row ${index} has no form`);
        if (wantedForm !== undefined && form !== wantedForm)
            continue;
        const accession = textOrNull(accessions[index]);
        const filingDate = textOrNull(filingDates[index]);
        if (accession === null || filingDate === null)
            throw sourceError(`SEC submissions row ${index} has no accessionNumber/filingDate`);
        const primaryDocument = textOrNull(primaryDocuments[index]);
        rows.push({
            cik,
            company_name: companyName,
            form,
            filing_date: filingDate,
            report_date: textOrNull(reportDates[index]),
            acceptance_datetime: textOrNull(acceptance[index]),
            accession_number: accession,
            primary_document: primaryDocument,
            primary_doc_description: textOrNull(primaryDescriptions[index]),
            items: textOrNull(items[index]),
            size: numberOrNull(sizes[index]),
            is_xbrl: boolOrNull(xbrl[index]),
            is_inline_xbrl: boolOrNull(inlineXbrl[index]),
            file_number: textOrNull(fileNumbers[index]),
            film_number: textOrNull(filmNumbers[index]),
            url: filingsUrl(cik, accession, primaryDocument),
        });
    }
    return { data: rows, schema: filingRow };
}
// ── daily index ──────────────────────────────────────────────────────────────
const dailyIndexRow = {
    type: 'object',
    properties: {
        form_type: { type: 'string' },
        company_name: { type: 'string' },
        cik: { type: 'string' },
        filing_date: { type: 'string' },
        file_name: { type: 'string' },
        url: { type: 'string' },
    },
    required: ['form_type', 'company_name', 'cik', 'filing_date', 'file_name', 'url'],
    additionalProperties: false,
};
function normalizeDailyFilings(params) {
    assertKnown(params, ['filing_date', 'form']);
    const filing_date = calendarDate(params.filing_date, 'filing_date');
    const form = params.form === undefined ? undefined : String(params.form).trim().toUpperCase();
    return { filing_date, ...(form === undefined ? {} : { form }) };
}
/** `form.YYYYMMDD.idx` uses pipes or fixed-width columns; the fixed-width header may wrap. */
function parseDailyIndex(text, label) {
    const lines = text.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => /Form Type/i.test(line) && /Company Name/i.test(line));
    if (headerIndex < 0)
        throw sourceError(`${label} has no header row`);
    let separatorIndex = headerIndex;
    while (separatorIndex < lines.length && !/^-{5,}/.test(lines[separatorIndex].trim()))
        separatorIndex += 1;
    if (separatorIndex >= lines.length)
        throw sourceError(`${label} has no header separator`);
    const header = lines.slice(headerIndex, separatorIndex).filter((line) => line.trim().length > 0).join(' ');
    const pipe = header.includes('|');
    const cellsOf = (line) => pipe
        ? line.split('|').map((cell) => cell.trim())
        : line.trim().split(/\s{2,}/).map((cell) => cell.trim());
    const names = cellsOf(header);
    const indexOf = (pattern) => names.findIndex((name) => pattern.test(name));
    const formIndex = indexOf(/^Form Type$/i);
    const companyIndex = indexOf(/^Company Name$/i);
    const cikIndex = indexOf(/^CIK$/i);
    const dateIndex = indexOf(/^Date Filed$/i);
    const fileIndex = indexOf(/^File Name$/i);
    if ([formIndex, companyIndex, cikIndex, dateIndex, fileIndex].some((index) => index < 0))
        throw sourceError(`${label} header columns changed: ${header}`);
    const rows = [];
    for (const line of lines.slice(separatorIndex + 1)) {
        if (line.trim().length === 0 || /^-{5,}/.test(line.trim()))
            continue;
        const cells = cellsOf(line);
        if (cells.length <= Math.max(formIndex, companyIndex, cikIndex, dateIndex, fileIndex))
            throw sourceError(`${label} row has ${cells.length} cells: ${line.slice(0, 120)}`);
        const rawDate = cells[dateIndex];
        let filingDate = rawDate;
        if (!DATE_PATTERN.test(filingDate) && /^\d{8}$/.test(filingDate)) {
            filingDate = `${filingDate.slice(0, 4)}-${filingDate.slice(4, 6)}-${filingDate.slice(6, 8)}`;
        }
        if (!DATE_PATTERN.test(filingDate))
            throw sourceError(`${label} row date is not YYYYMMDD or YYYY-MM-DD: ${JSON.stringify(rawDate)}`);
        const fileName = cells[fileIndex];
        rows.push({
            form_type: cells[formIndex],
            company_name: cells[companyIndex],
            cik: padCik(cells[cikIndex]),
            filing_date: filingDate,
            file_name: fileName,
            url: `${SEC_WWW}/Archives/${fileName}`,
        });
    }
    return rows;
}
async function executeDailyFilings(params, signal) {
    const filingDate = String(params.filing_date);
    const year = filingDate.slice(0, 4);
    const month = Number(filingDate.slice(5, 7));
    const quarter = Math.floor((month - 1) / 3) + 1;
    const compact = filingDate.replaceAll('-', '');
    const url = `${SEC_WWW}/Archives/edgar/daily-index/${year}/QTR${quarter}/form.${compact}.idx`;
    const text = await secText(url, signal, `SEC daily index ${filingDate}`);
    const wantedForm = params.form === undefined ? undefined : String(params.form);
    const rows = parseDailyIndex(text, `SEC daily index ${filingDate}`).filter((row) => wantedForm === undefined || row.form_type === wantedForm);
    return { data: rows, schema: dailyIndexRow };
}
// ── full-text search ─────────────────────────────────────────────────────────
const fulltextRow = {
    type: 'object',
    properties: {
        accession_number: { type: 'string' },
        form: nullableString,
        file_date: nullableString,
        period_ending: nullableString,
        cik: nullableString,
        display_name: nullableString,
        file_type: nullableString,
        file_name: nullableString,
        url: nullableString,
    },
    required: ['accession_number'],
    additionalProperties: false,
};
function normalizeFulltext(params) {
    assertKnown(params, ['q', 'forms', 'start_date', 'end_date', 'limit']);
    const q = typeof params.q === 'string' ? params.q.trim() : '';
    if (q.length === 0 || q.length > 200)
        throw new Error('q must be a non-empty string of at most 200 characters');
    let forms;
    if (params.forms !== undefined) {
        if (!Array.isArray(params.forms) || params.forms.length === 0 || params.forms.length > 5)
            throw new Error('forms must be an array of 1 to 5 form types');
        forms = [...new Set(params.forms.map((value) => {
                if (typeof value !== 'string' || value.trim().length === 0)
                    throw new Error('forms[] must be a non-empty string');
                return value.trim().toUpperCase();
            }))];
    }
    const hasStart = params.start_date !== undefined;
    const hasEnd = params.end_date !== undefined;
    if (hasStart !== hasEnd)
        throw new Error('start_date and end_date must be given together');
    const start_date = hasStart ? calendarDate(params.start_date, 'start_date') : undefined;
    const end_date = hasEnd ? calendarDate(params.end_date, 'end_date') : undefined;
    if (start_date !== undefined && end_date !== undefined && start_date > end_date)
        throw new Error('start_date must not be later than end_date');
    const limit = params.limit === undefined ? 10 : Number(params.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error('limit must be an integer from 1 to 100');
    return { q, ...(forms === undefined ? {} : { forms }), ...(start_date === undefined ? {} : { start_date }), ...(end_date === undefined ? {} : { end_date }), limit };
}
async function executeFulltext(params, signal) {
    const query = new URLSearchParams();
    query.set('q', String(params.q));
    if (params.forms !== undefined)
        query.set('forms', params.forms.join(','));
    if (params.start_date !== undefined && params.end_date !== undefined) {
        query.set('dateRange', 'custom');
        query.set('startdt', String(params.start_date));
        query.set('enddt', String(params.end_date));
    }
    const url = `${SEC_EFTS}/LATEST/search-index?${query.toString()}`;
    const payload = await secJson(url, signal, 'SEC full-text search');
    if (!isRecord(payload) || !isRecord(payload.hits) || !Array.isArray(payload.hits.hits))
        throw sourceError('SEC full-text search response has no hits.hits array');
    const rows = [];
    for (const hit of payload.hits.hits.slice(0, Number(params.limit))) {
        if (!isRecord(hit))
            throw sourceError('SEC full-text search hit is not an object');
        const id = typeof hit._id === 'string' ? hit._id : '';
        const source = isRecord(hit._source) ? hit._source : {};
        const accession = textOrNull(source.adsh) ?? (id.includes(':') ? id.slice(0, id.indexOf(':')) : null);
        if (accession === null)
            throw sourceError('SEC full-text search hit has no accession number');
        const fileName = id.includes(':') ? id.slice(id.indexOf(':') + 1) : null;
        const ciks = Array.isArray(source.ciks) ? source.ciks.map((value) => String(value)) : [];
        const names = Array.isArray(source.display_names) ? source.display_names.map((value) => String(value)) : [];
        const cik = ciks.length > 0 ? padCik(ciks[0]) : null;
        rows.push({
            accession_number: accession,
            form: textOrNull(source.form),
            file_date: textOrNull(source.file_date),
            period_ending: textOrNull(source.period_ending),
            cik,
            display_name: names.length > 0 ? textOrNull(names[0]) : null,
            file_type: textOrNull(source.file_type),
            file_name: fileName,
            url: cik === null || fileName === null ? null : `${SEC_WWW}/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${fileName}`,
        });
    }
    return { data: rows, schema: fulltextRow };
}
// ── XBRL frames ──────────────────────────────────────────────────────────────
const FRAME_PERIOD_PATTERN = /^CY\d{4}(?:Q[1-4])?I?$/;
const marketFrameRow = {
    type: 'object',
    properties: {
        cik: { type: 'string' },
        entity_name: { type: 'string' },
        value: nullableNumber,
        accession_number: { type: 'string' },
        start_date: nullableString,
        end_date: { type: 'string' },
        location: nullableString,
    },
    required: ['cik', 'entity_name', 'accession_number', 'end_date'],
    additionalProperties: false,
};
function normalizeMarketFrame(params) {
    assertKnown(params, ['tag', 'unit', 'period']);
    const tag = typeof params.tag === 'string' ? params.tag.trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tag))
        throw new Error('tag must be a us-gaap tag such as Assets or Revenues');
    const unit = params.unit === undefined ? 'USD' : String(params.unit).trim();
    if (!/^[A-Za-z]+$/.test(unit))
        throw new Error('unit must be a unit code such as USD or shares');
    const period = typeof params.period === 'string' ? params.period.trim().toUpperCase() : '';
    if (!FRAME_PERIOD_PATTERN.test(period))
        throw new Error('period must look like CY2025Q1I (instant), CY2025Q1 (duration) or CY2025');
    return { tag, unit, period };
}
async function executeMarketFrame(params, signal) {
    const tag = String(params.tag);
    const unit = String(params.unit);
    const period = String(params.period);
    const url = `${SEC_DATA}/api/xbrl/frames/us-gaap/${encodeURIComponent(tag)}/${encodeURIComponent(unit)}/${encodeURIComponent(period)}.json`;
    const payload = await secJson(url, signal, `SEC frames ${tag}/${unit}/${period}`);
    if (!isRecord(payload) || !Array.isArray(payload.data))
        throw sourceError(`SEC frames ${tag}/${unit}/${period} response has no data array`);
    const rows = payload.data.map((raw, index) => {
        if (!isRecord(raw))
            throw sourceError(`SEC frames row ${index} is not an object`);
        const endDate = textOrNull(raw.end);
        const accession = textOrNull(raw.accn);
        if (endDate === null || accession === null)
            throw sourceError(`SEC frames row ${index} has no end/accn`);
        return {
            cik: padCik(raw.cik),
            entity_name: textOrNull(raw.entityName) ?? (() => { throw sourceError(`SEC frames row ${index} has no entityName`); })(),
            value: numberOrNull(raw.val),
            accession_number: accession,
            start_date: textOrNull(raw.start),
            end_date: endDate,
            location: textOrNull(raw.loc),
        };
    });
    return { data: rows, schema: marketFrameRow };
}
// ── registration ─────────────────────────────────────────────────────────────
function createSecSource(options) {
    const schema = {
        capability: options.capability,
        time_contract: getDataTimeContract(options.capability),
        name: options.name,
        source: `http:us-official.${options.capability}`,
        data_key: buildDataKey('us_official', 'http', options.capability),
        source_label: 'us_official',
        paginated: false,
        cacheMaxAgeMs: options.cacheMaxAgeMs,
        rowShape: { rootArray: true },
        summary: options.summary,
        description: options.description,
        input_schema: options.inputSchema,
        output_schema: options.outputSchema,
    };
    return {
        schema,
        normalizeParams: (params) => options.normalize(params),
        validateOutput: (data) => options.validateOutput(data) && outputSchemaIssues(options.outputSchema, data).length === 0,
        execute: async (request, signal) => options.execute(options.normalize(request.params), signal),
    };
}
export function createSecSources() {
    return [
        createSecSource({
            capability: 'sec_ticker_cik',
            cacheMaxAgeMs: 86_400_000,
            name: 'get_sec_ticker_cik',
            summary: '美股 ticker → SEC CIK（批量）',
            description: '把美股 ticker 映射到 SEC CIK（company_tickers.json，零 key）。`tickers` 1–20 个、自动大写去重；每个请求的 ticker 都返回一行，**未收录的 ticker 用 `found=false` + `cik=null` 显式标出，不是静默丢行**（该文件只含美股注册人，ADR/ETF 有时不在其中）。`cik` 是 10 位零填充字符串（SEC 全站口径），不是整数。上游文件约 1MB，进程内缓存 1 小时。⛔ 不要用 ticker 猜 CIK；也不要拿别的市场代码当美股 ticker。',
            inputSchema: {
                type: 'object',
                properties: { tickers: { type: 'array', items: { type: 'string' }, description: '美股 ticker 列表（1–20 个，如 AAPL / MSFT）' } },
                required: ['tickers'],
                additionalProperties: false,
            },
            outputSchema: { type: 'array', items: tickerCikRow },
            allowed: ['tickers'],
            normalize: normalizeTickers,
            validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.ticker === 'string' && typeof row.found === 'boolean'),
            execute: executeTickerCik,
        }),
        createSecSource({
            capability: 'sec_filings',
            cacheMaxAgeMs: 1_800_000,
            name: 'get_sec_filings',
            summary: 'SEC 申报列表（submissions，按公司）',
            description: '按公司取 SEC EDGAR 最近申报清单（submissions JSON：`data.sec.gov/submissions/CIK##########.json`，零 key）。`ticker` 与 `cik` 二选一；给 ticker 时先查 company_tickers.json。返回 `filings.recent` 块（上游列式数组转成行），`form` 精确过滤、`limit` 1–100（默认 20）。⛔ `filings.recent` 只覆盖最近约 1000 条，更早的申报在 `filings.files` 分年文件里，本能力不取——需要更早历史时不要假装这里没有就是没申报。`accession_number` 保留连字符；`url` 由 `https://www.sec.gov/Archives/edgar/data/{cik}/{accession 去连字符}/{primaryDocument}` 拼出，`primary_document` 为空时 `url=null`。`filing_date` 是**美东申报日**，`acceptance_datetime` 是 UTC 的 ISO 时刻（上游带 `Z`，不是美东本地时间）；`report_date`（报告期）可能为空串。`items` 对 8-K/6-K 有意义（如 2.02），其它 form 常为空。SEC 要求声明式 UA（`SEC_USER_AGENT` 可覆盖）且 ≤10 req/s，本层自设 8 req/s。',
            inputSchema: {
                type: 'object',
                properties: {
                    ticker: { type: 'string', description: '美股 ticker（与 cik 二选一）' },
                    cik: { type: 'string', description: 'SEC CIK（1–10 位数字，与 ticker 二选一）' },
                    form: { type: 'string', description: '精确匹配的 form 类型，如 8-K / 10-Q / 6-K' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回行数，默认 20' },
                },
                required: [],
                additionalProperties: false,
            },
            outputSchema: { type: 'array', items: filingRow },
            allowed: ['ticker', 'cik', 'form', 'limit'],
            normalize: normalizeFilings,
            validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.accession_number === 'string'),
            execute: executeFilings,
        }),
        createSecSource({
            capability: 'sec_daily_filings',
            cacheMaxAgeMs: 21_600_000,
            name: 'get_sec_daily_filings',
            summary: 'SEC 日索引（某美东申报日的全部申报）',
            description: '取 SEC EDGAR 某一天的**日索引**（`Archives/edgar/daily-index/{年}/QTR{季}/form.{YYYYMMDD}.idx`，零 key）：当天所有申报的 form、公司名、CIK、申报日与文件路径。`filing_date` 是**美东申报日**，必须是已发布的工作日；`form` 可选、精确过滤（如 8-K）。一行一条申报；全量日（不限 form）实测可达数千行，按 form 过滤后再用。`url` 指向 `https://www.sec.gov/Archives/{file_name}`（索引条目，不是正文）。⛔ 该日索引不存在（周末/假日/尚未发布）时上游 404，本层响亮失败并提示换工作日，不返回空数组冒充「没有申报」。idx 行格式按表头自适应（有 `|` 按竖线切，否则按 2+ 空格切；定宽表头可跨两行），申报日接受 `YYYYMMDD` 或 `YYYY-MM-DD` 并统一输出后者；表头列缺失、行宽不足、日期畸形都响亮失败。`filing_date` 是申报日，不是报告期。SEC 限速与 UA 同其它 sec_* 能力。',
            inputSchema: {
                type: 'object',
                properties: {
                    filing_date: { type: 'string', description: '美东申报日 YYYY-MM-DD（必须是已发布的工作日）' },
                    form: { type: 'string', description: '精确匹配的 form 类型，如 8-K' },
                },
                required: ['filing_date'],
                additionalProperties: false,
            },
            outputSchema: { type: 'array', items: dailyIndexRow },
            allowed: ['filing_date', 'form'],
            normalize: normalizeDailyFilings,
            validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.file_name === 'string'),
            execute: executeDailyFilings,
        }),
        createSecSource({
            capability: 'sec_fulltext_search',
            cacheMaxAgeMs: 1_800_000,
            name: 'get_sec_fulltext_search',
            summary: 'SEC 全文检索（EDGAR FTS）',
            description: 'SEC EDGAR 全文检索（`efts.sec.gov/LATEST/search-index`，零 key）：按关键词找申报文件。`q` 必填（≤200 字符，短语可用引号）；`forms` 可选 1–5 个 form 类型；`start_date`/`end_date` 可选但必须成对给（美东申报日）；`limit` 1–100（默认 10）。返回 `hits.hits` 的申报级行：`accession_number`、`form`、`file_date`、`period_ending`、`cik`（10 位）、`display_name`、`file_type`、`file_name`（来自 `_id` 冒号后半段）与拼出的 `url`。⛔ `_id` 是 `{accession}:{filename}`，**不是 URL**，必须按 cik+accession 重新拼；cik 缺失时 `url=null`。⛔ 全文检索只覆盖 2001 年以来的电子申报正文，且是关键词匹配不是语义检索；命中排序由上游给，本层不改。空命中返回成功空数组。SEC 限速与 UA 同其它 sec_* 能力。',
            inputSchema: {
                type: 'object',
                properties: {
                    q: { type: 'string', description: '检索词（≤200 字符；短语加引号）' },
                    forms: { type: 'array', items: { type: 'string' }, description: 'form 类型列表（1–5 个）' },
                    start_date: { type: 'string', description: '起始申报日 YYYY-MM-DD（与 end_date 成对）' },
                    end_date: { type: 'string', description: '截止申报日 YYYY-MM-DD（与 start_date 成对）' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回行数，默认 10' },
                },
                required: ['q'],
                additionalProperties: false,
            },
            outputSchema: { type: 'array', items: fulltextRow },
            allowed: ['q', 'forms', 'start_date', 'end_date', 'limit'],
            normalize: normalizeFulltext,
            validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.accession_number === 'string'),
            execute: executeFulltext,
        }),
        createSecSource({
            capability: 'sec_market_frame',
            cacheMaxAgeMs: 86_400_000,
            name: 'get_sec_market_frame',
            summary: 'SEC XBRL frames（同 tag 全市场横截面）',
            description: '获取 SEC XBRL frames：某个 us-gaap 概念在**同一报告期**的全市场横截面（`data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json`，零 key）。`tag` 如 Assets / Revenues / NetIncomeLoss；`unit` 默认 USD；`period` 形如 `CY2025Q1I`（instant，时点）、`CY2025Q1`（duration，区间）、`CY2025`（年度）。真报文实测（2026-11-27）：`Assets/USD/CY2025Q1I` 有 `pts:5655` 行，单次响应约 1MB——本能力**不分页、一次返回全部行**，按 `limit` 截断不做（会静默丢公司）；要收窄就在本地用 tag/period 选。行字段：`cik`（10 位补零）、`entity_name`、`value`（报告币种原值；instant 是时点值、duration 是区间值，⛔ 不可跨期直接比较）、`accession_number`、`start_date`（instant 行为 null）、`end_date`、`location`（如 US-CA，可能为空串或 `-`）。⛔ 同一 tag 不同公司的会计口径/期间端点不同（如 52/53 周财年），`end_date` 会分散在几天内，不是数据错误；不要把 frames 当「同一时刻快照」。空 data 是合法空（该期没有申报该 tag）。SEC 限速与 UA 同其它 sec_* 能力。',
            inputSchema: {
                type: 'object',
                properties: {
                    tag: { type: 'string', description: 'us-gaap 概念名，如 Assets / Revenues / NetIncomeLoss' },
                    unit: { type: 'string', description: '单位代码，默认 USD' },
                    period: { type: 'string', description: '报告期：CY2025Q1I（时点）/ CY2025Q1（区间）/ CY2025' },
                },
                required: ['tag', 'period'],
                additionalProperties: false,
            },
            outputSchema: { type: 'array', items: marketFrameRow },
            allowed: ['tag', 'unit', 'period'],
            normalize: normalizeMarketFrame,
            validateOutput: (data) => Array.isArray(data) && data.every((row) => isRecord(row) && typeof row.cik === 'string' && typeof row.end_date === 'string'),
            execute: executeMarketFrame,
        }),
    ];
}
