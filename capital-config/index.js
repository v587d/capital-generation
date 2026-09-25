import z from '@deepseek-ai/schemastery'

export const name = 'capital-config'

/**
 * Settings namespace this package owns. Two facts make this string load-bearing:
 *
 *  1. **It is the card's seat.** The plugins settings tab renders the intersection
 *     of (namespaces the Host serves) × (cards registered under `settings.plugin.item`).
 *     Removing or renaming this registration makes the browser card **silently
 *     disappear** — no error, the credential fields are simply never offered.
 *  2. **It is the ref source.** The card reads `fuyaoCredentialRef` /
 *     `retriever.credentialRef` / `retriever.windDocs.credentialRef` from the
 *     resolved section to know which credential references to address. The main
 *     plugin (`@v587d/capital-generation`) reads the same section to resolve the keys.
 *
 * The card deliberately does **not** write credentials into this namespace: API keys
 * live in the credentials domain (`remote.credentials.set`), and the section holds
 * the reference *names* the card reads to know which keys to address. There is exactly
 * ONE stored preference the card does write: `retriever.localFetch.enabled` (the
 * local-fetch fallback switch under the AnySearch key), saved immediately via
 * `scope.mutate` with the nested path `['retriever', 'localFetch', 'enabled']` —
 * it lands in the Host settings document (`~/.dsh/settings.yaml`), survives restarts,
 * and `applies: 'restart'` makes it take effect in new Capital sessions.
 *
 * The browser half mirrors this namespace name in `client.src.cjs` (`NS`); the two
 * must stay equal (guarded by `test/capital-config.test.mjs`).
 */
export const SETTINGS_NAMESPACE = 'capital-generation'

const WindDocsSchema = z.object({
  endpoint: z.string().default('').description('可选：Wind 文档检索端点'),
  credentialRef: z.string().default('WIND_API_KEY').description('Wind credentials 引用名'),
  timeoutMs: z.number().default(60000).description('Wind 请求超时毫秒'),
})

/**
 * 本地直连回退默认值。必须与主插件 `src/index.ts` 的 `LOCAL_FETCH_DEFAULTS` 逐字一致
 * （两处 schema 漂移会被 `test/capital-config.test.mjs` 的 deepEqual 用例抓住）。
 * 数值口径对齐官方 `dsh-web-fetch-http`（timeoutMs=30000 / maxBodyChars=100000）；
 * `maxContentChars` 切在转换前的原始 HTML 上，所以按 HTML 体积给足。
 * `userAgent` 默认是产品标识；显式配成空串时消费点回落到插件版本号。
 */
const LOCAL_FETCH_DEFAULTS = {
  enabled: true,
  timeoutMs: 30000,
  maxBytes: 524288,
  maxContentChars: 100000,
  maxRedirects: 5,
  userAgent: '@v587d/capital-generation',
}

const LocalFetchSchema = z.object({
  enabled: z.boolean().default(LOCAL_FETCH_DEFAULTS.enabled).description('是否允许本机直连出网：AnySearch 失败后的回退抓取 + 具名来源工具的执行（默认开启；关闭时来源工具调用响亮失败）'),
  timeoutMs: z.number().default(LOCAL_FETCH_DEFAULTS.timeoutMs).description('本机直连单次请求超时毫秒'),
  maxBytes: z.number().default(LOCAL_FETCH_DEFAULTS.maxBytes).description('本机直连响应体字节上限'),
  maxContentChars: z.number().default(LOCAL_FETCH_DEFAULTS.maxContentChars).description('本机直连正文码点上限（切在转换前的原始 HTML 上，不是 markdown 输出）'),
  maxRedirects: z.number().default(LOCAL_FETCH_DEFAULTS.maxRedirects).description('本机直连最大重定向跳数'),
  userAgent: z.string().default(LOCAL_FETCH_DEFAULTS.userAgent).description('本机直连 User-Agent；空 = 回落到插件版本号'),
})

export const Config = z.object({
  customPersona: z.string().default('').description('Capital 模式附加人设文本'),
  fuyaoCredentialRef: z.string().default('FUYAO_API_KEY').description('Fuyao credentials 引用名'),
  retriever: z.object({
    baseURL: z.string().default('').description('AnySearch API 地址'),
    credentialRef: z.string().default('ANYSEARCH_API_KEY').description('AnySearch credentials 引用名'),
    windDocs: WindDocsSchema.default({
      endpoint: '',
      credentialRef: 'WIND_API_KEY',
      timeoutMs: 60000,
    }),
    localFetch: LocalFetchSchema.default({ ...LOCAL_FETCH_DEFAULTS }),
  }).default({
    baseURL: '',
    credentialRef: 'ANYSEARCH_API_KEY',
    windDocs: { endpoint: '', credentialRef: 'WIND_API_KEY', timeoutMs: 60000 },
    localFetch: { ...LOCAL_FETCH_DEFAULTS },
  }),
})

function install(settingsCtx, ctx, config) {
  const settings = settingsCtx.get?.('settings') ?? settingsCtx.settings
  settings.register(SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'restart',
  })
  ctx.logger?.info?.('capital-config: settings namespace registered')
}

export function apply(ctx, config = {}) {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    ctx.inject(['settings'], (settingsCtx) => install(settingsCtx, ctx, config))
    return
  }
  install(ctx, ctx, config)
}
