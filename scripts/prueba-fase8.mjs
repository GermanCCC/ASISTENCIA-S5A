// =====================================================================
// Pruebas de la fase 8 (estadísticas y Excel). NO usan Supabase.
//
// Uso:  npm run prueba:fase8
//
// Prueba con datos inventados:
//   1. Los cálculos de src/lib/estadisticas.js (porcentaje del grupo,
//      clases para recuperarse, faltas permitidas).
//   2. El Excel de src/lib/libroAsistencia.js: lo arma con exceljs, lo
//      guarda en memoria, lo vuelve a abrir y revisa sus celdas.
// =====================================================================
import ExcelJS from 'exceljs'
import {
  clasesParaRecuperarse,
  faltasPermitidas,
  formatearPorcentaje,
  resumirGrupo,
} from '../src/lib/estadisticas.js'
import { crearLibroAsistencia, nombreArchivoAsistencia } from '../src/lib/libroAsistencia.js'

let correctas = 0
let fallidas = 0
function revisar(nombre, ok, detalle) {
  if (ok) correctas++
  else fallidas++
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `  → ${JSON.stringify(detalle)}`}`)
}

// ---------------------------------------------------------------------
console.log('Cálculos')

// 7 de 10 con mínimo 80%: (7 + 5) / (10 + 5) = 80%  → 5 clases
revisar('7 de 10 (mín. 80%) → necesita 5 clases seguidas', clasesParaRecuperarse(7, 10, 80) === 5)
// 7 + 4 = 11 de 14 = 78.6%: con 4 todavía no alcanza
revisar('…y con 4 no le alcanzaría', (7 + 4) / (10 + 4) < 0.8)
revisar('si no está en riesgo → 0', clasesParaRecuperarse(9, 10, 80) === 0)
revisar('sin clases → 0', clasesParaRecuperarse(0, 0, 80) === 0)
revisar('mínimo 100% con una falta → imposible (null)', clasesParaRecuperarse(9, 10, 100) === null)
// 9 / (10 + 1) = 81.8% ok; 9 / 12 = 75% ya no → 1
revisar('9 de 10 (mín. 80%) → puede faltar 1', faltasPermitidas(9, 10, 80) === 1)
// 8 / (10 + 0) = 80% exacto: justo en el mínimo, no puede faltar más
revisar('8 de 10 (mín. 80%) → puede faltar 0', faltasPermitidas(8, 10, 80) === 0)
revisar('mínimo 0% → nunca queda en riesgo (null)', faltasPermitidas(1, 10, 0) === null)
revisar('formato de porcentaje', formatearPorcentaje(83.333) === '83.3%' && formatearPorcentaje(null) === '—')

const fila = (nombre, activo, p, r, f, j, extra = {}) => {
  const total = p + r + f + j
  const porcentaje = total ? Math.round((1000 * (p + r + j)) / total) / 10 : null
  return {
    alumno_id: `id-${nombre}`,
    nombre,
    numero_control: extra.numero_control ?? `2233${nombre.length}0`,
    activo,
    total_clases: total,
    presentes: p,
    retardos: r,
    faltas: f,
    justificadas: j,
    porcentaje,
    porcentaje_minimo: 80,
    en_riesgo: porcentaje != null && porcentaje < 80,
  }
}
const resumen = [
  fila('ANA', true, 2, 0, 1, 0), // 66.7% en riesgo
  fila('BETO', true, 1, 1, 0, 1), // 100%
  fila('CARLA', false, 1, 0, 0, 0), // dada de baja con registros
  fila('DANI', false, 0, 0, 0, 0), // dado de baja sin registros: no va en el Excel
  fila('EVA', true, 0, 0, 0, 0, { numero_control: null }), // alta reciente: sin clases
]
const general = resumirGrupo(resumen)
// Activos: ANA 2/3 + BETO 3/3 + EVA 0/0 = 5 / 6 = 83.3%
revisar('porcentaje del grupo suma conteos de los activos', general.porcentaje === 83.3 && general.alumnosActivos === 3, general)
revisar('alumnos en riesgo del grupo', general.enRiesgo === 1, general)

// ---------------------------------------------------------------------
console.log('\nExcel')

const grupo = { nombre: 'S5A', materia: 'Programación Web', periodo: 'AGO-DIC 2026', porcentaje_minimo_asistencia: 80 }
// Tres clases; las horas están en UTC (Hermosillo = UTC-7): 15:05 UTC = 08:05 en Hermosillo.
const sesiones = [
  {
    id: 's1',
    abierta_en: '2026-10-05T15:05:00+00:00',
    asistencias: [
      { alumno_id: 'id-ANA', estado: 'presente' },
      { alumno_id: 'id-BETO', estado: 'retardo' },
      { alumno_id: 'id-CARLA', estado: 'presente' },
    ],
  },
  {
    id: 's2',
    abierta_en: '2026-10-07T15:05:00+00:00',
    asistencias: [
      { alumno_id: 'id-ANA', estado: 'falta' },
      { alumno_id: 'id-BETO', estado: 'justificada' },
    ],
  },
  {
    // 00:30 UTC del día 9 = 17:30 del día 8 en Hermosillo: la fecha debe salir 08/10
    id: 's3',
    abierta_en: '2026-10-09T00:30:00+00:00',
    asistencias: [
      { alumno_id: 'id-ANA', estado: 'presente' },
      { alumno_id: 'id-BETO', estado: 'presente' },
    ],
  },
]

const libro = crearLibroAsistencia(ExcelJS, { grupo, resumen, sesiones }, new Date('2026-10-08T17:00:00Z'))
// Se guarda y se vuelve a abrir, como lo haría Excel.
const leido = new ExcelJS.Workbook()
await leido.xlsx.load(await libro.xlsx.writeBuffer())
const lista = leido.getWorksheet('Lista')
const hoja = leido.getWorksheet('Resumen')
const texto = (h, celda) => String(h.getCell(celda).value ?? '')

revisar('tiene las hojas "Lista" y "Resumen"', !!lista && !!hoja)
revisar('título con grupo, materia y periodo', texto(lista, 'A1') === 'Lista de asistencia — S5A · Programación Web · AGO-DIC 2026', texto(lista, 'A1'))
revisar('encabezado de fecha en hora de Hermosillo', texto(lista, 'D4') === '05/10\n08:05', texto(lista, 'D4'))
revisar('clase de la tarde no se corre al día siguiente', texto(lista, 'F4') === '08/10\n17:30', texto(lista, 'F4'))

const filaDe = (h, nombre) => {
  for (let i = 5; i <= h.rowCount; i++) if (String(h.getCell(`C${i}`).value).startsWith(nombre)) return i
  return null
}
const ana = filaDe(lista, 'ANA')
revisar('ANA: P, F, P', ['D', 'E', 'F'].map((c) => texto(lista, `${c}${ana}`)).join() === 'P,F,P')
const beto = filaDe(lista, 'BETO')
revisar('BETO: R, J, P', ['D', 'E', 'F'].map((c) => texto(lista, `${c}${beto}`)).join() === 'R,J,P')
const carla = filaDe(lista, 'CARLA')
revisar('dada de baja con registros aparece marcada', texto(lista, `C${carla}`) === 'CARLA (baja)')
revisar('sin registro en una clase → "—"', texto(lista, `E${carla}`) === '—')
revisar('dado de baja sin registros no aparece', filaDe(lista, 'DANI') === null)
revisar('alta reciente sin clases sí aparece', filaDe(lista, 'EVA') !== null)
revisar('la falta va con relleno rojo claro', lista.getCell(`E${ana}`).fill?.fgColor?.argb === 'FFFEE2E2')
revisar('columnas y encabezado congelados', lista.views[0]?.state === 'frozen' && lista.views[0].xSplit === 3 && lista.views[0].ySplit === 4)

const anaR = filaDe(hoja, 'ANA')
revisar('Resumen: conteos de ANA', [4, 5, 6, 7, 8].map((c) => hoja.getRow(anaR).getCell(c).value).join() === '3,2,0,1,0')
const pct = hoja.getRow(anaR).getCell(9)
revisar('porcentaje como número con formato %', Math.abs(pct.value - 0.667) < 1e-9 && pct.numFmt === '0.0%', { v: pct.value, f: pct.numFmt })
revisar('ANA marcada en riesgo', hoja.getRow(anaR).getCell(10).value === 'Sí')
revisar('BETO no está en riesgo', hoja.getRow(filaDe(hoja, 'BETO')).getCell(10).value === 'No')
revisar('alumno sin clases: porcentaje vacío', String(hoja.getRow(filaDe(hoja, 'EVA')).getCell(9).value ?? '') === '')
revisar('Resumen dice clases y asistencia general', texto(hoja, 'A2').startsWith('3 clases · asistencia general del grupo: 83.3%'), texto(hoja, 'A2'))

revisar(
  'nombre de archivo sin caracteres inválidos',
  nombreArchivoAsistencia({ nombre: 'S5A', materia: 'Redes: LAN/WAN' }, '2026-10-08') === 'Asistencia S5A Redes LANWAN 2026-10-08.xlsx',
)

console.log(`\n${correctas} correctas, ${fallidas} fallidas`)
process.exitCode = fallidas ? 1 : 0
