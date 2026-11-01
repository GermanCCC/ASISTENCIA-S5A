import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import https from 'node:https'
import { startLocalServer } from '../server.mjs'
import { freePort } from '../database.mjs'
import { importData } from '../import-data.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
test('Servidor local: activación QR, seguridad, asistencia, fotos y persistencia', { timeout: 180000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'asistencia-local-test-'))
  const logs = []
  let runtime
  const ports = { desktopPort: await freePort(), setupPort: await freePort(), securePort: await freePort() }
  async function start() { runtime = await startLocalServer({ dataDir, rootDir, ...ports, log: line => logs.push(line) }) }
  t.after(async () => {
    await runtime?.stop()
    // Sólo se borra el directorio temporal creado por esta prueba.
    const resolved = await realpath(dataDir)
    const temp = await realpath(tmpdir())
    assert.equal(path.dirname(resolved), temp)
    assert.ok(path.basename(resolved).startsWith('asistencia-local-test-'))
    await rm(resolved, { recursive: true, force: true })
  })
  try { await start() } catch (error) { console.error(logs.join('\n')); throw error }
  async function request(endpoint, body, token, options = {}) {
    const response = await fetch(runtime.url + '/api' + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
      ...(body === undefined ? {} : { body: options.raw ? body : JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => ({}))
    return { status: response.status, ...json }
  }
  const call = async (name, args, token) => request(`/rpc/${name}`, args, token)
  const query = async (table, input, token) => request('/query', { table, ...input }, token)
  const fn = (body, token) => request('/functions/activar-por-qr', body, token)
  const setup = await request('/auth/setup', { name: 'Profesor prueba', email: 'prueba@example.test', password: 'Contraseña-segura-2026' })
  assert.equal(setup.status, 200, JSON.stringify(setup))
  const teacher = setup.data.session.access_token
  assert.equal(setup.data.recovery.length, 40)
  await t.test('el profesor sólo se configura una vez y el servidor valida la sesión', async () => {
    assert.equal((await request('/auth/setup', { name: 'Intruso', email: 'otro@example.test', password: 'contraseña-segura' })).status, 400)
    assert.equal((await query('grupos', {}, null)).status, 401)
    assert.equal((await query('grupos', {}, 'f'.repeat(64))).status, 401)
    assert.equal((await request('/auth/login', { email: 'prueba@example.test', password: 'incorrecta' })).status, 401)
    assert.equal((await request('/auth/login', { email: 'prueba@example.test', password: 'Contraseña-segura-2026' })).status, 200)
  })
  const created = await query('grupos', { action: 'insert', values: { nombre: 'PRUEBA', materia: 'Local' }, single: 'single' }, teacher)
  assert.equal(created.status, 200, JSON.stringify(created))
  const group = created.data.id
  const pupils = await query('alumnos', { action: 'insert', values: [
    { grupo_id: group, nombre: 'Alumno Uno', numero_control: '12345678' },
    { grupo_id: group, nombre: 'Alumno Dos', numero_control: '12345679' },
  ] }, teacher)
  assert.equal(pupils.status, 200, JSON.stringify(pupils))
  const pupil = pupils.data[0]
  const device = randomUUID(), secret = randomBytes(32).toString('hex')
  let student
  await t.test('activar por QR exige aprobación y un secreto del teléfono', async () => {
    assert.equal((await call('abrir_activacion', { p_grupo_id: group }, teacher)).status, 200)
    const token = (await call('token_activacion_actual', { p_grupo_id: group }, teacher)).data.token
    const listing = await fn({ accion: 'listar', token })
    assert.equal(listing.data.codigo, 'ok', JSON.stringify(listing))
    const pending = await fn({ accion: 'solicitar', pase: listing.data.pase, alumno_id: pupil.id, tipo: 'nueva', numero_control: '12345678', device_id: device, secreto: secret })
    assert.equal(pending.data.codigo, 'ok', JSON.stringify(pending))
    const args = { solicitud_id: pending.data.solicitud_id, secreto: secret, device_id: device }
    assert.notEqual((await fn({ accion: 'canjear', ...args })).data.codigo, 'ok')
    assert.equal((await call('aprobar_solicitud', { p_solicitud_id: args.solicitud_id }, teacher)).status, 200)
    assert.notEqual((await fn({ accion: 'canjear', ...args, secreto: '0'.repeat(64) })).data.codigo, 'ok')
    const redemption = await fn({ accion: 'canjear', ...args })
    assert.equal(redemption.data.codigo, 'ok', JSON.stringify(redemption))
    student = redemption.data.sesion.access_token
    assert.equal((await request('/auth/session', undefined, student)).data.user.app_metadata.rol, 'alumno')
    assert.notEqual((await fn({ accion: 'canjear', ...args })).data.codigo, 'ok')
  })
  let sessionId, qr
  await t.test('QR firmado y vigente registra exactamente una asistencia', async () => {
    const opened = await call('abrir_sesion', { p_grupo_id: group }, teacher)
    assert.equal(opened.status, 200, JSON.stringify(opened))
    sessionId = typeof opened.data === 'string' ? opened.data : opened.data.id
    assert.ok(sessionId, JSON.stringify(opened))
    const response = await call('token_qr_actual', { p_sesion_id: sessionId }, teacher)
    assert.equal(response.data.segundos, 5)
    qr = response.data.token
    assert.equal((await call('token_qr_actual', { p_sesion_id: sessionId }, student)).status, 400)
    const expired = qr.split('.'); expired[1] = String(Number(expired[1]) - 10)
    assert.notEqual((await call('registrar_asistencia', { p_token: expired.join('.'), p_device_id: device }, student)).data.codigo, 'presente')
    assert.notEqual((await call('registrar_asistencia', { p_token: qr, p_device_id: randomUUID() }, student)).data.codigo, 'presente')
    const registered = await call('registrar_asistencia', { p_token: qr, p_device_id: device }, student)
    assert.equal(registered.data.codigo, 'presente', JSON.stringify(registered))
    assert.equal((await call('registrar_asistencia', { p_token: qr, p_device_id: device }, student)).data.codigo, 'ya_registrado')
    assert.equal((await query('asistencias', {}, teacher)).data.length, 1)
  })
  await t.test('el alumno no puede leer secretos, hacerse profesor ni registrar por otro', async () => {
    assert.equal((await query('privado.sesion_secretos', {}, student)).status, 400)
    assert.equal((await call('qr_alumnos_del_grupo', { p_token: qr }, student)).status, 403)
    assert.equal((await call('listar_solicitudes', { p_grupo_id: group }, student)).status, 400)
    assert.equal((await query('grupos', { action: 'insert', values: { nombre: 'Intruso', materia: 'Intruso' } }, student)).status, 400)
    assert.equal((await query('alumnos', { action: 'update', values: { user_id: randomUUID() }, filters: [{ column: 'id', value: pupil.id }] }, teacher)).status, 400)
    assert.equal((await query('asistencias', { action: 'insert', values: { alumno_id: pupils.data[1].id, sesion_id: sessionId, estado: 'presente', metodo: 'manual' } }, student)).status, 400)
    assert.equal((await query('grupos', { filters: [{ column: 'id); DROP TABLE grupos;--', value: 'x' }] }, teacher)).status, 400)
  })
  await t.test('cerrar lista asigna faltas y los informes conservan sus relaciones', async () => {
    assert.equal((await call('cerrar_sesion', { p_sesion_id: sessionId }, teacher)).status, 200)
    const all = await query('asistencias', {}, teacher)
    assert.equal(all.data.length, 2)
    assert.equal(all.data.find(a => a.alumno_id === pupils.data[1].id).estado, 'falta')
    assert.equal((await query('asistencias', {}, student)).data.length, 1)
    const report = await query('sesiones', { columns: 'id, asistencias(alumno_id, estado)' }, teacher)
    assert.equal(report.data[0].asistencias.length, 2)
    assert.equal((await query('resumen_asistencia_alumno', {}, student)).data.length, 1)
    assert.equal(typeof (await query('resumen_asistencia_alumno', {}, student)).data[0].total_clases, 'number')
    const history = await query('asistencias', { columns: 'id, sesiones!inner(id, estado)', filters: [{ column: 'sesiones.estado', value: 'cerrada' }] }, student)
    assert.equal(history.data[0].sesiones.estado, 'cerrada')
  })
  await t.test('el certificado local valida HTTPS y se distribuye sin claves privadas', async () => {
    const ca = await readFile(path.join(dataDir, 'certificates', 'salon-ca.crt'))
    const response = await new Promise((resolve, reject) => {
      const req = https.get(`https://127.0.0.1:${ports.securePort}/api/status`, { ca }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body })) }); req.on('error', reject)
    })
    assert.equal(response.status, 200)
    const download = await fetch(`http://127.0.0.1:${ports.setupPort}/salon-ca.crt`)
    assert.ok((await download.text()).includes('BEGIN CERTIFICATE'))
    const privateKey = await fetch(`http://127.0.0.1:${ports.setupPort}/salon-ca.key`)
    assert.ok(!(await privateKey.text()).includes('PRIVATE KEY'))
    assert.equal((await request('/query', { table: 'grupos' }, teacher, { headers: { Origin: 'https://evil.example' } })).status, 403)
  })
  await t.test('las selfies se guardan localmente y sólo el profesor obtiene acceso', async () => {
    assert.equal((await query('grupos', { action: 'update', values: { requiere_selfie: true }, filters: [{ column: 'id', value: group }] }, teacher)).status, 200)
    const opened = await call('abrir_sesion', { p_grupo_id: group }, teacher)
    const id = typeof opened.data === 'string' ? opened.data : opened.data.id
    const token = (await call('token_qr_actual', { p_sesion_id: id }, teacher)).data.token
    const pending = await call('registrar_asistencia', { p_token: token, p_device_id: device }, student)
    assert.equal(pending.data.codigo, 'selfie_requerida', JSON.stringify(pending))
    const photo = `${id}/${pupil.id}/${randomUUID()}.jpg`
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const upload = await request(`/photos/upload?path=${encodeURIComponent(photo)}`, body, student, { raw: true, headers: { 'Content-Type': 'image/jpeg' } })
    assert.equal(upload.status, 200, JSON.stringify(upload))
    assert.equal((await request(`/photos/upload?path=${encodeURIComponent(`${id}/${pupils.data[1].id}/${randomUUID()}.jpg`)}`, body, student, { raw: true, headers: { 'Content-Type': 'image/jpeg' } })).status, 400)
    const complete = await call('registrar_asistencia', { p_token: pending.data.pase, p_device_id: device, p_selfie_path: photo }, student)
    assert.equal(complete.data.codigo, 'presente', JSON.stringify(complete))
    assert.equal((await request('/photos/sign', { paths: [photo] }, student)).status, 403)
    const signed = await request('/photos/sign', { paths: [photo] }, teacher)
    assert.equal(signed.status, 200)
    assert.equal((await fetch(runtime.url + signed.data[0].signedUrl)).status, 200)
    assert.equal((await fetch(runtime.url + signed.data[0].signedUrl.replace(/signature=[a-f0-9]+/, 'signature=' + 'f'.repeat(64)))).status, 403)
    await call('cerrar_sesion', { p_sesion_id: id }, teacher)
  })
  await t.test('cambiar de teléfono requiere aprobación y revoca el anterior', async () => {
    const newDevice = randomUUID(), newSecret = randomBytes(32).toString('hex')
    const token = (await call('token_activacion_actual', { p_grupo_id: group }, teacher)).data.token
    const listing = await fn({ accion: 'listar', token })
    const pending = await fn({ accion: 'solicitar', pase: listing.data.pase, alumno_id: pupil.id, tipo: 'cambio', numero_control: '12345678', device_id: newDevice, secreto: newSecret })
    assert.equal(pending.data.codigo, 'ok', JSON.stringify(pending))
    const args = { solicitud_id: pending.data.solicitud_id, secreto: newSecret, device_id: newDevice }
    assert.notEqual((await fn({ accion: 'canjear', ...args })).data.codigo, 'ok')
    await call('aprobar_solicitud', { p_solicitud_id: args.solicitud_id }, teacher)
    const completed = await fn({ accion: 'canjear', ...args })
    assert.equal(completed.data.codigo, 'ok', JSON.stringify(completed))
    const devices = await runtime.database.pool.query('SELECT device_id, estado FROM public.dispositivos WHERE alumno_id = $1', [pupil.id])
    assert.equal(devices.rows.find(d => d.device_id === device).estado, 'revocado')
    assert.equal(devices.rows.find(d => d.device_id === newDevice).estado, 'activo')
    assert.equal((await request('/auth/session', undefined, student)).data.user.id, (await request('/auth/session', undefined, completed.data.sesion.access_token)).data.user.id)
  })
  await t.test('respaldo y reinicio conservan historial y sesión', async () => {
    const backup = await request('/backup', undefined, teacher)
    assert.equal(backup.data.format, 'asistencia-local-v1')
    assert.equal(backup.data.tables.asistencias.length, 4)
    assert.equal(backup.data.photos.length, 1)
    // La restauración se prueba en una transacción que se revierte para no
    // interferir con la prueba de persistencia del servidor original.
    const client = await runtime.database.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM public.grupos')
      const totals = await importData(client, backup.data, setup.data.session.user.id)
      assert.equal(totals.asistencias, 4)
      assert.equal((await client.query('SELECT count(*)::integer AS total FROM public.asistencias')).rows[0].total, 4)
      assert.equal((await client.query('SELECT count(*)::integer AS total FROM public.alumnos WHERE user_id IS NOT NULL')).rows[0].total, 0)
      await client.query('ROLLBACK')
    } finally { client.release() }
    const ca = await readFile(path.join(dataDir, 'certificates', 'salon-ca.crt'), 'utf8')
    await runtime.stop(); runtime = null
    await start()
    assert.equal((await request('/auth/session', undefined, student)).status, 200)
    assert.equal((await query('asistencias', {}, teacher)).data.length, 4)
    assert.equal(await readFile(path.join(dataDir, 'certificates', 'salon-ca.crt'), 'utf8'), ca)
  })
})
