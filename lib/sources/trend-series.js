/**
 * Intraday trend series for the host-plane watchlist: Tencent `appstock/app/minute/query` for
 * A-shares and HK, Eastmoney `push2his .../trends2/get` for US. Leaf module — it only reuses the
 * two existing throttle chains and the shared identity parser, so the host package can call it
 * through `lib/` without pulling the data-collector hub in.
 *
 * The desk gets one shape for all markets; every judgement the sources disagree on (units,
 * after-hours padding, closing auction, session clock) is made here and stated in the payload.
 */
import { sharedEastmoneyClient } from '../net/eastmoney-client.js';
import { parseSecurityCode } from './security-code.js';
import { callIfzqHosts, isRecord, numberOrNull, requiredNumber, sourceError } from './tencent-public-core.js';
const TZ = {
    'a-share': 'Asia/Shanghai',
    hk: 'Asia/Hong_Kong',
    us: 'America/New_York',
};
/** Continuous sessions in exchange-local minutes; lunch breaks are two entries, not a gap to smooth. */
const SESSIONS = {
    'a-share': [[570, 690], [780, 900]],
    hk: [[570, 720], [780, 960]],
    us: [[570, 960]],
};
/** Tencent returns after-hours padding past this minute (A-share 15:06–15:30, HK closing auction). */
const TENCENT_CUT = { 'a-share': '1500', hk: '1600', us: '1600' };
/** Tencent US minute trend answers one closing row with no date; that market goes to Eastmoney. */
const US_SECID_BY_VENUE = { OQ: '105', N: '106', AM: '107' };
const US_INDEX_SECID = {
    IXIC: '100.NDX', NDX: '100.NDX',
    INX: '100.SPX', SPX: '100.SPX',
    DJI: '100.DJIA', DJIA: '100.DJIA',
};
const TREND_CURRENCY = {
    'a-share': 'CNY',
    'fund-etf': 'CNY',
    'a-share-index': null,
    'hk-stock': 'HKD',
    'hk-index': null,
    'us-stock': 'USD',
    'us-index': null,
};
const HK_KEY = /^(?:\d{5}|[A-Z][A-Z0-9.]{1,9})\.HK$/u;
const US_KEY = /^([A-Z][A-Z0-9.]{0,9})\.([A-Z]{1,3})$/u;
/**
 * Storage identity → upstream request. `undefined` means the chart cannot be drawn at all
 * (US OTC pink and exotic US indices): the caller must not spend a request to find out.
 */
export function resolveTrendTarget(item) {
    const thscode = typeof item.thscode === 'string' ? item.thscode.trim() : '';
    const assetType = typeof item.asset_type === 'string' ? item.asset_type : '';
    if (thscode.length === 0)
        return undefined;
    const currency = TREND_CURRENCY[assetType] ?? null;
    if (assetType === 'a-share' || assetType === 'a-share-index' || assetType === 'fund-etf') {
        let code;
        try {
            code = parseSecurityCode(thscode, 'thscode');
        }
        catch {
            return undefined;
        }
        // Storage keys are canonical (`600519.SH`); a bare or lowercase code must not reach upstream.
        if (code.canonical !== thscode)
            return undefined;
        return {
            thscode,
            source: 'tencent',
            market: 'a-share',
            symbol: code.tencentSymbol,
            isIndex: assetType === 'a-share-index',
            volumeUnit: 'lot',
            currency,
        };
    }
    if (assetType === 'hk-stock' || assetType === 'hk-index') {
        if (!HK_KEY.test(thscode))
            return undefined;
        return {
            thscode,
            source: 'tencent',
            market: 'hk',
            symbol: `hk${thscode.slice(0, -3)}`,
            isIndex: assetType === 'hk-index',
            volumeUnit: assetType === 'hk-index' ? null : 'share',
            currency,
        };
    }
    if (assetType === 'us-index') {
        if (!thscode.endsWith('.US'))
            return undefined;
        const secid = US_INDEX_SECID[thscode.slice(0, -3)];
        if (secid === undefined)
            return undefined;
        return { thscode, source: 'eastmoney', market: 'us', secid, isIndex: true, volumeUnit: null, currency: null };
    }
    if (assetType === 'us-stock') {
        const match = US_KEY.exec(thscode);
        if (match === null)
            return undefined;
        const marketId = US_SECID_BY_VENUE[match[2]];
        if (marketId === undefined)
            return undefined;
        return { thscode, source: 'eastmoney', market: 'us', secid: `${marketId}.${match[1]}`, isIndex: false, volumeUnit: 'share', currency };
    }
    return undefined;
}
/** Trading minutes elapsed up to a wall clock; lunch breaks never count as elapsed time. */
export function elapsedTradingMinutes(market, minutes) {
    let total = 0;
    for (const [start, end] of SESSIONS[market]) {
        total += Math.min(Math.max(minutes - start, 0), end - start);
    }
    return total;
}
function sessionLength(market) {
    return SESSIONS[market].reduce((sum, [start, end]) => sum + (end - start), 0);
}
function zonedClock(ms, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
    const date = `${pick('year')}-${String(pick('month')).padStart(2, '0')}-${String(pick('day')).padStart(2, '0')}`;
    return { date, minutes: pick('hour') * 60 + pick('minute') };
}
/** The desk must never present yesterday's line as today's; the clock lives here, not in the browser. */
function sessionState(market, sessionDate, lastTime, now) {
    if (sessionDate === null)
        return { status: 'previous', stale: false };
    const clock = zonedClock(now, TZ[market]);
    if (clock.date !== sessionDate)
        return { status: 'previous', stale: false };
    const elapsed = elapsedTradingMinutes(market, clock.minutes);
    if (elapsed <= 0 || elapsed >= sessionLength(market))
        return { status: 'closed', stale: false };
    const elapsedAtLast = elapsedTradingMinutes(market, Number(lastTime.slice(0, 2)) * 60 + Number(lastTime.slice(3, 5)));
    return { status: 'live', stale: elapsed - elapsedAtLast > 10 };
}
/** Wall-clock offset of a time zone at one instant, in minutes (DST-aware). */
function zoneOffsetMinutes(instant, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
    const wall = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'));
    return Math.round((wall - instant) / 60_000);
}
function hhmm(value, field) {
    const match = /^(\d{2}):(\d{2})$/u.exec(value);
    if (match === null)
        throw sourceError(`trend ${field} is not HH:MM: ${JSON.stringify(value)}`, 'trend_parse_failed');
    return value;
}
/**
 * Units per share lot in Tencent's A-share minute payload: the main board and ETFs count 手 (100),
 * 科创板 counts shares. Turnover is 元 either way, so the unit is whichever makes amount/volume land
 * on the printed price; the two candidates are a hundredfold apart, so "nearer" needs no threshold —
 * and unlike a board table (688 today, 689 CDR, 北交所 tomorrow) it cannot go stale.
 */
function trendLotSize(target, rows) {
    if (target.market !== 'a-share' || target.isIndex)
        return 1;
    const tail = rows[rows.length - 1];
    if (tail === undefined || tail.cumVolume <= 0 || tail.cumAmount <= 0)
        return 100;
    const perUnit = tail.cumAmount / tail.cumVolume;
    return Math.abs(perUnit - tail.price) <= Math.abs(perUnit / 100 - tail.price) ? 1 : 100;
}
/** Tencent A-share/HK minute trend: one row per minute with cumulative volume/amount. */
async function fetchTencentTrend(target, signal, now) {
    const symbol = target.symbol ?? '';
    const payload = await callIfzqHosts({
        path: '/appstock/app/minute/query',
        query: `code=${encodeURIComponent(symbol)}`,
        label: 'minute trend',
        code: 'tencent_minute_unavailable',
        isEmpty: (data) => !isRecord(data[symbol]),
    }, signal);
    const node = payload[symbol];
    if (!isRecord(node))
        throw sourceError(`Tencent minute trend ${symbol} has no symbol node`, 'trend_parse_failed');
    const series = node.data;
    const quote = node.qt;
    if (!isRecord(series) || !Array.isArray(series.data))
        throw sourceError(`Tencent minute trend ${symbol} has no data array`, 'trend_parse_failed');
    if (!isRecord(quote) || !Array.isArray(quote[symbol]))
        throw sourceError(`Tencent minute trend ${symbol} has no qt array`, 'trend_parse_failed');
    const qt = quote[symbol];
    const rawDate = String(series.date ?? '');
    if (!/^\d{8}$/u.test(rawDate))
        throw sourceError(`Tencent minute trend ${symbol} has an unreadable date ${JSON.stringify(series.date)}`, 'trend_parse_failed');
    const last = requiredNumber(qt[3], 'last');
    const prevClose = requiredNumber(qt[4], 'prev_close');
    const rawOpen = numberOrNull(qt[5]);
    const open = rawOpen !== null && rawOpen > 0 ? rawOpen : null;
    const quoteVolume = numberOrNull(qt[6]);
    if (prevClose <= 0)
        throw sourceError(`Tencent minute trend ${symbol} has a non-positive previous close`, 'trend_parse_failed');
    const high = numberOrNull(qt[33]);
    const low = numberOrNull(qt[34]);
    const rows = [];
    for (const raw of series.data) {
        if (typeof raw !== 'string')
            throw sourceError(`Tencent minute trend ${symbol} row is not a string`, 'trend_parse_failed');
        const fields = raw.trim().split(/\s+/u);
        if (fields.length !== 4)
            throw sourceError(`Tencent minute trend ${symbol} row shape changed: ${JSON.stringify(raw)}`, 'trend_parse_failed');
        const [stamp, priceText, volumeText, amountText] = fields;
        if (!/^\d{4}$/u.test(stamp))
            throw sourceError(`Tencent minute trend ${symbol} row time is not HHMM: ${JSON.stringify(stamp)}`, 'trend_parse_failed');
        const price = requiredNumber(priceText, 'price');
        const cumVolume = requiredNumber(volumeText, 'cumulative volume');
        const cumAmount = requiredNumber(amountText, 'cumulative amount');
        if (price <= 0)
            throw sourceError(`Tencent minute trend ${symbol} returned a non-positive price at ${stamp}`, 'trend_parse_failed');
        rows.push({ time: `${stamp.slice(0, 2)}:${stamp.slice(2)}`, price, cumVolume, cumAmount });
    }
    if (rows.length === 0)
        throw sourceError(`Tencent minute trend ${symbol} returned no points`, 'trend_unavailable');
    // Cut the after-hours padding, then keep the HK closing-auction print as the real close.
    const cut = `${TENCENT_CUT[target.market].slice(0, 2)}:${TENCENT_CUT[target.market].slice(2)}`;
    const kept = rows.filter((row) => row.time <= cut);
    if (target.market === 'hk') {
        // HK stocks print the closing auction a few minutes later (16:08); HK indices also carry an
        // evening quote at 18:31 that is not part of the session, so only the near miss is kept.
        const auction = rows.find((row) => row.time > cut && row.time <= '16:10');
        if (auction !== undefined)
            kept.push(auction);
    }
    if (kept.length === 0)
        throw sourceError(`Tencent minute trend ${symbol} had every point after ${cut}`, 'trend_unavailable');
    const lot = trendLotSize(target, kept);
    const points = [];
    let previousKeptVolume = 0;
    let previousKeptAmount = 0;
    let previousTime = '';
    for (const row of kept) {
        if (previousTime !== '' && row.time < previousTime) {
            throw sourceError(`Tencent minute trend ${symbol} time moved backwards at ${row.time}`, 'trend_parse_failed');
        }
        previousTime = row.time;
        // Tencent restates the running totals when a print settles (300803.SZ 2026-11-18: the final row
        // carried 0.04% less turnover than the row before it). A restatement is not corruption: it means
        // "no new trade", so the delta clamps to zero and the running total keeps its high-water mark.
        const volume = Math.max(0, row.cumVolume - previousKeptVolume);
        const amount = Math.max(0, row.cumAmount - previousKeptAmount);
        previousKeptVolume = Math.max(previousKeptVolume, row.cumVolume);
        previousKeptAmount = Math.max(previousKeptAmount, row.cumAmount);
        const shares = row.cumVolume * lot;
        const avg = target.isIndex || shares <= 0 ? null : row.cumAmount / shares;
        points.push([row.time, row.price, avg, volume, amount]);
    }
    const sessionDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`;
    const state = sessionState(target.market, sessionDate, points[points.length - 1][0], now);
    const tail = points[points.length - 1];
    return {
        thscode: target.thscode,
        source: 'tencent',
        market: target.market,
        tz: TZ[target.market],
        session_date: sessionDate,
        session_status: state.status,
        stale: state.stale,
        prev_close: prevClose,
        open,
        high: high ?? points.reduce((best, point) => Math.max(best, point[1]), points[0][1]),
        low: low ?? points.reduce((best, point) => Math.min(best, point[1]), points[0][1]),
        last,
        avg: tail[2],
        // Quote volume and the last cumulative amount are the day's totals (the 15:00 point matches the
        // quote exactly); `tail[3]` / `tail[4]` are one minute and must not be reported as the whole day.
        volume: quoteVolume !== null && quoteVolume > 0 ? quoteVolume : previousKeptVolume,
        amount: previousKeptAmount > 0 ? previousKeptAmount : null,
        volume_unit: target.market === 'a-share' && !target.isIndex ? (lot === 100 ? 'lot' : 'share') : target.volumeUnit,
        currency: target.currency,
        points,
    };
}
/** Eastmoney US trend: per-minute OHLC + volume/amount/avg, previous close included. */
async function fetchEastmoneyTrend(target, signal, now) {
    const secid = target.secid ?? '';
    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/trends2/get');
    url.searchParams.set('secid', secid);
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6,f7,f8');
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
    url.searchParams.set('iscr', '0');
    url.searchParams.set('ndays', '1');
    const payload = await sharedEastmoneyClient().fetchJson(url.toString(), { signal });
    if (!isRecord(payload) || !isRecord(payload.data))
        throw sourceError(`Eastmoney trend ${secid} returned no data`, 'trend_unavailable');
    const data = payload.data;
    const prevClose = requiredNumber(data.preClose ?? data.prePrice, 'prev_close');
    if (prevClose <= 0)
        throw sourceError(`Eastmoney trend ${secid} has a non-positive previous close`, 'trend_parse_failed');
    if (!Array.isArray(data.trends) || data.trends.length === 0)
        throw sourceError(`Eastmoney trend ${secid} returned no points`, 'trend_unavailable');
    // Eastmoney timestamps are Beijing time even for US rows (22:30–05:00 for a 09:30–16:00 ET
    // session); the desk must show the exchange clock, so shift every row by the ET offset once.
    let offsetMinutes = null;
    let sessionDate = null;
    let open = null;
    let high = null;
    let low = null;
    const points = [];
    let previousTime = '';
    for (const raw of data.trends) {
        if (typeof raw !== 'string')
            throw sourceError(`Eastmoney trend ${secid} row is not a string`, 'trend_parse_failed');
        const fields = raw.split(',');
        if (fields.length !== 8)
            throw sourceError(`Eastmoney trend ${secid} row shape changed: ${JSON.stringify(raw)}`, 'trend_parse_failed');
        const stamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/u.exec(fields[0]);
        if (stamp === null)
            throw sourceError(`Eastmoney trend ${secid} row time is unreadable: ${JSON.stringify(fields[0])}`, 'trend_parse_failed');
        const instant = Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]) - 8, Number(stamp[5]));
        offsetMinutes ??= zoneOffsetMinutes(instant, TZ[target.market]);
        const local = new Date(instant + offsetMinutes * 60_000);
        const time = hhmm(`${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`, 'time');
        if (previousTime !== '' && time < previousTime)
            throw sourceError(`Eastmoney trend ${secid} time moved backwards at ${time}`, 'trend_parse_failed');
        previousTime = time;
        sessionDate ??= local.toISOString().slice(0, 10);
        const barOpen = requiredNumber(fields[1], 'open');
        const price = requiredNumber(fields[2], 'close');
        const barHigh = requiredNumber(fields[3], 'high');
        const barLow = requiredNumber(fields[4], 'low');
        if (price <= 0)
            throw sourceError(`Eastmoney trend ${secid} returned a non-positive price at ${time}`, 'trend_parse_failed');
        open ??= barOpen;
        high = high === null ? barHigh : Math.max(high, barHigh);
        low = low === null ? barLow : Math.min(low, barLow);
        const volume = numberOrNull(fields[5]);
        const amount = numberOrNull(fields[6]);
        // Index rows carry amount 0 (no traded value); null keeps it out of the UI instead of showing 0.
        const avg = target.isIndex ? null : numberOrNull(fields[7]);
        points.push([time, price, avg, volume, amount === 0 ? null : amount]);
    }
    if (points.length === 0)
        throw sourceError(`Eastmoney trend ${secid} returned no points`, 'trend_unavailable');
    const state = sessionState(target.market, sessionDate, points[points.length - 1][0], now);
    const tail = points[points.length - 1];
    return {
        thscode: target.thscode,
        source: 'eastmoney',
        market: target.market,
        tz: TZ[target.market],
        session_date: sessionDate,
        session_status: state.status,
        stale: state.stale,
        prev_close: prevClose,
        open,
        high,
        low,
        last: tail[1],
        avg: target.isIndex ? null : tail[2],
        // `0` from an unreadable column is "no number", not a traded zero (index rows carry amount 0).
        volume: points.some((point) => point[3] !== null) ? points.reduce((sum, point) => sum + (point[3] ?? 0), 0) : null,
        amount: points.some((point) => point[4] !== null) ? points.reduce((sum, point) => sum + (point[4] ?? 0), 0) : null,
        volume_unit: target.volumeUnit,
        currency: target.currency,
        points,
    };
}
/** One entry point for both branches; `thscode` is filled by the caller, which owns identity. */
export async function fetchTrendSeries(target, options) {
    const now = options.now ?? Date.now();
    const series = target.source === 'tencent'
        ? await fetchTencentTrend(target, options.signal, now)
        : await fetchEastmoneyTrend(target, options.signal, now);
    return series;
}
