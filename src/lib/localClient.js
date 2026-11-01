// Conserva la interfaz que usan las pantallas, pero todas las peticiones van
// al servidor de Windows. No se usan llaves, cuentas ni servicios de la nube.
const KEY = 'asistencia-sesion-local-v1'
let session = null
try { session = JSON.parse(localStorage.getItem(KEY)) } catch { /* Sin sesión guardada. */ }
const listeners = new Set()
function saveSession(value, event = 'SIGNED_IN') {
  session = value
  if (value) localStorage.setItem(KEY, JSON.stringify(value))
  else localStorage.removeItem(KEY)
  for (const callback of listeners) callback(event, value)
}
export async function localRequest(path, body, options = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...options.headers },
      ...(body === undefined ? {} : { body: options.raw ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(['/import', '/backup'].includes(path) ? 180000 : 20000),
    })
    const result = await response.json().catch(() => ({ error: { message: 'Respuesta no válida del servidor local' } }))
    if (!response.ok) return { data: null, error: result.error ?? { message: 'No se pudo completar la acción' } }
    return { data: result.data ?? null, error: null }
  } catch {
    return { data: null, error: { message: 'No se pudo conectar con la computadora del profesor. Comprueba el wifi y que la aplicación esté abierta.' } }
  }
}
class Query {
  constructor(table) { this.input = { table, filters: [] } }
  select(columns = '*') { this.input.columns = columns; return this }
  eq(column, value) { this.input.filters.push({ column, value }); return this }
  order(column, options = {}) { this.input.order = { column, ...options }; return this }
  insert(values) { Object.assign(this.input, { action: 'insert', values }); return this }
  update(values) { Object.assign(this.input, { action: 'update', values }); return this }
  delete() { this.input.action = 'delete'; return this }
  single() { this.input.single = 'single'; return this }
  maybeSingle() { this.input.single = 'maybeSingle'; return this }
  then(resolve, reject) { return localRequest('/query', this.input).then(resolve, reject) }
}
class Channel {
  handlers = []
  cancelled = false
  on(_type, filter, callback) { this.handlers.push({ filter, callback, previous: new Map() }); return this }
  subscribe() {
    const poll = async () => {
      for (const handler of this.handlers) {
        if (this.cancelled) return
        const query = new Query(handler.filter.table)
        if (handler.filter.filter) {
          const [column, value] = handler.filter.filter.split('=eq.')
          query.eq(column, value)
        }
        // Solicitudes no se leen directamente: se consulta la bandeja autorizada.
        if (handler.filter.table === 'solicitudes_activacion') { handler.callback({}); continue }
        const { data } = await query.select('*')
        if (!data || this.cancelled) continue
        const next = new Map(data.map(row => [row.id, row]))
        for (const row of data) {
          const old = handler.previous.get(row.id)
          if (!old && ['INSERT', '*'].includes(handler.filter.event)) handler.callback({ new: row, old: {} })
          else if (old && JSON.stringify(old) !== JSON.stringify(row) && ['UPDATE', '*'].includes(handler.filter.event)) handler.callback({ new: row, old })
        }
        if (handler.filter.event === '*') for (const [id, old] of handler.previous) if (!next.has(id)) handler.callback({ old, new: {} })
        handler.previous = next
      }
      if (!this.cancelled) this.timer = setTimeout(poll, 2000)
    }
    poll()
    return this
  }
  unsubscribe() { this.cancelled = true; clearTimeout(this.timer) }
}
export const localClient = {
  from: table => new Query(table),
  rpc: (name, args = {}) => localRequest(`/rpc/${encodeURIComponent(name)}`, args),
  functions: { invoke: (name, { body }) => localRequest(`/functions/${encodeURIComponent(name)}`, body) },
  channel: () => new Channel(),
  removeChannel: channel => channel.unsubscribe(),
  auth: {
    onAuthStateChange(callback) {
      listeners.add(callback)
      // Primero se verifica con el servidor; una sesión editada en el navegador
      // nunca concede permisos. Si el wifi falla se conserva para reintentar.
      Promise.resolve().then(async () => {
        if (session) {
          const { data, error } = await localRequest('/auth/session')
          if (data) session = { ...session, user: data.user }
          else if (error?.message?.includes('venció')) saveSession(null, 'SIGNED_OUT')
        }
        if (listeners.has(callback)) callback('INITIAL_SESSION', session)
      })
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
    },
    async signInWithPassword(credentials) {
      const result = await localRequest('/auth/login', credentials)
      if (result.data) saveSession(result.data.session)
      return result
    },
    async setup(credentials) {
      const result = await localRequest('/auth/setup', credentials)
      if (result.data) saveSession(result.data.session)
      return result
    },
    async setSession(value) {
      const previous = session
      session = value
      const result = await localRequest('/auth/session')
      if (result.data) saveSession({ ...value, user: result.data.user })
      else session = previous
      return result
    },
    async signOut() { const result = await localRequest('/auth/logout', {}); saveSession(null, 'SIGNED_OUT'); return result },
    updateUser: fields => localRequest('/auth/password', fields),
    resetPasswordForEmail: () => Promise.resolve({ error: { message: 'La recuperación es local. Usa tu código de recuperación en la computadora del profesor.' } }),
  },
  storage: { from: () => ({
    upload: (name, body) => localRequest(`/photos/upload?path=${encodeURIComponent(name)}`, body, { raw: true, headers: { 'Content-Type': 'image/jpeg' } }),
    createSignedUrls: paths => localRequest('/photos/sign', { paths }),
  }) },
}
