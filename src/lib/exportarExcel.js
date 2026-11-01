import { cargarDatosGrupo } from './datosGrupo.js'
import { crearLibroAsistencia, nombreArchivoAsistencia } from './libroAsistencia.js'
import { hoyEnHermosillo } from './fechas.js'

// Descarga el Excel de asistencia del grupo (ver libroAsistencia.js).
export async function exportarExcel(grupo) {
  // exceljs pesa ~900 KB: se carga solo cuando el profesor exporta.
  const [{ default: ExcelJS }, datos] = await Promise.all([import('exceljs'), cargarDatosGrupo(grupo.id)])
  const libro = crearLibroAsistencia(ExcelJS, { grupo, ...datos })
  const contenido = await libro.xlsx.writeBuffer()

  const archivo = new Blob([contenido], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const enlace = document.createElement('a')
  enlace.href = URL.createObjectURL(archivo)
  enlace.download = nombreArchivoAsistencia(grupo, hoyEnHermosillo())
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  // Se libera un poco después: algunos navegadores todavía están leyendo el archivo.
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000)
}
