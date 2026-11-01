import { _electron as electron } from 'playwright-core'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { freePort } from '../database.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'asistencia-ui-test-'))
const errors = []
let app
try {
  const ports = { desktopPort: await freePort(), setupPort: await freePort(), securePort: await freePort() }
  const env = { ...process.env, ASISTENCIA_DATA_DIR: dataDir, ASISTENCIA_TEST_PORTS: JSON.stringify(ports) }
  delete env.ELECTRON_RUN_AS_NODE
  const executablePath = process.env.ASISTENCIA_ELECTRON_TEST || createRequire(import.meta.url)('electron')
  app = await electron.launch({ args: [rootDir], executablePath, env, timeout: 60000 })
  const page = await app.firstWindow({ timeout: 60000 })
  page.setDefaultTimeout(60000)
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Bienvenido a Asistencia local' }).waitFor()
  await page.getByLabel('Tu nombre', { exact: true }).fill('Profesor de prueba')
  await page.getByLabel('Correo', { exact: true }).fill('profesor@example.test')
  await page.getByLabel('Contraseña', { exact: true }).fill('Contraseña-local-segura')
  await page.getByRole('button', { name: 'Crear mi cuenta local' }).click()
  await page.getByRole('button', { name: 'Ya guardé mi código. Continuar' }).waitFor()
  const recovery = await page.locator('code').textContent()
  assert.equal(recovery.length, 40)
  await page.getByRole('button', { name: 'Ya guardé mi código. Continuar' }).click()
  await page.getByRole('link', { name: 'Teléfonos', exact: true }).click()
  await page.getByRole('heading', { name: 'Conectar teléfonos' }).waitFor()
  await page.getByAltText('QR para configurar el teléfono en la red del salón').waitFor()
  await app.evaluate(({ session }, target) => {
    globalThis.testDownload = new Promise(resolve => {
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(target)
        item.once('done', (_event, state) => resolve({ state, filename: item.getFilename() }))
      })
    })
  }, path.join(dataDir, 'respaldo-ui.json'))
  await page.getByRole('button', { name: 'Descargar respaldo' }).click()
  const download = await app.evaluate(() => globalThis.testDownload)
  assert.equal(download.state, 'completed')
  assert.match(download.filename, /asistencia-respaldo/)
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'respaldo-ui.json'), 'utf8')).format, 'asistencia-local-v1')
  await page.getByRole('link', { name: 'Pase de Lista', exact: true }).click()
  await page.getByRole('link', { name: 'Crear grupo', exact: true }).click()
  await page.getByLabel('Grupo', { exact: true }).fill('S5A local')
  await page.getByLabel('Materia', { exact: true }).fill('Prueba sin internet')
  await page.getByRole('button', { name: 'Crear grupo', exact: true }).click()
  await page.getByRole('heading', { name: 'S5A local', exact: true }).waitFor()
  await page.getByLabel('Nombre', { exact: true }).fill('Alumno de prueba')
  await page.getByLabel('Número de control', { exact: true }).fill('12345678')
  await page.getByRole('button', { name: 'Agregar', exact: true }).click()
  await page.getByText('Alumno de prueba', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Pase de lista', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir lista', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar lista', exact: true }).waitFor()
  await page.getByRole('img', { name: 'Código QR del pase de lista', exact: true }).locator('svg').waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Interfaz Windows verificada: configuración inicial, recuperación, QR de conexión, respaldo, alta de grupo y alumno, y apertura de lista con QR.')
} finally {
  if (app) await app.close()
  const resolved = await realpath(dataDir)
  assert.equal(path.dirname(resolved), await realpath(tmpdir()))
  assert.ok(path.basename(resolved).startsWith('asistencia-ui-test-'))
  await rm(resolved, { recursive: true, force: true })
}
