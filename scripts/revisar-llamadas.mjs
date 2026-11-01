// Revisa que cada llamada a una función de la base de datos (.rpc) use
// exactamente los parámetros que esa función tiene en las migraciones.
//
// Uso:  npm run revisar:llamadas
//
// Existe porque un nombre de parámetro equivocado no falla al compilar:
// solo falla cuando la app ya está publicada ("Could not find the function").
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

async function archivos(carpeta, extension) {
  const entradas = await readdir(join(RAIZ, carpeta), { recursive: true, withFileTypes: true })
  return entradas
    .filter((e) => e.isFile() && e.name.endsWith(extension))
    .map((e) => join(e.parentPath ?? e.path, e.name))
}

// 1. Firmas de las funciones públicas según las migraciones (la última
//    definición gana). Los parámetros con "default" son opcionales.
const firmas = new Map()
for (const ruta of (await archivos('supabase/migrations', '.sql')).sort()) {
  const sql = await readFile(ruta, 'utf8')
  for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([^)]*)\)/gi)) {
    const parametros = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ nombre: p.split(/\s+/)[0], opcional: /\bdefault\b/i.test(p) }))
    firmas.set(m[1], parametros)
  }
}

// 2. Llamadas en el código: .rpc('f', {...}), llamar('f', {...}) en las
//    Edge Functions y useTokenQr('f', 'parametro', ...).
const fuentes = [
  ...(await archivos('src', '.js')),
  ...(await archivos('src', '.jsx')),
  ...(await archivos('supabase/functions', '.js')),
  ...(await archivos('scripts', '.mjs')),
].filter((ruta) => !ruta.endsWith('revisar-llamadas.mjs'))

const llamadas = []
for (const ruta of fuentes) {
  const codigo = await readFile(ruta, 'utf8')
  // Después del nombre puede venir: ")" = sin parámetros; ", {...}" = un
  // objeto que sí se revisa; ", variable" = no se puede revisar aquí.
  for (const m of codigo.matchAll(/(?:\.rpc|llamar)\(\s*'(\w+)'\s*(\)|,\s*\{([^}]*)\}|,)/g)) {
    if (m[2] === ',' || m[3]?.includes('...')) continue
    // Solo nombres al inicio de cada propiedad ("p_lat: ..."), no el ":" de
    // un "condición ? a : b" dentro del valor.
    const claves = m[3] ? [...m[3].matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((c) => c[1]) : []
    llamadas.push({ ruta, funcion: m[1], claves })
  }
  for (const m of codigo.matchAll(/useTokenQr\(\s*'(\w+)',\s*'(\w+)'/g)) {
    llamadas.push({ ruta, funcion: m[1], claves: [m[2]] })
  }
}

// 3. Comparar.
let problemas = 0
for (const { ruta, funcion, claves } of llamadas) {
  const relativa = ruta.slice(RAIZ.length)
  const esperados = firmas.get(funcion)
  if (!esperados) {
    console.log(`✗ ${relativa}: la función "${funcion}" no existe en las migraciones`)
    problemas++
    continue
  }
  const sobran = claves.filter((c) => !esperados.some((p) => p.nombre === c))
  const faltan = esperados.filter((p) => !p.opcional && !claves.includes(p.nombre))
  if (sobran.length || faltan.length) {
    const firma = esperados.map((p) => (p.opcional ? `[${p.nombre}]` : p.nombre)).join(', ')
    console.log(`✗ ${relativa}: ${funcion}(${claves.join(', ')}) — la función espera (${firma})`)
    problemas++
  }
}

console.log(`${llamadas.length} llamadas revisadas, ${problemas} con problemas`)
process.exitCode = problemas ? 1 : 0
