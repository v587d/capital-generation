import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

import { PythonRuntimeError } from './errors.js'
import { pythonChildEnv } from './child-env.js'
import { detachedChild, killTree, pythonFlags } from './platform.js'
import type { ProbeReport } from './types.js'

export interface ProbeOptions {
  python: string
  workerPath: string
  sitePackages: string[]
  homeDir: string
  tempDir: string
  timeoutMs: number
  signal?: AbortSignal
  env?: Record<string, string | undefined>
}

function parseReport(output: string): ProbeReport {
  const line = output.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).at(-1)
  if (line === undefined) throw new PythonRuntimeError('probe-failed', 'Python probe 没有输出。')
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new PythonRuntimeError('probe-failed', 'Python probe 输出不是 JSON。', output)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PythonRuntimeError('probe-failed', 'Python probe 输出不是对象。', output)
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.pythonVersion !== 'string'
    || typeof raw.executable !== 'string'
    || typeof raw.platform !== 'string'
    || typeof raw.arch !== 'string'
    || !Array.isArray(raw.sitePackages)
    || raw.sitePackages.some((item) => typeof item !== 'string')
    || raw.packages === null
    || typeof raw.packages !== 'object'
    || Array.isArray(raw.packages)) {
    throw new PythonRuntimeError('probe-failed', 'Python probe 字段不完整。', output)
  }
  return raw as unknown as ProbeReport
}

/** Run the private interpreter once and require its self-check JSON. */
export async function probePython(options: ProbeOptions): Promise<ProbeReport> {
  await mkdir(options.homeDir, { recursive: true })
  await mkdir(options.tempDir, { recursive: true })
  const env = pythonChildEnv({
    pythonDir: options.python.replace(/[\\/][^\\/]+$/u, ''),
    homeDir: options.homeDir,
    tempDir: options.tempDir,
    baseEnv: options.env ?? process.env,
  })
  const args = [
    ...pythonFlags,
    options.workerPath,
    'probe',
    ...options.sitePackages.flatMap((path) => ['--site-packages', path]),
  ]

  return await new Promise<ProbeReport>((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(options.python, args, {
      cwd: options.tempDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: detachedChild,
    })
    const timer = setTimeout(() => {
      timedOut = true
      void killTree(child.pid, child, 'SIGTERM')
      setTimeout(() => { void killTree(child.pid, child, 'SIGKILL') }, 2_000).unref?.()
    }, options.timeoutMs)
    timer.unref?.()
    const abort = () => { void killTree(child.pid, child, 'SIGTERM') }
    options.signal?.addEventListener('abort', abort, { once: true })
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (timedOut) return reject(new PythonRuntimeError('timeout', 'Python probe 超时。', stderr))
      if (options.signal?.aborted === true) return reject(new PythonRuntimeError('cancelled', undefined, stderr))
      if (code !== 0) return reject(new PythonRuntimeError('probe-failed', `Python probe 退出码 ${String(code)}。`, stderr || stdout))
      try {
        resolvePromise(parseReport(stdout))
      } catch (error) {
        reject(error)
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-64 * 1024) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024) })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      reject(new PythonRuntimeError('probe-failed', `启动 Python 失败：${String(error)}`))
    })
    child.once('close', (code) => finish(code))
  })
}
