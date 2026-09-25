import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CONVERSION_DEPTH,
  extractTitle,
  htmlToMarkdown,
  stripInvisibleText,
} from '../lib/web-retriever/html-markdown.js'

const OMITTED_MARKDOWN = '[HTML content omitted: unable to convert safely.]'

function callWithoutThrow(html, maxChars, message) {
  let result
  assert.doesNotThrow(() => {
    result = htmlToMarkdown(html, maxChars)
  }, message)
  return result
}

test('MAX_CONVERSION_DEPTH 常量为 512（官方实测：512 层 ≈ 0.15s，2000 层 ≈ 2s）', () => {
  assert.equal(MAX_CONVERSION_DEPTH, 512)
})

test('removeNonVisibleContent：script/style/noscript/template/iframe/object/embed 内容不外漏', () => {
  const html = '<p>before</p><script>alert(1)</script><style>body{color:red}</style>'
    + '<noscript>NS</noscript><template>TP</template><iframe src="https://i.test"></iframe>'
    + '<object data="o"></object><embed src="e"><p>after</p>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.omitted, false)
  assert.match(result.markdown, /before/)
  assert.match(result.markdown, /after/)
  for (const leak of ['alert(1)', 'color:red', 'NS', 'TP']) {
    assert.ok(!result.markdown.includes(leak), `不得外漏：${leak}`)
  }
})

test('removeNonVisibleContent：display:none / visibility / aria-hidden / hidden / input[type=hidden] 全部命中', () => {
  const html = '<p>VISIBLE</p>'
    + '<div style="display:none">S1</div>'
    + '<div style="visibility:hidden">S2</div>'
    + '<div style="visibility:collapse">S3</div>'
    + '<div style="display:none !important">S4</div>'
    + '<div style="DISPLAY: NONE">S5</div>'
    + '<div aria-hidden="true">S6</div>'
    + '<div hidden>S7</div>'
    + '<div><input type="hidden" value="SECRET_INPUT"><span>ok</span></div>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.omitted, false)
  assert.equal(result.markdown, 'VISIBLE\n\nok')
  for (const leak of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'SECRET_INPUT']) {
    assert.ok(!result.markdown.includes(leak), `不得外漏：${leak}`)
  }
})

test('removeNonVisibleContent：多声明与冒号周围空格也能命中 display:none', () => {
  const result = htmlToMarkdown('<div style="color:red;display : none ;margin:0">S8</div><p>keep</p>', 20_000)
  assert.equal(result.omitted, false)
  assert.equal(result.markdown, 'keep')
})

test('GFM 表格：3 列 thead 表 → 表头行 + --- 分隔行 + 数据行', () => {
  const html = '<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>'
    + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.omitted, false)
  assert.equal(result.markdown, '| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   | 3   |')
  // 「| a | b | c |」形式的行（允许单元格内填充空格）与精确分隔行。
  assert.match(result.markdown, /^\| a\s+\|\s*b\s+\|\s*c\s+\|$/m)
  assert.match(result.markdown, /^\| --- \| --- \| --- \|$/m)
})

test('GFM 表格：无 thead 但首行全 th → 同样补分隔行', () => {
  const html = '<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.markdown, '| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   | 3   |')
})

test('GFM 表格：td-only 表由 gfm 插件补空表头 + 分隔行（保持 GFM 合法）', () => {
  const html = '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.markdown, '|     |     |\n| --- | --- |\n| 1   | 2   |\n| 3   | 4   |')
})

test('GFM 表格：align 属性与内联 text-align 决定分隔符形状', () => {
  const byAttr = htmlToMarkdown(
    '<table><tr><th align="center">a</th><th align="right">b</th></tr><tr><td>1</td><td>2</td></tr></table>',
    20_000,
  )
  assert.equal(byAttr.markdown, '| a   | b   |\n| :---: | ---: |\n| 1   | 2   |')
  const byStyle = htmlToMarkdown(
    '<table><tr><th style="text-align: center">a</th></tr><tr><td>1</td></tr></table>',
    20_000,
  )
  assert.equal(byStyle.markdown, '| a   |\n| :---: |\n| 1   |')
})

test('GFM 表格：单元格内竖线转义；colspan 不展开（GFM 无法表达跨列）', () => {
  const escaped = htmlToMarkdown('<table><tr><th>a|b</th></tr><tr><td>c</td></tr></table>', 20_000)
  assert.equal(escaped.markdown, '| a\\|b |\n| --- |\n| c   |')
  const spanned = htmlToMarkdown(
    '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr></table>',
    20_000,
  )
  assert.equal(spanned.markdown, '| a   | b   |\n| --- | --- |\n| wide |')
})

test('基础转换：a → [t](url)，h2 → atx 标题', () => {
  const result = htmlToMarkdown('<h2>标题</h2><p><a href="https://x.test">t</a></p>', 20_000)
  assert.equal(result.omitted, false)
  assert.equal(result.markdown, '## 标题\n\n[t](https://x.test)')
})

test('600 层嵌套：返回固定省略标记、omitted === true、不抛错', () => {
  const openOnly = '<div>'.repeat(600) + 'x'
  const result = callWithoutThrow(openOnly, 20_000)
  assert.equal(result.omitted, true)
  assert.equal(result.markdown, OMITTED_MARKDOWN)
  assert.equal(result.truncated, false)
  const closed = '<div>'.repeat(600) + 'x' + '</div>'.repeat(600)
  const closedResult = callWithoutThrow(closed, 20_000)
  assert.equal(closedResult.omitted, true)
  assert.equal(closedResult.markdown, OMITTED_MARKDOWN)
})

test('600 层嵌套：title 仍从原始 HTML 提取', () => {
  const html = '<html><head><title>deep</title></head><body>' + '<div>'.repeat(600)
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.omitted, true)
  assert.equal(result.title, 'deep')
})

test('深度边界：512 层仍转换、513 层才省略（> MAX_CONVERSION_DEPTH）', () => {
  const atLimit = htmlToMarkdown('<div>'.repeat(512) + 'x' + '</div>'.repeat(512), 20_000)
  assert.equal(atLimit.omitted, false)
  assert.equal(atLimit.markdown, 'x')
  const overLimit = htmlToMarkdown('<div>'.repeat(513) + 'x' + '</div>'.repeat(513), 20_000)
  assert.equal(overLimit.omitted, true)
  assert.equal(overLimit.markdown, OMITTED_MARKDOWN)
})

test('深度守卫不过度触发：400 层正常转换；void 元素与 raw-text 正文不计深度', () => {
  const moderate = htmlToMarkdown('<div>'.repeat(400) + 'ok' + '</div>'.repeat(400), 20_000)
  assert.equal(moderate.omitted, false)
  assert.equal(moderate.markdown, 'ok')
  const voids = htmlToMarkdown('<br>'.repeat(2_000), 20_000)
  assert.equal(voids.omitted, false)
  const rawText = htmlToMarkdown('<script>' + 'a'.repeat(100) + '</script><p>x</p>', 20_000)
  assert.equal(rawText.omitted, false)
  assert.equal(rawText.markdown, 'x')
})

test('输出上限：markdown 长度 ≤ maxChars；超长输入 truncated === true', () => {
  const longInput = htmlToMarkdown('<p>' + 'x'.repeat(500) + '</p>', 200)
  assert.equal(longInput.truncated, true)
  assert.ok(longInput.markdown.length <= 200, `输出长度 ${longInput.markdown.length} 不得超过 200`)
  assert.match(longInput.markdown, /^x+$/)
  assert.equal(longInput.omitted, false)
  // 源不超限但转换输出超限（<hr> → "* * *" 共 5 字符 > 4）：只截输出。
  const expanded = htmlToMarkdown('<hr>', 4)
  assert.equal(expanded.truncated, true)
  assert.equal(expanded.markdown, '* * ')
  assert.equal(expanded.omitted, false)
  // 正常路径不误报截断。
  const normal = htmlToMarkdown('<p>hello</p>', 200)
  assert.equal(normal.truncated, false)
  assert.equal(normal.markdown, 'hello')
})

test('title 从原始 HTML 提取：源串被截断不影响 title', () => {
  const html = '<title>茅台</title><p>' + 'x'.repeat(300) + '</p>'
  const result = htmlToMarkdown(html, 50)
  assert.equal(result.title, '茅台')
  assert.equal(result.truncated, true)
  assert.ok(result.markdown.length <= 50)
})

test('extractTitle：去首尾空、压空白、实体解码（命名 + 十进制 + 十六进制）', () => {
  assert.equal(extractTitle('<title> 茅台 </title>'), '茅台')
  assert.equal(extractTitle('<title>  多  个  空  格  </title>'), '多 个 空 格')
  assert.equal(
    extractTitle('<title>A &amp; B &lt;C&gt; &quot;d&quot; &#39;e&#39; &nbsp;end</title>'),
    'A & B <C> "d" \'e\' end',
  )
  assert.equal(extractTitle('<title>&#20013;&#22269;&#x4e2d;&#x56fd;</title>'), '中国中国')
  assert.equal(extractTitle('<TITLE>upper</TITLE>'), 'upper')
  assert.equal(extractTitle('<title>first</title><title>second</title>'), 'first')
  assert.equal(
    extractTitle('<html><head><meta charset="utf-8"><title>with head</title></head><body><p>b</p></body></html>'),
    'with head',
  )
})

test('extractTitle：单遍解码不二次解（&amp;lt; → &lt;），非法码点原样保留', () => {
  assert.equal(extractTitle('<title>&amp;lt;</title>'), '&lt;')
  assert.equal(extractTitle('<title>&#x110000;</title>'), '&#x110000;')
})

test('extractTitle：无 title / 空 title / 窗口外 → undefined', () => {
  assert.equal(extractTitle('<p>no title here</p>'), undefined)
  assert.equal(extractTitle('<title></title>'), undefined)
  assert.equal(extractTitle('<title>   </title>'), undefined)
  assert.equal(extractTitle('x'.repeat(5_000) + '<title>late</title>'), undefined)
})

test('畸形输入不抛错：未闭合标签、注释内标签、引号里的 >、script 正文里的 </scriptx', () => {
  const cases = [
    ['<div><p>hello', 'hello'],
    ['<!-- <div><div><div> -->visible', 'visible'],
    ['<div title="a > b">t</div>', 't'],
    ["<div title='a > b'>t</div>", 't'],
    ['<script>var s = "</scriptx>";</script><p>ok</p>', 'ok'],
    ['<!DOCTYPE html><p>x</p>', 'x'],
  ]
  for (const [html, expected] of cases) {
    const result = callWithoutThrow(html, 20_000, `不得抛错：${html.slice(0, 40)}`)
    assert.equal(result.omitted, false, `不得省略：${html.slice(0, 40)}`)
    assert.equal(result.markdown, expected)
  }
  const scriptish = htmlToMarkdown('<script>var s = "</scriptx>";</script><p>ok</p>', 20_000)
  assert.ok(!scriptish.markdown.includes('var s'), 'script 正文不得外漏')
})

test('畸形输入不抛错：空串、纯空白、无 body 的 html、未闭合注释', () => {
  for (const html of ['', '   \n  \t ', '<html></html>', '<html>', '<!-- <div>rest is comment']) {
    const result = callWithoutThrow(html, 20_000, `不得抛错：${JSON.stringify(html)}`)
    assert.equal(result.omitted, false)
    assert.equal(result.truncated, false)
    assert.equal(result.markdown, '')
    assert.equal(result.title, undefined)
  }
})

test('幂等与稳定：同一输入连续两次调用结果完全一致（共享 turndown 实例无状态）', () => {
  const rich = '<h2>标题</h2><p><a href="https://x.test">t</a></p>'
    + '<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>'
    + '<script>alert(1)</script><div style="display:none">S</div>'
  const first = htmlToMarkdown(rich, 20_000)
  const second = htmlToMarkdown(rich, 20_000)
  assert.deepEqual(second, first)
  // 交叉转换不同文档后再回来，结果仍一致（证明实例间无状态残留）。
  const other = htmlToMarkdown('<p>other</p><style>x{y:z}</style>', 20_000)
  const third = htmlToMarkdown(rich, 20_000)
  assert.deepEqual(third, first)
  assert.notEqual(other.markdown, first.markdown)
})

test('结果形状：无 title 时不携带 title 字段；有 title 时字段存在', () => {
  const noTitle = htmlToMarkdown('<p>x</p>', 20_000)
  assert.ok(!('title' in noTitle), '无 title 不得携带该字段')
  const withTitle = htmlToMarkdown('<title>茅台</title><p>x</p>', 20_000)
  assert.equal(withTitle.title, '茅台')
  assert.equal(typeof withTitle.markdown, 'string')
  assert.equal(typeof withTitle.truncated, 'boolean')
  assert.equal(typeof withTitle.omitted, 'boolean')
})

test('不可见字符：零宽 / 双向覆盖 / 软连字符不进上下文，实体写法同样剥掉', () => {
  // 顺序要紧：先解码实体、后剥不可见字符，否则 `&#8206;` 解出来的是一个**活的** U+200E 方向标记。
  const html = '<title>浦发&#8206;银行&#xFEFF;</title><p>浦发\u200B银行\u202E反向\u00AD软</p>'
  const result = htmlToMarkdown(html, 20_000)
  assert.equal(result.title, '浦发银行', `title 里的不可见字符必须消失：${JSON.stringify(result.title)}`)
  assert.ok(!/[\u00AD\u200B-\u200F\u202E\uFEFF]/u.test(result.markdown), `正文里的不可见字符必须消失：${JSON.stringify(result.markdown)}`)
  assert.match(result.markdown, /浦发银行反向软/u, '可见文字与顺序不得受影响')
  // 换行 / 回车 / 制表是呈现需要的，不能连带删掉。
  assert.equal(stripInvisibleText('a\r\n\tb'), 'a\r\n\tb')
  assert.equal(extractTitle('<title>公告\u200B\u202A</title>'), '公告')
})
