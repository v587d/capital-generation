import type { Context } from '@deepseek-ai/cordis'
import { DataCollectorHub } from './hub.js'
import {
  UpstreamRetryBudget,
  classifyUpstreamFailure,
  retryBudgetKey,
  upstreamFailureError,
} from './upstream-retry.js'
import type { DatasetRef } from './store.js'
// Session reading and authorization have one implementation (src/tool-exec.ts); do not re-implement here.
import { authorizedSession, sessionIdentityDecisions, type AgentExecutionLike as ToolExecLike } from '../tool-exec.js'
import { DATA_COLLECTION_PRESET_IDS } from '../preset-ids.js'
import { CATALOG_TOPICS, type CatalogTopic } from './catalog-taxonomy.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }

/** dc_status diagnostics: credential presence only, never values. */
export interface DataCollectorDiagnostics {
  probeApiKey: () => Promise<{ present: boolean; source: string | null; error?: string }>
/**
   * Tool-surface restriction snapshot (root/role policies), restated locally so this layer does
   * not depend on the agents layer. `allowed` stays empty: host-global allow-lists are not model-visible.
   */
  rootPolicy?: () => Array<{
    agentId: string | undefined
    root: boolean
    presetId: string
    outcome: string
    denied: string[]
    allowed?: string[]
    failed: string[]
  }>
  onCall?: (snapshot: { at: number; call: number; apiKey: unknown; capabilities: string[] }) => void
}

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object => ({ type: 'object', properties, required, additionalProperties: false })
const freeObject = { type: 'object', additionalProperties: true }
const MAX_ID_LENGTH = 256
const MAX_PARAMS_BYTES = 64 * 1024

function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`)
  if (value.length > maxLength) throw new Error(`${name} exceeds maximum length ${maxLength}`)
  return value
}

function boundedParams(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object')
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error('params must be JSON-serializable')
  }
  if (encoded.length > MAX_PARAMS_BYTES) throw new Error(`params exceeds maximum size ${MAX_PARAMS_BYTES} bytes`)
  return value as Record<string, unknown>
}

/** Model-visible DatasetRef: metadata only; no raw rows, data_key or absolute paths. */
const datasetRefSchema = (): object => jsonObject({
  dataset_id: { type: 'string' },
  task_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  session_id: { type: 'string' },
  artifact_ref: { type: 'string' },
  format: { type: 'string' },
  capability: { type: 'string' },
  source_label: { type: 'string' },
  schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  row_count: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
  captured_at: { type: 'integer' },
  retention_until: { type: 'integer' },
  params_digest: { type: 'string' },
  time_coverage: {
    type: 'object',
    properties: {
      column: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      from: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      to: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      format: { type: 'string', enum: ['epoch_ms', 'date_string', 'datetime_string', 'none'] },
    },
    required: ['column', 'from', 'to', 'format'],
    additionalProperties: false,
  },
}, ['dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format', 'capability', 'source_label', 'schema', 'row_count', 'captured_at', 'retention_until', 'params_digest'])

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  // ToolOutputDefinition.render(args, value): the first parameter is the input, the second the output.
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function tool(
  name: string,
  description: string,
  parameters: object,
  schema: object,
  execute: (args: Record<string, unknown>, exec: ToolExecLike) => Promise<unknown>,
  options: { concurrencySafe?: boolean } = {},
) {
  return {
    name,
    description,
    parameters,
    output: { schema, render },
    execute,
    // Framework concurrency pool: mark pure-read discovery tools only. request_data stays serial
    // because the Hub executes FIFO and upstream throttling/merging is not promised under parallelism.
    ...(options.concurrencySafe === true ? { isConcurrencySafe: () => true } : {}),
  }
}

const dcStatusCalls: { current: number } = { current: 0 }

/** Stable, guided errors: a model typo and an empty catalog need different recovery actions. */
type CapabilityErrorCode =
  | 'capability_required'
  | 'capability_invalid'
  | 'capability_catalog_empty'
  | 'capability_scope_invalid'
  | 'capability_unknown'

function capabilityError(code: CapabilityErrorCode, detail: string): Error {
  const error = new Error(`${code}: ${detail}`)
  ;(error as Error & { code?: string }).code = code
  return error
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

/** normalizeParams errors are model-fixable: keep the field reason and pin recovery to describe -> fix -> retry. */
function requestParamsError(error: unknown, capability: string): Error | undefined {
  if (errorCode(error)) return undefined
  const message = error instanceof Error ? error.message : String(error)
  if (!/(?:\bparameter\b|\bparams\b|missing required parameter|unsupported parameter|at least one of)/i.test(message)) return undefined
  const detail = `request_params_invalid: ${message}. 请先调用 describe_capability({ "capability": ${JSON.stringify(capability)} }) 重新读取该能力的 input_schema，再严格按 schema 修正 params 后重试 request_data；不要凭记忆猜测参数。 Please read describe_capability(${JSON.stringify(capability)}) before retrying request_data.`
  const failure = new Error(detail)
  ;(failure as Error & { code?: string }).code = 'request_params_invalid'
  return failure
}

function resolveCapability(hub: DataCollectorHub, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    throw capabilityError('capability_required', '缺少 capability 参数。请先调用 list_capabilities() 取回能力目录，再调用 describe_capability({ "capability": "<目录中的名字>" }) 读取该能力契约。')
  }
  if (typeof value !== 'string') {
    throw capabilityError('capability_invalid', `capability 必须是字符串（收到 ${Array.isArray(value) ? 'array' : typeof value}）。一次只描述一个能力；请从 list_capabilities() 的目录中原样复制名字，再调用 describe_capability。`)
  }
  const name = value.trim()
  if (name.length === 0) {
    throw capabilityError('capability_required', 'capability 是空白字符串。请先调用 list_capabilities()，再把目录中的 capability 名原样传给 describe_capability。')
  }
  if (name.length > MAX_ID_LENGTH) {
    throw capabilityError('capability_invalid', `capability 超过 ${MAX_ID_LENGTH} 字符，不是合法能力名。请从 list_capabilities() 的目录里原样复制一个名字。`)
  }
  if (name.includes(',')) {
    throw capabilityError('capability_invalid', `capability 不接受逗号分隔的多个名字（收到 "${name}"）。一次只调用 describe_capability 描述一个能力；需要多个就分多次调用。`)
  }
  if (!hub.describeCapability(name)) {
    const available = hub.capabilityNames()
    if (available.length === 0) {
      throw capabilityError('capability_catalog_empty', '当前没有任何已注册的数据能力（数据源注册没有生效）。注意：缺凭据**不会**让目录变空——同花顺能力始终在目录里，只在取数那一刻点名 FUYAO_API_KEY 失败。本工具此刻对任何名字都会失败——不要反复重试，也不要编造能力名；请把该状态回告主 Agent，必要时用 dc_status 核对 registered_capability_count / registered_topics 与 api_key。')
    }
    throw capabilityError('capability_unknown', `未注册的能力 "${name}"。目录按九个主题分片，下面是索引；先按 topic 取分片，再原样复制名字：\n${hub.catalogIndex()}\n不要自行编造、缩写或改写。`)
  }
  return name
}

/** `topic` is optional; blank means "index", an unknown value gets the full topic list instead of an empty shard. */
function resolveCatalogTopic(hub: DataCollectorHub, value: unknown): CatalogTopic | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw capabilityError('capability_scope_invalid', `topic 必须是字符串（收到 ${Array.isArray(value) ? 'array' : typeof value}）。省略 topic 取九行索引，或从索引里选一个 topic 原样传入。`)
  }
  const topic = value.trim()
  if (topic.length === 0) return undefined
  const entries = hub.catalogTopicEntries()
  const match = entries.find((entry) => entry.topic === topic)
  if (!match) {
    const available = entries.map((entry) => `${entry.topic}(${entry.label},${entry.count}条)`).join('、')
    throw capabilityError('capability_scope_invalid', `未知 topic "${topic}"。可用 topic：${available || '（当前目录为空）'}。请从 list_capabilities() 的索引里原样选一个 topic，再调用 list_capabilities({ "topic": "<topic>" })；不要编造。需要全量就九片分别取，不要用 all。`)
  }
  return match.topic
}

export function registerDataCollectorTools(ctx: Context, hub: DataCollectorHub, diagnostics?: DataCollectorDiagnostics): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const retryBudget = new UpstreamRetryBudget()
  const registrations = [
    tool(
      'request_data',
      '向数据管道请求数据：宿主先按 capability+params 校验当前 session 的已验证 manifest；force_refresh=false 或省略且命中未过期、满足该来源缓存新鲜度的 Dataset 时直接返回已有 DatasetRef，不访问上游；force_refresh=true 才重新取数并生成新的不可变 Dataset（默认保留 7 天），绝不覆盖旧 Dataset。明确要现在/最新的行情快照时请用 force_refresh=true，7 天是保留期而非实时新鲜度。本工具只返回 DatasetRef（dataset_id / artifact_ref / schema / row_count / captured_at / retention_until 等元数据），绝不返回原始数据行。capability 必须是 list_capabilities 返回的短能力名（如 ticker_search / quote / history / trading_calendar），params 必须按 describe_capability({ capability }) 返回的 input_schema 填写。若返回 request_params_invalid，先重新调用 describe_capability({ capability: "<当前能力名>" })，再按 schema 修正并重试一次；不要凭记忆猜参数。可重试上游失败（限流、网络、超时、5xx）对同一 capability 最多 3 次尝试；返回 upstream_retry_exhausted 后停止重试，改用等价能力或回告主 Agent，不要用 wait_agent 等上游恢复。task_id 必须由主 Agent 在本轮委派前确定，并在所有子 Agent 与最终报告中原样复用；不要由 data_collector 自行生成。相同 capability+params 的并发请求合并为同一次执行。当前 workspace 只读或落盘失败时抛错 workspace_not_writable（绝不退化为内存假成功）。请求归属自动记为当前 delegated child session，不接收 requester_agent_id 参数。',
      jsonObject({
        capability: { type: 'string' },
        params: freeObject,
        force_refresh: { type: 'boolean' },
        task_id: { type: 'string' },
      }, ['capability', 'params', 'task_id']),
      datasetRefSchema(),
      async (args, exec) => {
        const requestedCapability = boundedString(args.capability, 'capability', MAX_ID_LENGTH)
        const session = authorizedSession(ctx, exec, 'request_data', DATA_COLLECTION_PRESET_IDS)
        let budgetKey: string | undefined
        let capability: string | undefined
        try {
          const params = boundedParams(args.params)
          // Fail early with the same catalog guidance as describe_capability instead of
          // making the model infer a capability typo from a low-level Hub error.
          capability = resolveCapability(hub, requestedCapability)
          budgetKey = retryBudgetKey(session.id, capability)
          const prior = retryBudget.inspect(budgetKey)
          if (prior?.exhausted) {
            throw upstreamFailureError({
              capability,
              failure: prior.failure,
              attempts: prior.attempts,
              maxAttempts: retryBudget.maxAttempts,
              terminal: true,
            })
          }
          const ref = await hub.request({
            capability,
            params,
            force_refresh: args.force_refresh === true,
            task_id: boundedString(args.task_id, 'task_id', MAX_ID_LENGTH),
            session,
          }, { signal: exec.signal })
          retryBudget.reset(budgetKey)
          return ref
        } catch (error) {
          const failure = capability && budgetKey ? classifyUpstreamFailure(error) : null
          if (failure && budgetKey && capability) {
            const snapshot = retryBudget.record(budgetKey, failure)
            throw upstreamFailureError({
              capability,
              failure,
              attempts: snapshot.attempts,
              maxAttempts: retryBudget.maxAttempts,
              terminal: snapshot.exhausted,
            })
          }
          throw requestParamsError(error, requestedCapability) ?? error
        }
      },
    ),
    tool(
      'list_capabilities',
      '发现数据能力目录。不传 topic：返回九行主题索引 `topic|中文|条数|码点|例子`，先看哪个主题包含所需能力；传 topic：返回该主题的 `capability|summary|paginated` 行。按问题需要取片，不设片数上限：复杂/跨资产问题建议第一步九片全取，单一资产按需取；同一 session 已有结果不要重复调用，多个 topic 在同一条消息里并发调用（本工具纯读、可并发）。片数是结果，不是配额；单片 <2048 是体积预算。目录刻意不含 schema；选定能力后用 describe_capability 取完整契约。request_data 的 capability 必须以目录为准，不要编造。未知 topic 返回 capability_scope_invalid 并列出可用主题。',
      jsonObject({
        topic: {
          type: 'string',
          enum: [...CATALOG_TOPICS],
          description: '可选。省略返回九行主题索引；给出 topic 返回该主题的能力目录。一次只取需要的主题，不要拉全部。',
        },
      }),
      { type: 'string' },
      async (args, exec) => {
        authorizedSession(ctx, exec, 'list_capabilities', DATA_COLLECTION_PRESET_IDS)
        if (hub.capabilityNames().length === 0) {
          throw capabilityError('capability_catalog_empty', '当前没有任何已注册的数据能力（数据源注册没有生效）。注意：缺凭据**不会**让目录变空；不要反复重试，也不要编造能力名；请用 dc_status 核对 registered_capability_count / registered_topics 与 api_key，并回告主 Agent。')
        }
        const topic = resolveCatalogTopic(hub, args.topic)
        return topic === undefined ? hub.catalogIndex() : hub.capabilityDirectory(topic)
      },
      { concurrencySafe: true },
    ),
    tool(
      'describe_capability',
      '读取**一个**能力的完整契约：description（单位、null 语义、时间与分页口径）、input_schema（params 的取值与约束）、output_fields（返回字段的逐行字典 `路径:类型[:说明]`，类型后缀 `?` 为可为 null、`[].` 为数组元素的字段）与 paginated。request_data 的 params 必须按这里返回的 input_schema 填写；request_data 若返回 request_params_invalid，应回到这里重新读取后再重试。一个能力描述一次即可：结果已在本 session 历史里，重复描述同一个能力只会白占上下文；需要几个能力就**在同一条消息里一次发出多个调用**（本工具是纯读、可并发执行，框架会把它们放进并发池、在同一个下一步一起返回），但一次仍只传**一个**名字，不要用逗号把多个名字塞进一条调用。错误按 code 引导：capability_required（没给名字，先 list_capabilities()）、capability_invalid（不是字符串/超长/含逗号，改为目录中的单个名字）、capability_catalog_empty（数据源未注册，别重试，回告主 Agent）、capability_unknown（名字不存在，错误里回九行索引，按 topic 取分片后原样复制）。',
      jsonObject({ capability: { type: 'string' } }, ['capability']),
      jsonObject({
        capability: { type: 'string' },
        summary: { type: 'string' },
        paginated: { type: 'boolean' },
        description: { type: 'string' },
        input_schema: freeObject,
        output_fields: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      }, ['capability', 'summary', 'paginated', 'description', 'input_schema', 'output_fields']),
      async (args, exec) => {
        authorizedSession(ctx, exec, 'describe_capability', DATA_COLLECTION_PRESET_IDS)
        const capability = resolveCapability(hub, args.capability)
        const detail = hub.describeCapability(capability)
        if (!detail) throw capabilityError('capability_unknown', `未注册的能力 "${capability}"。`)
        return detail
      },
      { concurrencySafe: true },
    ),
    ...(diagnostics ? [
      tool('dc_status', '诊断工具：返回数据管道运行状态 —— at/call 为本次真实执行的时间戳与计数（防伪）、api_key 为**本次调用现取**的凭据解析结果（present/source，不含密钥值）、registered_capability_count 与 registered_topics 为当前注册规模（九片 topic/label/count 汇总；**不返回全部能力名**，名字从 `list_capabilities` 分片取）、agent_tool_policy 为工具面收敛的现场记录（preset_id / root / outcome / allowed / denied / failed：`outcome=restricted` 是组合期那次减名字的账，`guard-denied` 是一次调用真的被调用级闸门拦下（`ocr` 的 url 形态、`write` / `edit`、角色的 `interrupt_agent`），`not-capital` / `skipped` / `unavailable` / `pending` 是四种没生效的原因；`root=true` 是用户手开出来的会话。工具面本身由该 preset 挂的工具行决定，allowed 恒为空。排查"某个 Agent 为什么看得见、或为什么用不了某颗工具"用）、session_identity 为最近的工具授权判据现场（tool / via=preset|topology / preset_id / allowed；`via:"topology"` 表示 registry 读不到身份、回落到"必须是被委派的子会话"这一旧判据）。数据源注册不依赖 key：api_key.present=false 时同花顺能力仍在目录里，但每次取数会点名 FUYAO_API_KEY 失败。排障时优先调用。', jsonObject(),
        jsonObject({
          at: { type: 'integer' },
          call: { type: 'integer' },
          api_key: jsonObject({ present: { type: 'boolean' }, source: { oneOf: [{ type: 'string' }, { type: 'null' }] }, error: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, ['present']),
          registered_capability_count: { type: 'integer' },
          registered_topics: { type: 'array', items: jsonObject({
            topic: { type: 'string' },
            label: { type: 'string' },
            count: { type: 'integer' },
          }, ['topic', 'label', 'count']) },
          agent_tool_policy: { type: 'array', items: jsonObject({
            agent_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            root: { type: 'boolean' },
            preset_id: { type: 'string' },
            outcome: { type: 'string' },
            allowed: { type: 'array', items: { type: 'string' } },
            denied: { type: 'array', items: { type: 'string' } },
            failed: { type: 'array', items: { type: 'string' } },
          }, ['agent_id', 'root', 'preset_id', 'outcome', 'allowed', 'denied', 'failed']) },
          session_identity: { type: 'array', items: jsonObject({
            tool: { type: 'string' },
            via: { type: 'string' },
            preset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            allowed: { type: 'boolean' },
          }, ['tool', 'via', 'preset_id', 'allowed']) },
        }, ['at', 'call', 'api_key', 'registered_capability_count', 'registered_topics']),
        async (_args, exec) => {
           authorizedSession(ctx, exec, 'dc_status', DATA_COLLECTION_PRESET_IDS)
          const apiKey = await diagnostics.probeApiKey()
          const capabilities = hub.capabilityNames()
          const agentToolPolicy = diagnostics.rootPolicy?.()?.map((probe) => ({
            agent_id: probe.agentId ?? null,
            root: probe.root,
            preset_id: probe.presetId,
            outcome: probe.outcome,
            allowed: probe.allowed ?? [],
            denied: probe.denied,
            failed: probe.failed,
          }))
          const snapshot = { at: Date.now(), call: ++dcStatusCalls.current, apiKey, capabilities }
          diagnostics.onCall?.(snapshot)
          return {
            at: snapshot.at,
            call: snapshot.call,
            api_key: apiKey,
            registered_capability_count: capabilities.length,
            registered_topics: hub.catalogTopicEntries().map(({ topic, label, count }) => ({ topic, label, count })),
            ...(agentToolPolicy === undefined ? {} : { agent_tool_policy: agentToolPolicy }),
            // Authorization decision trail: preset identity vs fallback to session topology; without
            // it, "identity unavailable" and "identity confirmed" look identical to the model.
            session_identity: sessionIdentityDecisions().map((record) => ({
              tool: record.tool,
              via: record.via,
              preset_id: record.presetId,
              allowed: record.allowed,
            })),
          }
        }),
    ] : []),
  ]
  for (const definition of registrations) ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
}

/** Model-visible DatasetRef field whitelist (tests and host assertions). */
export const DATASET_REF_FIELDS = [
  'dataset_id', 'task_id', 'session_id', 'artifact_ref', 'format',
  'capability', 'source_label', 'schema', 'row_count', 'captured_at',
  'retention_until', 'params_digest', 'time_coverage',
] as const satisfies readonly (keyof DatasetRef)[]
