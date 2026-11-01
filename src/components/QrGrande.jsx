import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// QR rotativo grande con la barra que muestra cuándo cambia.
// Se dibuja como SVG: se ve nítido a cualquier tamaño, también proyectado.
// Siempre negro sobre blanco, aunque esté el modo oscuro: los lectores de
// QR necesitan ese contraste.
//   siguienteCambio: cuándo cambia el QR, en hora LOCAL (ms)
//   duracion:        cada cuánto cambia el QR en ms (la da useTokenQr:
//                    5 s el pase de lista, 10 s la activación)
export default function QrGrande({ token, siguienteCambio, duracion, ancho, etiqueta }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    if (!token) return
    QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }).then(setSvg)
  }, [token])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="aspect-square rounded-3xl bg-white p-3 shadow-sm [&>svg]:h-full [&>svg]:w-full"
        style={{ width: ancho }}
        role="img"
        aria-label={etiqueta}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" style={{ maxWidth: ancho }}>
        {/* key: con cada QR nuevo la barra se crea de nuevo y arranca vacía */}
        {token && siguienteCambio && <Barra key={token} siguienteCambio={siguienteCambio} duracion={duracion} />}
      </div>
    </div>
  )
}

// Barra que se llena y queda completa justo cuando cambia el QR.
// La anima el navegador (animación CSS "llenar-barra-qr" en index.css):
// es continua y no depende de un temporizador de React, así que no se
// atrasa. Si el QR ya llevaba un rato en pantalla (por ejemplo, al abrir
// la página), el retraso negativo hace que arranque por donde va.
function Barra({ siguienteCambio, duracion }) {
  const [transcurrido] = useState(() => Math.min(duracion, Math.max(0, duracion - (siguienteCambio - Date.now()))))
  return (
    <div
      className="h-full rounded-full bg-indigo-600"
      style={{ animation: `llenar-barra-qr ${duracion}ms linear -${transcurrido}ms forwards` }}
    />
  )
}
