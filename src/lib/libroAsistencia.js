import { ZONA_HORARIA } from './fechas.js'
import { ESTADOS, resumirGrupo } from './estadisticas.js'

// Arma el Excel de asistencia de un grupo con dos hojas:
//   "Lista":   alumnos en filas, una columna por clase, con P / R / F / J
//   "Resumen": conteos y porcentaje de cada alumno, en riesgo resaltados
//
// Recibe ExcelJS como parámetro (en vez de importarlo aquí) para que este
// archivo funcione igual en el navegador y en las pruebas con Node.
//   datos: { grupo, resumen, sesiones } (ver datosGrupo.js)
//   generado: fecha en que se genera (Date)

// Relleno de cada estado (los mismos tonos claros de la app).
const RELLENOS = {
  presente: 'FFDCFCE7',
  retardo: 'FFFEF3C7',
  falta: 'FFFEE2E2',
  justificada: 'FFE0F2FE',
}
const RELLENO_ENCABEZADO = 'FFE0E7FF'
const RELLENO_RIESGO = 'FFFEE2E2'

const formatoDia = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, day: '2-digit', month: '2-digit' })
const formatoHora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hour12: false })
const formatoGenerado = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, dateStyle: 'long', timeStyle: 'short' })

const rellenar = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const bordeFino = { style: 'thin', color: { argb: 'FFCBD5E1' } }
const BORDES = { top: bordeFino, left: bordeFino, bottom: bordeFino, right: bordeFino }

export function crearLibroAsistencia(ExcelJS, { grupo, resumen, sesiones }, generado = new Date()) {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Pase de Lista'
  libro.created = generado

  // Alumnos: los activos y los dados de baja que sí tienen registros
  // (su historial no se pierde). resumen ya viene ordenado por nombre.
  const alumnos = resumen.filter((r) => r.activo || r.total_clases > 0)
  const titulo = [grupo.nombre, grupo.materia, grupo.periodo].filter(Boolean).join(' · ')
  const nombreDe = (a) => (a.activo ? a.nombre : `${a.nombre} (baja)`)

  // ---------------- Hoja "Lista" ----------------
  const lista = libro.addWorksheet('Lista', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] })
  lista.getCell('A1').value = `Lista de asistencia — ${titulo}`
  lista.getCell('A1').font = { bold: true, size: 14 }
  lista.getCell('A2').value =
    `Generada el ${formatoGenerado.format(generado)} · P = presente, R = retardo, F = falta, J = justificada`
  lista.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } }

  // Encabezado: fecha y hora de cada clase en dos renglones de la celda.
  const encabezado = lista.getRow(4)
  encabezado.values = [
    '#',
    'Número de control',
    'Nombre',
    ...sesiones.map((s) => `${formatoDia.format(new Date(s.abierta_en))}\n${formatoHora.format(new Date(s.abierta_en))}`),
  ]
  encabezado.height = 32
  encabezado.eachCell((celda) => {
    celda.font = { bold: true }
    celda.fill = rellenar(RELLENO_ENCABEZADO)
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    celda.border = BORDES
  })

  // Estado de cada alumno en cada clase: sesion → (alumno → estado)
  const estados = new Map(sesiones.map((s) => [s.id, new Map(s.asistencias.map((a) => [a.alumno_id, a.estado]))]))

  alumnos.forEach((alumno, i) => {
    const fila = lista.getRow(5 + i)
    fila.values = [
      i + 1,
      alumno.numero_control ?? '',
      nombreDe(alumno),
      // Sin registro (por ejemplo, lo dieron de alta después de esa clase): "—"
      ...sesiones.map((s) => ESTADOS[estados.get(s.id).get(alumno.alumno_id)]?.letra ?? '—'),
    ]
    fila.eachCell({ includeEmpty: true }, (celda, columna) => {
      celda.border = BORDES
      if (columna > 3) {
        celda.alignment = { horizontal: 'center' }
        const estado = sesiones[columna - 4] && estados.get(sesiones[columna - 4].id).get(alumno.alumno_id)
        if (RELLENOS[estado]) celda.fill = rellenar(RELLENOS[estado])
        else celda.font = { color: { argb: 'FF94A3B8' } }
      }
    })
  })

  lista.getColumn(1).width = 5
  lista.getColumn(2).width = 18
  lista.getColumn(3).width = 36
  sesiones.forEach((_, i) => {
    lista.getColumn(4 + i).width = 7
  })

  // ---------------- Hoja "Resumen" ----------------
  const hoja = libro.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 4 }] })
  const general = resumirGrupo(resumen)
  hoja.getCell('A1').value = `Resumen de asistencia — ${titulo}`
  hoja.getCell('A1').font = { bold: true, size: 14 }
  hoja.getCell('A2').value =
    `${sesiones.length} ${sesiones.length === 1 ? 'clase' : 'clases'} · asistencia general del grupo: ` +
    (general.porcentaje == null ? 'sin datos' : `${general.porcentaje}%`) +
    ` · mínimo: ${grupo.porcentaje_minimo_asistencia}%`
  hoja.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } }

  const titulos = hoja.getRow(4)
  titulos.values = ['#', 'Número de control', 'Nombre', 'Clases', 'Presentes', 'Retardos', 'Faltas', 'Justificadas', 'Asistencia', 'En riesgo']
  titulos.eachCell((celda) => {
    celda.font = { bold: true }
    celda.fill = rellenar(RELLENO_ENCABEZADO)
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    celda.border = BORDES
  })

  alumnos.forEach((a, i) => {
    const fila = hoja.getRow(5 + i)
    fila.values = [
      i + 1,
      a.numero_control ?? '',
      nombreDe(a),
      a.total_clases,
      a.presentes,
      a.retardos,
      a.faltas,
      a.justificadas,
      // Se guarda como fracción (0.875) con formato de porcentaje, para que
      // en Excel se pueda ordenar y promediar como número.
      a.porcentaje == null ? '' : a.porcentaje / 100,
      a.en_riesgo ? 'Sí' : 'No',
    ]
    fila.getCell(9).numFmt = '0.0%'
    fila.eachCell({ includeEmpty: true }, (celda, columna) => {
      celda.border = BORDES
      if (columna > 3) celda.alignment = { horizontal: 'center' }
      if (a.en_riesgo) celda.fill = rellenar(RELLENO_RIESGO)
    })
    if (a.en_riesgo) fila.getCell(10).font = { bold: true, color: { argb: 'FFB91C1C' } }
  })

  const nota = hoja.getRow(6 + alumnos.length)
  nota.getCell(1).value =
    'Cuentan como asistencia: presente, retardo y justificada. Solo se cuentan las listas cerradas.'
  nota.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } }

  ;[5, 18, 36, 9, 11, 10, 9, 13, 12, 11].forEach((ancho, i) => {
    hoja.getColumn(i + 1).width = ancho
  })

  return libro
}

// Nombre del archivo: "Asistencia S5A Programación Web 2026-10-08.xlsx"
// (sin los caracteres que Windows no acepta en nombres de archivo).
export function nombreArchivoAsistencia(grupo, fechaHoy) {
  const base = ['Asistencia', grupo.nombre, grupo.materia].filter(Boolean).join(' ')
  return `${base.replace(/[\\/:*?"<>|]/g, '').trim()} ${fechaHoy}.xlsx`
}
