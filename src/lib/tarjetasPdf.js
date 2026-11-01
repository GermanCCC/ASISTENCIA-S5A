// Genera el PDF con las tarjetas de activación: 10 por hoja tamaño carta
// (2 columnas × 5 filas), con líneas punteadas para recortarlas.
//
// Cada tarjeta lleva nombre, número de control, código y un QR con el
// enlace de activación. Al escanear el QR, el alumno llega a /activar con
// el código ya escrito; solo le falta su número de control.

// qrcode se importa normal: la app ya lo trae para dibujar los QR del pase
// de lista y de activación, así que cargarlo "bajo demanda" no ahorraba nada.
import QRCode from 'qrcode'

// Medidas en milímetros (hoja carta: 215.9 × 279.4)
const HOJA = { ancho: 215.9, alto: 279.4 }
const MARGEN = 10
const COLUMNAS = 2
const FILAS = 5
const SEPARACION = 4
const TARJETA = {
  ancho: (HOJA.ancho - 2 * MARGEN - (COLUMNAS - 1) * SEPARACION) / COLUMNAS,
  alto: (HOJA.alto - 2 * MARGEN - (FILAS - 1) * SEPARACION) / FILAS,
}
const QR = 30
const RELLENO = 5

// "ABCDEFGH" → "ABCD-EFGH"
export function formatearCodigo(codigo) {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`
}

// tarjetas: [{ nombre, numero_control, codigo }]
export async function generarPdfTarjetas({ grupo, tarjetas, urlBase }) {
  // jspdf se carga solo al generar el PDF (pesa bastante y casi nunca se usa).
  const { jsPDF } = await import('jspdf')

  // compress: sin esto, cada QR se guarda sin comprimir y el PDF pesa megas.
  const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true })
  const host = new URL(urlBase).host
  const encabezado = [grupo.nombre, grupo.materia].filter(Boolean).join(' · ')

  for (const [i, tarjeta] of tarjetas.entries()) {
    const posicion = i % (COLUMNAS * FILAS)
    if (i > 0 && posicion === 0) doc.addPage()

    const x = MARGEN + (posicion % COLUMNAS) * (TARJETA.ancho + SEPARACION)
    const y = MARGEN + Math.floor(posicion / COLUMNAS) * (TARJETA.alto + SEPARACION)
    const codigo = formatearCodigo(tarjeta.codigo)
    const enlace = `${urlBase}/activar?codigo=${codigo}`

    // Contorno punteado para recortar
    doc.setLineDashPattern([1.5, 1.5], 0)
    doc.setDrawColor(150)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, TARJETA.ancho, TARJETA.alto, 3, 3)
    doc.setLineDashPattern([], 0)

    // QR a la derecha
    const qrX = x + TARJETA.ancho - RELLENO - QR
    const qrY = y + RELLENO
    // 240 px en 30 mm ≈ 200 ppp: nítido al imprimir y ligero.
    const imagenQr = await QRCode.toDataURL(enlace, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
    doc.addImage(imagenQr, 'PNG', qrX, qrY, QR, QR, undefined, 'FAST')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(110)
    doc.text('Escanéame con tu celular', qrX + QR / 2, qrY + QR + 4, { align: 'center' })

    // Texto a la izquierda
    const textoX = x + RELLENO
    const anchoTexto = qrX - textoX - 4
    let cursorY = y + RELLENO + 2.5

    doc.setFontSize(7.5)
    doc.setTextColor(110)
    doc.text(doc.splitTextToSize(encabezado, anchoTexto)[0], textoX, cursorY)

    cursorY += 5.5
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20)
    // El nombre completo debe caber en 2 renglones: si no cabe, se va
    // reduciendo la letra (nunca se corta el nombre).
    let tamano = 10.5
    let renglonesNombre
    do {
      doc.setFontSize(tamano)
      renglonesNombre = doc.splitTextToSize(tarjeta.nombre, anchoTexto)
      tamano -= 0.5
    } while (renglonesNombre.length > 2 && tamano >= 6)
    doc.text(renglonesNombre, textoX, cursorY)
    cursorY += renglonesNombre.length * 4.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(70)
    doc.text(
      tarjeta.numero_control ? `No. de control: ${tarjeta.numero_control}` : 'No. de control: lo escribes al activar',
      textoX,
      cursorY,
    )

    // Código grande, en letra de ancho fijo para que se lea bien
    cursorY += 7
    doc.setFontSize(7)
    doc.setTextColor(110)
    doc.text('CÓDIGO DE ACTIVACIÓN', textoX, cursorY)
    cursorY += 7
    doc.setFont('courier', 'bold')
    doc.setFontSize(19)
    doc.setTextColor(20)
    doc.text(codigo, textoX, cursorY)

    // Instrucción alternativa (si el QR no se puede escanear)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(110)
    doc.text(`o entra a ${host}/activar`, textoX, y + TARJETA.alto - RELLENO)
  }

  doc.save(`tarjetas-activacion-${grupo.nombre.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`)
}
