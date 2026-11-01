import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Pide al servidor el token de un QR rotativo y lo cambia justo a tiempo.
// Sirve para los dos QR:
//   useTokenQr('token_qr_actual', 'p_sesion_id', sesionId)          (pase de lista, cada 5 s)
//   useTokenQr('token_activacion_actual', 'p_grupo_id', grupoId)    (activar alumnos, cada 10 s)
//
// El reloj de la computadora del profesor puede estar adelantado o
// atrasado. Por eso no se usa su hora para decidir cuándo cambiar: el
// servidor manda su hora ("ahora") y el momento del próximo cambio, y se
// calcula el "desfase" entre ambos relojes. Con eso, la barra de progreso
// y el temporizador coinciden con lo que el servidor va a aceptar.
//
// QR siguiente por adelantado (solo el pase de lista lo manda): el QR
// anterior vale apenas 3 s después del cambio, así que no conviene
// esperar a la red justo en ese momento. Con el siguiente ya en mano, la
// pantalla cambia sola en el segundo exacto, y el par nuevo se pide con
// calma 1 s después; si la red tropieza, hay unos 4 s para reintentar.
//
// `version`: cambiarlo obliga a pedir el token de nuevo (por ejemplo,
// después de reabrir la ventana de activación).
//
// Devuelve:
//   token            texto que va dentro del QR
//   siguienteCambio  cuándo cambia el QR, en hora LOCAL (ms)
//   duracion         cada cuánto cambia el QR (ms)
//   desfase          hora del servidor - hora local (ms)
//   cierraEn         cuándo se cierra, en hora del servidor (texto ISO)
//   cerrada          true si ya se cerró
//   error            mensaje si falló la conexión (se reintenta solo)
export function useTokenQr(funcion, parametro, id, version = 0) {
  const [estado, setEstado] = useState({
    token: null,
    siguienteCambio: null,
    duracion: 10_000,
    desfase: 0,
    cierraEn: null,
    cerrada: false,
    error: '',
  })

  useEffect(() => {
    let cancelado = false
    let temporizador // próxima petición al servidor
    let cambio // cambio local al QR siguiente (sin red)
    setEstado((e) => ({ ...e, cerrada: false }))

    async function pedir() {
      clearTimeout(temporizador)
      const inicio = Date.now()
      const { data, error } = await supabase.rpc(funcion, { [parametro]: id })
      const fin = Date.now()
      if (cancelado) return

      if (error) {
        // Mientras tanto se sigue viendo el último QR (y el cambio local ya
        // programado). Se reintenta en 1 s.
        setEstado((e) => ({ ...e, error: 'Problema de conexión, reintentando…' }))
        temporizador = setTimeout(pedir, 1000)
        return
      }

      // Llegó respuesta: el cambio programado con la respuesta anterior ya
      // no hace falta (o, si se cerró, ya no debe ocurrir).
      clearTimeout(cambio)

      if (!data.abierta) {
        setEstado((e) => ({ ...e, token: null, cerrada: true, error: '' }))
        return
      }

      // La respuesta tardó (fin - inicio); se asume que el servidor tomó su
      // hora a la mitad del viaje.
      const desfase = new Date(data.ahora).getTime() - (inicio + fin) / 2
      const siguienteCambio = new Date(data.siguiente_cambio).getTime() - desfase
      // El QR de activación no manda "segundos": cambia cada 10 s.
      const duracion = (data.segundos ?? 10) * 1000
      const base = { desfase, duracion, cierraEn: data.cierra_en, cerrada: false, error: '' }

      if (!data.token_siguiente) {
        setEstado({ ...base, token: data.token, siguienteCambio })
        // 200 ms después del cambio, para asegurar que el servidor ya está
        // en el intervalo nuevo.
        temporizador = setTimeout(pedir, Math.max(500, siguienteCambio - Date.now() + 200))
        return
      }

      // Si la respuesta llegó tan tarde que ya pasó el cambio, se muestra
      // directamente el siguiente.
      if (Date.now() >= siguienteCambio) {
        setEstado({ ...base, token: data.token_siguiente, siguienteCambio: siguienteCambio + duracion })
      } else {
        setEstado({ ...base, token: data.token, siguienteCambio })
        cambio = setTimeout(
          () => setEstado((e) => ({ ...e, token: data.token_siguiente, siguienteCambio: siguienteCambio + duracion })),
          siguienteCambio - Date.now(),
        )
      }
      temporizador = setTimeout(pedir, Math.max(500, siguienteCambio - Date.now() + 1000))
    }

    // Los navegadores frenan los temporizadores de las pestañas ocultas.
    // Al volver a la pestaña se pide el token de inmediato.
    function alCambiarVisibilidad() {
      if (document.visibilityState === 'visible') pedir()
    }

    pedir()
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      cancelado = true
      clearTimeout(temporizador)
      clearTimeout(cambio)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [funcion, parametro, id, version])

  return estado
}
