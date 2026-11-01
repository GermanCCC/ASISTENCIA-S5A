import { useEffect, useRef, useState } from 'react'
import { useAhora } from '../hooks/useAhora.js'
import { Boton, Spinner } from './ui.jsx'

// La foto se reduce a 640 px de lado (~60 KB): suficiente para reconocer
// a alguien y rápida de subir con datos móviles.
const LADO = 640

// Cámara frontal para la selfie del registro.
//   limite:      hasta cuándo vale el pase de selfie (hora local, ms)
//   alCapturar:  recibe la foto (Blob JPEG). Si algo sale mal devuelve el
//                mensaje del problema, y aquí se deja intentar de nuevo.
//   alCancelar:  volver a escanear
//
// A propósito no hay opción de elegir una foto de la galería: tiene que
// ser una foto tomada en ese momento.
export default function CamaraSelfie({ limite, alCapturar, alCancelar }) {
  const video = useRef(null)
  const [estado, setEstado] = useState('iniciando') // iniciando | lista | enviando | error
  const [problema, setProblema] = useState('')
  const ahora = useAhora(500)

  useEffect(() => {
    let flujo
    let cancelado = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } }, audio: false })
      .then(async (s) => {
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        flujo = s
        video.current.srcObject = s
        await video.current.play().catch(() => {})
        setEstado('lista')
      })
      .catch((e) => {
        if (cancelado) return
        setEstado('error')
        setProblema(
          e?.name === 'NotAllowedError'
            ? 'Permite el acceso a la cámara para tomarte la selfie.'
            : 'No se pudo abrir la cámara frontal.',
        )
      })
    return () => {
      cancelado = true
      // Apagar la cámara al salir (si no, el foco verde del celular sigue prendido).
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function tomar() {
    setEstado('enviando')
    setProblema('')
    const foto = await capturar(video.current)
    const resultado = await alCapturar(foto)
    if (resultado) {
      setProblema(resultado)
      setEstado('lista')
    }
  }

  const restante = Math.max(0, Math.ceil((limite - ahora) / 1000))

  if (restante === 0 && estado !== 'enviando') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <p className="text-xl font-semibold">Se acabó el tiempo para la selfie</p>
        <Boton onClick={alCancelar} className="w-full py-4 text-lg">
          Escanear de nuevo
        </Boton>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-black">
        {/* Se ve como espejo (más natural), pero la foto se guarda normal. */}
        <video ref={video} className="h-full w-full -scale-x-100 object-cover" muted playsInline />
        {(estado === 'iniciando' || estado === 'enviando') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-lg text-white">
            <Spinner className="size-8" />
            {estado === 'enviando' ? 'Registrando…' : 'Abriendo cámara…'}
          </div>
        )}
        <span className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 font-mono text-white tabular-nums">
          {restante} s
        </span>
      </div>

      {problema && <p className="text-center font-medium text-red-600 dark:text-red-400">{problema}</p>}

      <Boton onClick={tomar} disabled={estado !== 'lista'} className="w-full py-5 text-xl">
        Tomar selfie
      </Boton>
      <button type="button" onClick={alCancelar} className="text-sm font-medium text-slate-600 dark:text-slate-400">
        Cancelar
      </button>
    </div>
  )
}

// Recorta el centro del video en un cuadrado de 640 px y lo convierte a JPEG.
function capturar(elementoVideo) {
  const { videoWidth: ancho, videoHeight: alto } = elementoVideo
  const lado = Math.min(ancho, alto)
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.min(LADO, lado)
  lienzo.height = lienzo.width
  lienzo
    .getContext('2d')
    .drawImage(elementoVideo, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, lienzo.width, lienzo.height)
  return new Promise((resolve) => lienzo.toBlob(resolve, 'image/jpeg', 0.75))
}
