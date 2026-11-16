import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import * as entry from '../lib/python-runtime-entry.js'

function fakeCtx(home) {
  const provided = []
  const routes = []
  const effects = []
  const ctx = {
    get(name) {
      if (name === 'profileContext') return { home, dir: home }
      if (name === 'connection') return { requestRejection: () => undefined }
      return undefined
    },
    provide(name, value) { provided.push({ name, value }) },
    effect(callback) { const dispose = callback(); effects.push(dispose); return () => {} },
    inject(names, callback) {
      if (names.includes('webServer')) {
        callback({
          webServer: { register: (route) => { routes.push(route); return () => {} } },
          effect: (fn) => { const dispose = fn(); effects.push(dispose); return () => {} },
        })
      }
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, provided, routes, effects }
}

test('python-runtime entry: provides the service and registers the authenticated route prefix', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cg-runtime-entry-'))
  const { ctx, provided, routes } = fakeCtx(home)
  entry.apply(ctx)
  const service = provided.find((item) => item.name === 'pythonRuntime')
  assert.ok(service?.value, 'host row must provide pythonRuntime')
  assert.equal(service.value.manifest.python, '3.13.17')
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/python-runtime')
  await service.value.dispose()
})
