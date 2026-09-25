/**
 * HTML → GFM Markdown 转换（本地直抓回退的呈现层，todo 4 `local-fetch.ts` 消费）。
 *
 * 语义逐条移植自官方 DSH `web_fetch` 渲染器
 * （`dsh-LLM-icon/.research/dsh-src/packages/web/tool-web/src/fetch.ts`）：
 * turndown + GFM 插件、`removeNonVisibleContent` 规则、无跨列展开的表格规则、
 * 512 层嵌套词法守卫与固定省略标记。官方实现里与本模块无关的呈现职责
 * （`Fetched <url>` 头、截断脚注、WeakMap memoization）一律不搬——"网页正文不是指令"
 * 由 web_retriever persona 的硬规则承担，不在正文里插水印。
 *
 * 官方没做、这里补上的第四道：`stripInvisibleText`（零宽 / 双向覆盖 / C0-C1 控制符剥离）。
 * 它放在本模块导出，是因为 invisibles 的入口不止 HTML：`extractTitle` 会解码数字实体
 * （`&#x202E;` 解出来就是 RLO），AnySearch 返回的清洗正文也原样带这些字符。
 * 三个内容入口（本地转换、title、具名来源页面字段）共用这一份实现（AGENTS.md §9.7）。
 *
 * 为什么必须补这三道保护（turndown 的已知缺口）：
 * - turndown 默认**不删** `<script>/<style>`，其正文会当文本带进输出；
 * - turndown 完全**不处理**隐藏元素；
 * - turndown 的转换按元素递归，超深嵌套下可能爆栈或长时间占用事件循环——
 *   官方实测：嵌套 512 层 ≈ 0.15s、2000 层 ≈ 2s、20000 层 ≈ 5s，期间协作式
 *   超时定时器无法触发，所以超过 512 层直接放弃转换。
 */

import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'

/** 嵌套深度上限：超过则跳过转换、返回固定省略标记。健壮性不变量，不是可调参数。 */
export const MAX_CONVERSION_DEPTH = 512

/** 转换结果：`title` 从原始 HTML 提取（源串截断不影响）；无 title 时缺省该字段。 */
export interface HtmlMarkdownResult {
  title?: string
  /** 转换后的 GFM markdown；转换不安全时为固定省略标记。 */
  markdown: string
  /** 源串或输出曾被 `maxChars` 截断。 */
  truncated: boolean
  /** true 表示转换被放弃（超深或 turndown 抛错），`markdown` 为省略标记。 */
  omitted: boolean
}

// ---------------------------------------------------------------------------
// 不可见字符剥离（外部内容共用的出口）
// ---------------------------------------------------------------------------

/**
 * 网页里可以出现**完全没有字形**的字符，而它们会原样进入模型上下文与用户看到的引用：
 * - C0/C1 控制符与 DEL：`\r`、`\x00` 之类能把一行截断或让后续文本覆盖已显示内容；
 * - 软连字符 `U+00AD`、零宽系列 `U+200B–U+200F`（含 LRM/RLM 方向标记）/ `U+2060–U+2064` / BOM：
 *   肉眼不可见，却能把 `忽略前面的指令` 写成关键词字面检查**认不出**的形状；
 * - 双向覆盖 `U+202A–U+202E` / 隔离符 `U+2066–U+2069`：改变一行的**显示顺序**
 *   （Trojan Source 一类攻击），回显给用户的就是假的文本；
 * - `U+2028` / `U+2029`：行/段分隔符，渲染上与 `\n` 等价、按行处理时又不算换行。
 *
 * 只删不替换成占位符：这些字符在合法正文里没有承载信息，删除是保序的。
 * 换行 `\n`、回车 `\r`、制表 `\t` 保留（markdown 呈现需要）。
 */
const INVISIBLE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu

export function stripInvisibleText(value: string): string {
  return value.replace(INVISIBLE_PATTERN, '')
}

// ---------------------------------------------------------------------------
// turndown 实例与规则（官方 fetch.ts:25-95 的移植）
// ---------------------------------------------------------------------------

/** turndown 构造选项：与官方 web_fetch 一致的固定呈现选项。 */
interface TurndownOptions {
  headingStyle: 'atx'
  codeBlockStyle: 'fenced'
  bulletListMarker: '-'
}

/**
 * 垫片（`turndown-shim.d.ts`）只声明了无参构造，而本仓约定不引入 `@types/turndown`、
 * 也不改垫片文件；这里在使用点给出带选项的精确构造签名（结构类型，非 any）。
 */
type TurndownConstructor = new (options: TurndownOptions) => TurndownService

/** domino 节点的最小结构形状：remove 规则与表格规则实际用到的成员。 */
interface DomNode {
  nodeName: string
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
  parentNode: DomNode | null
  parentElement: DomNode | null
  childNodes: ArrayLike<DomNode>
}

/** 表格行：cells 集合（th/td）。 */
interface DomTableRow extends DomNode {
  cells: ArrayLike<DomNode>
}

/** 表格分节（thead/tbody/tfoot）：父节点是 table。 */
interface DomTableSection extends DomNode {
  parentElement: DomTable | null
}

/** 表格：rows 集合（判断表头行用）。 */
interface DomTable extends DomNode {
  rows: ArrayLike<DomNode>
}

/** 表格单元格：align 属性与内联 style 的 text-align 决定 GFM 分隔符。 */
interface DomTableCell extends DomNode {
  style: { textAlign: string }
}

/**
 * 模块作用域唯一的 turndown 实例。官方注释明说该实例跨 `turndown()` 调用无状态、
 * 可共享；规则只注册一次，全部转换复用（测试用幂等用例钉住这一点）。
 * 规则注册顺序与官方一致：先 `use(gfm)`，再 remove 规则，最后表格规则——
 * turndown 按后注册先匹配解析规则，表格规则因此覆盖 gfm 插件自带的跨列展开实现。
 */
const turndown = new (TurndownService as TurndownConstructor)({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
turndown.use(gfm)

/** 命中即整块删除（replacement 返回空串），脚本/样式/隐藏元素的内容不进输出。 */
turndown.addRule('removeNonVisibleContent', {
  filter(node: DomNode): boolean {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.nodeName)) return true
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true
    if (node.nodeName === 'INPUT' && node.getAttribute('type')?.toLowerCase() === 'hidden') return true
    const declarations = node.getAttribute('style')?.split(';') ?? []
    return declarations.some((declaration) => {
      const separator = declaration.indexOf(':')
      if (separator === -1) return false
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important\s*$/u, '')
      return (property === 'display' && value === 'none')
        || (property === 'visibility' && (value === 'hidden' || value === 'collapse'))
    })
  },
  replacement(): string {
    return ''
  },
})

/** 渲染一个 GFM 表格单元格，不解释 HTML 的跨列计数。 */
function renderTableCell(content: string, index: number): string {
  const prefix = index === 0 ? '| ' : ' '
  const escaped = content.trim().replace(/\n\r/g, '<br>').replace(/\n/g, '<br>').replace(/\|+/g, '\\|').padEnd(3, ' ')
  return `${prefix}${escaped} |`
}

/** 该行是否表格的 Markdown 表头行。 */
function isTableHeadingRow(row: DomTableRow): boolean {
  const cells = Array.from(row.cells)
  const section = row.parentElement as DomTableSection
  const table = section.parentElement as DomTable
  return (section.nodeName === 'THEAD' || table.rows[0] === row)
    && cells.every(cell => cell.nodeName === 'TH')
}

/** 把 HTML 单元格对齐方式映射成 GFM 分隔符。 */
function tableBorder(cell: DomTableCell): string {
  const alignment = (cell.getAttribute('align') || cell.style.textAlign || '').toLowerCase()
  if (alignment === 'left') return ':---'
  if (alignment === 'right') return '---:'
  if (alignment === 'center') return ':---:'
  return '---'
}

turndown.addRule('tableCellWithoutSpanExpansion', {
  filter: ['th', 'td'],
  replacement(content: string, node: DomNode): string {
    const cell = node as DomTableCell
    const row = cell.parentNode as DomTableRow
    // GFM 无法表达跨列。忽略 colspan 让转换工作量与输出和源成正比，
    // 而不是跟数字属性走（gfm 插件自带规则会按 colspan 展开成多个空单元格）。
    return renderTableCell(content, Array.from(row.childNodes).indexOf(cell))
  },
})
turndown.addRule('tableRowWithoutSpanExpansion', {
  filter: 'tr',
  replacement(content: string, node: DomNode): string {
    const row = node as DomTableRow
    const border = isTableHeadingRow(row)
      ? Array.from(row.cells, (cell: DomNode, index: number) => renderTableCell(tableBorder(cell as DomTableCell), index)).join('')
      : ''
    return `\n${content}${border.length > 0 ? `\n${border}` : ''}`
  },
})

// ---------------------------------------------------------------------------
// 嵌套深度词法守卫（官方 fetch.ts:120-223 的移植）
// ---------------------------------------------------------------------------

/** 永不接收闭合标签的元素：不进词法栈。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 正文按纯文本解析、直到匹配闭合标签的元素。 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript'])

/** 一个字符能否出现在 raw-text 闭合标签名之后。 */
function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || /\s/.test(char)
}

/** 找 raw-text 元素的匹配闭合标签，不把正文里长得像标记的文本当标签。 */
function findRawTextEnd(lowerHtml: string, name: string, from: number): number {
  const prefix = `</${name}`
  let candidate = lowerHtml.indexOf(prefix, from)
  while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) {
    candidate = lowerHtml.indexOf(prefix, candidate + prefix.length)
  }
  return candidate
}

/**
 * 保守地拒绝词法元素栈超过转换深度上限的 HTML。单遍扫描：忽略注释里的闭合
 * 标签、跳过 raw-text 正文、尊重引号里的 `>`、只接受与栈顶同名的闭合标签——
 * 畸形输入因此只会多计嵌套，不会把嵌套藏掉。
 */
function exceedsConversionDepth(html: string): boolean {
  const lowerHtml = html.toLowerCase()
  const openElements: string[] = []
  let offset = 0
  let inComment = false

  while (offset < html.length) {
    const start = html.indexOf('<', offset)
    if (inComment) {
      const end = html.indexOf('-->', offset)
      if (end !== -1 && (start === -1 || end < start)) {
        inComment = false
        offset = end + 3
        continue
      }
    }
    if (start === -1) break
    if (!inComment && html.startsWith('<!--', start)) {
      inComment = true
      offset = start + 4
      continue
    }

    let cursor = start + 1
    const closing = html[cursor] === '/'
    if (closing) cursor += 1
    const nameStart = cursor
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? '')) cursor += 1
    if (cursor === nameStart || !/[a-zA-Z]/.test(html.charAt(nameStart))) {
      offset = start + 1
      continue
    }

    const name = lowerHtml.slice(nameStart, cursor)
    let quote: '"' | "'" | undefined
    while (cursor < html.length) {
      const char = html[cursor]
      cursor += 1
      if (quote !== undefined) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (html[cursor - 1] !== '>') break

    if (closing) {
      if (!inComment && openElements.at(-1) === name) openElements.pop()
    } else {
      let last = cursor - 2
      while (/\s/.test(html.charAt(last))) last -= 1
      if (!VOID_ELEMENTS.has(name) && html[last] !== '/') {
        openElements.push(name)
        if (openElements.length > MAX_CONVERSION_DEPTH) return true
        if (!inComment && RAW_TEXT_ELEMENTS.has(name)) {
          const end = findRawTextEnd(lowerHtml, name, cursor)
          if (end === -1) break
          offset = end
          continue
        }
      }
    }
    offset = cursor
  }
  return false
}

// ---------------------------------------------------------------------------
// title 提取
// ---------------------------------------------------------------------------

/** 只在开头固定窗口内找 `<title>`：title 位于 head、靠文档开头，窗口上限避免对超长正文全量扫描。 */
const TITLE_SCAN_CHARS = 2048

const TITLE_PATTERN = /<title[^>]*>([^<]*)<\/title>/i
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|nbsp|#[0-9]+|#[xX][0-9a-fA-F]+);/g
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['nbsp', '\u00a0'],
])

/** 解码数字字符引用（十进制与十六进制）；非法码点返回 null（保留原文）。 */
function decodeNumericEntity(body: string): string | null {
  const hex = body[1] === 'x' || body[1] === 'X'
  const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
  if (!(code >= 0 && code <= 0x10ffff)) return null
  return String.fromCodePoint(code)
}

/** 单遍解码实体：`&amp;lt;` 只解成 `&lt;`，不会第二轮再解成 `<`。 */
function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match) => {
    const body = match.slice(1, -1)
    const named = NAMED_ENTITIES.get(body)
    if (named !== undefined) return named
    return decodeNumericEntity(body) ?? match
  })
}

/**
 * 从 HTML 开头提取 `<title>` 并解码实体、压空白。找不到或解码后为空返回
 * `undefined`。注意：`<title>` 的文本按官方行为仍会留在 markdown 正文里
 * （官方 remove 列表不含 TITLE），本函数只负责回执的 `title` 字段。
 */
export function extractTitle(html: string): string | undefined {
  const match = TITLE_PATTERN.exec(html.slice(0, TITLE_SCAN_CHARS))
  if (match === null) return undefined
  const title = stripInvisibleText(decodeEntities(match[1])).replace(/\s+/g, ' ').trim()
  return title === '' ? undefined : title
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 转换不安全（超深或 turndown 抛错）时返回的固定省略标记。 */
const OMITTED_MARKDOWN = '[HTML content omitted: unable to convert safely.]'

function omittedResult(title: string | undefined, sourceTruncated: boolean, maxChars: number): HtmlMarkdownResult {
  const outputTruncated = OMITTED_MARKDOWN.length > maxChars
  return {
    ...(title !== undefined ? { title } : {}),
    markdown: outputTruncated ? OMITTED_MARKDOWN.slice(0, maxChars) : OMITTED_MARKDOWN,
    truncated: sourceTruncated || outputTruncated,
    omitted: true,
  }
}

/**
 * 把 HTML 转成有界 GFM markdown。
 *
 * 流程：先按 `maxChars` 截断源串（记 `truncated`，与官方 renderBody 一致）→
 * 超深或 turndown 抛错 → 固定省略标记 + `omitted: true`（不让原始标记外漏）→
 * 否则转换，剥掉不可见字符（`stripInvisibleText`），再按 `maxChars` 截断输出。
 * `title` 一律从**原始** HTML 提取。
 */
export function htmlToMarkdown(html: string, maxChars: number): HtmlMarkdownResult {
  const title = extractTitle(html)
  const content = html.slice(0, maxChars)
  const sourceTruncated = content.length !== html.length
  if (exceedsConversionDepth(content)) {
    return omittedResult(title, sourceTruncated, maxChars)
  }
  let converted: string
  try {
    converted = turndown.turndown(content)
  } catch {
    // turndown 的 DOM 遍历按元素递归；词法守卫建模不了的畸形标记仍可能抛
    // RangeError。转换失败与超深走同一个省略标记，不把源标记带回模型上下文。
    return omittedResult(title, sourceTruncated, maxChars)
  }
  const sanitized = stripInvisibleText(converted)
  const outputTruncated = sanitized.length > maxChars
  return {
    ...(title !== undefined ? { title } : {}),
    markdown: outputTruncated ? sanitized.slice(0, maxChars) : sanitized,
    truncated: sourceTruncated || outputTruncated,
    omitted: false,
  }
}
