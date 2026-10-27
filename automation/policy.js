/**
 * Hard call-level policy for unattended runs. Identity is the session id registered by the
 * runner: a tool call is constrained only when its exact Agent session belongs to a live run.
 * Role composition already closes each child's tool surface; this layer removes the two
 * interactions that composition cannot express (asking the user and writing files/privilege).
 */
export const BLOCKED_TOOL_NAMES = ['ask_user_question', 'write', 'edit']
export const SHELL_TOOL_NAMES = ['bash', 'pwsh', 'run_code']

const INSTALLED = new WeakMap()

function runnerOf(value) {
  try {
    return typeof value === 'function' ? value() : value
  } catch {
    return undefined
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function automationGuardReason(exec, runner) {
  const name = exec?.name
  if (typeof name !== 'string') return undefined
  const activeRunner = runnerOf(runner)
  const sessionId = exec?.agent?.session?.id
  if (typeof sessionId !== 'string' || typeof activeRunner?.hasAutomationSession !== 'function' || !activeRunner.hasAutomationSession(sessionId)) return undefined
  if (BLOCKED_TOOL_NAMES.includes(name)) {
    const reason = name === 'ask_user_question'
      ? '无人值守运行不能向用户提问：请基于现有信息采用保守口径继续，并在最终答复开头写明「需要用户确认」的缺口。'
      : `无人值守运行不能写文件（${name}）：请把结论写在最终答复中，不要修改工作区。`
    activeRunner.noteGuardDenied(sessionId, name, reason)
    return reason
  }
  if (SHELL_TOOL_NAMES.includes(name)) {
    const args = isRecord(exec.arguments) ? exec.arguments : undefined
    if (args?.sandbox_permissions !== undefined || args?.justification !== undefined) {
      const reason = '无人值守运行不能申请沙箱提权：请只读执行，缺文件或权限时如实说明。'
      activeRunner.noteGuardDenied(sessionId, name, reason)
      return reason
    }
  }
  return undefined
}

export function installAutomationPolicy({ ctx, runner, logger }) {
  const root = ctx.root ?? ctx
  if (root === null || (typeof root !== 'object' && typeof root !== 'function')) return
  const existing = INSTALLED.get(root)
  if (existing !== undefined) {
    existing.runner = runner
    existing.generation += 1
    const generation = existing.generation
    const cleanup = () => {
      if (INSTALLED.get(root) !== existing || existing.generation !== generation) return
      try {
        if (typeof existing.disposeGuard === 'function') existing.disposeGuard()
      } finally {
        INSTALLED.delete(root)
      }
    }
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => cleanup, 'capital-automation: unattended policy')
      return
    }
    return cleanup
  }
  let tools
  try {
    tools = ctx.get?.('tools') ?? ctx.tools
  } catch {
    tools = undefined
  }
  if (tools === undefined || typeof tools.guard !== 'function') {
    logger?.warn?.('capital-automation: tools.guard 不可用，无人值守工具闸门未安装')
    return
  }
  const record = { runner, generation: 1, disposeGuard: undefined }
  const install = () => {
    try {
      record.disposeGuard = tools.guard((exec) => automationGuardReason(exec, record.runner))
      INSTALLED.set(root, record)
      logger?.info?.('capital-automation: 无人值守工具闸门已安装（ask_user_question / write / edit / shell 提权）')
    } catch (error) {
      logger?.warn?.(`capital-automation: 无人值守工具闸门安装失败：${String(error)}`)
      return undefined
    }
    const generation = record.generation
    return () => {
      if (INSTALLED.get(root) !== record || record.generation !== generation) return
      try {
        if (typeof record.disposeGuard === 'function') record.disposeGuard()
      } finally {
        INSTALLED.delete(root)
      }
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(install, 'capital-automation: unattended policy')
    return
  }
  return install()
}
