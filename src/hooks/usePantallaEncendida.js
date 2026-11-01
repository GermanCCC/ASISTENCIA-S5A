import { useEffect } from 'react'

// Evita que la pantalla se apague mientras se muestra el QR (útil cuando
// el profesor usa su celular). Usa la Wake Lock API; si el navegador no la
// tiene, simplemente no hace nada.
export function usePantallaEncendida(activa) {
  useEffect(() => {
    if (!activa || !('wakeLock' in navigator)) return
    let bloqueo = null
    let cancelado = false

    async function pedir() {
      try {
        bloqueo = await navigator.wakeLock.request('screen')
        if (cancelado) bloqueo.release()
      } catch {
        // Puede fallar si la batería está baja; no es grave.
      }
    }

    // El navegador suelta el bloqueo al cambiar de pestaña; se vuelve a pedir.
    function alCambiarVisibilidad() {
      if (document.visibilityState === 'visible') pedir()
    }

    pedir()
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      cancelado = true
      bloqueo?.release().catch(() => {})
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [activa])
}
