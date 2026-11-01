import { identifier } from './queries.mjs'

const COLUMNS = {
  grupos: ['id', 'profesor_id', 'nombre', 'materia', 'periodo', 'minutos_ventana', 'minutos_retardo', 'porcentaje_minimo_asistencia', 'requiere_ubicacion', 'lat', 'lng', 'radio_m', 'requiere_selfie', 'creado_en'],
  alumnos: ['id', 'grupo_id', 'numero_control', 'nombre', 'activo', 'creado_en'],
  sesiones: ['id', 'grupo_id', 'fecha', 'abierta_en', 'retardo_desde', 'cierra_en', 'estado', 'cerrada_en'],
  asistencias: ['id', 'sesion_id', 'alumno_id', 'estado', 'metodo', 'registrado_en', 'lat', 'lng', 'distancia_m', 'precision_m', 'selfie_path', 'sospechosa', 'motivo_sospecha', 'editado_por', 'editado_en'],
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function validateImport(input) {
  if (!input || !['asistencia-local-v1', 'asistencia-supabase-v1'].includes(input.format)) throw new Error('Este archivo no es un respaldo de Asistencia')
  for (const table of Object.keys(COLUMNS)) {
    if (!Array.isArray(input.tables?.[table]) || input.tables[table].length > 100000 || input.tables[table].some(row => !UUID.test(row?.id))) throw new Error(`Datos inválidos en ${table}`)
  }
  const groups = new Set(input.tables.grupos.map(g => g.id))
  const pupils = new Map(input.tables.alumnos.map(a => [a.id, a.grupo_id]))
  const sessions = new Map(input.tables.sesiones.map(s => [s.id, s.grupo_id]))
  if (input.tables.alumnos.some(a => !groups.has(a.grupo_id)) || input.tables.sesiones.some(s => !groups.has(s.grupo_id)) || input.tables.asistencias.some(a => !pupils.has(a.alumno_id) || !sessions.has(a.sesion_id) || pupils.get(a.alumno_id) !== sessions.get(a.sesion_id))) throw new Error('El archivo contiene registros que no pertenecen a sus grupos')
  return { grupos: groups.size, alumnos: pupils.size, sesiones: sessions.size, asistencias: input.tables.asistencias.length }
}

// Se restaura en una instalación vacía. Nunca se mezclan ni se borran registros
// existentes. Las sesiones y los teléfonos se reactivan por seguridad.
export async function importData(client, input, teacherId, photoNames = new Set()) {
  const totals = validateImport(input)
  await client.query('LOCK TABLE public.grupos IN EXCLUSIVE MODE')
  if ((await client.query('SELECT id FROM public.grupos LIMIT 1')).rows.length) throw new Error('La importación requiere una instalación sin grupos. Conserva tu respaldo y usa una instalación vacía.')
  for (const [table, allowed] of Object.entries(COLUMNS)) {
    for (const source of input.tables[table]) {
      const row = Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
      if (table === 'grupos') row.profesor_id = teacherId
      if (table === 'sesiones') {
        row.estado = 'cerrada'
        row.cerrada_en = source.cerrada_en || source.cierra_en
      }
      if (table === 'asistencias') {
        row.editado_por = source.editado_por ? teacherId : null
        row.selfie_path = photoNames.has(source.selfie_path) ? source.selfie_path : null
      }
      const keys = Object.keys(row)
      await client.query(`INSERT INTO public.${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
    }
  }
  // Una lista que estaba abierta en el respaldo pasa a cerrada; los alumnos
  // sin registro reciben falta para no dejar porcentajes inconsistentes.
  await client.query(`INSERT INTO public.asistencias(sesion_id, alumno_id, estado, metodo)
    SELECT s.id, a.id, 'falta', 'automatico' FROM public.sesiones s
    JOIN public.alumnos a ON a.grupo_id = s.grupo_id AND a.activo
    ON CONFLICT (sesion_id, alumno_id) DO NOTHING`)
  return totals
}
