import z from '@deepseek-ai/schemastery'

export const name = 'capital-config'

/**
 * 本包在 profile 里的**条目 id**。0.1.7 起它就是 settings 命名空间本身：
 * `dsh-settings` 不再接受 `settings.register()`，而是把**活动 profile 条目**的 Config schema 里
 * 声明为 `.volatile()` 的字段投影成表单，`ns` 恒等于 `entry.options.id`。两个事实因此承重：
 *
 *  1. **它是卡片的座位**：浏览器半边 `ctx.configForms.get(条目 id)` 与
 *     `whileServed([条目 id])` 都按它寻址；卡片注册进 `plugins.row.config`，
 *     key 是 `<包名>#<条目 id>`。改名字任何一处不同步，卡片都是**静默消失**（零报错）。
 *  2. **它是取数配置的来源**：主插件 `@v587d/capital-generation` 经
 *     `settings.describe()` 读同一条目的解析值，拿 `fuyaoCredentialRef` /
 *     `retriever.credentialRef` / `retriever.windDocs.credentialRef` /
 *     `retriever.paddleOcr.credentialRef` 这些**引用名**去寻密钥。
 *
 * 密钥本身恒不进本条目：API Key 写在 credentials 域（`remote.credentials.set`），
 * 这里只存引用名。唯一写进配置的偏好是回退开关 `retriever.localFetch.enabled`。
 *
 * ⛔ 字段必须 `.volatile()`：`volatileForm(schema)` 在没有任何 volatile 字段时返回
 * `undefined`，该条目就**不进** describe 镜像——卡片读不到命名空间，写入也会被
 * `Config field "…" is not volatile` 拒绝。非 volatile 字段仍是普通配置，只能改 profile 文件。
 *
 * 浏览器半边镜像了这个 id（`client.src.cjs` 的 `ENTRY_ID`），两处同改由
 * `test/capital-config.test.mjs` 钉住。
 */
export const SETTINGS_ENTRY_ID = 'capital-config'

const WindDocsSchema = z.object({
  endpoint: z.string().default('').volatile().description('可选：覆盖 Wind 文档检索端点'),
  credentialRef: z.string().default('WIND_API_KEY').volatile().description('Wind credentials 引用名'),
  timeoutMs: z.number().default(60000).volatile().description('Wind 请求超时毫秒'),
})

/**
 * 本地直连回退默认值。必须与主插件 `src/index.ts` 的 `LOCAL_FETCH_DEFAULTS` 逐字一致
 * （两处 schema 漂移会被 `test/capital-config.test.mjs` 的 deepEqual 用例抓住）。
 * 数值口径对齐官方 `dsh-web-fetch-http`（timeoutMs=30000 / maxBodyChars=100000）；
 * `maxContentChars` 切在转换前的原始 HTML 上，所以按 HTML 体积给足。
 * `userAgent` 默认是产品标识；显式配成空串时消费点回落到插件版本号。
 */
export const LOCAL_FETCH_DEFAULTS = {
  enabled: true,
  timeoutMs: 30000,
  maxBytes: 524288,
  maxContentChars: 100000,
  maxRedirects: 5,
  userAgent: '@v587d/capital-generation',
}

const LocalFetchSchema = z.object({
  enabled: z.boolean().default(LOCAL_FETCH_DEFAULTS.enabled).volatile().description('是否允许本机直连出网：AnySearch 失败后的回退抓取 + 具名来源工具的执行（默认开启；关闭时来源工具调用响亮失败）'),
  timeoutMs: z.number().default(LOCAL_FETCH_DEFAULTS.timeoutMs).volatile().description('本机直连单次请求超时毫秒'),
  maxBytes: z.number().default(LOCAL_FETCH_DEFAULTS.maxBytes).volatile().description('本机直连响应体字节上限'),
  maxContentChars: z.number().default(LOCAL_FETCH_DEFAULTS.maxContentChars).volatile().description('本机直连正文码点上限（切在转换前的原始 HTML 上，不是 markdown 输出）'),
  maxRedirects: z.number().default(LOCAL_FETCH_DEFAULTS.maxRedirects).volatile().description('本机直连最大重定向跳数'),
  userAgent: z.string().default(LOCAL_FETCH_DEFAULTS.userAgent).volatile().description('本机直连 User-Agent；空 = 回落到插件版本号'),
})

/**
 * PaddleOCR 文档解析（`ocr` 工具）默认值。必须与主插件 `src/index.ts` 的
 * `PADDLE_OCR_DEFAULTS` 逐字一致（漂移被 `test/capital-config.test.mjs` 的 deepEqual 抓住）。
 *
 * `endpoint` / `model` 留空是把真值让给 `src/ocr/client.ts`；`pollBudgetMs: 0` = 客户端默认的
 * 200000 毫秒自有等待预算，必须小于 `ocr` 工具声明的 240000 超时，否则框架先超时、
 * 回执里没有 `doc_id` 可续查。
 */
export const PADDLE_OCR_DEFAULTS = {
  endpoint: '',
  credentialRef: 'PADDLE_OCR_TOKEN',
  model: '',
  pollBudgetMs: 0,
}

const PaddleOcrSchema = z.object({
  endpoint: z.string().default(PADDLE_OCR_DEFAULTS.endpoint).volatile().description('PaddleOCR 作业端点；空 = 官方端点'),
  credentialRef: z.string().default(PADDLE_OCR_DEFAULTS.credentialRef).volatile().description('PaddleOCR Token 的 credentials 引用名'),
  model: z.string().default(PADDLE_OCR_DEFAULTS.model).volatile().description('解析模型名；空 = PaddleOCR-VL-1.6'),
  pollBudgetMs: z.number().default(PADDLE_OCR_DEFAULTS.pollBudgetMs).volatile().description('ocr 内部等作业的预算毫秒，0 = 默认 200000'),
})

export const Config = z.object({
  customPersona: z.string().default('').volatile().description('Capital 模式附加人设文本'),
  fuyaoCredentialRef: z.string().default('FUYAO_API_KEY').volatile().description('Fuyao credentials 引用名'),
  retriever: z.object({
    baseURL: z.string().default('').volatile().description('AnySearch API 地址'),
    credentialRef: z.string().default('ANYSEARCH_API_KEY').volatile().description('AnySearch credentials 引用名'),
    windDocs: WindDocsSchema.default({
      endpoint: '',
      credentialRef: 'WIND_API_KEY',
      timeoutMs: 60000,
    }),
    localFetch: LocalFetchSchema.default({ ...LOCAL_FETCH_DEFAULTS }),
    paddleOcr: PaddleOcrSchema.default({ ...PADDLE_OCR_DEFAULTS }),
  }).default({
    baseURL: '',
    credentialRef: 'ANYSEARCH_API_KEY',
    windDocs: { endpoint: '', credentialRef: 'WIND_API_KEY', timeoutMs: 60000 },
    localFetch: { ...LOCAL_FETCH_DEFAULTS },
    paddleOcr: { ...PADDLE_OCR_DEFAULTS },
  }),
})

/**
 * 本行**不消费**自己的配置，也不需要注册任何服务：可编辑性全部是 schema 事实
 * （`.volatile()`），`dsh-settings` 从条目 Config 投影出表单，主插件再经
 * `settings.describe()` 读回解析值。所以这里只留一行日志，证明这颗行激活了。
 */
export function apply(ctx) {
  ctx.logger?.info?.('capital-config: settings entry active (volatile config surface)')
}
