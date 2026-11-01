import { useEffect, useState } from 'react'

// Sigue la ubicación del celular mientras `activa` sea true.
// Se empieza a pedir desde que se abre la pantalla (no al escanear): el
// GPS tarda unos segundos en ubicarse y el QR solo dura unos segundos.
//
// Devuelve { posicion, problema }:
//   posicion: { lat, lng, precision (metros), cuando (ms) } o null
//   problema: '' | 'denegada' | 'no_disponible'
export function useUbicacion(activa) {
  const [estado, setEstado] = useState({ posicion: null, problema: '' })

  useEffect(() => {
    if (!activa) return
    if (!navigator.geolocation) {
      setEstado({ posicion: null, problema: 'no_disponible' })
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setEstado({
          posicion: { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, cuando: p.timestamp },
          problema: '',
        }),
      (e) => setEstado((anterior) => ({ ...anterior, problema: e.code === e.PERMISSION_DENIED ? 'denegada' : 'no_disponible' })),
      // maximumAge: acepta una ubicación de hasta 30 s para responder rápido.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [activa])

  return estado
}
