// Convierte los errores de Supabase/Postgres en mensajes claros en español.
// `porRestriccion` permite dar un mensaje específico según qué regla de la
// base de datos se rompió, ej. { alumnos_numero_control_unico: '...' }.
export function mensajeDeError(error, porRestriccion = {}) {
  if (!error) return ''
  const texto = error.message ?? String(error)

  for (const [restriccion, mensaje] of Object.entries(porRestriccion)) {
    if (texto.includes(restriccion)) return mensaje
  }

  if (/Invalid login credentials/i.test(texto)) return 'Correo o contraseña incorrectos'
  if (/Email not confirmed/i.test(texto)) return 'Falta confirmar el correo de esta cuenta'
  // Recuperar contraseña
  if (/rate limit|only request this after/i.test(texto)) return 'Espera un minuto antes de pedir otro enlace.'
  if (/should be different from the old password/i.test(texto)) return 'La contraseña nueva debe ser distinta a la anterior.'
  if (/Password should be at least/i.test(texto)) return 'La contraseña es demasiado corta.'
  if (/weak|pwned|known to be/i.test(texto)) return 'Esa contraseña es muy común. Elige otra.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(texto))
    return 'Sin conexión. Revisa tu internet e intenta de nuevo.'

  // Códigos de error estándar de Postgres
  if (error.code === '23505') return 'Ya existe un registro con esos datos'
  if (error.code === '23514') return 'Algún dato no es válido'
  if (error.code === '42501') return 'No tienes permiso para hacer esto'

  return texto
}
