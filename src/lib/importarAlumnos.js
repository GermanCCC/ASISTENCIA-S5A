// Importación de la lista de alumnos desde Excel (.xlsx) o CSV.
//
// El proceso tiene tres pasos, cada uno en su función:
//   1. leerArchivo:      archivo → filas de texto (sin importar el formato)
//   2. interpretarFilas: filas → [{ nombre, numero_control }] (encuentra las columnas)
//   3. revisarImportacion: marca cuáles se pueden importar y por qué no las demás
import { claveNombre, limpiarNombre, limpiarNumeroControl, problemaNumeroControl, quitarAcentos } from './texto.js'

// ---------------------------------------------------------------------
// 1. Leer el archivo
// ---------------------------------------------------------------------
export async function leerArchivo(archivo) {
  const extension = archivo.name.split('.').pop().toLowerCase()

  if (extension === 'xlsx') return leerExcel(await archivo.arrayBuffer())
  if (extension === 'csv' || extension === 'txt') return leerCsv(await decodificarTexto(archivo))
  if (extension === 'xls') {
    throw new Error('Los archivos .xls (Excel antiguo) no se pueden leer. Ábrelo en Excel y guárdalo como .xlsx o .csv.')
  }
  throw new Error('Formato no soportado. Usa un archivo .xlsx o .csv.')
}

// Excel en Windows guarda los CSV en "ANSI" (windows-1252), no en UTF-8.
// Si se leyera todo como UTF-8, "MARTÍNEZ" saldría como "MART�NEZ".
// Por eso se intenta UTF-8 en modo estricto y, si falla, windows-1252.
async function decodificarTexto(archivo) {
  const bytes = await archivo.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// Lector de CSV sencillo pero correcto: respeta comillas ("Pérez, Juan"),
// comillas dobles escapadas ("") y saltos de línea de Windows (\r\n).
// Excel en español separa con ";" en vez de ",", así que el separador se
// detecta viendo cuál aparece más en la primera línea.
export function leerCsv(texto) {
  const primeraLinea = texto.split(/\r?\n/, 1)[0]
  const contar = (caracter) => primeraLinea.split(caracter).length - 1
  const separador = [';', '\t'].reduce((mejor, s) => (contar(s) > contar(mejor) ? s : mejor), ',')

  const filas = []
  let fila = []
  let celda = ''
  let dentroDeComillas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (dentroDeComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"'
        i++
      } else if (c === '"') {
        dentroDeComillas = false
      } else {
        celda += c
      }
    } else if (c === '"') {
      dentroDeComillas = true
    } else if (c === separador) {
      fila.push(celda)
      celda = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
    } else {
      celda += c
    }
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }
  return filas
}

async function leerExcel(bytes) {
  // exceljs pesa bastante; se carga solo cuando de verdad se abre un Excel,
  // así no hace más lenta la app para los alumnos.
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(bytes)
  const hoja = libro.worksheets[0]
  if (!hoja) return []

  const filas = []
  hoja.eachRow({ includeEmpty: false }, (renglon) => {
    const valores = []
    // cell.text da el texto tal como se ve en Excel, aunque la celda sea
    // número, fórmula o texto con formato.
    renglon.eachCell({ includeEmpty: true }, (celda, columna) => {
      valores[columna - 1] = celda.text ?? ''
    })
    filas.push(Array.from(valores, (v) => v ?? ''))
  })
  return filas
}

// ---------------------------------------------------------------------
// 2. Encontrar las columnas de nombre y número de control
// ---------------------------------------------------------------------

// Encabezados reconocidos, ya sin acentos, espacios ni signos:
// "No. de Control" → "nodecontrol", "Número de control" → "numerodecontrol".
const ENCABEZADOS_NOMBRE = ['nombre', 'nombres', 'nombrecompleto', 'alumno', 'nombredelalumno', 'estudiante']
const ENCABEZADOS_CONTROL = [
  'numerocontrol', 'numerodecontrol', 'nocontrol', 'nodecontrol', 'numcontrol',
  'control', 'matricula', 'nc',
]

// Un número de control: 6 a 10 dígitos, opcionalmente con una letra al
// inicio (ej. 21330123 o C21330123).
const PARECE_CONTROL = /^[A-Z]?\d{6,10}$/i

const claveEncabezado = (texto) => quitarAcentos(texto).toLowerCase().replace(/[^a-z0-9]/g, '')

export function interpretarFilas(filasCrudas) {
  // Se recuerda el número de renglón original para poder decirle al
  // profesor "el renglón 7 no tiene nombre".
  const filas = filasCrudas
    .map((celdas, i) => ({ renglon: i + 1, celdas: celdas.map((c) => String(c ?? '').trim()) }))
    .filter((f) => f.celdas.some((c) => c !== ''))

  if (filas.length === 0) throw new Error('El archivo está vacío.')

  // ¿La primera fila es un encabezado?
  const encabezado = filas[0].celdas.map(claveEncabezado)
  let colNombre = encabezado.findIndex((c) => ENCABEZADOS_NOMBRE.includes(c))
  let colControl = encabezado.findIndex((c) => ENCABEZADOS_CONTROL.includes(c))
  const datos = colNombre >= 0 || colControl >= 0 ? filas.slice(1) : filas

  // Sin encabezado reconocible: se adivina por el contenido.
  if (colNombre < 0) {
    const totalColumnas = Math.max(...datos.map((f) => f.celdas.length))
    const columnas = Array.from({ length: totalColumnas }, (_, i) => datos.map((f) => f.celdas[i] ?? ''))

    if (colControl < 0) {
      // La columna donde casi todo (80%+) parece número de control.
      colControl = columnas.findIndex((valores) => {
        const llenos = valores.filter((v) => v !== '')
        return llenos.length > 0 && llenos.filter((v) => PARECE_CONTROL.test(v)).length / llenos.length >= 0.8
      })
    }
    // El nombre es la columna (que no sea la de control) con más letras.
    let masLetras = 0
    columnas.forEach((valores, i) => {
      if (i === colControl) return
      const letras = valores.join('').replace(/[^\p{L}]/gu, '').length
      if (letras > masLetras) {
        masLetras = letras
        colNombre = i
      }
    })
  }

  if (colNombre < 0) {
    throw new Error('No encontré la columna de nombres. Pon un encabezado "nombre" en la primera fila.')
  }

  return datos.map((f) => ({
    renglon: f.renglon,
    nombre: limpiarNombre(f.celdas[colNombre]),
    numero_control: colControl >= 0 ? limpiarNumeroControl(f.celdas[colControl]) : null,
  }))
}

// ---------------------------------------------------------------------
// 3. Revisar contra los alumnos que ya están en el grupo
// ---------------------------------------------------------------------
// Devuelve cada fila con `problema` = null (se importa) o el motivo por el
// que se omite. Así importar dos veces el mismo archivo no duplica nada.
export function revisarImportacion(filas, existentes) {
  const controlesDelGrupo = new Set(existentes.map((a) => a.numero_control).filter(Boolean))
  const nombresDelGrupo = new Set(existentes.map((a) => claveNombre(a.nombre)))
  const controlesVistos = new Set()
  const nombresVistos = new Set()

  return filas.map((fila) => {
    const nombre = claveNombre(fila.nombre)
    let problema = null

    if (!fila.nombre) problema = 'Sin nombre'
    // Se omite en vez de importarlo sin número: así el profesor corrige el
    // archivo y no se pierde el dato sin darse cuenta.
    else if (problemaNumeroControl(fila.numero_control)) problema = problemaNumeroControl(fila.numero_control)
    else if (fila.numero_control && controlesDelGrupo.has(fila.numero_control))
      problema = 'Ese número de control ya está en el grupo'
    else if (fila.numero_control && controlesVistos.has(fila.numero_control))
      problema = 'Número de control repetido en el archivo'
    else if (nombresDelGrupo.has(nombre)) problema = 'Ya está en el grupo'
    else if (nombresVistos.has(nombre)) problema = 'Nombre repetido en el archivo'

    if (!problema) {
      nombresVistos.add(nombre)
      if (fila.numero_control) controlesVistos.add(fila.numero_control)
    }
    return { ...fila, problema }
  })
}
