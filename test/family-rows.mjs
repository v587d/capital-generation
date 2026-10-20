/**
 * Row contracts map each custom tool-family row to its exact model tool names.
 * Entry tests verify registrations; persona tests combine this table with preset rows (§9.7).
 * Framework-provided names (skill/send_message/shell/fs) are not listed here.
 */

/** Custom tool entry points, in declaration order. */
export const CAPITAL_ROW_TOOLS = {
  '@v587d/capital-generation/tools/collect': ['request_data', 'list_capabilities', 'describe_capability', 'dc_status'],
  '@v587d/capital-generation/tools/dataset-read': ['describe_dataset', 'inspect_dataset', 'profile_dataset', 'query_dataset'],
  '@v587d/capital-generation/tools/chart-source': ['prepare_chart_source'],
  '@v587d/capital-generation/tools/chart-render': ['render_chart'],
  '@v587d/capital-generation/tools/retrieve-search': ['anysearch_search', 'web_retriever_fetch', 'wind_docs_announcements', 'wind_docs_news'],
  '@v587d/capital-generation/tools/retrieve-sources': [
    'cls_telegraph', 'wscn_lives', 'cninfo_irm', 'sseinfo_qa',
    'eastmoney_724', 'eastmoney_stock_news', 'eastmoney_reports', 'sina_reports', 'ths_eps_forecast',
  ],
  '@v587d/capital-generation/tools/ocr': ['ocr'],
  '@v587d/capital-generation/tools/time': ['get_local_datetime', 'resolve_data_time_range'],
  '@v587d/capital-generation/tools/watchlist': ['get_watchlist'],
  // Root presence settings only; this row registers no tools.
  '@v587d/capital-generation/tools/root-extras': [],
}

/** A row owns its complete tool family; generic capabilities are not trimmed per role. */
export function rowTools(rowName, config) {
  const names = CAPITAL_ROW_TOOLS[rowName]
  if (names === undefined) throw new Error(`未知的族行 ${rowName}：它没登记在 test/family-rows.mjs 的行契约里`)
  if (config !== undefined && Object.keys(config).length > 0) {
    throw new Error(`${rowName} 带了行配置 ${JSON.stringify(config)}，但行契约里没有开关：写一格没人读的 config 就是下一次"以为裁了、其实没裁"`)
  }
  return [...names]
}

/** Deduplicated sorted surface produced by a set of mounted rows. */
export function faceOf(rows) {
  return [...new Set(rows.flatMap((row) => rowTools(row.name, row.config)))].sort()
}
