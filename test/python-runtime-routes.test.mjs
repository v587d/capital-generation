import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { createPythonRuntimeHandler } from '../lib/python-runtime/routes.js'

function response() {
  return {
    statusCode: 200,
    headers: {},
    text: '',
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.text += String(value) },
    json() { return JSON.parse(this.text) },
  }
}

async function call(handler, { method = 'GET', url = '/python-runtime/status', body, authorize } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  const res = response()
  await handler(req, res)
  return res
}

function fakeManager(calls) {
  return {
    async status() { return { supported: true, base: { state: 'not-installed' } } },
    prepare(packs) { calls.push(['prepare', packs]); return { id: 'job-1', packs, state: 'running' } },
    getJob(id) { return id === 'job-1' ? { id, state: 'running' } : undefined },
    cancel(id) { calls.push(['cancel', id]); return id === 'job-1' },
    async remove(pack) { calls.push(['remove', pack]) },
    async verify() { return { pythonVersion: '3.13.17' } },
  }
}

test('python-runtime routes: status and prepare are bounded and authenticated', async () => {
  const calls = []
  const handler = createPythonRuntimeHandler(fakeManager(calls), () => undefined)
  const status = await call(handler)
  assert.equal(status.statusCode, 200)
  assert.equal(status.json().supported, true)

  const prepared = await call(handler, { method: 'POST', url: '/python-runtime/prepare', body: { packs: ['parquet'] } })
  assert.equal(prepared.statusCode, 202)
  assert.deepEqual(prepared.json().job.packs, ['base', 'parquet'])
  assert.deepEqual(calls.at(-1), ['prepare', ['base', 'parquet']])

  const unauthorized = await call(createPythonRuntimeHandler(fakeManager([]), () => 401))
  assert.equal(unauthorized.statusCode, 401)
})

test('python-runtime routes: invalid bodies and unknown jobs fail loudly', async () => {
  const handler = createPythonRuntimeHandler(fakeManager([]), () => undefined)
  const invalid = await call(handler, { method: 'POST', url: '/python-runtime/prepare', body: { packs: ['nope'] } })
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.json().error.code, 'invalid-request')

  const missing = await call(handler, { url: '/python-runtime/jobs/nope' })
  assert.equal(missing.statusCode, 404)

  const noConfirm = await call(handler, { method: 'POST', url: '/python-runtime/remove', body: { pack: 'base' } })
  assert.equal(noConfirm.statusCode, 400)

  const removed = await call(handler, { method: 'POST', url: '/python-runtime/remove', body: { pack: 'base', confirm: true } })
  assert.equal(removed.statusCode, 200)
})

test('python-runtime routes: only the prefix is served and GET/POST methods are enforced', async () => {
  const handler = createPythonRuntimeHandler(fakeManager([]), () => undefined)
  const outside = await call(handler, { url: '/other' })
  assert.equal(outside.statusCode, 404)
  const wrong = await call(handler, { method: 'POST', url: '/python-runtime/status' })
  assert.equal(wrong.statusCode, 405)
})
