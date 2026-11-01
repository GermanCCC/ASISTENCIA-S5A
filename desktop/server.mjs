import express from 'express'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { openDatabase } from './database.mjs'
import { localAddresses, localCertificates } from './certificates.mjs'
import { activation, hash, newSession, passwordHash, checkPassword, publicUser, userForToken } from './auth.mjs'
import { PUBLIC_RPC, queryTable, rpc } from './queries.mjs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { importData, validateImport } from './import-data.mjs'

const isLoopback = request => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
const listen = (server, port, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
const close = server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections() })
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export async function startLocalServer({ dataDir, rootDir, desktopPort = 8785, setupPort = 8786, securePort = 8787, log = console.log }) {
  const database = await openDatabase(dataDir, rootDir, log)
  const { pool, asUser } = database
  const servers = []
  const timers = []
  try {
    const addresses = localAddresses()
    const certificates = await localCertificates(dataDir, addresses)
    const signedSecret = randomBytes(32)
    const signature = text => createHmac('sha256', signedSecret).update(text).digest('hex')
    const photoDir = path.join(dataDir, 'selfies')
    await mkdir(photoDir, { recursive: true })
    const app = express()
    app.disable('x-powered-by')
    const hosts = new Set(['localhost', '127.0.0.1', ...addresses])
    app.use((req, res, next) => {
      let host
      try { host = new URL(`http://${req.headers.host}`).hostname } catch { return res.sendStatus(400) }
      if (!hosts.has(host)) return res.sendStatus(403)
      // Evita peticiones desde páginas de internet a la aplicación del salón.
      if (req.headers.origin) {
        try {
          const expected = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`
          if (req.headers.origin !== expected) return res.sendStatus(403)
        } catch { return res.sendStatus(403) }
      }
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'same-origin')
      res.setHeader('X-Frame-Options', 'DENY')
      next()
    })
    app.use('/api/import', (req, res, next) => isLoopback(req) && !req.socket.encrypted ? next() : res.sendStatus(403), express.json({ limit: '100mb' }))
    app.use(express.json({ limit: '2mb' }))
    // Límites por dirección, sin confiar en encabezados que pueda inventar un alumno.
    const limits = new Map()
    app.use('/api', (req, res, next) => {
      const now = Date.now()
      const kind = /login|setup|recover/.test(req.path) ? 'login' : /functions/.test(req.path) ? 'activation' : 'normal'
      const key = `${req.socket.remoteAddress}:${kind}`
      let bucket = limits.get(key)
      if (!bucket || now > bucket.until) { bucket = { count: 0, until: now + 60000 }; limits.set(key, bucket) }
      if (++bucket.count > ({ login: 15, activation: 180, normal: 900 })[kind]) return res.status(429).json({ error: { message: 'Demasiadas solicitudes. Espera un minuto.' } })
      res.setHeader('Cache-Control', 'no-store')
      next()
    })
    timers.push(setInterval(() => { for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key) }, 60000))
    app.use('/api', async (req, _res, next) => {
      try {
        req.localToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
        req.localUser = await userForToken(pool, req.localToken)
        next()
      } catch (error) { next(error) }
    })
    const requireUser = (req, res, next) => req.localUser ? next() : res.status(401).json({ error: { message: 'Tu sesión venció. Vuelve a entrar.' } })
    const desktopOnly = (req, res, next) => isLoopback(req) && !req.socket.encrypted ? next() : res.sendStatus(403)
    const teacherOnly = (req, res, next) => req.localUser?.raw_app_meta_data?.rol === 'profesor' ? next() : res.sendStatus(403)
    app.get('/api/status', async (_req, res) => {
      const { rows } = await pool.query('SELECT EXISTS(SELECT FROM public.profesores) AS configured')
      res.json({ data: { local: true, configured: rows[0].configured } })
    })
    app.get('/api/connection', requireUser, teacherOnly, (req, res) => res.json({ data: {
      addresses: addresses.map(address => ({ url: `https://${address}:${securePort}`, setup: `http://${address}:${setupPort}` })),
      fingerprint: certificates.fingerprint,
      ...(isLoopback(req) ? { dataDir } : {}),
    } }))
    app.post('/api/auth/setup', desktopOnly, async (req, res) => {
      const name = String(req.body.name ?? '').trim().slice(0, 100)
      const email = String(req.body.email ?? '').trim().toLowerCase()
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe tu nombre y un correo válido')
      const hashed = await passwordHash(req.body.password)
      const recovery = randomBytes(20).toString('hex')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('LOCK TABLE auth.users IN EXCLUSIVE MODE')
        if ((await client.query('SELECT id FROM public.profesores LIMIT 1')).rows.length) throw new Error('La cuenta del profesor ya está configurada')
        const { rows } = await client.query(`INSERT INTO auth.users(email, password_hash, raw_app_meta_data, raw_user_meta_data)
          VALUES ($1, $2, '{"rol":"profesor"}', $3) RETURNING id`, [email, hashed, { nombre: name }])
        await client.query("INSERT INTO local.settings VALUES ('recovery_hash', $1)", [hash(recovery)])
        const session = await newSession(client, rows[0].id)
        await client.query('COMMIT')
        res.json({ data: { session, recovery } })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    })
    app.post('/api/auth/login', async (req, res) => {
      const email = String(req.body.email ?? '').trim().toLowerCase()
      const { rows } = await pool.query('SELECT * FROM auth.users WHERE email = $1 AND raw_app_meta_data->>\'rol\' = \'profesor\'', [email])
      if (!await checkPassword(req.body.password, rows[0]?.password_hash)) return res.status(401).json({ error: { message: 'Correo o contraseña incorrectos' } })
      res.json({ data: { session: await newSession(pool, rows[0].id) } })
    })
    app.get('/api/auth/session', requireUser, (req, res) => res.json({ data: { user: publicUser(req.localUser) } }))
    app.post('/api/auth/logout', requireUser, async (req, res) => {
      await pool.query('DELETE FROM local.sessions WHERE token_hash = $1', [hash(req.localToken)])
      res.json({ data: null })
    })
    app.post('/api/auth/password', requireUser, teacherOnly, async (req, res) => {
      const hashed = await passwordHash(req.body.password)
      await pool.query('UPDATE auth.users SET password_hash = $1 WHERE id = $2', [hashed, req.localUser.id])
      await pool.query('DELETE FROM local.sessions WHERE user_id = $1 AND token_hash <> $2', [req.localUser.id, hash(req.localToken)])
      res.json({ data: null })
    })
    app.post('/api/auth/recover', desktopOnly, async (req, res) => {
      const hashed = await passwordHash(req.body.password)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query("SELECT value FROM local.settings WHERE key = 'recovery_hash' FOR UPDATE")
        if (!rows[0] || hash(String(req.body.recovery ?? '')) !== rows[0].value) throw new Error('Código de recuperación incorrecto')
        const recovery = randomBytes(20).toString('hex')
        await client.query("UPDATE auth.users SET password_hash = $1 WHERE raw_app_meta_data->>'rol' = 'profesor'", [hashed])
        await client.query("DELETE FROM local.sessions WHERE user_id IN (SELECT id FROM public.profesores)")
        await client.query("UPDATE local.settings SET value = $1 WHERE key = 'recovery_hash'", [hash(recovery)])
        await client.query('COMMIT')
        res.json({ data: { recovery } })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    })
    app.post('/api/query', requireUser, async (req, res) => res.json({ data: await asUser(req.localUser.id, client => queryTable(client, req.body)) }))
    app.post('/api/rpc/:name', requireUser, async (req, res) => {
      if (!PUBLIC_RPC.has(req.params.name)) return res.sendStatus(403)
      res.json({ data: await asUser(req.localUser.id, client => rpc(client, req.params.name, req.body)) })
    })
    app.post('/api/functions/:name', async (req, res) => {
      if (!['activar-alumno', 'activar-por-qr'].includes(req.params.name)) return res.sendStatus(404)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const data = await activation(client, req.params.name, req.body, req.localUser, (name, args) => rpc(client, name, args))
        await client.query('COMMIT')
        res.json({ data })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    })
    const photoPath = value => {
      if (typeof value !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/.test(value)) throw new Error('Ruta de foto inválida')
      return path.join(photoDir, value)
    }
    app.post('/api/photos/upload', requireUser, express.raw({ type: 'image/jpeg', limit: '1mb' }), async (req, res) => {
      const name = String(req.query.path ?? '')
      const target = photoPath(name)
      if (!Buffer.isBuffer(req.body) || req.body[0] !== 0xff || req.body[1] !== 0xd8) throw new Error('La foto debe ser JPEG')
      await mkdir(path.dirname(target), { recursive: true })
      let written = false
      try {
        await asUser(req.localUser.id, async client => {
          await client.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('selfies', $1)", [name])
          await writeFile(target, req.body, { flag: 'wx' }); written = true
        })
      } catch (error) { if (written) await unlink(target).catch(() => {}); throw error }
      res.json({ data: { path: name } })
    })
    app.post('/api/photos/sign', requireUser, teacherOnly, async (req, res) => {
      if (!Array.isArray(req.body.paths) || req.body.paths.length > 1000) throw new Error('Lista de fotos inválida')
      const expires = Date.now() + 3600000
      const data = await asUser(req.localUser.id, async client => {
        const result = []
        for (const name of req.body.paths) {
          photoPath(name)
          const { rows } = await client.query("SELECT name FROM storage.objects WHERE bucket_id = 'selfies' AND name = $1", [name])
          result.push({ path: name, signedUrl: rows.length ? `/api/photos/file?path=${encodeURIComponent(name)}&expires=${expires}&signature=${signature(`${name}:${expires}`)}` : null })
        }
        return result
      })
      res.json({ data })
    })
    app.get('/api/photos/file', async (req, res) => {
      const { path: name, expires, signature: received } = req.query
      const target = photoPath(name)
      const expected = signature(`${name}:${expires}`)
      if (!/^\d+$/.test(String(expires)) || Number(expires) < Date.now() || !/^[a-f0-9]{64}$/.test(String(received)) || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return res.sendStatus(403)
      res.type('jpg').send(await readFile(target))
    })
    // Los respaldos incluyen datos y fotos; se descargan únicamente desde Windows.
    app.get('/api/backup', desktopOnly, requireUser, teacherOnly, async (_req, res) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const tables = {}
        for (const name of ['profesores', 'grupos', 'alumnos', 'dispositivos', 'sesiones', 'asistencias']) tables[name] = (await client.query(`SELECT * FROM public.${name}`)).rows
        const photos = []
        for (const row of (await client.query('SELECT name, created_at FROM storage.objects')).rows) {
          try { photos.push({ ...row, content: (await readFile(photoPath(row.name))).toString('base64') }) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        await client.query('COMMIT')
        res.json({ data: { format: 'asistencia-local-v1', exported_at: new Date().toISOString(), tables, photos } })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    })
    app.post('/api/import', desktopOnly, requireUser, teacherOnly, async (req, res) => {
      validateImport(req.body)
      const photos = req.body.photos ?? []
      if (!Array.isArray(photos) || photos.length > 10000) throw new Error('Lista de fotos inválida')
      for (const photo of photos) {
        photoPath(photo.name)
        if (typeof photo.content !== 'string' || photo.content.length > 1400000 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(photo.content)) throw new Error('Foto de respaldo inválida')
      }
      const client = await pool.connect()
      const written = []
      try {
        await client.query('BEGIN')
        const totals = await importData(client, req.body, req.localUser.id, new Set(photos.map(photo => photo.name)))
        for (const photo of photos) {
          const target = photoPath(photo.name)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, Buffer.from(photo.content, 'base64'), { flag: 'wx' }); written.push(target)
          await client.query("INSERT INTO storage.objects(bucket_id, name, created_at) VALUES ('selfies', $1, coalesce($2::timestamptz, now()))", [photo.name, photo.created_at ?? null])
        }
        await client.query('COMMIT')
        res.json({ data: totals })
      } catch (error) {
        await client.query('ROLLBACK')
        await Promise.all(written.map(target => unlink(target).catch(() => {})))
        throw error
      } finally { client.release() }
    })
    app.use('/api', (_req, res) => res.status(404).json({ error: { message: 'Operación no disponible' } }))
    const dist = path.join(rootDir, 'dist')
    const index = (await readFile(path.join(dist, 'index.html'), 'utf8')).replace('<head>', '<head><script>window.__ASISTENCIA_LOCAL__=true;</script>')
    app.use(express.static(dist, { index: false, maxAge: 0 }))
    app.use((_req, res) => res.type('html').send(index))
    app.use((error, _req, res, _next) => {
      log(error.message)
      res.status(error.status === 413 ? 413 : 400).json({ error: { message: error.code === '42501' ? 'No tienes permiso para esta acción' : error.message, code: error.code } })
    })
    const desktop = http.createServer(app)
    servers.push(desktop)
    await listen(desktop, desktopPort, '127.0.0.1')
    const secure = https.createServer({ key: certificates.key, cert: certificates.cert, minVersion: 'TLSv1.2' }, app)
    servers.push(secure)
    await listen(secure, securePort, '0.0.0.0')
    const setup = http.createServer((req, res) => {
      const host = String(req.headers.host ?? '').split(':')[0]
      if (!hosts.has(host)) { res.writeHead(403); return res.end() }
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (req.url === '/salon-ca.crt') {
        res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="salon-ca.crt"' })
        return res.end(certificates.caPem)
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar mi teléfono</title>
        <style>body{font:17px system-ui;max-width:620px;margin:40px auto;padding:20px;line-height:1.6;background:#f8fafc;color:#172033}a{color:#4338ca}a.button{display:inline-block;background:#4f46e5;color:white;padding:12px 20px;border-radius:12px}code{overflow-wrap:anywhere;font-size:12px}</style>
        <h1>Asistencia del salón</h1><p>Esta conexión funciona sin internet. Mantén el teléfono conectado al wifi del salón, aunque indique «sin internet».</p>
        <h2>1. Instala el certificado del salón</h2><p>Hazlo una sola vez para permitir la cámara y el QR.</p><p><a class="button" href="/salon-ca.crt">Descargar certificado</a></p>
        <p><strong>iPhone:</strong> abre esta página en Safari. Después de descargar: Ajustes → General → VPN y gestión de dispositivos → instala el perfil descargado. Luego Ajustes → General → Información → Ajustes de confianza de certificados → activa la confianza del certificado «Asistencia del salon».</p>
        <p><strong>Android:</strong> Ajustes → Seguridad y privacidad → Más ajustes de seguridad → Cifrado y credenciales → Instalar un certificado → Certificado de CA. Selecciona el archivo descargado. Los nombres cambian según el fabricante; busca «certificado de CA» en Ajustes. Si pide un PIN, usa el de desbloqueo del teléfono.</p>
        <p>Comprueba con el profesor la huella antes de confiar en el certificado:</p><code>${escapeHtml(certificates.fingerprint)}</code>
        <h2>2. Abre la aplicación</h2><p><a class="button" href="https://${escapeHtml(host)}:${securePort}">Abrir Asistencia</a></p>
        <p>Si aparece una advertencia de certificado, vuelve al paso 1 y comprueba que activaste su confianza.</p>
        <h2>3. Agrega el icono</h2><p>iPhone: Safari → Compartir → Añadir a pantalla de inicio. Android: menú de Chrome → Añadir a pantalla de inicio o Instalar aplicación.</p>
        <p>Permite el acceso a la cámara al escanear. No borres los datos de esta aplicación: identifican tu teléfono. Si cambian el router o la dirección de la computadora, pide el enlace nuevo al profesor.</p></html>`)
    })
    servers.push(setup)
    await listen(setup, setupPort, '0.0.0.0')
    async function maintenance() {
      await pool.query('SELECT privado.cerrar_sesiones_vencidas()')
      await pool.query('DELETE FROM local.sessions WHERE expires_at < now()')
    }
    async function cleanPhotos() {
      const { rows } = await pool.query("SELECT name FROM storage.objects WHERE created_at < now() - interval '30 days'")
      for (const { name } of rows) {
        try { await unlink(photoPath(name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
        await pool.query('DELETE FROM storage.objects WHERE name = $1', [name])
      }
    }
    await maintenance()
    await cleanPhotos()
    timers.push(setInterval(() => maintenance().catch(error => log(error.message)), 5000))
    timers.push(setInterval(() => cleanPhotos().catch(error => log(error.message)), 3600000))
    return { database, url: `http://127.0.0.1:${desktopPort}`, addresses, async stop() {
      timers.forEach(clearInterval)
      await Promise.all(servers.map(close))
      await database.close()
    } }
  } catch (error) {
    timers.forEach(clearInterval)
    await Promise.all(servers.map(close))
    await database.close()
    throw error
  }
}
