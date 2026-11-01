// =====================================================================
// Pruebas de la fase 6 (activación por QR), contra el Supabase REAL.
//
// Uso:  npm run prueba:fase6
//
// Pide tu correo y contraseña de profesor (no se guardan ni se muestran).
// Crea un grupo temporal "PRUEBA-AUTO-..." con 2 alumnos, recorre todo el
// flujo de activación por QR (y el de tarjeta) como lo haría un celular,
// y prueba que un alumno con cuenta se une a una SEGUNDA clase con la misma
// cuenta. Al terminar BORRA los grupos aunque alguna prueba falle.
//
// Queda un rastro: los usuarios de Auth de los alumnos de prueba
// (correos ...@alumnos.invalid), sin datos ni acceso. Se pueden borrar en
// Supabase → Authentication → Users.
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
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

// Igual que src/lib/funciones.js: siempre devuelve { codigo, ... }.
// cliente: con qué sesión se llama (anon = celular sin sesión).
const anon = nuevoCliente()
async function funcion(nombre, cuerpo, cliente = anon) {
  const { data, error } = await cliente.functions.invoke(nombre, { body: cuerpo })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    const respuesta = await error.context.json().catch(() => null)
    if (respuesta) return respuesta
  }
  return { codigo: 'error_red', mensaje: error.message }
}
const qr = (accion, datos) => funcion('activar-por-qr', { accion, ...datos })

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
  let grupo2 = null // la segunda clase ("unirme a otra clase")
  const grupo = exigir(
    await profe
      .from('grupos')
      .insert({ nombre: `PRUEBA-AUTO-${Date.now()}`, materia: 'Prueba automática' })
      .select('id, nombre')
      .single(),
    'Crear grupo de prueba',
  )
  console.log(`Grupo temporal: ${grupo.nombre}`)

  try {
    const sufijo = String(Date.now() % 1e6).padStart(6, '0')
    const [A, B] = exigir(
      await profe
        .from('alumnos')
        .insert([
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA A', numero_control: `88${sufijo}1` },
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA B', numero_control: null },
        ])
        .select('id, nombre, numero_control'),
      'Crear alumnos',
    ).sort((x, y) => x.nombre.localeCompare(y.nombre))
    const secreto = () => randomBytes(32).toString('hex')

    const corto = await profe.from('alumnos').insert({ grupo_id: grupo.id, nombre: 'ALUMNO CORTO', numero_control: '67' })
    revisar('la base de datos no deja guardar un número de control de 2 caracteres',
      corto.error?.message?.includes('alumnos_numero_control_formato'), corto.error)
    const celular = { A: randomUUID(), A2: randomUUID(), B: randomUUID() }

    console.log('\nVentana y QR de activación')
    exigir(await profe.rpc('abrir_activacion', { p_grupo_id: grupo.id }), 'Abrir activación')
    const tokenActivacion = async () =>
      exigir(await profe.rpc('token_activacion_actual', { p_grupo_id: grupo.id }), 'token_activacion_actual').token
    let token = await tokenActivacion()
    revisar('el profesor obtiene el QR de activación', /^A\./.test(token ?? ''), token)

    const directo = await anon.rpc('qr_alumnos_del_grupo', { p_token: token })
    revisar('sin sesión no se pueden llamar las funciones qr_* directamente', !!directo.error, directo.data)

    let r = await qr('listar', { token })
    revisar('el alumno escanea y recibe los nombres y un pase', r.codigo === 'ok' && r.sin_activar.length === 2 && /^P\./.test(r.pase), r)

    // El QR de activación NO cambió a 5 s: sigue cambiando cada 10 s y un QR
    // de hace 12 s todavía vale (el del pase de lista ya no valdría).
    {
      const antes = Date.now()
      const datos = exigir(await profe.rpc('token_activacion_actual', { p_grupo_id: grupo.id }), 'token_activacion_actual')
      const desfase = new Date(datos.ahora).getTime() - (antes + Date.now()) / 2
      const apareceEn = Number(datos.token.split('.')[2]) * 10_000 // hora del servidor (ms)
      const espera = apareceEn + 12_000 - desfase - Date.now()
      process.stdout.write(`  … esperando ${Math.ceil(espera / 1000)} s\n`)
      await new Promise((listo) => setTimeout(listo, Math.max(0, espera)))
      const viejo = await qr('listar', { token: datos.token })
      revisar(
        'el QR de activación sigue cambiando cada 10 s y uno de hace 12 s todavía vale',
        new Date(datos.siguiente_cambio) - new Date(datos.ahora) <= 10_000 && !datos.token_siguiente && viejo.codigo === 'ok',
        viejo,
      )
    }
    revisar('solo se envían id y nombre', r.sin_activar.every((a) => Object.keys(a).sort().join() === 'id,nombre'), r.sin_activar)
    const pase = r.pase

    console.log('\nSolicitud, aprobación y canje')
    const secA = secreto()
    r = await qr('solicitar', {
      pase, alumno_id: A.id, tipo: 'nueva', numero_control: '67', device_id: celular.A, user_agent: 'prueba', secreto: secA,
    })
    revisar('número de control muy corto → dice el largo permitido',
      r.codigo === 'numero_control_longitud' && r.mensaje === 'El número de control debe tener entre 4 y 20 caracteres', r)
    // Formato válido pero no es el suyo: así se prueba la comparación, no la longitud.
    r = await qr('solicitar', {
      pase, alumno_id: A.id, tipo: 'nueva', numero_control: `77${sufijo}9`, device_id: celular.A, user_agent: 'prueba', secreto: secA,
    })
    revisar('número de control equivocado → rechazado', r.codigo === 'numero_control_no_coincide', r)
    const solA = await qr('solicitar', {
      pase, alumno_id: A.id, tipo: 'nueva', numero_control: A.numero_control, device_id: celular.A, user_agent: 'prueba', secreto: secA,
    })
    revisar('solicitud creada con número de verificación', solA.codigo === 'ok' && /^\d{3}$/.test(solA.numero_verificacion), solA)
    // Sin solicitud, todo lo demás fallaría en cadena con errores confusos.
    if (solA.codigo !== 'ok') throw new Error(`No se pudo crear la solicitud: ${solA.mensaje}`)

    const bandeja = exigir(await profe.rpc('listar_solicitudes', { p_grupo_id: grupo.id }), 'Bandeja')
    revisar('aparece en la bandeja del profesor con el mismo número',
      bandeja.some((s) => s.id === solA.solicitud_id && s.numero_verificacion === solA.numero_verificacion), bandeja)

    r = await qr('consultar', { solicitud_id: solA.solicitud_id, secreto: secA })
    revisar('el celular ve "pendiente"', r.estado === 'pendiente', r)
    r = await qr('canjear', { solicitud_id: solA.solicitud_id, secreto: secA, device_id: celular.A })
    revisar('no se puede canjear antes de aprobar', r.codigo === 'no_aprobada', r)

    exigir(await profe.rpc('aprobar_solicitud', { p_solicitud_id: solA.solicitud_id }), 'Aprobar')
    r = await qr('consultar', { solicitud_id: solA.solicitud_id, secreto: secA })
    revisar('después de aprobar, el celular ve "aprobada"', r.estado === 'aprobada', r)
    r = await qr('canjear', { solicitud_id: solA.solicitud_id, secreto: secreto(), device_id: celular.A })
    revisar('con otro secreto no se puede canjear', r.codigo === 'no_encontrada', r)

    const canjeA = await qr('canjear', { solicitud_id: solA.solicitud_id, secreto: secA, device_id: celular.A })
    revisar('el celular correcto recibe su sesión', canjeA.codigo === 'ok' && !!canjeA.sesion?.access_token, canjeA)
    const clienteA = nuevoCliente()
    exigir(await clienteA.auth.setSession(canjeA.sesion), 'Sesión de A')
    const usuarioA = exigir(await clienteA.auth.getUser(), 'Usuario de A').user
    revisar('la cuenta es de alumno (app_metadata.rol)', usuarioA.app_metadata?.rol === 'alumno', usuarioA.app_metadata)
    const filasA = exigir(await clienteA.from('alumnos').select('id'), 'Alumnos vistos por A')
    revisar('el alumno ve solo su propia fila', filasA.length === 1 && filasA[0].id === A.id, filasA)
    const perfilA = exigir(await clienteA.from('profesores').select('id'), 'Perfil de profesor de A')
    revisar('la cuenta del alumno no tiene perfil de profesor', perfilA.length === 0, perfilA)
    r = await qr('canjear', { solicitud_id: solA.solicitud_id, secreto: secA, device_id: celular.A })
    revisar('una solicitud no se canjea dos veces', r.codigo === 'ya_canjeada', r)

    const intento = await clienteA.rpc('aprobar_solicitud', { p_solicitud_id: solA.solicitud_id })
    revisar('un alumno no puede aprobar solicitudes', !!intento.error, intento.data)

    console.log('\nCelulares y rechazo')
    token = await tokenActivacion()
    const pase2 = (await qr('listar', { token })).pase
    r = await qr('solicitar', {
      pase: pase2, alumno_id: B.id, tipo: 'nueva', numero_control: `88${sufijo}2`, device_id: celular.A, user_agent: 'prueba', secreto: secreto(),
    })
    revisar('el celular de A no puede pedir el nombre de B', r.codigo === 'dispositivo_de_otro', r)
    const secB = secreto()
    const solB = await qr('solicitar', {
      pase: pase2, alumno_id: B.id, tipo: 'nueva', numero_control: `88${sufijo}2`, device_id: celular.B, user_agent: 'prueba', secreto: secB,
    })
    exigir(await profe.rpc('rechazar_solicitud', { p_solicitud_id: solB.solicitud_id }), 'Rechazar')
    r = await qr('consultar', { solicitud_id: solB.solicitud_id, secreto: secB })
    revisar('rechazada: el celular lo ve', r.estado === 'rechazada', r)

    console.log('\nCambio de celular')
    const secA2 = secreto()
    const solA2 = await qr('solicitar', {
      pase: pase2, alumno_id: A.id, tipo: 'cambio', numero_control: A.numero_control, device_id: celular.A2, user_agent: 'prueba', secreto: secA2,
    })
    const bandeja2 = exigir(await profe.rpc('listar_solicitudes', { p_grupo_id: grupo.id }), 'Bandeja')
    revisar('la bandeja marca el cambio de celular', bandeja2.some((s) => s.id === solA2.solicitud_id && s.tipo === 'cambio'), bandeja2)
    exigir(await profe.rpc('aprobar_solicitud', { p_solicitud_id: solA2.solicitud_id }), 'Aprobar cambio')
    const dispositivos = exigir(
      await profe.from('dispositivos').select('device_id, estado').eq('alumno_id', A.id),
      'Dispositivos de A',
    )
    const estadoDe = (d) => dispositivos.find((x) => x.device_id === d)?.estado
    revisar('el celular nuevo queda activo y el anterior revocado', estadoDe(celular.A2) === 'activo' && estadoDe(celular.A) === 'revocado', dispositivos)
    const canjeA2 = await qr('canjear', { solicitud_id: solA2.solicitud_id, secreto: secA2, device_id: celular.A2 })
    const clienteA2 = nuevoCliente()
    exigir(await clienteA2.auth.setSession(canjeA2.sesion), 'Sesión de A en celular nuevo')
    const usuarioA2 = exigir(await clienteA2.auth.getUser(), 'Usuario A2').user
    revisar('en el celular nuevo es la MISMA cuenta', usuarioA2.id === usuarioA.id, { antes: usuarioA.id, ahora: usuarioA2.id })

    console.log('\nSeparación entre QR de activación y de asistencia')
    const sesion = exigir(await profe.rpc('abrir_sesion', { p_grupo_id: grupo.id }), 'Abrir sesión')
    r = exigir(
      await clienteA2.rpc('registrar_asistencia', { p_token: await tokenActivacion(), p_device_id: celular.A2 }),
      'Registrar con QR de activación',
    )
    revisar('el QR de activación no sirve para registrar asistencia', r.codigo === 'qr_invalido', r)
    const tokenLista = exigir(await profe.rpc('token_qr_actual', { p_sesion_id: sesion.id }), 'token_qr_actual').token
    r = await qr('listar', { token: tokenLista })
    revisar('el QR de asistencia no sirve para activar', r.codigo === 'qr_invalido', r)
    r = exigir(await clienteA2.rpc('registrar_asistencia', { p_token: tokenLista, p_device_id: celular.A2 }), 'Registrar')
    revisar('con su celular nuevo, A registra asistencia', r.codigo === 'presente', r)

    console.log('\nTarjeta con código (la función de la fase 4, ahora con código compartido)')
    const [{ codigo }] = exigir(
      await profe.rpc('generar_codigos_activacion', { p_grupo_id: grupo.id, p_alumno_ids: [B.id] }),
      'Generar código de B',
    )
    r = await funcion('activar-alumno', {
      codigo, numero_control: `88${sufijo}2`, device_id: celular.B, user_agent: 'prueba',
    })
    revisar('B activa con su tarjeta', r.codigo === 'ok' && r.estado_dispositivo === 'activo' && !!r.sesion, r)

    console.log('\nUnirse a otra clase con la misma cuenta')
    grupo2 = exigir(
      await profe.from('grupos').insert({ nombre: `PRUEBA-AUTO-${Date.now()}-B`, materia: 'Prueba automática' }).select('id').single(),
      'Crear segunda clase',
    )
    const J = exigir(
      await profe.from('alumnos').insert({ grupo_id: grupo2.id, nombre: 'ALUMNO PRUEBA J' }).select('id').single(),
      'Alumno de la segunda clase',
    )
    exigir(await profe.rpc('abrir_activacion', { p_grupo_id: grupo2.id }), 'Abrir activación 2')
    const token2 = exigir(await profe.rpc('token_activacion_actual', { p_grupo_id: grupo2.id }), 'Token 2').token
    const paseJ = (await qr('listar', { token: token2 })).pase
    const pedirUnirse = (cliente, secretoSol) =>
      funcion('activar-por-qr', {
        accion: 'solicitar', pase: paseJ, alumno_id: J.id, tipo: 'nueva', numero_control: A.numero_control,
        device_id: celular.A2, user_agent: 'prueba', secreto: secretoSol, unirme: true,
      }, cliente)

    r = await pedirUnirse(anon, secreto())
    revisar('pedir unirse sin sesión → "sesión vencida" (no crea otra cuenta)', r.codigo === 'sesion_vencida', r)
    r = await pedirUnirse(profe, secreto())
    revisar('una cuenta de profesor no puede unirse como alumno', r.codigo === 'cuenta_invalida', r)

    const secJ = secreto()
    const solJ = await pedirUnirse(clienteA2, secJ)
    revisar('A pide unirse con la sesión de su celular', solJ.codigo === 'ok', solJ)
    if (solJ.codigo !== 'ok') throw new Error(`No se pudo pedir la unión: ${solJ.mensaje}`)
    const bandeja3 = exigir(await profe.rpc('listar_solicitudes', { p_grupo_id: grupo2.id }), 'Bandeja 2')
    const enBandeja = bandeja3.find((s) => s.id === solJ.solicitud_id)
    revisar('la bandeja dice "ya tiene cuenta" y su nombre en la otra clase',
      enBandeja?.cuenta_existente === true && JSON.stringify(enBandeja.otros_nombres) === JSON.stringify([A.nombre]), enBandeja)

    exigir(await profe.rpc('aprobar_solicitud', { p_solicitud_id: solJ.solicitud_id }), 'Aprobar unión')
    const canjeJ = await qr('canjear', { solicitud_id: solJ.solicitud_id, secreto: secJ, device_id: celular.A2 })
    revisar('al canjear no se manda sesión nueva (se queda la suya)', canjeJ.codigo === 'ok' && canjeJ.union === true && !canjeJ.sesion, canjeJ)
    const filasA2 = exigir(await clienteA2.from('alumnos').select('id, grupo_id'), 'Clases de A')
    revisar('con la MISMA sesión, A ve sus dos clases',
      filasA2.length === 2 && filasA2.some((x) => x.grupo_id === grupo.id) && filasA2.some((x) => x.grupo_id === grupo2.id), filasA2)

    const sesion2 = exigir(await profe.rpc('abrir_sesion', { p_grupo_id: grupo2.id }), 'Abrir sesión 2')
    const tokenLista2 = exigir(await profe.rpc('token_qr_actual', { p_sesion_id: sesion2.id }), 'token 2').token
    r = exigir(await clienteA2.rpc('registrar_asistencia', { p_token: tokenLista2, p_device_id: celular.A2 }), 'Registrar en la 2')
    revisar('con el mismo celular, A registra asistencia en la segunda clase', r.codigo === 'presente', r)

    console.log('\nCierre de la ventana')
    const tokenViejo = await tokenActivacion()
    exigir(await profe.rpc('cerrar_activacion', { p_grupo_id: grupo.id }), 'Cerrar activación')
    r = await qr('listar', { token: tokenViejo })
    revisar('con la ventana cerrada no se puede activar', r.codigo === 'activacion_cerrada', r)
  } catch (e) {
    fallidas++
    console.error(`\n✗ La prueba se detuvo: ${e.message}`)
  } finally {
    const ids = [grupo.id, grupo2?.id].filter(Boolean)
    const { error } = await profe.from('grupos').delete().in('id', ids)
    console.log(error ? `\nNo se pudieron borrar los grupos temporales: ${error.message}` : '\nGrupos temporales borrados.')
  }

  console.log(`\n${correctas} correctas, ${fallidas} fallidas`)
  process.exitCode = fallidas ? 1 : 0
}
