import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
}

function ownerFile(ownerDir) {
  return join(ownerDir, 'owner.json')
}

async function readOwnerFile(ownerDir, expectedProfileKey) {
  try {
    const text = await readFile(ownerFile(ownerDir), 'utf8')
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object') return undefined
    if (typeof value.ownerId !== 'string' || typeof value.expiresAt !== 'number') return undefined
    if (expectedProfileKey !== undefined && value.profileKey !== expectedProfileKey) return undefined
    return value
  } catch {
    return undefined
  }
}

/** Read the active owner without following a renamed old root. */
async function readOwner(lockDir, expectedProfileKey) {
  try {
    const entries = await readdir(lockDir, { withFileTypes: true })
    const owners = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const value = await readOwnerFile(join(lockDir, entry.name), expectedProfileKey)
      if (value !== undefined) owners.push(value)
    }
    // Read old-format records during the one-release migration window.
    const legacy = await readOwnerFile(lockDir, expectedProfileKey)
    if (legacy !== undefined) owners.push(legacy)
    owners.sort((left, right) => (right.expiresAt ?? 0) - (left.expiresAt ?? 0))
    return owners[0]
  } catch {
    return undefined
  }
}

async function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  await rename(temp, file)
}

export function createOwnerLease(options) {
  const {
    directory,
    profileKey,
    ownerId,
    leaseMs,
    now = () => Date.now(),
    random = () => randomUUID(),
  } = options
  // The root is only the arbitration point. Each lease gets a private child directory, so a
  // stale process keeps addressing the renamed old root and can never write into its successor.
  const lockDir = join(directory, `capital_automation.${safeSegment(profileKey)}.lock`)
  let ownedDir
  let held = false
  let token

  async function ensureDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }

  async function writeClaim() {
    if (ownedDir === undefined || token === undefined) throw new Error('owner lease is not claimed')
    const at = now()
    await atomicWrite(ownerFile(ownedDir), {
      ownerId,
      fencingToken: token,
      profileKey,
      acquiredAt: at,
      heartbeatAt: at,
      expiresAt: at + leaseMs,
    })
  }

  async function claimEmptyRoot() {
    token = `${Date.now().toString(36)}-${String(random()).slice(0, 8)}`
    const candidate = join(lockDir, `lease-${safeSegment(ownerId)}-${safeSegment(token)}`)
    await mkdir(candidate, { mode: 0o700 })
    ownedDir = candidate
    try {
      await writeClaim()
      held = true
      return true
    } catch (error) {
      ownedDir = undefined
      token = undefined
      await rm(candidate, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function acquire() {
    if (held) return true
    await ensureDirectory()
    let createdRoot = false
    try {
      await mkdir(lockDir, { mode: 0o700 })
      createdRoot = true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    if (createdRoot) return claimEmptyRoot()

    const incumbent = await readOwner(lockDir, profileKey)
    if (incumbent !== undefined && Number.isFinite(incumbent.expiresAt) && incumbent.expiresAt > now()) {
      return false
    }
    // Only the contender that wins this rename may install a replacement root. Any old owner
    // still holding the previous child path can write there, but that path is now stale.
    const stale = `${lockDir}.stale-${process.pid}-${String(random()).slice(0, 8)}`
    try {
      await rename(lockDir, stale)
    } catch {
      return false
    }
    try {
      await mkdir(lockDir, { mode: 0o700 })
      return await claimEmptyRoot()
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      return false
    } finally {
      await rm(stale, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function renew() {
    if (!held || ownedDir === undefined || token === undefined) return false
    const current = await readOwnerFile(ownedDir, profileKey)
    const active = await readOwner(lockDir, profileKey)
    if (current?.ownerId !== ownerId || current?.fencingToken !== token
      || active?.ownerId !== ownerId || active?.fencingToken !== token) {
      held = false
      return false
    }
    if (!Number.isFinite(current.expiresAt) || current.expiresAt <= now()
      || !Number.isFinite(active.expiresAt) || active.expiresAt <= now()) {
      held = false
      return false
    }
    try {
      await writeClaim()
      const afterWrite = await readOwner(lockDir, profileKey)
      if (afterWrite?.ownerId !== ownerId || afterWrite?.fencingToken !== token) {
        held = false
        return false
      }
      return true
    } catch {
      held = false
      return false
    }
  }

  async function release() {
    if (!held) return
    held = false
    const previousDir = ownedDir
    const previousToken = token
    ownedDir = undefined
    token = undefined
    const current = await readOwnerFile(previousDir, profileKey)
    if (current?.ownerId !== ownerId || current?.fencingToken !== previousToken) return
    // Do not remove the root: deleting it races a successor. An empty root is safely renamed by
    // the next contender after it observes that no live child lease remains.
    await rm(previousDir, { recursive: true, force: true }).catch(() => {})
  }

  return {
    lockDir,
    get held() {
      return held
    },
    get fencingToken() {
      return token
    },
    acquire,
    renew,
    release,
    read: () => readOwner(lockDir, profileKey),
    async isCurrent() {
      if (!held || ownedDir === undefined || token === undefined) return false
      const current = await readOwnerFile(ownedDir, profileKey)
      const active = await readOwner(lockDir, profileKey)
      return current?.ownerId === ownerId
        && current?.fencingToken === token
        && active?.ownerId === ownerId
        && active?.fencingToken === token
        && Number.isFinite(current.expiresAt)
        && current.expiresAt > now()
        && Number.isFinite(active.expiresAt)
        && active.expiresAt > now()
    },
  }
}

/** Test hook: create a foreign lease without racing the public acquire path. */
export async function writeForeignLease(directory, profileKey, owner) {
  const lockDir = join(directory, `capital_automation.${safeSegment(profileKey)}.lock`)
  await mkdir(lockDir, { recursive: true, mode: 0o700 })
  const child = join(lockDir, `lease-${safeSegment(owner.ownerId ?? 'foreign')}-${safeSegment(owner.fencingToken ?? randomUUID())}`)
  await mkdir(child, { mode: 0o700 })
  await atomicWrite(ownerFile(child), owner)
  return lockDir
}

/** Touch an empty marker file so callers can prove the directory exists before opening a domain. */
export async function ensureOwnerDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const marker = await open(join(directory, '.keep'), 'a', 0o600)
  await marker.close()
}
