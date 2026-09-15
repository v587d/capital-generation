import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStandaloneHtml, loadVendoredChartLibrary } from '../lib/chart/html.js'
import { buildChartPayload } from '../lib/chart/series.js'
import { normalizeChartSpec } from '../lib/chart/spec.js'

/**
 * 自包含 HTML 的**结构**测试。
 *
 * 产物是降级底线（DSH 客户端扩展面坏掉时唯一还能看图的路），所以它必须自己站得住：
 * 内联脚本语法必须正确、标签不能被数据里的尖括号提前闭合、深色模式自带。这些错误
 * 在浏览器里表现为"白屏或半张图"，没有任何报错可看——只能靠测试提前钉住。
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

/** 抽出所有 <script> 正文；自包含产物只允许内联脚本。 */
function inlineScripts(html) {
  const bodies = []
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
  let match
  while ((match = pattern.exec(html)) !== null) bodies.push(match[1])
  return bodies
}

test('自包含 HTML：三段内联脚本语法都合法，且没有任何外部资源引用', () => {
  const html = htmlFor([{ date: '2025-01-01', close: 1 }], { kind: 'line', x: 'date', series: ['close'] })

  // 结构性断言（比在压缩过的库里搜 URL 可靠）：一切都必须内联。
  assert.equal(/<script[^>]*\bsrc=/.test(html), false, '不允许外部脚本')
  assert.equal(/<link[^>]+href=/i.test(html), false, '不允许外部样式')
  // 去掉脚本正文后的纯标签部分不应引用任何外部资源。
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '')
  assert.equal(/(src|href)\s*=\s*["']https?:/i.test(markup), false, '页面标签不允许外部资源引用')

  const scripts = inlineScripts(html)
  assert.equal(scripts.length, 3, `期望 3 段内联脚本（库 / 运行时 / 渲染调用），实际 ${scripts.length}`)
  for (const [index, body] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(body), `第 ${index + 1} 段内联脚本语法错误`)
  }
  // 我们自己的运行时不得发起任何网络请求（vendored 库内部有 SVG 命名空间与归属链接，那是它的实现细节）。
  assert.equal(/\bfetch\s*\(/.test(scripts[1]), false, '运行时不应发起网络请求')
  assert.equal(/XMLHttpRequest/.test(scripts[1]), false, '运行时不应发起网络请求')
})

test('自包含 HTML：数据里的 </script> 与尖括号不能逃出脚本标签', () => {
  const evil = '</script><img src=x onerror=alert(1)>'
  const html = htmlFor([{ date: '2025-01-01', label: evil, close: 1 }], { kind: 'column', x: 'label', series: ['close'] })

  // 标签结构必须仍然完整：脚本标签数量不变，且没有真的注入 img 元素。
  assert.equal(inlineScripts(html).length, 3)
  assert.equal(/<img/i.test(html), false, '数据内容逃出了脚本标签')
  assert.ok(html.includes('\\u003c/script'), '尖括号必须以 \\u003c 形式内联进 JSON')

  // 渲染调用里内联的 payload 仍然是可解析的 JSON。
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
