// Manejo del modo claro/oscuro.
// Preferencias posibles: 'sistema' (sigue al celular), 'claro' u 'oscuro'.
// Se guarda en localStorage porque es solo una comodidad de cada dispositivo.

const CLAVE = 'tema'
const consultaOscuro = window.matchMedia('(prefers-color-scheme: dark)')

export function leerPreferencia() {
  try {
    return localStorage.getItem(CLAVE) ?? 'sistema'
  } catch {
    return 'sistema'
  }
}

export function aplicarTema(preferencia) {
  const oscuro =
    preferencia === 'oscuro' || (preferencia === 'sistema' && consultaOscuro.matches)
  document.documentElement.classList.toggle('dark', oscuro)
}

export function guardarPreferencia(preferencia) {
  try {
    if (preferencia === 'sistema') localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, preferencia)
  } catch {
    // Navegación privada o almacenamiento bloqueado: el tema funciona igual,
    // solo no se recuerda la próxima vez.
  }
  aplicarTema(preferencia)
}

// Si el usuario dejó "sistema" y cambia el tema del celular con la app
// abierta, la app cambia también.
consultaOscuro.addEventListener('change', () => {
  if (leerPreferencia() === 'sistema') aplicarTema('sistema')
})
