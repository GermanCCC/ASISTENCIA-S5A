import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)
export const hash = text => createHash('sha256').update(text).digest('hex')
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new Error('Usa una contraseña de 10 a 200 caracteres')
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`
}
export async function checkPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 200 || !stored) return false
  const [salt, value] = stored.split(':')
  const derived = await scrypt(password, salt, 64)
  return timingSafeEqual(Buffer.from(value, 'hex'), derived)
}
export function publicUser(row) {
  return { id: row.id, email: row.email, app_metadata: row.raw_app_meta_data, user_metadata: row.raw_user_meta_data }
}
export async function newSession(client, userId) {
  const token = randomBytes(32).toString('hex')
  await client.query('INSERT INTO local.sessions(token_hash, user_id) VALUES ($1, $2)', [hash(token), userId])
  const { rows } = await client.query('SELECT * FROM auth.users WHERE id = $1', [userId])
  return { access_token: token, refresh_token: token, user: publicUser(rows[0]) }
}
export async function userForToken(pool, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  const { rows } = await pool.query(`SELECT u.* FROM auth.users u JOIN local.sessions s ON s.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(token)])
  return rows[0] ?? null
}

// Esta parte queda dentro del servidor y de una transacción, igual que las
// funciones de activación originales. Los teléfonos no reciben privilegios SQL.
export async function activation(client, name, body, currentUser, call) {
  const text = value => String(value ?? '')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const unionUser = body.unirme === true ? currentUser?.id : null
  if (body.unirme === true && currentUser?.raw_app_meta_data?.rol !== 'alumno') throw new Error('Inicia tu sesión de alumno para unirte a otra clase')
  async function account(prepared) {
    if (prepared.user_id) {
      const { rows } = await client.query('SELECT id FROM auth.users WHERE id = $1 AND raw_app_meta_data->>\'rol\' = \'alumno\'', [prepared.user_id])
      if (!rows.length) throw new Error('La cuenta de alumno no existe')
      return prepared.user_id
    }
    const id = randomUUID()
    await client.query(`INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
      VALUES ($1, $2, '{"rol":"alumno"}', $3)`, [id, `${prepared.alumno_id}@alumnos.invalid`, { nombre: prepared.nombre }])
    return id
  }
  if (name === 'activar-alumno') {
    if (!uuid.test(text(body.device_id))) throw new Error('Identificación del teléfono inválida')
    const args = { p_codigo: text(body.codigo), p_numero_control: text(body.numero_control), p_device_id: body.device_id, p_user_id: unionUser }
    const prepared = await call('revisar_activacion', args)
    if (prepared.codigo !== 'ok') return prepared
    const userId = unionUser ?? await account(prepared)
    const completed = await call('completar_activacion', { ...args, p_user_id: userId, p_user_agent: text(body.user_agent).slice(0, 300) })
    if (completed.codigo !== 'ok') throw new Error(completed.mensaje)
    return { ...completed, union: Boolean(unionUser), ...(unionUser ? {} : { sesion: await newSession(client, userId) }) }
  }
  switch (body.accion) {
    case 'listar': return call('qr_alumnos_del_grupo', { p_token: text(body.token) })
    case 'solicitar':
      if (!uuid.test(text(body.alumno_id)) || !uuid.test(text(body.device_id))) throw new Error('Solicitud inválida')
      return call('qr_solicitar_activacion', {
        p_pase: text(body.pase), p_alumno_id: body.alumno_id, p_tipo: text(body.tipo),
        p_numero_control: text(body.numero_control), p_device_id: body.device_id,
        p_user_agent: text(body.user_agent).slice(0, 300), p_secreto: text(body.secreto), p_user_id: unionUser,
      })
    case 'consultar':
      if (!uuid.test(text(body.solicitud_id))) throw new Error('Solicitud inválida')
      return call('qr_consultar_solicitud', { p_solicitud_id: body.solicitud_id, p_secreto: text(body.secreto) })
    case 'canjear': {
      if (!uuid.test(text(body.solicitud_id)) || !uuid.test(text(body.device_id))) throw new Error('Solicitud inválida')
      // Bloquea antes de crear cuenta para que un canje simultáneo no cree huérfanos.
      await client.query('SELECT id FROM public.solicitudes_activacion WHERE id = $1 FOR UPDATE', [body.solicitud_id])
      const args = { p_solicitud_id: body.solicitud_id, p_secreto: text(body.secreto), p_device_id: body.device_id }
      const prepared = await call('qr_preparar_canje', args)
      if (prepared.codigo !== 'ok') return prepared
      if (prepared.union && currentUser?.id !== prepared.user_id) throw new Error('La sesión no coincide con la solicitud')
      const userId = await account(prepared)
      const completed = await call('qr_completar_canje', { ...args, p_user_id: userId })
      if (completed.codigo !== 'ok') throw new Error(completed.mensaje)
      return { ...completed, estado_dispositivo: 'activo', union: Boolean(prepared.union), ...(prepared.union ? {} : { sesion: await newSession(client, userId) }) }
    }
    default: throw new Error('Acción desconocida')
  }
}
