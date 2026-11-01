import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { freePort } from '../database.mjs'

const rootDir = path.resolve(process.argv[2] || '.build-cache/windows-build/win-unpacked/resources/app')
const { startLocalServer } = await import(pathToFileURL(path.join(rootDir, 'desktop/server.mjs')).href)
const dataDir = await mkdtemp(path.join(tmpdir(), 'asistencia-package-test-'))
let runtime
try {
  runtime = await startLocalServer({ rootDir, dataDir, desktopPort: await freePort(), setupPort: await freePort(), securePort: await freePort(), log: () => {} })
  const response = await fetch(runtime.url + '/api/status')
  assert.deepEqual((await response.json()).data, { local: true, configured: false })
  const index = await (await fetch(runtime.url)).text()
  assert.ok(index.includes('window.__ASISTENCIA_LOCAL__=true'))
  const asset = index.match(/src="(\/assets\/[^" ]+\.js)"/)[1]
  const script = await fetch(runtime.url + asset)
  assert.equal(script.status, 200)
  await script.arrayBuffer()
  console.log('Paquete Windows verificado: base incluida, migraciones, HTTPS y aplicación local sin dependencias externas.')
} finally {
  await runtime?.stop()
  const resolved = await realpath(dataDir)
  assert.equal(path.dirname(resolved), await realpath(tmpdir()))
  assert.ok(path.basename(resolved).startsWith('asistencia-package-test-'))
  await rm(resolved, { recursive: true, force: true })
}
