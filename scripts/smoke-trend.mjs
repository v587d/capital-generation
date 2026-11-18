#!/usr/bin/env node
/**
 * Live check for the intraday trend core (not part of `npm test`: it needs the network).
 * Prints one line per symbol plus the first/last point, so a shape change upstream is obvious.
 *
 *   node scripts/smoke-trend.mjs 600519.SH 00700.HK HSI.HK AAPL.OQ IXIC.US TCEHY.PS
 */
import { fetchTrendSeries, resolveTrendTarget } from '../lib/sources/trend-series.js'

const ASSET_TYPES = {
  SH: (code) => (code.startsWith('000') ? 'a-share-index' : 'a-share'),
  SZ: (code) => (code.startsWith('399') ? 'a-share-index' : 'a-share'),
  HK: (code) => (/^\d{5}$/u.test(code) ? 'hk-stock' : 'hk-index'),
  US: () => 'us-index',
}

function guessAssetType(thscode) {
  const stem = thscode.slice(0, thscode.lastIndexOf('.'))
  const exchange = thscode.slice(thscode.lastIndexOf('.') + 1)
  // US tickers keep their venue ({AAPL}.OQ); only the three index markers use `.US`.
  const guess = ASSET_TYPES[exchange]?.(stem) ?? 'us-stock'
  if (guess === undefined) throw new Error(`cannot guess asset_type for ${thscode}; pass THSCODE:ASSET_TYPE`)
  return guess
}

const targets = process.argv.slice(2)
if (targets.length === 0) targets.push('600519.SH', '000001.SH', '00700.HK', 'HSI.HK', 'AAPL.OQ', 'IXIC.US', 'TCEHY.PS')

let failures = 0
for (const argument of targets) {
  const [thscode, forced] = argument.split(':')
  const assetType = forced ?? guessAssetType(thscode)
  const target = resolveTrendTarget({ thscode, asset_type: assetType })
  if (target === undefined) {
    console.log(`- ${thscode} [${assetType}] 不支持（不请求上游）`)
    continue
  }
  try {
    const series = await fetchTrendSeries(target, { signal: AbortSignal.timeout(15_000) })
    const first = series.points[0]
    const last = series.points[series.points.length - 1]
    const money = (value) => (value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 }))
    console.log(
      `✓ ${thscode} [${assetType}] ${series.source}/${series.market} ${series.session_date} ${series.session_status}${series.stale ? ' stale' : ''}` +
      ` | ${series.points.length} 点 ${first[0]}→${last[0]}` +
      ` | 昨收 ${money(series.prev_close)} 开 ${money(series.open)} 高 ${money(series.high)} 低 ${money(series.low)} 收 ${money(series.last)}` +
      ` | 均价 ${money(series.avg)} 量 ${money(series.volume)} 额 ${money(series.amount)}`,
    )
  } catch (error) {
    failures += 1
    console.log(`✗ ${thscode} [${assetType}] ${error?.code ?? ''} ${error?.message ?? error}`)
  }
}
process.exitCode = failures === 0 ? 0 : 1
