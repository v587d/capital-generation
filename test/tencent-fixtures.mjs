// Tencent public-endpoint fixtures shared by the watchlist harness and the index-source tests:
// both sides must read the same real payload, or one can go green on its own fake.
// Smartbox text is verbatim; snapshot rows use ASCII names so GBK and UTF-8 bytes coincide.

// Keys are `market|query`; anything unlisted answers the `N` sentinel. `String.raw` keeps `\uXXXX`
// as six literal characters — one template expansion and it is no longer the upstream payload.

export const SMARTBOX_ROWS = {
  'hk|腾讯': String.raw`v_hint="hk~00700~\u817e\u8baf\u63a7\u80a1~txkg~GP^hk~80700~\u817e\u8baf\u63a7\u80a1r~txkgr~GP^hk~01698~\u817e\u8baf\u97f3\u4e50sw~txylsw~GP^hk~13005~\u817e\u8baf\u6cd5\u5174\u4e03\u4e09\u8d2dA~txfxqsga~QZ^hk~13020~\u817e\u8baf\u4fe1\u8bc1\u4e03\u4e03\u8d2dB~txxzqqgb~QZ^hk~13024~\u817e\u8baf\u6469\u5229\u516d\u4e59\u8d2dA~txmllyga~QZ^hk~13040~\u817e\u8baf\u6469\u901a\u516d\u4e59\u6cbdB~txmtlygb~QZ^hk~13052~\u817e\u8baf\u56fd\u541b\u516d\u7532\u6cbdA~txgjljga~QZ^hk~13085~\u817e\u8baf\u6cd5\u5df4\u516d\u4e59\u8d2dF~txfblygf~QZ^hk~13091~\u817e\u8baf\u6c47\u4e30\u516d\u4e59\u8d2dC~txhflygc~QZ";`,
  'us|腾讯': String.raw`v_hint="us~tcehy.ps~\u817e\u8baf\u63a7\u80a1(adr)~txkgadr~GP^us~tctzf.ps~\u817e\u8baf\u63a7\u80a1~txkg~GP^us~tme.n~\u817e\u8baf\u97f3\u4e50~txyl~GP^us~npsny.ps~naspers(\u817e\u8baf\u5357\u975e\u5927\u80a1\u4e1c)(adr)~nasperstxnfdgdadr~GP";`,
  // Same term, 7 of 10 rows are warrant `QZ`: the whitelist must leave 3, not 0 and not 10.
  'hk|纳指': String.raw`v_hint="hk~11146~\u7eb3\u6307\u745e\u94f6\u516d\u4e59\u6cbdA~nzrylyga~QZ^hk~11147~\u7eb3\u6307\u745e\u94f6\u516d\u4e59\u8d2dA~nzrylyga~QZ^hk~11149~\u7eb3\u6307\u6469\u901a\u516d\u4e59\u6cbdA~nzmtlyga~QZ^hk~11154~\u7eb3\u6307\u745e\u94f6\u516d\u4e59\u6cbdB~nzrylygb~QZ^hk~11159~\u7eb3\u6307\u6469\u901a\u516d\u4e59\u6cbdB~nzmtlygb~QZ^hk~11160~\u7eb3\u6307\u6469\u901a\u516d\u4e59\u8d2dA~nzmtlyga~QZ^hk~11170~\u7eb3\u6307\u6cd5\u5174\u516d\u4e59\u6cbdA~nzfxlyga~QZ^hk~11180~\u7eb3\u6307\u745e\u94f6\u516d\u4e59\u8d2dB~nzrylygb~QZ^hk~11181~\u7eb3\u6307\u745e\u94f6\u516d\u4e59\u6cbdC~nzrylygc~QZ^hk~11202~\u7eb3\u6307\u6469\u5229\u516d\u4e59\u8d2dA~nzmllyga~QZ";`,
  'hk|恒生指数': String.raw`v_hint="hk~HSI~\u6052\u751f\u6307\u6570~hszs~ZS^hk~HSIGTR~\u6052\u751f\u6307\u6570(\u603b\u6536\u76ca)~hszszsy~ZS^hk~HSINTR~\u6052\u751f\u6307\u6570(\u51c0\u603b\u6536\u76ca)~hszsjzsy~ZS^hk~03115~\u5b89\u7855\u6052\u751f\u6307\u6570~ashszs~GP^hk~83115~\u5b89\u7855\u6052\u751f\u6307\u6570r~ashszsr~GP^hk~09115~\u5b89\u7855\u6052\u751f\u6307\u6570u~ashszsu~GP";`,
  'hk|HSI': String.raw`v_hint="hk~HSI~\u6052\u751f\u6307\u6570~hszs~ZS^hk~03136~\u6052\u6307esgetf~hsi esg etf~GP^hk~HSIESG~\u6052\u6307esg\u6307\u6570~hzesgzs~ZS^hk~HSIGTR~\u6052\u751f\u6307\u6570(\u603b\u6536\u76ca)~hszszsy~ZS^hk~HSINTR~\u6052\u751f\u6307\u6570(\u51c0\u603b\u6536\u76ca)~hszsjzsy~ZS";`,
  'hk|00700': String.raw`v_hint="hk~00700~\u817e\u8baf\u63a7\u80a1~txkg~GP";`,
  'hk|80700': String.raw`v_hint="hk~80700~\u817e\u8baf\u63a7\u80a1r~txkgr~GP";`,
  'hk|00465': String.raw`v_hint="hk~00465~\u5bcc\u901a\u79d1\u6280~ftkj~GP";`,
  'hk|03037': String.raw`v_hint="hk~03037~\u5357\u65b9\u6052\u6307etf~nfhzetf~GP";`,
  // One query returns both an index and an ETF (`03032` is `GP`): rows split on the type field, not the code.
  'hk|HSTECH': String.raw`v_hint="hk~HSTECH~\u6052\u751f\u79d1\u6280\u6307\u6570~hskjzs~ZS^hk~03032~\u6052\u751f\u79d1\u6280etf~hstech etf~GP";`,
  'us|AAPL': String.raw`v_hint="us~aapl.oq~\u82f9\u679c~pg~GP";`,
  'us|QQQ': String.raw`v_hint="us~qqq.oq~\u7eb3\u6307100etfinvesco~nz100etfinvesco~GP^us~qqqa.oq~\u7eb3\u65af\u8fbe\u514b100etfproshares~nsdk100etfproshares~GP";`,
  'us|DJI': String.raw`v_hint="us~dji~\u9053\u743c\u65af~dqs~ZS^us~djia.am~\u9053\u743c\u65afetfglobalx~dqsetfglobalx~GP";`,
  'us|IXIC': String.raw`v_hint="us~ixic~\u7eb3\u65af\u8fbe\u514b~nsdk~ZS";`,
  'us|INX': String.raw`v_hint="us~inx~\u6807\u666e500~bp500~ZS";`,
  'us|DJI': String.raw`v_hint="us~dji~\u9053\u743c\u65af~dqs~ZS";`,
  'us|TCEHY': String.raw`v_hint="us~tcehy.ps~\u817e\u8baf\u63a7\u80a1(adr)~txkgadr~GP";`,
  'us|BRK.B': String.raw`v_hint="us~brk.b.n~\u4f2f\u514b\u5e0c\u5c14b~bkxeb~GP";`,
  // ⛔ Canonical keys return no rows at all: strip to the stem before lookup, or a real ticker reads as missing.
  'hk|00700.HK': String.raw`v_hint="N";`,
  'hk|HSI.HK': String.raw`v_hint="N";`,
  'us|TCEHY.PS': String.raw`v_hint="N";`,
  'us|IXIC.US': String.raw`v_hint="N";`,
}

/** Snapshot column positions as captured: HK 78 columns, US 73; currency at 75 / 35. */
const TENCENT_SNAPSHOT_ROWS = {
  hk00700: { market: 'hk', name: 'TENCENT', code: '00700', price: '420.800', lastClose: '428.200', open: '425.600', volume: '7666674.0', time: '2026-10-07 14:06:13', change: '-7.400', pct: '-1.73', high: '426.000', low: '419.200', amount: '3233765129.928', amplitude: '1.59', currency: 'HKD', turnover: '0.08', boardLot: '100', type: 'GP', totalShares: '9092605595.00', avg: '421.795', mcap: '38261.6843', english: 'TENCENT' },
  // `-R` counter is a CNY-quoted HK stock: inferring currency from market is always wrong.
  hk80700: { market: 'hk', name: 'TENCENT-R', code: '80700', price: '359.400', lastClose: '365.000', open: '361.000', volume: '6000.0', time: '2026-10-07 14:03:39', change: '-5.600', pct: '-1.53', high: '361.000', low: '358.600', amount: '2158600.000', amplitude: '0.66', currency: 'CNY', turnover: '0.00', boardLot: '100', type: 'GP', totalShares: '9092605595.00', avg: '359.767', mcap: '32678.8245', english: 'TENCENT-R' },
  // Suspended: volume/amount 0, price equals last close; upstream sends `0.00`, not a missing value.
  hk00465: { market: 'hk', name: 'FUTONG TECH', code: '00465', price: '3.200', lastClose: '3.200', open: '0.000', volume: '0.0', time: '2026-10-07 09:20:22', change: '0.000', pct: '0.00', high: '0', low: '0', amount: '0.000', amplitude: '0.00', currency: 'HKD', turnover: '0.00', boardLot: '2000', type: 'GP', totalShares: '315211000.00', avg: '', mcap: '10.0868', english: 'FUTONG TECH' },
  hk03037: { market: 'hk', name: 'CSOP HSI ETF', code: '03037', price: '24.760', lastClose: '24.860', open: '24.880', volume: '35000.0', time: '2026-10-07 13:56:42', change: '-0.100', pct: '-0.40', high: '24.880', low: '24.740', amount: '866750.000', amplitude: '0.56', currency: 'HKD', turnover: '0.14', boardLot: '500', type: 'GP-FUND', totalShares: '24700000.00', avg: '24.764', mcap: '6.1157', english: 'CSOP HSI ETF' },
  hkHSI: { market: 'hk', name: 'HANG SENG INDEX', code: 'HSI', price: '24163.050', lastClose: '24280.560', open: '24172.290', volume: '6390582.1851', time: '2026-10-07 14:06:21', change: '-117.510', pct: '-0.48', high: '24266.920', low: '24071.410', amount: '6390582.185', amplitude: '0.81', currency: 'HKD', turnover: '0.00', boardLot: '0', type: 'ZS', totalShares: '0.00', avg: '', mcap: '0', english: 'Hang Seng Index' },
  // Other index spellings: `[6]` still equals `[37]`, while VHSI has both at 0 — index turnover is
  // meaningless, so `is_stale` must never be applied to indices.
  hkHSCEI: { market: 'hk', name: 'HANG SENG CHINA ENTERPRISES', code: 'HSCEI', price: '8076.790', lastClose: '8128.970', open: '8095.080', volume: '1844412.9510', time: '2026-10-07 14:51:16', change: '-52.180', pct: '-0.64', high: '8121.790', low: '8047.900', amount: '1844412.951', amplitude: '0.91', currency: 'HKD', turnover: '0.00', boardLot: '0', type: 'ZS', totalShares: '0.00', avg: '', mcap: '0', english: 'Hang Seng China Enterprises Index' },
  hkVHSI: { market: 'hk', name: 'HSI VOLATILITY INDEX', code: 'VHSI', price: '17.900', lastClose: '18.360', open: '18.180', volume: '0.0000', time: '2026-10-07 14:51:15', change: '-0.460', pct: '-2.51', high: '18.450', low: '17.870', amount: '0.000', amplitude: '3.16', currency: 'HKD', turnover: '0.00', boardLot: '0', type: 'ZS', totalShares: '0.00', avg: '', mcap: '0', english: 'HSI Volatility Index (VHSI)' },
  hkHSTECH: { market: 'hk', name: 'HANG SENG TECH INDEX', code: 'HSTECH', price: '4189.850', lastClose: '4223.080', open: '4209.140', volume: '1347144.4430', time: '2026-10-07 14:06:20', change: '-33.230', pct: '-0.79', high: '4222.430', low: '4156.560', amount: '1347144.443', amplitude: '1.56', currency: 'HKD', turnover: '0.00', boardLot: '0', type: 'ZS', totalShares: '0.00', avg: '', mcap: '0', english: 'Hang Seng TECH Index' },
  usAAPL: { market: 'us', name: 'APPLE', code: 'AAPL.OQ', price: '333.63', lastClose: '332.89', open: '332.28', volume: '30449005', time: '2026-10-06 16:00:01', change: '0.74', pct: '0.22', high: '334.38', low: '330.62', amount: '10143705927', amplitude: '1.13', currency: 'USD', turnover: '0.21', totalShares: '14594180000', floatShares: '14585108878', avg: '333.14', mcap: '48690.56273', floatMcap: '48660.29875', english: 'Apple Inc.' },
  // Key is the request spelling itself (US tickers keep their exchange/level suffix).
  'usBRK.B': { market: 'us', name: 'BERKSHIRE HATHAWAY B', code: 'BRK.B.N', price: '505.54', lastClose: '504.26', open: '504.34', volume: '3251113', time: '2026-10-06 16:05:20', change: '1.28', pct: '0.25', high: '508.52', low: '503.78', amount: '1645832385', amplitude: '0.94', currency: 'USD', turnover: '0.15', totalShares: '2140709794', floatShares: '1247613213', avg: '506.24', mcap: '10822.14429', floatMcap: '6307.18384', english: 'Berkshire Hathaway Inc. New' },
  usTCEHY: { market: 'us', name: 'TENCENT ADR', code: 'TCEHY.PS', price: '54.50', lastClose: '54.84', open: '54.81', volume: '2901238', time: '2026-10-06 16:00:01', change: '-0.34', pct: '-0.62', high: '54.81', low: '54.06', amount: '157713942', amplitude: '1.37', currency: 'USD', turnover: '0.03', totalShares: '9006470367', floatShares: '1921980776', avg: '54.36', mcap: '4908.52635', floatMcap: '1047.47952', english: 'Tencent Holdings Limited' },
  usIXIC: { market: 'us', name: 'NASDAQ COMPOSITE', code: '.IXIC', price: '27599.89', lastClose: '27477.31', open: '27641.17', volume: '7658736712', time: '2026-10-06 18:34:12', change: '122.58', pct: '0.45', high: '27722.75', low: '27592.56', amount: '211380260921089', amplitude: '0.47', currency: 'USD', turnover: '', totalShares: '', floatShares: '', avg: '27599.89', mcap: '', floatMcap: '', english: 'Nasdaq Composite' },
  usINX: { market: 'us', name: 'S&P 500', code: '.INX', price: '7818.93', lastClose: '7773.95', open: '7805.96', volume: '2717394878', time: '2026-10-06 16:40:07', change: '44.98', pct: '0.58', high: '7844.52', low: '7805.96', amount: '21247120333441', amplitude: '0.50', currency: 'USD', turnover: '', totalShares: '', floatShares: '', avg: '7818.93', mcap: '', floatMcap: '', english: 'S&P 500 Index' },
  usDJI: { market: 'us', name: 'DOW JONES', code: '.DJI', price: '51521.28', lastClose: '51267.90', open: '51444.10', volume: '404919021', time: '2026-10-06 16:42:37', change: '253.38', pct: '0.49', high: '51672.25', low: '51422.90', amount: '20868319695805', amplitude: '0.49', currency: 'USD', turnover: '', totalShares: '', floatShares: '', avg: '51537.02', mcap: '', floatMcap: '', english: 'Dow Jones' },
  // Guessing `usSSPX` for the S&P returns this real ETF without an error.
  usSSPX: { market: 'us', name: 'JANUS HENDERSON SUSTAINABLE ETF', code: 'SSPX.AM', price: '31.47', lastClose: '31.47', open: '0.00', volume: '0', time: '2026-10-06 09:30:00', change: '0.00', pct: '0.00', high: '0.00', low: '0.00', amount: '0', amplitude: '0.00', currency: 'USD', turnover: '', totalShares: '', floatShares: '', avg: '', mcap: '', floatMcap: '', english: 'Janus Henderson U.S. Sustainable Eqt Etf' },
}

function snapshotRowText(symbol, row) {
  const columns = row.market === 'hk'
    ? { 1: row.name, 2: row.code, 3: row.price, 4: row.lastClose, 5: row.open, 6: row.volume, 30: row.time, 31: row.change, 32: row.pct, 33: row.high, 34: row.low, 37: row.amount, 43: row.amplitude, 45: row.mcap, 46: row.english, 59: row.turnover, 60: row.boardLot, 63: row.type, 69: row.totalShares, 73: row.avg, 75: row.currency }
    : { 1: row.name, 2: row.code, 3: row.price, 4: row.lastClose, 5: row.open, 6: row.volume, 30: row.time, 31: row.change, 32: row.pct, 33: row.high, 34: row.low, 35: row.currency, 37: row.amount, 38: row.turnover, 43: row.amplitude, 44: row.floatMcap, 45: row.mcap, 46: row.english, 62: row.totalShares, 63: row.floatShares, 67: row.avg }
  const fields = Array.from({ length: row.market === 'hk' ? 78 : 73 }, () => '')
  for (const [index, value] of Object.entries(columns)) fields[Number(index)] = value === undefined ? '' : String(value)
  return `v_${symbol}="${fields.join('~')}"`
}

// Unknown symbols are silently dropped, as upstream does: "fewer rows than requested" is itself
// the assertion, so the fixture must not pad a row.
export function tencentSnapshotText(symbols) {
  // ⛔ Lookup is case-sensitive: upstream echoes the variable name as requested, so a lowercase
  // fixture would cover our own spelling bugs and count fake hits as real ones.
  const rows = symbols.filter((symbol) => TENCENT_SNAPSHOT_ROWS[symbol] !== undefined)
  if (rows.length === 0) return 'v_pv_none_match="1";'
  return `${rows.map((symbol) => snapshotRowText(symbol, TENCENT_SNAPSHOT_ROWS[symbol])).join(';')};`
}
