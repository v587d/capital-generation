import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PythonRuntimeError, isPythonRuntimeError, messageOf } from './errors.js'
import { withInstallLock } from './lock.js'
import { normalizePackNames, packTarget } from './manifest.js'
import {
  availableBytes,
  directoryBytes,
  exists,
  isInside,
  lockRoot,
  packRoot,
  readJson,
  readyFileShape,
  readyPath,
  removeStaleStaging,
  resolveDshHome,
  runtimeRoot,
  safeRelative,
  stagingRoot,
  storeRoot,
  writeJsonAtomic,
} from './paths.js'
import { findPnpmCli, type PlatformFacts } from './platform.js'
import { classifyPnpmFailure, installArgs, runPnpm, writeInstallProject, type PnpmInvocation } from './pnpm.js'
import { probePython } from './probe.js'
import type {
  PackName,
  PackStatus,
  PrepareJob,
  ProbeReport,
  ReadyFile,
  RuntimeHandle,
  RuntimeManifest,
  RuntimeStatus,
  TargetId,
} from './types.js'

interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

export interface PythonRuntimeManagerOptions {
  manifest: RuntimeManifest
  dshHome?: string
  workerPath: string
  target: PlatformFacts
  profileDir?: string
  packageManager?: PnpmInvocation
  packSources?: Partial<Record<PackName, string>>
  registry?: string
  logger?: LoggerLike
  now?: () => Date
  runPnpm?: typeof runPnpm
  probePython?: typeof probePython
}

interface RuntimePackMetadata {
  schemaVersion: number
  kind: 'base' | 'lib'
  platform: string
  arch: string
  pythonVersion: string
  executable: string | null
  sitePackages: string[]
  packages: Record<string, string>
}

interface ActiveJob {
  job: PrepareJob
  controller: AbortController
  promise: Promise<void>
}

const PACK_ORDER: PackName[] = ['base', 'parquet']

function nowIso(now: () => Date): string {
  return now().toISOString()
}

function copyJob(job: PrepareJob): PrepareJob {
  return {
    ...job,
    packs: [...job.packs],
    ...(job.error === undefined ? {} : { error: { ...job.error } }),
  }
}

function targetParts(target: TargetId): { platform: string; arch: string } {
  const index = target.lastIndexOf('-')
  return { platform: target.slice(0, index), arch: target.slice(index + 1) }
}

function normalizeMachine(value: string): string {
  const machine = value.toLowerCase()
  if (machine === 'amd64' || machine === 'x86_64' || machine === 'x64') return 'x64'
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64'
  return machine
}

function packagesMatch(actual: Record<string, string>, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([name, version]) => actual[name] === version)
}

export class PythonRuntimeManager {
  readonly manifest: RuntimeManifest
  readonly dshHome: string
  readonly cacheRoot: string
  readonly workerPath: string
  readonly target: PlatformFacts
  private readonly profileDir?: string
  private readonly packageManager?: PnpmInvocation
  private readonly packSources: Partial<Record<PackName, string>>
  private readonly registry?: string
  private readonly logger?: LoggerLike
  private readonly now: () => Date
  private readonly runPnpm: typeof runPnpm
  private readonly probePython: typeof probePython
  private readonly jobs = new Map<string, ActiveJob>()
  private activeJobId?: string
  private pnpmInvocation?: PnpmInvocation

  constructor(options: PythonRuntimeManagerOptions) {
    this.manifest = options.manifest
    this.dshHome = resolveDshHome(options.dshHome)
    this.cacheRoot = runtimeRoot(this.dshHome, options.manifest.cacheRoot)
    this.workerPath = options.workerPath
    this.target = options.target
    this.profileDir = options.profileDir
    this.packageManager = options.packageManager
    this.packSources = options.packSources ?? {}
    this.registry = options.registry
    this.logger = options.logger
    this.now = options.now ?? (() => new Date())
    this.runPnpm = options.runPnpm ?? runPnpm
    this.probePython = options.probePython ?? probePython
  }

  private targetId(): TargetId {
    if (this.target.target === null || !this.target.supported) {
      throw new PythonRuntimeError('unsupported-platform', this.target.reason)
    }
    return this.target.target
  }

  private async readReady(pack: PackName, version: string, target: TargetId): Promise<ReadyFile | undefined> {
    const root = packRoot(this.cacheRoot, pack, version, target)
    const value = await readJson<unknown>(readyPath(root))
    return readyFileShape(value) ? value : undefined
  }

  private async packStatus(pack: PackName): Promise<PackStatus> {
    const target = this.target.target
    const spec = target === null ? undefined : this.manifest.packs[pack].targets[target]
    const version = spec?.version ?? ''
    const packageName = spec?.package ?? ''
    const base: PackStatus = {
      name: pack,
      state: 'not-installed',
      kind: this.manifest.packs[pack].kind,
      version,
      package: packageName,
      target,
      pythonVersion: this.manifest.python,
      packages: { ...this.manifest.packs[pack].packages },
      bytes: 0,
      path: target === null ? '' : packRoot(this.cacheRoot, pack, version, target),
    }
    if (target === null || spec === undefined) return base
    const root = packRoot(this.cacheRoot, pack, version, target)
    if (!await exists(root)) return base
    const ready = await this.readReady(pack, version, target)
    if (ready === undefined) {
      return { ...base, state: 'broken', error: 'ready.json 缺失或不可读。' }
    }
    if (ready.pack !== pack
      || ready.packVersion !== version
      || ready.target !== target
      || ready.package !== packageName
      || ready.pythonVersion !== this.manifest.python
      || !packagesMatch(ready.packages, this.manifest.packs[pack].packages)) {
      return { ...base, state: 'broken', error: 'ready.json 与当前 manifest 不一致。' }
    }
    try {
      if (pack === 'base' && ready.python === null) {
        return { ...base, state: 'broken', error: 'base ready.json 缺少 Python 可执行文件。' }
      }
      if (ready.python !== null) await stat(safeRelative(root, ready.python))
      for (const item of ready.sitePackages) await stat(safeRelative(root, item))
    } catch (error) {
      return { ...base, state: 'broken', error: `运行时文件缺失：${messageOf(error)}` }
    }
    return {
      ...base,
      state: 'ready',
      installedAt: ready.installedAt,
      bytes: ready.bytes ?? await directoryBytes(root),
    }
  }

  async status(): Promise<RuntimeStatus> {
    const base = await this.packStatus('base')
    const parquet = await this.packStatus('parquet')
    const active = this.activeJobId === undefined ? undefined : this.jobs.get(this.activeJobId)?.job
    return {
      supported: this.target.supported,
      ...(this.target.reason === undefined ? {} : { reason: this.target.reason }),
      target: this.target.target,
      platform: this.target.platform,
      arch: this.target.arch,
      python: this.manifest.python,
      cacheRoot: this.cacheRoot,
      base,
      parquet,
      ready: base.state === 'ready',
      ...(active === undefined ? {} : { activeJob: copyJob(active) }),
    }
  }

  prepare(packs: unknown = ['base']): PrepareJob {
    const names = normalizePackNames(packs)
    const target = this.targetId()
    for (const name of names) packTarget(this.manifest, name, target)

    if (this.activeJobId !== undefined) {
      const active = this.jobs.get(this.activeJobId)
      if (active !== undefined && active.job.state === 'running') {
        if (active.job.packs.length === names.length && active.job.packs.every((name, index) => name === names[index])) {
          return copyJob(active.job)
        }
        throw new PythonRuntimeError('busy', '已有另一个运行时准备任务在进行。')
      }
    }

    const id = randomUUID()
    const job: PrepareJob = {
      id,
      packs: names,
      state: 'running',
      stage: 'checking',
      message: '检查平台与缓存…',
      startedAt: nowIso(this.now),
    }
    const controller = new AbortController()
    const active: ActiveJob = { job, controller, promise: Promise.resolve() }
    this.jobs.set(id, active)
    this.activeJobId = id
    active.promise = this.runJob(active).catch((error) => {
      this.logger?.error?.(`python-runtime prepare failed: ${messageOf(error)}`)
    }).finally(() => {
      if (this.activeJobId === id) this.activeJobId = undefined
    })
    return copyJob(job)
  }

  getJob(id: string): PrepareJob | undefined {
    const active = this.jobs.get(id)
    return active === undefined ? undefined : copyJob(active.job)
  }

  async waitForJob(id: string): Promise<PrepareJob> {
    const active = this.jobs.get(id)
    if (active === undefined) throw new PythonRuntimeError('invalid-request', `没有这个运行时任务：${id}`)
    await active.promise
    return copyJob(active.job)
  }

  cancel(id: string): boolean {
    const active = this.jobs.get(id)
    if (active === undefined || active.job.state !== 'running') return false
    active.controller.abort()
    active.job.message = '正在取消…'
    return true
  }

  private async runJob(active: ActiveJob): Promise<void> {
    const { job, controller } = active
    try {
      await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 })
      await removeStaleStaging(stagingRoot(this.cacheRoot))
      for (const pack of job.packs) {
        if (controller.signal.aborted) throw new PythonRuntimeError('cancelled')
        job.current = pack
        job.stage = 'checking'
        job.message = `检查 ${pack}…`
        const status = await this.packStatus(pack)
        if (status.state === 'ready') continue
        job.stage = 'installing'
        job.message = `安装 ${pack}…`
        await this.ensurePack(active, pack)
      }
      job.stage = 'done'
      job.state = 'done'
      job.message = '分析环境已就绪。'
      job.endedAt = nowIso(this.now)
      delete job.current
    } catch (error) {
      const runtimeError = isPythonRuntimeError(error)
        ? error
        : new PythonRuntimeError('unknown', messageOf(error))
      job.state = runtimeError.code === 'cancelled' ? 'cancelled' : 'failed'
      job.stage = 'done'
      job.message = runtimeError.message
      job.error = { code: runtimeError.code, message: runtimeError.message }
      job.endedAt = nowIso(this.now)
      this.logger?.error?.(`python-runtime: ${runtimeError.code}: ${runtimeError.message}`)
      if (runtimeError.diagnostics !== undefined) this.logger?.warn?.(runtimeError.diagnostics)
    }
  }

  private getPnpm(): PnpmInvocation {
    if (this.pnpmInvocation !== undefined) return this.pnpmInvocation
    this.pnpmInvocation = this.packageManager ?? findPnpmCli()
    return this.pnpmInvocation
  }

  private async ensurePack(active: ActiveJob, pack: PackName): Promise<void> {
    const target = this.targetId()
    const spec = packTarget(this.manifest, pack, target)
    const root = packRoot(this.cacheRoot, pack, spec.version, target)
    const lock = join(lockRoot(this.cacheRoot), `${pack}-${spec.version}-${target}`)
    const { job, controller } = active

    await mkdir(lockRoot(this.cacheRoot), { recursive: true, mode: 0o700 })
    await withInstallLock(lock, async () => {
      const current = await this.packStatus(pack)
      if (current.state === 'ready') return

      job.stage = 'checking'
      job.message = `检查磁盘空间…`
      const free = await availableBytes(this.cacheRoot)
      if (free !== undefined && free < this.manifest.limits.minFreeBytes) {
        throw new PythonRuntimeError('disk-space', `磁盘空间不足：需要约 ${Math.ceil(this.manifest.limits.minFreeBytes / 1048576)} MB，当前约 ${Math.floor(free / 1048576)} MB。`)
      }

      const staging = join(stagingRoot(this.cacheRoot), `${pack}-${spec.version}-${target}-${randomUUID()}`)
      const installDir = join(staging, 'install')
      const payload = join(staging, 'payload')
      const probeHome = join(staging, 'probe-home')
      const probeTemp = join(staging, 'probe-tmp')
      try {
        await mkdir(staging, { recursive: true, mode: 0o700 })
        const source = this.packSources[pack]
        // A package.json dependency value is a range or a file URL, never `name@version`:
        // pnpm treats the latter as a relative directory and installs nothing.
        const dependency = source === undefined ? spec.version : pathToFileURL(resolve(source)).href
        await writeInstallProject(installDir, spec.package, dependency, this.registry)
        job.stage = 'installing'
        job.message = source === undefined ? `下载并安装 ${pack}（约 ${Math.ceil(spec.bytes / 1048576)} MB）…` : `安装本地 ${pack} 包…`
        const result = await this.runPnpm(this.getPnpm(), installArgs(installDir, storeRoot(this.cacheRoot), this.registry), {
          cwd: this.profileDir ?? staging,
          timeoutMs: this.manifest.limits.installTimeoutMs,
          signal: controller.signal,
        })
        if (result.code !== 0 || result.timedOut || result.aborted) throw classifyPnpmFailure(result)

        const installed = join(installDir, 'node_modules', ...spec.package.split('/'))
        if (!await exists(installed)) {
          throw new PythonRuntimeError('pack-invalid', `pnpm 安装完成但找不到 ${spec.package}。`)
        }
        await rename(installed, payload)
        await rm(installDir, { recursive: true, force: true })

        const metadata = await this.readPackMetadata(payload, pack, target)
        const executable = metadata.executable === null ? undefined : safeRelative(payload, metadata.executable)
        if (metadata.kind === 'base') {
          if (executable === undefined) throw new PythonRuntimeError('pack-invalid', 'base pack 缺少 executable。')
          if (this.target.platform !== 'win32') await chmod(executable, 0o755)
        }
        const sitePackages = metadata.sitePackages.map((item) => safeRelative(payload, item))

        const baseReady = pack === 'base' ? undefined : await this.readReady('base', this.manifest.packs.base.targets[target]?.version ?? '', target)
        const baseRoot = pack === 'base' ? undefined : packRoot(this.cacheRoot, 'base', this.manifest.packs.base.targets[target]?.version ?? '', target)
        const python = pack === 'base'
          ? executable
          : (baseReady?.python === null || baseReady?.python === undefined || baseRoot === undefined ? undefined : safeRelative(baseRoot, baseReady.python))
        if (python === undefined) throw new PythonRuntimeError('pack-invalid', `${pack} pack 找不到可用的 Python 解释器；请先安装 base。`)
        const probeSites = pack === 'base'
          ? sitePackages
          : [
            ...(baseReady?.sitePackages ?? []).map((item) => safeRelative(baseRoot as string, item)),
            ...sitePackages,
          ]

        job.stage = 'verifying'
        job.message = `自检 ${pack}…`
        const report = await this.probePython({
          python,
          workerPath: this.workerPath,
          sitePackages: probeSites,
          homeDir: probeHome,
          tempDir: probeTemp,
          timeoutMs: this.manifest.limits.probeTimeoutMs,
          signal: controller.signal,
        })
        this.validateProbe(report, pack, target, python, probeSites, payload, baseRoot)

        const ready: ReadyFile = {
          schemaVersion: 1,
          pack,
          packVersion: spec.version,
          target,
          package: spec.package,
          pythonVersion: this.manifest.python,
          packages: { ...this.manifest.packs[pack].packages },
          python: metadata.executable === null ? null : `payload/${metadata.executable}`,
          sitePackages: metadata.sitePackages.map((item) => `payload/${item}`),
          installedAt: nowIso(this.now),
          probe: { ok: true, at: nowIso(this.now) },
          bytes: await directoryBytes(payload),
        }
        await writeJsonAtomic(readyPath(staging), ready)
        await mkdir(join(root, '..'), { recursive: true })
        if (await exists(root)) {
          const previous = `${root}.broken-${Date.now()}`
          await rename(root, previous)
          await rm(previous, { recursive: true, force: true }).catch(() => undefined)
        }
        await rename(staging, root)
      } finally {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      }
    }, { timeoutMs: 30_000, staleMs: 120_000 })
  }

  private async readPackMetadata(payload: string, pack: PackName, target: TargetId): Promise<RuntimePackMetadata> {
    const value = await readJson<Record<string, unknown>>(join(payload, 'runtime-pack.json'))
    if (value === undefined) throw new PythonRuntimeError('pack-invalid', '运行时包缺少 runtime-pack.json。')
    const parts = targetParts(target)
    const expected = this.manifest.packs[pack]
    if (value.schemaVersion !== 1
      || value.kind !== expected.kind
      || value.platform !== parts.platform
      || value.arch !== parts.arch
      || value.pythonVersion !== this.manifest.python
      || value.packages === null
      || typeof value.packages !== 'object'
      || Array.isArray(value.packages)) {
      throw new PythonRuntimeError('pack-invalid', 'runtime-pack.json 与 manifest/当前平台不一致。')
    }
    if (!packagesMatch(value.packages as Record<string, string>, expected.packages)) {
      throw new PythonRuntimeError('pack-invalid', 'runtime-pack.json 的三方库版本与 manifest 不一致。')
    }
    if (value.executable !== null && typeof value.executable !== 'string') {
      throw new PythonRuntimeError('pack-invalid', 'runtime-pack.json.executable 必须是字符串或 null。')
    }
    if (!Array.isArray(value.sitePackages) || value.sitePackages.length === 0 || value.sitePackages.some((item) => typeof item !== 'string')) {
      throw new PythonRuntimeError('pack-invalid', 'runtime-pack.json.sitePackages 必须是非空字符串数组。')
    }
    const metadata = value as unknown as RuntimePackMetadata
    for (const item of metadata.sitePackages) {
      const path = safeRelative(payload, item)
      if (!await exists(path)) throw new PythonRuntimeError('pack-invalid', `site-packages 不存在：${item}`)
    }
    if (metadata.executable !== null) {
      const path = safeRelative(payload, metadata.executable)
      if (!await exists(path)) throw new PythonRuntimeError('pack-invalid', `Python 可执行文件不存在：${metadata.executable}`)
    }
    return metadata
  }

  private validateProbe(
    report: ProbeReport,
    pack: PackName,
    target: TargetId,
    python: string,
    sitePackages: string[],
    payload: string,
    baseRoot: string | undefined,
  ): void {
    const parts = targetParts(target)
    if (report.pythonVersion !== this.manifest.python) {
      throw new PythonRuntimeError('probe-failed', `Python 版本不匹配：期望 ${this.manifest.python}，实际 ${report.pythonVersion}。`)
    }
    if (report.platform !== parts.platform) {
      throw new PythonRuntimeError('probe-failed', `Python 平台不匹配：期望 ${parts.platform}，实际 ${report.platform}。`)
    }
    if (normalizeMachine(report.arch) !== parts.arch) {
      throw new PythonRuntimeError('probe-failed', `Python 架构不匹配：期望 ${parts.arch}，实际 ${report.arch}。`)
    }
    if (!packagesMatch(report.packages, this.manifest.packs[pack].packages)) {
      throw new PythonRuntimeError('probe-failed', `Python 三方库版本不匹配：${JSON.stringify(report.packages)}。`)
    }
    const reportPython = resolve(report.executable)
    const expectedPython = resolve(python)
    const root = pack === 'base' ? payload : baseRoot
    if (root === undefined || reportPython !== expectedPython || !isInside(root, reportPython)) {
      throw new PythonRuntimeError('probe-failed', 'probe 使用了 payload 之外的解释器。')
    }
    for (const item of report.sitePackages) {
      const allowed = sitePackages.some((candidate) => resolve(candidate) === resolve(item))
        || (baseRoot !== undefined && isInside(baseRoot, item))
      if (!allowed) throw new PythonRuntimeError('probe-failed', `probe 使用了未授权的 site-packages：${item}`)
    }
  }

  /** Re-run the self-check against the installed packs; `parquet` also verifies pyarrow. */
  async verify(packs: unknown = ['base']): Promise<ProbeReport> {
    const names = normalizePackNames(packs)
    const handle = await this.resolve(names)
    const target = this.targetId()
    const baseSpec = packTarget(this.manifest, 'base', target)
    const baseRoot = packRoot(this.cacheRoot, 'base', baseSpec.version, target)
    const probeHome = join(this.cacheRoot, 'verify-home')
    const probeTemp = join(this.cacheRoot, 'verify-tmp')
    const report = await this.probePython({
      python: handle.python,
      workerPath: this.workerPath,
      sitePackages: handle.sitePackages,
      homeDir: probeHome,
      tempDir: probeTemp,
      timeoutMs: this.manifest.limits.probeTimeoutMs,
    })
    const parts = targetParts(target)
    if (report.pythonVersion !== this.manifest.python
      || report.platform !== parts.platform
      || normalizeMachine(report.arch) !== parts.arch) {
      throw new PythonRuntimeError(
        'probe-failed',
        `Python 运行时与当前平台不一致：${report.pythonVersion}/${report.platform}/${report.arch}。`,
      )
    }
    if (!packagesMatch(report.packages, handle.packages)) {
      throw new PythonRuntimeError('probe-failed', `Python 三方库版本不匹配：${JSON.stringify(report.packages)}。`)
    }
    const reportPython = resolve(report.executable)
    if (reportPython !== resolve(handle.python) || !isInside(baseRoot, reportPython)) {
      throw new PythonRuntimeError('probe-failed', 'probe 使用了 payload 之外的解释器。')
    }
    for (const item of report.sitePackages) {
      const allowed = handle.sitePackages.some((candidate) => resolve(candidate) === resolve(item))
        || isInside(baseRoot, item)
      if (!allowed) throw new PythonRuntimeError('probe-failed', `probe 使用了未授权的 site-packages：${item}`)
    }
    return report
  }

  async resolve(packs: unknown = ['base']): Promise<RuntimeHandle> {
    const names = normalizePackNames(packs)
    const target = this.targetId()
    const baseSpec = packTarget(this.manifest, 'base', target)
    const base = await this.packStatus('base')
    if (base.state !== 'ready') throw new PythonRuntimeError('runtime-not-ready')
    const baseRoot = packRoot(this.cacheRoot, 'base', baseSpec.version, target)
    const baseReady = await this.readReady('base', baseSpec.version, target)
    if (baseReady === undefined || baseReady.python === null) throw new PythonRuntimeError('runtime-not-ready')

    const sitePackages = baseReady.sitePackages.map((item) => safeRelative(baseRoot, item))
    const packages = { ...baseReady.packages }
    const packVersions: Partial<Record<PackName, string>> = { base: baseSpec.version }
    for (const pack of names.filter((name) => name !== 'base')) {
      const spec = packTarget(this.manifest, pack, target)
      const status = await this.packStatus(pack)
      if (status.state !== 'ready') throw new PythonRuntimeError('runtime-not-ready', `${pack} 运行时尚未准备。`)
      const requires = this.manifest.packs[pack].requires?.base
      if (requires !== undefined && requires !== baseReady.packVersion) {
        throw new PythonRuntimeError('pack-invalid', `${pack} 需要 base ${requires}，当前是 ${baseReady.packVersion}。`)
      }
      const root = packRoot(this.cacheRoot, pack, spec.version, target)
      const ready = await this.readReady(pack, spec.version, target)
      if (ready === undefined) throw new PythonRuntimeError('runtime-not-ready', `${pack} 运行时尚未准备。`)
      sitePackages.push(...ready.sitePackages.map((item) => safeRelative(root, item)))
      Object.assign(packages, ready.packages)
      packVersions[pack] = spec.version
    }
    return {
      python: safeRelative(baseRoot, baseReady.python),
      pythonVersion: this.manifest.python,
      sitePackages,
      packages,
      packs: packVersions,
    }
  }

  async remove(pack: PackName): Promise<void> {
    if (this.activeJobId !== undefined) throw new PythonRuntimeError('busy', '运行时任务进行中，不能移除。')
    if (!PACK_ORDER.includes(pack)) throw new PythonRuntimeError('invalid-request', `未知 pack：${String(pack)}`)
    if (pack === 'base' && (await this.packStatus('parquet')).state === 'ready') {
      throw new PythonRuntimeError('busy', '请先移除 parquet 运行时，再移除 base。')
    }
    await rm(join(this.cacheRoot, pack), { recursive: true, force: true })
  }

  async dispose(): Promise<void> {
    for (const active of this.jobs.values()) {
      if (active.job.state === 'running') active.controller.abort()
    }
    await Promise.allSettled([...this.jobs.values()].map((active) => active.promise))
    this.jobs.clear()
    this.activeJobId = undefined
  }
}
