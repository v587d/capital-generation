import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PythonRuntimeError } from './errors.js'
import { killTree } from './platform.js'

export interface PnpmInvocation {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface PnpmRunResult {
  code: number | null
  output: string
  timedOut: boolean
  aborted: boolean
}

export interface PnpmRunOptions {
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  env?: Record<string, string>
  maxOutputBytes?: number
}

const MAX_OUTPUT = 64 * 1024

function appendBounded(previous: string, chunk: Buffer, cap: number): string {
  const next = previous + chunk.toString('utf8')
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Run pnpm without a shell. The caller owns the exact package spec (never model input). */
export async function runPnpm(invocation: PnpmInvocation, args: string[], options: PnpmRunOptions): Promise<PnpmRunResult> {
  const cap = options.maxOutputBytes ?? MAX_OUTPUT
  return await new Promise<PnpmRunResult>((resolvePromise, reject) => {
    let output = ''
    let timedOut = false
    let aborted = false
    let settled = false
    const child = spawn(invocation.command, [...invocation.args, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...invocation.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      timedOut = true
      void killTree(child.pid, child, 'SIGTERM')
      setTimeout(() => { void killTree(child.pid, child, 'SIGKILL') }, 2_000).unref?.()
    }, options.timeoutMs)
    timer.unref?.()

    const abort = () => {
      aborted = true
      void killTree(child.pid, child, 'SIGTERM')
      setTimeout(() => { void killTree(child.pid, child, 'SIGKILL') }, 2_000).unref?.()
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      resolvePromise({ code, output, timedOut, aborted })
    }
    child.stdout?.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk, cap) })
    child.stderr?.on('data', (chunk: Buffer) => { output = appendBounded(output, chunk, cap) })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') reject(new PythonRuntimeError('pnpm-missing', 'pnpm 可执行文件不存在。', String(error)))
      else reject(new PythonRuntimeError('unknown', `启动 pnpm 失败：${String(error)}`))
    })
    child.once('close', (code) => finish(code))
  })
}

export function classifyPnpmFailure(result: PnpmRunResult): PythonRuntimeError {
  if (result.aborted) return new PythonRuntimeError('cancelled', undefined, result.output)
  if (result.timedOut) return new PythonRuntimeError('timeout', 'pnpm 安装运行时包超时。', result.output)
  const text = result.output
  if (/ERR_PNPM_FETCH_404|E404|404 Not Found/i.test(text)) {
    return new PythonRuntimeError('not-found', '运行时包版本在 registry 中不存在，或镜像尚未同步。', text)
  }
  if (/ERR_PNPM_META_FETCH_FAIL|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_SOCKET|proxy|TLS|certificate/i.test(text)) {
    return new PythonRuntimeError('network', '无法连接 npm registry 或代理/TLS 失败。', text)
  }
  if (/ENOSPC|no space left/i.test(text)) return new PythonRuntimeError('disk-space', undefined, text)
  if (/EACCES|EPERM|permission denied/i.test(text)) return new PythonRuntimeError('permission', undefined, text)
  return new PythonRuntimeError('unknown', `pnpm 安装失败（exit ${String(result.code)}）。`, text)
}

export async function writeInstallProject(payloadDir: string, packageName: string, spec: string, registry?: string): Promise<void> {
  await mkdir(payloadDir, { recursive: true })
  const manifest = {
    name: 'capital-python-runtime-install',
    private: true,
    version: '1.0.0',
    dependencies: { [packageName]: spec },
  }
  const npmrc = [
    'node-linker=hoisted',
    'package-import-method=auto',
    'ignore-scripts=true',
    'strict-peer-dependencies=false',
    'auto-install-peers=false',
    ...(registry === undefined || registry === '' ? [] : [`registry=${registry}`]),
    '',
  ].join('\n')
  await writeFile(join(payloadDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(join(payloadDir, '.npmrc'), npmrc, 'utf8')
}

export function installArgs(payloadDir: string, storeDir: string, registry?: string): string[] {
  return [
    'install',
    '--dir', payloadDir,
    '--ignore-workspace',
    '--no-lockfile',
    '--prod',
    '--ignore-scripts',
    '--store-dir', storeDir,
    '--reporter=append-only',
    // pnpm 11 may ignore node-linker from a project .npmrc when --dir names another project.
    '--config.node-linker=hoisted',
    '--config.package-import-method=auto',
    ...(registry === undefined || registry === '' ? [] : ['--registry', registry]),
  ]
}
