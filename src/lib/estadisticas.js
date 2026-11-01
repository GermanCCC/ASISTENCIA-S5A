// Cálculos de asistencia que usan varias pantallas (inicio, estadísticas,
// historial, "Mi asistencia") y el Excel. No usan Supabase: reciben los
// datos ya cargados, así se pueden probar sin conexión (npm run prueba:fase8).
//
// Regla del sistema (igual que la vista resumen_asistencia_alumno):
// cuentan como asistencia presente, retardo y justificada; solo cuentan
// las listas ya cerradas.

export const ESTADOS = {
  presente: { letra: 'P', nombre: 'Presente' },
  retardo: { letra: 'R', nombre: 'Retardo' },
  falta: { letra: 'F', nombre: 'Falta' },
  justificada: { letra: 'J', nombre: 'Justificada' },
}

// Colores de cada estado en la interfaz (clases de Tailwind).
export const COLORES_ESTADO = {
  presente: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  retardo: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  falta: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  justificada: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
}

export function asistenciasDe(fila) {
  return fila.presentes + fila.retardos + fila.justificadas
}

// Porcentaje general del grupo = total de asistencias / total de clases,
// sumando a todos los alumnos activos. Se suman los conteos en vez de
// promediar los porcentajes para que un alumno con pocas clases no pese
// lo mismo que uno con todas.
//   filas: renglones de resumen_asistencia_alumno de UN grupo
export function resumirGrupo(filas) {
  const activos = filas.filter((r) => r.activo)
  const clases = activos.reduce((suma, r) => suma + r.total_clases, 0)
  const asistencias = activos.reduce((suma, r) => suma + asistenciasDe(r), 0)
  return {
    alumnosActivos: activos.length,
    porcentaje: clases > 0 ? Math.round((1000 * asistencias) / clases) / 10 : null,
    enRiesgo: activos.filter((r) => r.en_riesgo).length,
  }
}

// Si un alumno está en riesgo: ¿a cuántas clases seguidas tiene que
// asistir para volver al mínimo? Se despeja x de
//   (asistencias + x) / (clases + x) >= minimo / 100
// Devuelve null si no es posible (mínimo de 100% con alguna falta).
export function clasesParaRecuperarse(asistencias, clases, minimo) {
  if (clases === 0 || (100 * asistencias) / clases >= minimo) return 0
  if (minimo >= 100) return null
  // El -1e-9 evita que un 5.0000000001 por redondeo se vuelva 6.
  return Math.ceil((minimo * clases - 100 * asistencias) / (100 - minimo) - 1e-9)
}

// Si NO está en riesgo: ¿cuántas de las próximas clases puede faltar sin
// quedar debajo del mínimo? Se despeja f de
//   asistencias / (clases + f) >= minimo / 100
// Devuelve null si el mínimo es 0 (nunca quedaría en riesgo).
export function faltasPermitidas(asistencias, clases, minimo) {
  if (minimo <= 0) return null
  return Math.max(0, Math.floor((100 * asistencias) / minimo - clases + 1e-9))
}

// 80 → "80%", 83.33 → "83.3%"
export function formatearPorcentaje(valor) {
  if (valor == null) return '—'
  return `${Number(valor).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`
}
