// =====================================================================
// Pruebas de la fase 7 (ubicación y selfie), contra el Supabase REAL.
//
// Uso:  npm run prueba:fase7
//
// Pide tu correo y contraseña de profesor (no se guardan ni se muestran).
// Crea un grupo temporal que pide selfie y ubicación, activa 2 alumnos de
// prueba con tarjeta, abre una lista y prueba el flujo completo con el
// Storage real. Al terminar BORRA el grupo aunque alguna prueba falle.
//
// Quedan rastros: los usuarios de Auth de prueba (...@alumnos.invalid) y
// 2 fotos de prueba de unos bytes en el bucket "selfies" (nadie puede
// borrarlas desde la app; la limpieza automática las quita a los 30 días).
// =====================================================================
import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { preguntar, preguntarOculto } from './terminal.mjs'

const URL_SUPABASE = process.env.VITE_SUPABASE_URL
const LLAVE = process.env.VITE_SUPABASE_ANON_KEY
if (!URL_SUPABASE || !LLAVE) {
  console.error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el .env')
  process.exit(1)
}

const nuevoCliente = () =>
  createClient(URL_SUPABASE, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } })

let correctas = 0
let fallidas = 0
function revisar(nombre, ok, detalle) {
  if (ok) correctas++
  else fallidas++
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `  → ${JSON.stringify(detalle)}`}`)
}
function exigir({ data, error }, paso) {
  if (error) throw new Error(`${paso}: ${error.message}`)
  return data
}

const anon = nuevoCliente()
async function funcion(nombre, cuerpo) {
  const { data, error } = await anon.functions.invoke(nombre, { body: cuerpo })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    const respuesta = await error.context.json().catch(() => null)
    return { ...(respuesta ?? { codigo: 'http' }), estado: error.context.status }
  }
  return { codigo: 'error_red', mensaje: error.message }
}

// Unos bytes con encabezado JPEG: para Storage basta el tipo declarado.
const FOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9])
const SALON = { lat: 29.0729, lng: -110.9559 }

// ---------------------------------------------------------------------
const correo = process.env.PROFESOR_CORREO || (await preguntar('Correo del profesor: '))
const contrasena = process.env.PROFESOR_CONTRASENA || (await preguntarOculto('Contraseña: '))

const profe = nuevoCliente()
const login = await profe.auth.signInWithPassword({ email: correo, password: contrasena })
if (login.error) {
  console.error(`No se pudo iniciar sesión: ${login.error.message}`)
  process.exitCode = 1
} else {
  console.log('Sesión de profesor iniciada.\n')
  await correrPruebas()
}

async function correrPruebas() {
  const grupo = exigir(
    await profe
      .from('grupos')
      .insert({
        nombre: `PRUEBA-AUTO-${Date.now()}`,
        materia: 'Prueba automática',
        requiere_selfie: true,
        requiere_ubicacion: true,
        lat: SALON.lat,
        lng: SALON.lng,
        radio_m: 50,
      })
      .select('id, nombre')
      .single(),
    'Crear grupo de prueba',
  )
  console.log(`Grupo temporal: ${grupo.nombre}`)

  try {
    // --- Dos alumnos activados con tarjeta (como en la fase 4) ---
    const sufijo = String(Date.now() % 1e6).padStart(6, '0')
    const alumnos = exigir(
      await profe
        .from('alumnos')
        .insert([
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA A', numero_control: `66${sufijo}1` },
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA B', numero_control: `66${sufijo}2` },
        ])
        .select('id, nombre, numero_control'),
      'Crear alumnos',
    ).sort((x, y) => x.nombre.localeCompare(y.nombre))
    const codigos = exigir(
      await profe.rpc('generar_codigos_activacion', { p_grupo_id: grupo.id, p_alumno_ids: alumnos.map((a) => a.id) }),
      'Generar códigos',
    )
    const cel = {}
    const cliente = {}
    for (const [letra, alumno] of [['A', alumnos[0]], ['B', alumnos[1]]]) {
      cel[letra] = randomUUID()
      const r = await funcion('activar-alumno', {
        codigo: codigos.find((c) => c.alumno_id === alumno.id).codigo,
        numero_control: alumno.numero_control,
        device_id: cel[letra],
        user_agent: 'prueba-fase7',
      })
      if (r.codigo !== 'ok') throw new Error(`No se pudo activar a ${letra}: ${JSON.stringify(r)}`)
      cliente[letra] = nuevoCliente()
      exigir(await cliente[letra].auth.setSession(r.sesion), `Sesión de ${letra}`)
    }
    const [A, B] = alumnos

    const sesion = exigir(await profe.rpc('abrir_sesion', { p_grupo_id: grupo.id }), 'Abrir sesión')
    const token = async () => exigir(await profe.rpc('token_qr_actual', { p_sesion_id: sesion.id }), 'token').token
    const registrar = async (letra, t, extra = {}) =>
      exigir(
        await cliente[letra].rpc('registrar_asistencia', {
          p_token: t,
          p_device_id: cel[letra],
          p_lat: extra.lat ?? null,
          p_lng: extra.lng ?? null,
          p_precision_m: extra.precision ?? null,
          p_selfie_path: extra.selfie ?? null,
        }),
        `Registrar ${letra}`,
      )
    const subir = (letra, ruta, tipo = 'image/jpeg') =>
      cliente[letra].storage.from('selfies').upload(ruta, FOTO, { contentType: tipo, upsert: false })
    const ruta = (alumno) => `${sesion.id}/${alumno.id}/${randomUUID()}.jpg`

    console.log('\nSelfie con el Storage real')
    let r = await registrar('A', await token(), { ...SALON, precision: 15 })
    revisar('al escanear, pide selfie con un pase de 90 s', r.codigo === 'selfie_requerida' && /^S\./.test(r.pase) && r.segundos > 85, r)
    const paseA = r.pase

    let subida = await subir('A', ruta(B))
    revisar('A no puede subir una foto a la carpeta de B', !!subida.error, subida.data)
    subida = await subir('A', ruta(A), 'image/png')
    revisar('el bucket solo acepta JPEG', !!subida.error, subida.data)
    const rutaA = ruta(A)
    subida = await subir('A', rutaA)
    revisar('A sube su selfie a su carpeta', !subida.error, subida.error)

    const descarga = await cliente.A.storage.from('selfies').download(rutaA)
    revisar('A no puede descargar ni su propia foto', !!descarga.error, descarga.data ? 'la descargó' : null)
    const enlaceAlumno = await cliente.B.storage.from('selfies').createSignedUrl(rutaA, 60)
    revisar('otro alumno no puede obtener un enlace a la foto', !!enlaceAlumno.error, enlaceAlumno.data)

    r = await registrar('A', paseA, { ...SALON, precision: 15, selfie: rutaA })
    revisar('pase + foto + en el salón → registrado', r.codigo === 'presente' && r.sospechosa === false, r)

    const enlaceProfe = await profe.storage.from('selfies').createSignedUrl(rutaA, 60)
    revisar('el profesor obtiene un enlace temporal a la foto', !enlaceProfe.error && !!enlaceProfe.data?.signedUrl, enlaceProfe.error)
    if (enlaceProfe.data?.signedUrl) {
      const respuesta = await fetch(enlaceProfe.data.signedUrl)
      const bytes = new Uint8Array(await respuesta.arrayBuffer())
      revisar('el enlace sí descarga la foto', respuesta.ok && bytes.length === FOTO.length, { estado: respuesta.status })
    }

    console.log('\nPase de selfie y ubicación')
    r = await registrar('B', await token())
    revisar('B también recibe su pase', r.codigo === 'selfie_requerida', r)
    const paseB = r.pase
    r = await registrar('B', paseA, { selfie: rutaA })
    revisar('B no puede usar el pase de A', r.codigo === 'qr_invalido', r)
    const rutaB = ruta(B)
    exigir(await subir('B', rutaB), 'Subir foto de B')
    r = await registrar('B', paseB, { selfie: rutaB })
    revisar('B sin compartir ubicación → registrado pero sospechoso', r.codigo === 'presente' && r.sospechosa === true, r)

    const finales = exigir(
      await profe
        .from('asistencias')
        .select('alumno_id, selfie_path, distancia_m, precision_m, motivo_sospecha')
        .eq('sesion_id', sesion.id),
      'Asistencias',
    )
    const de = (alumno) => finales.find((f) => f.alumno_id === alumno.id)
    revisar('se guardan la foto, la distancia y la precisión de A',
      de(A)?.selfie_path === rutaA && de(A)?.distancia_m === 0 && de(A)?.precision_m === 15, de(A))
    revisar('el motivo de B dice que no compartió su ubicación', de(B)?.motivo_sospecha === 'No compartió su ubicación', de(B))

    console.log('\nLimpieza automática')
    const limpieza = await funcion('limpiar-selfies', {})
    // 401 = la función existe pero rechaza la llave pública (un 404 sería que no se desplegó).
    revisar('la limpieza NO se puede ejecutar con la llave pública', limpieza.estado === 401, limpieza)
    const vencidas = await profe.rpc('selfies_vencidas', { p_limite: 1 })
    revisar('el profesor no puede pedir la lista de fotos a borrar', !!vencidas.error, vencidas.data)
  } catch (e) {
    fallidas++
    console.error(`\n✗ La prueba se detuvo: ${e.message}`)
  } finally {
    const { error } = await profe.from('grupos').delete().eq('id', grupo.id)
    console.log(error ? `\nNo se pudo borrar el grupo temporal: ${error.message}` : '\nGrupo temporal borrado.')
  }

  console.log(`\n${correctas} correctas, ${fallidas} fallidas`)
  process.exitCode = fallidas ? 1 : 0
}
