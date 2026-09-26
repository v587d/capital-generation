// `src/ocr/markdown.ts` 的回归：把 PaddleOCR 的**内联 HTML 表格**变成模型读得懂的 GFM。
//
// 为什么单独钉一份（2026-09-25 真报文实测，贵州茅台 15 页研报）：上游 105,639 个字符里
// 63,232 个（**60%**）是 `style='text-align: center; …'` 样板，表格整张是 HTML。本仓场景
// 恰恰是"大量表格"，不处理就等于预算的六成买的是 HTML 属性；而 `prettifyMarkdown` 这类
// 上游开关**未知键被静默忽略**，帮不上（见 `client.ts` 文件头 ⛔ 2）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOcrDocument, locateQuery, normalizeOcrMarkdown, parsePageRange, selectPages } from '../lib/ocr/markdown.js'

test('内联 HTML 表 → GFM 管道表：剥掉 style 样板但一个数字都不动', () => {
  const source = `<table><thead><tr><th style='text-align: center; word-wrap: break-word;'>项目</th><th style='text-align: center;'>2024E</th></tr></thead><tbody><tr><td style='text-align: center;'>营业收入</td><td style='text-align: center;'>1,740.63</td></tr></tbody></table>`
  const { markdown, tables, styleCharsRemoved } = normalizeOcrMarkdown(source)
  assert.equal(tables, 1)
  assert.ok(styleCharsRemoved > 40, '必须量化"变小是剥排版噪音"，否则回执里的字数下降说不清')
  const lines = markdown.split('\n')
  assert.deepEqual(lines, ['| 项目 | 2024E |', '| --- | --- |', '| 营业收入 | 1,740.63 |'],
    '⛔ `<thead><th>` 表头行必须留在原位：丢了它，第一条数据行就会被当表头，等于给模型一张错表')
  assert.ok(!markdown.includes('style'), '样式一个字节都不该留')
  assert.ok(markdown.includes('1,740.63'), '⛔ 归一化只做无损排版：数字一律照抄，不做摘要也不改写')
})

test('HTML 实体解开、单元格里的竖线转义（串列比报错危险）', () => {
  const { markdown } = normalizeOcrMarkdown(`<table><tr><td>贵州茅台&amp;公司</td><td>A|B</td></tr><tr><td>第二行</td></tr></table>`)
  const lines = markdown.split('\n')
  assert.equal(lines[0], '| 贵州茅台&公司 | A\\|B |', 'GFM 里裸竖线会把一行切成三列')
  assert.equal(lines[2], '| 第二行| |', '列数按各行最大值补齐，分隔行才不会让整张表退化成裸文本')
})

test('上游把标题粘在正文尾巴上（实测 `2024-11-12## 盈利预测`）时补换行，但不误拆无空格的井号', () => {
  assert.ok(normalizeOcrMarkdown('报告日期 2024-11-12## 盈利预测').markdown.includes('\n\n## 盈利预测'), '标题不在行首就进不了页索引')
  assert.equal(normalizeOcrMarkdown('评级#买入 目标价').markdown, '评级#买入 目标价', '`#` 后没有空格就不是标题，不许拆行')
})

test('畸形表格（少写 </td>）仍能一格一切，不把下一格内容并进来', () => {
  const { markdown } = normalizeOcrMarkdown('<table><tr><td style="x">1<td>2</tr></table>')
  assert.equal(markdown.split('\n')[0], '| 1 | 2 |')
})

test('不含 HTML 的正文近似恒等：归一化不许吃掉正文', () => {
  const plain = '# 标题\n\n这是一段普通正文，含 | 竖线也不影响。\n'
  const { markdown, tables, styleCharsRemoved } = normalizeOcrMarkdown(plain)
  assert.equal(markdown, plain.trim())
  assert.equal(tables, 0)
  assert.equal(styleCharsRemoved, 0)
})

test('buildOcrDocument：页标记 + 偏移索引，切片能逐页还原', () => {
  const document = buildOcrDocument([
    { page: 1, markdown: '# 封面\n茅台研报', images: 2 },
    { page: 2, markdown: '<table><tr><td>营收</td><td>1,740.63</td></tr></table>', images: 0 },
    { page: 3, markdown: '风险提示', images: 0 },
  ])
  assert.equal(document.pages.length, 3)
  assert.equal(document.images, 2, 'images 只带数量：上游图链是临时地址，本仓不下载')
  assert.equal(document.tables, 1)
  assert.equal(document.chars, document.document.length)
  for (const entry of document.pages) {
    assert.equal(entry.end - entry.start, entry.chars)
    assert.ok(entry.start >= 0 && entry.end <= document.document.length)
  }
  assert.equal(document.document.slice(document.pages[0].start, document.pages[0].end), '# 封面\n茅台研报')
  assert.match(document.document, /<!-- page:2 -->\n\| 营收 \| 1,740\.63 \|/)
  assert.deepEqual(selectPages(document, [3]).map((item) => item.text), ['风险提示'])
})

test('parsePageRange："1-3" / "5" / "2-4,9" 去重按序，越界响亮失败而不是静默少给', () => {
  assert.deepEqual(parsePageRange('1-3', 5), [1, 2, 3])
  assert.deepEqual(parsePageRange('5', 5), [5])
  assert.deepEqual(parsePageRange('2-4,9', 9), [2, 3, 4, 9])
  assert.deepEqual(parsePageRange('3,1-2,2', 5), [3, 1, 2], '重复页只给一次，顺序按请求')
  assert.deepEqual(parsePageRange('2–4', 5), [2, 3, 4], '中文连接号/全角波浪号同样是区间')
  // "这页没有"和"我没给"在回执里必须能区分：两者都抛，且点名文档实际页数。
  assert.throws(() => parsePageRange('0-2', 5), /out of range/)
  assert.throws(() => parsePageRange('4-6', 5), /document has 5 pages/)
  assert.throws(() => parsePageRange('4-2', 5), /out of range/)
  assert.throws(() => parsePageRange('', 5), /empty after normalization/)
})

test('locateQuery：命中带页号，相邻命中合并成一段（三次同句不算三条证据）', () => {
  const body = `${'前言。'.repeat(30)}营业收入 1,740.63 亿元，营业收入同比增长 15%，营业收入增速放缓。${'尾部。'.repeat(30)}`
  const document = buildOcrDocument([{ page: 1, markdown: body, images: 0 }, { page: 2, markdown: '另一页提到营业收入的口径。', images: 0 }])
  const hits = locateQuery(document, '营业收入', 5, 40)
  assert.ok(hits.length >= 2, `第一次出现与后两次应合并成一段：实际 ${hits.length}`)
  assert.equal(hits[0].page, 1)
  assert.match(hits[0].excerpt, /营业收入/)
  assert.ok(hits.some((hit) => hit.page === 2), '跨页命中必须继续找')
  assert.ok(hits.every((hit) => !hit.excerpt.includes('\n')), '命中片段折成单行（⏎），不给半截换行结构')
  assert.ok(hits.every((hit) => !hit.excerpt.includes('<!-- page:')), '⛔ 落盘布局不是正文：标记进了片段就会被模型原样抄进回传')
  assert.deepEqual(locateQuery(document, '不存在的词', 5, 40), [], '空命中是空数组，由回执翻译成"不等于文档里没有这个主题"')
})

test('locateQuery 窗口停在页边界内：片段标第几页，就只能引第几页的字', () => {
  const document = buildOcrDocument([
    { page: 1, markdown: '第一章 总则。', images: 0 },
    { page: 2, markdown: '营业收入 1,740.63 亿元（第 2 页末）。', images: 0 },
    { page: 3, markdown: '第二章 口径说明。', images: 0 },
  ])
  // 窗口开得很大（1000 字符）也越不出去：命中在第 2 页，片段就只有第 2 页。
  const hits = locateQuery(document, '营业收入', 5, 1_000)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].page, 2)
  assert.ok(!hits[0].excerpt.includes('第一章') && !hits[0].excerpt.includes('第二章'),
    '⛔ 把邻页的字标成本页命中，模型就会按错页号引用——错引比少引危险')
})

test('limit 生效：命中很多时只取前 N 段', () => {
  const document = buildOcrDocument([{ page: 1, markdown: Array.from({ length: 30 }, (_u, i) => `第${i}节 关键指标 数值${i}`).join('\n\n'), images: 0 }])
  assert.equal(locateQuery(document, '关键指标', 3, 10).length, 3)
})
