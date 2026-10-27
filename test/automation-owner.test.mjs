import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOwnerLease, writeForeignLease } from '../automation/owner.js'

test('owner lease：原子创建、第二持有者被拒、续租、释放', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capital-automation-owner-'))
  try {
    const first = createOwnerLease({ directory: dir, profileKey: 'p_a', ownerId: 'owner-a', leaseMs: 60_000 })
    const second = createOwnerLease({ directory: dir, profileKey: 'p_a', ownerId: 'owner-b', leaseMs: 60_000 })
    assert.equal(await first.acquire(), true)
    assert.equal(await second.acquire(), false)
    assert.equal(await first.renew(), true)
    assert.equal(first.held, true)
    await first.release()
    assert.equal(first.held, false)
    assert.equal(await second.acquire(), true)
    await second.release()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('owner lease：过期租约被接管，fencing token 改变；不同 profile 互不影响', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capital-automation-owner-'))
  let clock = 1_000_000
  try {
    const first = createOwnerLease({ directory: dir, profileKey: 'p_a', ownerId: 'owner-a', leaseMs: 1000, now: () => clock })
    assert.equal(await first.acquire(), true)
    const firstToken = first.fencingToken
    clock += 5000
    const second = createOwnerLease({ directory: dir, profileKey: 'p_a', ownerId: 'owner-b', leaseMs: 1000, now: () => clock })
    assert.equal(await second.acquire(), true, '过期租约必须能被接管')
    assert.notEqual(second.fencingToken, firstToken)
    assert.equal(await first.renew(), false, '旧持有者不能续租已接管的目录')
    assert.equal(await first.isCurrent(), false, '旧持有者不能把自己的 stale child 当作当前 owner')
    const other = createOwnerLease({ directory: dir, profileKey: 'p_b', ownerId: 'owner-c', leaseMs: 1000, now: () => clock })
    assert.equal(await other.acquire(), true)
    await second.release()
    await other.release()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('owner lease：外部写入的未过期租约不会被抢', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capital-automation-owner-'))
  try {
    await writeForeignLease(dir, 'p_a', {
      ownerId: 'foreign',
      fencingToken: 'foreign-token',
      profileKey: 'p_a',
      acquiredAt: Date.now(),
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })
    const contender = createOwnerLease({ directory: dir, profileKey: 'p_a', ownerId: 'owner-a', leaseMs: 60_000 })
    assert.equal(await contender.acquire(), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
