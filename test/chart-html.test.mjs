import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStandaloneHtml, loadVendoredChartLibrary } from '../lib/chart/html.js'
import { buildChartPayload } from '../lib/chart/series.js'
import { normalizeChartSpec } from '../lib/chart/spec.js'

/**
 * Structure of the self-contained HTML (the fallback when the client extension surface breaks).
 * Failures here show up in a browser as a blank or half-drawn page with no error, so pin them:
 * inline scripts parse, data cannot close the script tag early, dark mode is self-contained.
 */

const library = loadVendoredChartLibrary()

function htmlFor(rows, rawSpec) {
  const payload = buildChartPayload({
    chart_id: 'ch_html',
    spec: normalizeChartSpec(rawSpec),
    rows,
    meta: { source_kind: 'path' },
  })
  return buildStandaloneHtml({ payload, library, generatedAt: 1_700_000_000_000 })
}

/** Extracts every <script> body; the artifact may only contain inline scripts. */
function inlineScripts(html) {
  const bodies = []
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
  let match
  while ((match = pattern.exec(html)) !== null) bodies.push(match[1])
  return bodies
}

test('自包含 HTML：三段内联脚本语法都合法，且没有任何外部资源引用', () => {
  const html = htmlFor([{ date: '2025-01-01', close: 1 }], { kind: 'line', x: 'date', series: ['close'] })

  // Structural checks are more reliable than grepping a minified library: everything must be inline.
  assert.equal(/<script[^>]*\bsrc=/.test(html), false, '不允许外部脚本')
  assert.equal(/<link[^>]+href=/i.test(html), false, '不允许外部样式')
  // The markup with script bodies removed must reference no external resources.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '')
  assert.equal(/(src|href)\s*=\s*["']https?:/i.test(markup), false, '页面标签不允许外部资源引用')

  const scripts = inlineScripts(html)
  assert.equal(scripts.length, 3, `期望 3 段内联脚本（库 / 运行时 / 渲染调用），实际 ${scripts.length}`)
  for (const [index, body] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(body), `第 ${index + 1} 段内联脚本语法错误`)
  }
  // Our runtime must make no network requests (the vendored library's own SVG links are its internals).
  assert.equal(/\bfetch\s*\(/.test(scripts[1]), false, '运行时不应发起网络请求')
  assert.equal(/XMLHttpRequest/.test(scripts[1]), false, '运行时不应发起网络请求')
})

test('自包含 HTML：数据里的 </script> 与尖括号不能逃出脚本标签', () => {
  const evil = '</script><img src=x onerror=alert(1)>'
  const html = htmlFor([{ date: '2025-01-01', label: evil, close: 1 }], { kind: 'column', x: 'label', series: ['close'] })

  // Tag structure must survive: same script count, no real img element injected.
  assert.equal(inlineScripts(html).length, 3)
  assert.equal(/<img/i.test(html), false, '数据内容逃出了脚本标签')
  assert.ok(html.includes('\\u003c/script'), '尖括号必须以 \\u003c 形式内联进 JSON')

  // The payload inlined in the render call is still parseable JSON.
  const renderScript = inlineScripts(html)[2]
  const payloadText = /var payload = ([\s\S]*?);\n/.exec(renderScript)[1]
  const payload = JSON.parse(payloadText)
  assert.equal(payload.chart_id, 'ch_html')
  assert.equal(payload.kind, 'column')
})

test('自包含 HTML：自带明暗两套主题变量与归属信息', () => {
  const html = htmlFor([{ date: '2025-01-01', close: 1 }], { kind: 'line', x: 'date', series: ['close'] })
  assert.match(html, /--dsw-alias-brand-primary/)
  assert.match(html, /@media \(prefers-color-scheme: dark\)/)
  assert.match(html, new RegExp(`Lightweight Charts™ v${library.version}`))
  assert.match(html, /不构成投资建议/)
})
