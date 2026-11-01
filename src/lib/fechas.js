// Todas las fechas del sistema se muestran en hora de Hermosillo, sin importar
// la zona horaria configurada en el celular o la computadora de quien lo use.
// Sonora no cambia de horario en verano, así que esta zona siempre es UTC-7.
export const ZONA_HORARIA = 'America/Hermosillo'

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA_HORARIA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const formatoHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
})

// Ej. "mié, 7 oct 2026"
export function formatearFecha(fecha) {
  return formatoFecha.format(new Date(fecha))
}

// Ej. "08:05 a.m."
export function formatearHora(fecha) {
  return formatoHora.format(new Date(fecha))
}

// Fecha del día en Hermosillo como "AAAA-MM-DD". Se usa en vez de
// toISOString() porque esa devuelve la fecha en UTC, y después de las
// 5 p.m. en Hermosillo ya sería "mañana".
export function hoyEnHermosillo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date())
}

// Cuenta regresiva: 245000 ms → "4:05"
export function formatearCuentaRegresiva(ms) {
  const segundos = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}

// "hace un momento", "hace 5 min", "hace 2 h"; más de un día: la fecha.
export function haceCuanto(fecha) {
  const minutos = Math.floor((Date.now() - new Date(fecha).getTime()) / 60000)
  if (minutos < 1) return 'hace un momento'
  if (minutos < 60) return `hace ${minutos} min`
  if (minutos < 24 * 60) return `hace ${Math.floor(minutos / 60)} h`
  return formatearFecha(fecha)
}
