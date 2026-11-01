// Limpieza y reglas de los datos de alumnos (alta manual, importación y activación).

// "  Juan   Pérez " → "Juan Pérez"
export function limpiarNombre(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim()
}

// " 21330123 " → "21330123"; " c2133 0123" → "C21330123"; "" → null
// Se guarda en mayúsculas y sin espacios para que "c123" y "C123" no
// cuenten como dos números de control distintos.
export function limpiarNumeroControl(texto) {
  const limpio = String(texto ?? '').replace(/\s+/g, '').toUpperCase()
  return limpio === '' ? null : limpio
}

// Regla del número de control: de 4 a 20 letras o números.
// Es la MISMA regla que exige la base de datos (migración 7: restricción
// alumnos_numero_control_formato y privado.validar_activacion). Aquí solo
// sirve para avisar al momento; si se cambia, hay que cambiarla allá también.
export const LARGO_NUMERO_CONTROL = { min: 4, max: 20 }

// Recibe el número YA limpio (limpiarNumeroControl). Devuelve el mensaje
// del problema, o null si está bien. Vacío (null) está bien: es opcional
// para el profesor; el alumno lo captura al activar.
export function problemaNumeroControl(numeroControl) {
  if (numeroControl == null) return null
  if (!/^[A-Z0-9]+$/.test(numeroControl)) return 'El número de control solo lleva letras y números'
  const { min, max } = LARGO_NUMERO_CONTROL
  if (numeroControl.length < min || numeroControl.length > max) {
    return `El número de control debe tener entre ${min} y ${max} caracteres`
  }
  return null
}

// Para comparar nombres sin que importen acentos, mayúsculas o espacios:
// "José  Pérez" y "JOSE PEREZ" dan lo mismo.
export function claveNombre(texto) {
  return quitarAcentos(limpiarNombre(texto)).toUpperCase()
}

// Separa cada letra de su acento (NFD) y quita los acentos
// (los caracteres combinables del rango U+0300 a U+036F).
export function quitarAcentos(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
