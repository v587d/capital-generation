/**
 * Board follow-up: append one question to the card's run Session, then fold the first completed
 * turn after the prompt into a short preview. The Session stays the full record; this module only
 * owns admission and lazy settlement of the card-facing preview.
 */
import { ASK_TIMEOUT_MS, MAX_ASK_ANSWER_CHARS, MAX_ASK_PREVIEW_CHARS } from './defaults.js'
import { sanitizeMessage } from './redact.js'

const ASK_PROMPT_LIMIT_MS = 30_000

export class AskError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.name = 'AskError'
    this.code = code
    this.status = status
    this.extra = extra
    this.askError = true
  }
}

function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function iso(at) {
  return new Date(at).toISOString()
}

function stateSignal() {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : new AbortController().signal
}

function textOfMessage(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    chunks.push(block.text)
  }
  return chunks.join('\n').trim()
}

/** Preview is one plain-text string, bounded; the full answer stays in the Session. */
export function previewOf(text) {
  const source = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:[#>]+|[*+-](?=\s))[ \t]*/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(source)
  if (chars.length === 0) return ''
  if (chars.length <= MAX_ASK_PREVIEW_CHARS) return source
  return `${chars.slice(0, MAX_ASK_PREVIEW_CHARS - 1).join('').trimEnd()}…`
}

function clipError(text) {
  const clean = sanitizeMessage(text).replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return '回答失败。'
  return clean.length > 300 ? `${clean.slice(0, 297)}...` : clean
}

function reasonText(reason) {
  const kind = reason?.kind
  if (kind === 'aborted') {
    const detail = reason?.reason?.reason ?? reason?.reason?.kind
    return clipError(typeof detail === 'string' && detail.length > 0 ? `回答被中止（${detail}）。` : '回答被中止。')
  }
  const failure = reason?.failure ?? reason?.error ?? reason?.reason
  const message = typeof failure?.message === 'string'
    ? failure.message
    : typeof failure === 'string' ? failure : ''
  return clipError(message.length > 0 ? `回答失败：${message}` : '回答失败。')
}

/**
 * Fold the first turn that ends after `afterSeq`. Returns undefined while the turn is still
 * open, so callers never mistake the run's original answer for this follow-up.
 */
function extractAskTurn(snapshot, afterSeq, now = Date.now()) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  let answer = ''
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const seq = Number(event.seq)
    if (!Number.isFinite(seq) || seq <= afterSeq) continue
    const data = event.data ?? event
    if (event.type === 'assistant/message') {
      const next = textOfMessage(data?.message)
      if (next.length > 0) answer = next
      continue
    }
    if (event.type !== 'turn/end') continue
    const at = Number(event.time)
    const finishedAt = iso(Number.isFinite(at) ? at : now)
    if (data?.reason?.kind === 'completed') {
      return answer.length > 0
        ? { status: 'ready', answer, finishedAt }
        : { status: 'failed', error: '这次追问没有返回文字答复。', finishedAt }
    }
    return { status: 'failed', error: reasonText(data?.reason), finishedAt }
  }
  return undefined
}

export function extractAskOutcome(snapshot, afterSeq, now = Date.now()) {
  const turn = extractAskTurn(snapshot, afterSeq, now)
  if (turn === undefined) return undefined
  if (turn.status === 'failed') return turn
  const preview = previewOf(turn.answer)
  return preview.length > 0
    ? { status: 'ready', preview, finishedAt: turn.finishedAt }
    : { status: 'failed', error: '这次追问没有返回文字答复。', finishedAt: turn.finishedAt }
}

export function buildAskPrompt(question) {
  return `【看板追问】
请基于这次任务简报和当前 session 的完整结论继续回答；先给结论，再给依据，只回答被问到的内容。

问题：${question}`
}

function publicOf(record) {
  return {
    id: record.id,
    runId: record.runId,
    sessionId: record.sessionId,
    question: record.question,
    status: record.status,
    preview: record.preview ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt ?? null,
  }
}

export function createAskService(options) {
  const {
    ctx,
    store,
    now = () => Date.now(),
    logger,
    timeoutMs = ASK_TIMEOUT_MS,
  } = options
  const inFlight = new Map()

  function requireSessionServices() {
    const controller = service(ctx, 'sessionController')
    const query = service(ctx, 'sessionQuery')
    if (controller?.state === undefined || controller?.prompt === undefined) {
      throw new AskError('session_unavailable', '会话服务暂时不可用，暂时不能追问。', 503)
    }
    if (query?.readSession === undefined) {
      throw new AskError('session_unavailable', '会话读取服务暂时不可用，暂时不能追问。', 503)
    }
    return { controller, query }
  }

  async function settle(record, patch) {
    const updated = await store.updateAsk(record.id, patch)
    return updated ?? record
  }

  function expired(record) {
    const created = Date.parse(record.createdAt)
    return Number.isFinite(created) && now() - created > timeoutMs
  }

  async function resolve(record) {
    const existing = inFlight.get(record.id)
    if (existing !== undefined) return existing
    const operation = (async () => {
      const { controller, query } = requireSessionServices()
      const state = await controller.state({ sessionId: record.sessionId }, stateSignal())
      // `active` only means a live Agent owns the Session; it can be idle. Only a running
      // turn or a pending inbox item makes the Session unavailable.
      const busy = state?.running === true
        || (Array.isArray(state?.queue) && state.queue.length > 0)
        || (Array.isArray(state?.pendingInput) && state.pendingInput.length > 0)
      if (busy) {
        return expired(record)
          ? settle(record, {
            status: 'failed',
            error: '回答超时，完整过程请看 session。',
            finishedAt: iso(now()),
          })
          : record
      }
      const snapshot = await query.readSession(record.sessionId)
      const outcome = extractAskOutcome(snapshot, record.baselineSeq, now())
      if (outcome === undefined) {
        return expired(record)
          ? settle(record, {
            status: 'failed',
            error: '回答超时，完整过程请看 session。',
            finishedAt: iso(now()),
          })
          : record
      }
      return settle(record, outcome)
    })()
      .catch((error) => {
        if (error?.askError === true) throw error
        logger?.warn?.(`capital-automation: 追问状态读取失败 ${record.id}：${String(error)}`)
        return record
      })
      .finally(() => {
        inFlight.delete(record.id)
      })
    inFlight.set(record.id, operation)
    return operation
  }

  async function ask(runId, input) {
    const question = String(input?.question ?? '').trim()
    if (question.length === 0) throw new AskError('invalid_question', '问题不能为空。', 400)
    const run = await store.getRun(runId)
    if (run === undefined) throw new AskError('run_not_found', '运行不存在。', 404)
    if (run.status !== 'succeeded' || typeof run.sessionId !== 'string' || run.sessionId.length === 0) {
      throw new AskError('run_not_ready', '这次运行还没有可追问的 session。', 409)
    }
    const { controller } = requireSessionServices()
    const pending = await store.pendingAskForRun(runId)
    if (pending !== undefined) {
      throw new AskError('ask_pending', '上一条追问还在回答，等它结束再问。', 409, { askId: pending.id })
    }
    let state
    try {
      state = await controller.state({ sessionId: run.sessionId }, stateSignal())
    } catch (error) {
      throw new AskError('session_unavailable', `读取 session 失败：${String(error?.message ?? error)}`, 503)
    }
    if (state?.running === true
      || (Array.isArray(state?.queue) && state.queue.length > 0)
      || (Array.isArray(state?.pendingInput) && state.pendingInput.length > 0)) {
      throw new AskError('session_busy', '这个 session 还在等待输入，处理完再问。', 409)
    }
    if (!Number.isSafeInteger(state?.cursor) || state.cursor < -1) {
      throw new AskError('session_unavailable', '无法读取 session 的日志位置，暂时不能追问。', 503)
    }
    const baselineSeq = state.cursor
    let record
    try {
      record = await store.createAsk({
        runId,
        sessionId: run.sessionId,
        question,
        baselineSeq,
      })
    } catch (error) {
      if (error?.code === 'ask_pending') {
        throw new AskError('ask_pending', error.message, 409, { askId: error.askId })
      }
      throw error
    }
    const promptController = new AbortController()
    const timer = setTimeout(() => promptController.abort(), ASK_PROMPT_LIMIT_MS)
    timer.unref?.()
    try {
      const receipt = await controller.prompt({
        requestId: `ask-${record.id}`,
        sessionId: run.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: buildAskPrompt(question) }],
        ...(typeof input?.timeZone === 'string' ? { clientTimeZone: input.timeZone } : {}),
      }, promptController.signal)
      if (receipt?.accepted !== true) throw new Error('Agent 未接受这条追问。')
    } catch (error) {
      const message = sanitizeMessage(String(error?.message ?? error)).slice(0, 300) || '追问提交失败。'
      try {
        await settle(record, { status: 'failed', error: message, finishedAt: iso(now()) })
      } catch (settleError) {
        logger?.warn?.(`capital-automation: 追问失败状态落盘失败 ${record.id}：${String(settleError)}`)
      }
      throw new AskError('ask_failed', message, 502, { askId: record.id })
    } finally {
      clearTimeout(timer)
    }
    return publicOf(record)
  }

  function legacyPreview(record) {
    return record.status === 'ready'
      && typeof record.preview === 'string'
      && record.preview.endsWith('…')
      && Array.from(record.preview).length <= 80
  }

  async function refreshPreview(record) {
    try {
      const { query } = requireSessionServices()
      const snapshot = await query.readSession(record.sessionId)
      const turn = extractAskTurn(snapshot, record.baselineSeq, now())
      if (turn?.status !== 'ready') return record
      const preview = previewOf(turn.answer)
      if (preview.length === 0) return record
      return settle(record, { preview })
    } catch (error) {
      logger?.warn?.(`capital-automation: 旧追问预览刷新失败 ${record.id}：${String(error)}`)
      return record
    }
  }

  async function status(askId) {
    const record = await store.getAsk(askId)
    if (record === undefined) throw new AskError('ask_not_found', '这条追问不存在。', 404)
    if (record.status === 'running') return publicOf(await resolve(record))
    if (legacyPreview(record)) return publicOf(await refreshPreview(record))
    return publicOf(record)
  }

  async function latestForRuns(runIds) {
    const records = await store.latestAsksForRuns(Array.isArray(runIds) ? runIds : [])
    const result = new Map()
    for (const [runId, record] of records) result.set(runId, publicOf(record))
    return result
  }

  async function history(runId) {
    const run = await store.getRun(runId)
    if (run === undefined) throw new AskError('run_not_found', '运行不存在。', 404)
    const records = await store.listAsksForRun(runId)
    return records.map(publicOf)
  }

  async function answer(askId) {
    const record = await store.getAsk(askId)
    if (record === undefined) throw new AskError('ask_not_found', '这条追问不存在。', 404)
    if (record.status !== 'ready') {
      throw new AskError('ask_not_ready', '回答还没有完成。', 409)
    }
    const { query } = requireSessionServices()
    let snapshot
    try {
      snapshot = await query.readSession(record.sessionId)
    } catch (error) {
      throw new AskError('answer_unavailable', `读取完整回答失败：${String(error?.message ?? error)}`, 503)
    }
    const turn = extractAskTurn(snapshot, record.baselineSeq, now())
    if (turn?.status !== 'ready' || typeof turn.answer !== 'string' || turn.answer.length === 0) {
      throw new AskError('answer_unavailable', '完整回答暂时不可用，请打开 session 查看。', 409)
    }
    const chars = Array.from(turn.answer)
    const truncated = chars.length > MAX_ASK_ANSWER_CHARS
    return {
      answer: truncated ? chars.slice(0, MAX_ASK_ANSWER_CHARS).join('') : turn.answer,
      truncated,
      finishedAt: turn.finishedAt,
    }
  }

  return { ask, status, latestForRuns, history, answer }
}
