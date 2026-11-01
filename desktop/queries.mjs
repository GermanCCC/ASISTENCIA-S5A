const TABLES = new Set(['profesores', 'grupos', 'alumnos', 'dispositivos', 'sesiones', 'asistencias', 'resumen_asistencia_alumno'])
const WRITES = {
  grupos: new Set(['nombre', 'materia', 'periodo', 'minutos_ventana', 'minutos_retardo', 'porcentaje_minimo_asistencia', 'requiere_ubicacion', 'lat', 'lng', 'radio_m', 'requiere_selfie']),
  alumnos: new Set(['grupo_id', 'nombre', 'numero_control', 'activo']),
  asistencias: new Set(['sesion_id', 'alumno_id', 'estado', 'metodo', 'sospechosa']),
}
export const PUBLIC_RPC = new Set(['abrir_sesion', 'cerrar_sesion', 'cerrar_sesiones_vencidas', 'token_qr_actual', 'registrar_asistencia', 'generar_codigos_activacion', 'aprobar_dispositivo', 'rechazar_dispositivo', 'abrir_activacion', 'cerrar_activacion', 'token_activacion_actual', 'listar_solicitudes', 'contar_solicitudes_pendientes', 'aprobar_solicitud', 'rechazar_solicitud'])
export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Campo inválido')
  return `"${value}"`
}
export async function rpc(client, name, args = {}) {
  const keys = Object.keys(args)
  const params = keys.map((key, i) => `${identifier(key)} => $${i + 1}`).join(', ')
  // to_jsonb conserva tanto funciones escalares como funciones que devuelven tablas.
  const { rows } = await client.query(`SELECT to_jsonb(r) AS value FROM public.${identifier(name)}(${params}) r`, Object.values(args))
  const tables = new Set(['generar_codigos_activacion', 'contar_solicitudes_pendientes'])
  return tables.has(name) ? rows.map(row => row.value) : rows[0]?.value ?? null
}

function splitColumns(text) { return text.split(/,(?![^()]*\))/).map(s => s.trim()).filter(Boolean) }
function projection(table, text, alias = 't') {
  if (!text || text === '*') return `${alias}.*`
  return splitColumns(text).map(column => {
    const relation = column.match(/^(asistencias|sesiones)(?:!inner)?\(([^()]*)\)$/)
    if (!relation) return `${alias}.${identifier(column)}`
    const [, child, fields] = relation
    if (table === 'sesiones' && child === 'asistencias') {
      return `(SELECT coalesce(jsonb_agg(row_to_json(rel)), '[]'::jsonb) FROM
        (SELECT ${projection(child, fields, 'a')} FROM public.asistencias a WHERE a.sesion_id = ${alias}.id) rel) AS asistencias`
    }
    if (table === 'asistencias' && child === 'sesiones') {
      return `(SELECT row_to_json(rel) FROM
        (SELECT ${projection(child, fields, 's')} FROM public.sesiones s WHERE s.id = ${alias}.sesion_id) rel) AS sesiones`
    }
    throw new Error('Relación inválida')
  }).join(', ')
}

// API deliberadamente pequeña: no acepta SQL ni nombres de esquema desde el teléfono.
// Los parámetros se escapan y cada operación se ejecuta con RLS, nunca como administrador.
export async function queryTable(client, input) {
  const { table, action = 'select', filters = [], columns = '*', order, single } = input
  if (!TABLES.has(table) || !['select', 'insert', 'update', 'delete'].includes(action)) throw new Error('Operación inválida')
  if (!Array.isArray(filters) || filters.length > 20) throw new Error('Filtros inválidos')
  const values = []
  const param = value => { values.push(value); return `$${values.length}` }
  const conditions = filters.map(({ column, value }) => {
    if (column === 'sesiones.estado' && table === 'asistencias') return `EXISTS (SELECT 1 FROM public.sesiones s WHERE s.id = t.sesion_id AND s.estado = ${param(value)})`
    return `t.${identifier(column)} = ${param(value)}`
  })
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  let sql
  if (action === 'select') {
    sql = `SELECT ${projection(table, columns)} FROM public.${identifier(table)} t${where}`
    if (order) sql += ` ORDER BY t.${identifier(order.column)} ${order.ascending === false ? 'DESC' : 'ASC'}`
    sql += ' LIMIT 10000'
  } else if (action === 'delete') {
    if (!['grupos', 'sesiones'].includes(table) || !conditions.length) throw new Error('Borrado no permitido')
    sql = `DELETE FROM public.${identifier(table)} t${where} RETURNING t.*`
  } else {
    const rows = Array.isArray(input.values) ? input.values : [input.values]
    if (!rows.length || rows.length > 1000 || rows.some(row => !row || typeof row !== 'object')) throw new Error('Datos inválidos')
    const keys = Object.keys(rows[0])
    if (!keys.length || keys.some(key => !WRITES[table]?.has(key)) || rows.some(row => Object.keys(row).length !== keys.length || keys.some(key => !(key in row)))) throw new Error('Campos no permitidos')
    if (action === 'insert') {
      sql = `INSERT INTO public.${identifier(table)} (${keys.map(identifier).join(',')}) VALUES `
      sql += rows.map(row => `(${keys.map(key => param(row[key])).join(',')})`).join(',') + ' RETURNING *'
    } else {
      if (!conditions.length || rows.length !== 1 || table === 'alumnos' && keys.includes('grupo_id') || table === 'asistencias' && keys.some(key => !['estado', 'sospechosa'].includes(key))) throw new Error('Cambio no permitido')
      sql = `UPDATE public.${identifier(table)} t SET ${keys.map(key => `${identifier(key)} = ${param(rows[0][key])}`).join(',')}${where} RETURNING t.*`
    }
  }
  const { rows } = await client.query(sql, values)
  if (single && rows.length > 1 || single === 'single' && rows.length !== 1) throw new Error('No se encontró un único registro')
  return single ? rows[0] ?? null : rows
}
