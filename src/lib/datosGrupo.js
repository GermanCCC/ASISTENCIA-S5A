import { supabase } from './supabase.js'

// Datos de asistencia de un grupo para las estadísticas y el Excel.
// Las dos pantallas leen exactamente lo mismo, así nunca dicen cosas distintas.
//
// Devuelve:
//   resumen:  un renglón por alumno de la vista resumen_asistencia_alumno
//             (conteos y porcentaje, calculados en la base de datos)
//   sesiones: listas CERRADAS, de la más antigua a la más reciente, cada una
//             con sus asistencias { alumno_id, estado }
//
// Solo cuentan las listas cerradas: una abierta todavía no tiene las
// faltas de quienes no se han registrado.
export async function cargarDatosGrupo(grupoId) {
  // Cierra las listas vencidas para que sus faltas ya cuenten (pg_cron lo
  // hace cada minuto; esto cubre el hueco). Si falla, los datos sirven igual.
  await supabase.rpc('cerrar_sesiones_vencidas')

  const [respResumen, respSesiones] = await Promise.all([
    supabase
      .from('resumen_asistencia_alumno')
      .select('alumno_id, nombre, numero_control, activo, total_clases, presentes, retardos, faltas, justificadas, porcentaje, porcentaje_minimo, en_riesgo')
      .eq('grupo_id', grupoId),
    supabase
      .from('sesiones')
      .select('id, abierta_en, asistencias(alumno_id, estado)')
      .eq('grupo_id', grupoId)
      .eq('estado', 'cerrada')
      .order('abierta_en'),
  ])
  const error = respResumen.error ?? respSesiones.error
  if (error) throw error

  const resumen = respResumen.data
    // numeric llega como número, pero por si acaso (Postgres lo puede mandar como texto).
    .map((r) => ({ ...r, porcentaje: r.porcentaje == null ? null : Number(r.porcentaje), porcentaje_minimo: Number(r.porcentaje_minimo) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { resumen, sesiones: respSesiones.data }
}
