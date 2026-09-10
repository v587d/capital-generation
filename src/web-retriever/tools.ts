import type { Context } from '@deepseek-ai/cordis'
import { WebRetriever } from './retriever.js'

interface ToolRuntimeLike { register(definition: unknown): () => void }
interface ToolExecLike { signal: AbortSignal }

const MAX_QUERY_LENGTH = 500
const MAX_URL_LENGTH = 2048
const MAX_RESULTS = 20

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: JSON.stringify(value) },
]

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`)
  if (value.length > maxLength) throw new Error(`${name} exceeds maximum length ${maxLength}`)
  return value
}

function validHttpUrl(value: unknown): string {
  const url = requiredString(value, 'url', MAX_URL_LENGTH)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('only http(s) URLs are allowed')
  } catch (error) {
    throw new Error(`url must be a valid http(s) URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  return url
}

function integer(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function searchOutput(result: Awaited<ReturnType<WebRetriever['search']>>): Record<string, unknown> {
  return {
    query: result.query,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    sources: result.sources.slice(0, MAX_RESULTS),
  }
}

function fetchOutput(result: Awaited<ReturnType<WebRetriever['fetch']>>): Record<string, unknown> {
  return {
    url: result.url,
    ok: result.ok,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content, content_chars: result.content.length } : {}),
    ...(result.error ? { error: result.error } : {}),
  }
}

/** 注册仅保留核心的两个模型工具：单查询 search、单 URL fetch。 */
export function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return

  const definitions = [
    {
      name: 'web_retriever_search',
      description: '使用 web_retriever 的 AnySearch 后端检索网页。一次只提交一个查询；结果仅作为候选来源，不等于已核验事实。需要读取网页正文时，必须逐个调用 web_retriever_fetch。',
      parameters: jsonObject({
        query: { type: 'string', description: '单个网页检索词，最多 500 字符' },
        max_results: { type: 'integer', description: '可选，返回来源数 1~20' },
      }, ['query']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH)
        const maxResults = integer(args.max_results, 'max_results', 1, MAX_RESULTS)
        return searchOutput(await retriever.search(query, maxResults, exec.signal))
      },
    },
    {
      name: 'web_retriever_fetch',
      description: '使用 web_retriever 的 AnySearch 后端抓取一个网页正文。一次只能提交一个 http(s) URL；证券任务只允许抓取已由官方页面直接证明归属和用途的官方来源域名，不得 fetch 全部搜索结果。',
      parameters: jsonObject({
        url: { type: 'string', description: '单个 http(s) URL；证券任务必须是已核验的官方来源 URL' },
      }, ['url']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        return fetchOutput(await retriever.fetch(validHttpUrl(args.url), exec.signal))
      },
    },
  ]

  for (const definition of definitions) {
    ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
  }
}
