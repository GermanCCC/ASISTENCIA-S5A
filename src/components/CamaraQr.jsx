import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { Spinner } from './ui.jsx'

// Cámara que lee códigos QR (librería qr-scanner).
//   activa:   true = leyendo; false = cámara detenida (por ejemplo, mientras
//             se procesa lo que se leyó)
//   alLeer:   recibe el texto del QR
//   children: lo que se dibuja encima del video (resultado, "Registrando…")
export default function CamaraQr({ activa, alLeer, children }) {
  const video = useRef(null)
  const escaner = useRef(null)
  const alLeerActual = useRef(alLeer)
  const [estado, setEstado] = useState('iniciando') // iniciando | lista | error
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)

  // El escáner se crea una vez; así siempre llama a la versión más nueva de alLeer.
  useEffect(() => {
    alLeerActual.current = alLeer
  }, [alLeer])

  useEffect(() => {
    const qr = new QrScanner(video.current, (lectura) => alLeerActual.current(lectura.data), {
      returnDetailedScanResult: true,
      preferredCamera: 'environment', // la cámara de atrás
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 10,
    })
    escaner.current = qr
    return () => {
      escaner.current = null
      qr.destroy()
    }
  }, [])

  useEffect(() => {
    const qr = escaner.current
    if (!qr) return
    if (!activa) {
      qr.stop()
      return
    }
    // Si la pantalla se cierra mientras la cámara arranca, se ignora el resultado.
    let cancelado = false
    setEstado('iniciando')
    qr.start()
      .then(() => !cancelado && setEstado('lista'))
      .catch((e) => {
        if (cancelado) return
        setEstado('error')
        setError(
          String(e?.name ?? e).includes('NotAllowed')
            ? 'Permite el acceso a la cámara: toca el ícono junto a la dirección (o ve a Ajustes del navegador) y elige «Permitir».'
            : 'No se pudo abrir la cámara de este celular.',
        )
      })
    return () => {
      cancelado = true
    }
  }, [activa, intento])

  return (
    // "relative" es necesario para el recuadro guía que dibuja qr-scanner.
    <div className="relative aspect-square overflow-hidden rounded-3xl bg-black">
      <video ref={video} className="h-full w-full object-cover" muted playsInline />

      {activa && estado === 'iniciando' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-lg text-white">
          <Spinner className="size-8" />
          Abriendo cámara…
        </div>
      )}

      {activa && estado === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setIntento((n) => n + 1)}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-slate-900"
          >
            Intentar de nuevo
          </button>
        </div>
      )}

      {children}
    </div>
  )
}
