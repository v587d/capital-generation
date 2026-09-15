/**
 * 自包含 HTML 图表的生成器。
 *
 * 这是整个方案的**降级底线**（docs/design/chart-visualization.md §5.4 的 L2）：
 * 它只依赖"用户有一个浏览器"，不依赖 DSH 的客户端插件系统、不依赖网络、
 * 不依赖任何上游扩展点。即使 Slot / bundle / 路由全部被上游改动打坏，
 * 用户依然能拿到一张可交互的图。
 *
 * 因此它必须：内联 vendored 库 + 内联数据 + 内联运行时，**零外部请求**。
 */
import { ChartError } from './errors.js'
import { CHART_RUNTIME_SOURCE } from './runtime.js'
import type { ChartPayload } from './series.js'

export interface VendoredChartLibrary {
  source: string
  version: string
  license: string
}

/**
 * 取 Node 内建 fs。
 *
 * 本仓刻意不引入 `@types/node`（src 里其他地方也不 import node: 模块），改用与
 * cordis.patch.yml 同一个惯用法 `process.getBuiltinModule`，因此只依赖**运行时**能力，
 * 不新增构建期类型依赖。
 */
interface NodeFsLike {
  readFileSync(path: URL, encoding: 'utf8'): string
}

function nodeFs(): NodeFsLike {
  const processLike = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  const fs = processLike?.getBuiltinModule?.('node:fs') as NodeFsLike | undefined
  if (!fs || typeof fs.readFileSync !== 'function') {
    throw new ChartError('chart_runtime_unavailable', 'Node fs is unavailable in this host; the standalone HTML artifact cannot embed the vendored chart library')
  }
  return fs
}

let cachedLibrary: VendoredChartLibrary | undefined

/**
 * 读取随包发布的 lightweight-charts standalone 构建。
 *
 * 路径相对 `import.meta.url`：编译后是 `lib/chart/vendor/...`（由 scripts/copy-assets.mjs
 * 从 `vendor/` 复制过去）。缺失时给出可操作错误，而不是让 HTML 里静默少一段脚本。
 */
export function loadVendoredChartLibrary(): VendoredChartLibrary {
  if (cachedLibrary) return cachedLibrary
  try {
    const fs = nodeFs()
    const source = fs.readFileSync(new URL('vendor/lightweight-charts.standalone.production.js', import.meta.url), 'utf8')
    const manifest = JSON.parse(fs.readFileSync(new URL('vendor/VERSION.json', import.meta.url), 'utf8')) as { version?: string; license?: string }
    cachedLibrary = { source, version: manifest.version ?? 'unknown', license: manifest.license ?? 'Apache-2.0' }
    return cachedLibrary
  } catch (error) {
    if (error instanceof ChartError) throw error
    throw new ChartError('chart_runtime_unavailable', `vendored lightweight-charts is missing (${error instanceof Error ? error.message : String(error)}); run npm run vendor:charts && npm run build`)
  }
}

/** 内联脚本的安全转义：`</script` 会提前结束 script 元素。 */
function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/** 内联 JSON 的安全转义：`<` 一律写成 `\u003c`（JSON 里合法，且彻底杜绝标签闭合）。 */
function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** 数据截至时间：按本仓数据口径用 Asia/Shanghai 显示，同时保留 UTC。 */
function formatCapturedAt(epochMs: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(epochMs)
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute} (Asia/Shanghai)`
  } catch {
    return new Date(epochMs).toISOString()
  }
}

export interface BuildStandaloneHtmlInput {
  payload: ChartPayload
  library: VendoredChartLibrary
  /** 生成时刻（epoch ms），仅用于页脚署名，不参与渲染。 */
  generatedAt: number
}

export function buildStandaloneHtml(input: BuildStandaloneHtmlInput): string {
  const { payload, library } = input
  const meta = payload.meta

  const facts: string[] = []
  facts.push(`${meta.points} 个数据点`)
  if (meta.downsampled) facts.push(`已从 ${meta.original_points} 点下采样（保留极值形状，非全量）`)
  if (meta.dataset_id) facts.push(`dataset ${meta.dataset_id}`)
  if (meta.source_label) facts.push(meta.source_label)
  if (meta.captured_at !== undefined) facts.push(`数据截至 ${formatCapturedAt(meta.captured_at)}`)
  if (meta.time_field) facts.push(`时间字段 ${meta.time_field}`)
  if (meta.axis === 'index') facts.push('分类轴（按行序）')

  const warnings = meta.warnings.length > 0
    ? `<ul class="warnings">${meta.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>
  /* 同一批 CSS 变量名由 DSH 壳提供；自包含 HTML 自己定义，因此两边渲染完全一致。 */
  :root {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-border-l1: rgba(0,0,0,0.10);
    --dsw-alias-label-primary: #1f2328;
    --dsw-alias-label-secondary: #6b7280;
    --dsw-alias-brand-primary: #2563eb;
    --dsw-alias-state-error-primary: #d94a3d;
    --dsw-alias-state-success-primary: #2f9e44;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --dsw-alias-bg-base: #16181d;
      --dsw-alias-border-l1: rgba(255,255,255,0.12);
      --dsw-alias-label-primary: #e8eaed;
      --dsw-alias-label-secondary: #9aa0a6;
      --dsw-alias-brand-primary: #6ea8fe;
      --dsw-alias-state-error-primary: #f0776c;
      --dsw-alias-state-success-primary: #57cc72;
    }
  }
  html, body { margin: 0; padding: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
  body { font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; padding: 16px 20px 24px; }
  h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  .facts { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
  main { margin-top: 12px; height: 460px; min-height: 320px; }
  .warnings { margin: 12px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
  footer { margin-top: 16px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(payload.title)}</h1>
  <p class="facts">${facts.map((fact) => escapeHtml(fact)).join(' · ')}</p>
</header>
<main id="chart"></main>
${warnings}
<footer>数据来源见上方标注；图表仅用于呈现，不构成投资建议。Lightweight Charts™ v${escapeHtml(library.version)} (${escapeHtml(library.license)})。</footer>
<script>${escapeScript(library.source)}</script>
<script>var __capitalChart = ${escapeScript(CHART_RUNTIME_SOURCE)};</script>
<script>
(function () {
  var payload = ${escapeJson(payload)};
  var container = document.getElementById('chart');
  try {
    __capitalChart.render(container, payload, globalThis.LightweightCharts);
  } catch (error) {
    container.textContent = '图表渲染失败：' + (error && error.message ? error.message : String(error));
  }
})();
</script>
</body>
</html>
`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
