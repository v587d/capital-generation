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
/** 嵌套深度上限：超过则跳过转换、返回固定省略标记。健壮性不变量，不是可调参数。 */
export declare const MAX_CONVERSION_DEPTH = 512;
/** 转换结果：`title` 从原始 HTML 提取（源串截断不影响）；无 title 时缺省该字段。 */
export interface HtmlMarkdownResult {
    title?: string;
    /** 转换后的 GFM markdown；转换不安全时为固定省略标记。 */
    markdown: string;
    /** 源串或输出曾被 `maxChars` 截断。 */
    truncated: boolean;
    /** true 表示转换被放弃（超深或 turndown 抛错），`markdown` 为省略标记。 */
    omitted: boolean;
}
export declare function stripInvisibleText(value: string): string;
/**
 * 从 HTML 开头提取 `<title>` 并解码实体、压空白。找不到或解码后为空返回
 * `undefined`。注意：`<title>` 的文本按官方行为仍会留在 markdown 正文里
 * （官方 remove 列表不含 TITLE），本函数只负责回执的 `title` 字段。
 */
export declare function extractTitle(html: string): string | undefined;
/**
 * 把 HTML 转成有界 GFM markdown。
 *
 * 流程：先按 `maxChars` 截断源串（记 `truncated`，与官方 renderBody 一致）→
 * 超深或 turndown 抛错 → 固定省略标记 + `omitted: true`（不让原始标记外漏）→
 * 否则转换，剥掉不可见字符（`stripInvisibleText`），再按 `maxChars` 截断输出。
 * `title` 一律从**原始** HTML 提取。
 */
export declare function htmlToMarkdown(html: string, maxChars: number): HtmlMarkdownResult;
