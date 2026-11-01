// =====================================================================
// Pruebas obligatorias de la fase 5, contra el Supabase REAL.
//
// Uso:  npm run prueba:fase5
//
// Pide tu correo y contraseña de profesor (no se guardan). Crea un grupo
// temporal "PRUEBA-AUTO-..." con 4 alumnos, los activa por la Edge
// Function igual que lo haría un celular, abre una lista de 2 minutos y
// comprueba cada regla. Al terminar BORRA el grupo (y con él sus
// alumnos, sesiones y asistencias), aunque alguna prueba falle.
//
// Tarda unos 2.5 minutos porque espera de verdad a que el QR cambie y
// expire, a que empiece el retardo y a que la lista se cierre.
//
// Queda un rastro: los 4 usuarios de Auth de los alumnos de prueba
// (correos ...@alumnos.invalid). No tienen datos ni acceso a nada; se
// pueden borrar en Supabase → Authentication → Users.
// =====================================================================
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { preguntar, preguntarOculto } from './terminal.mjs'

const URL_SUPABASE = process.env.VITE_SUPABASE_URL
const LLAVE = process.env.VITE_SUPABASE_ANON_KEY
if (!URL_SUPABASE || !LLAVE) {
  console.error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el .env')
  process.exit(1)
}

// Cada "celular" es un cliente distinto con su propia sesión en memoria.
const nuevoCliente = () =>
  createClient(URL_SUPABASE, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let correctas = 0
let fallidas = 0
function revisar(nombre, ok, detalle) {
  if (ok) correctas++
  else fallidas++
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `  → ${JSON.stringify(detalle)}`}`)
}

// Lanza un error con mensaje claro si Supabase respondió con error.
function exigir({ data, error }, paso) {
  if (error) throw new Error(`${paso}: ${error.message}`)
  return data
}

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
// No se usa process.exit(): en Windows a veces truena si Node todavía está
// cerrando conexiones. Con exitCode, Node termina solo cuando acaba todo.

async function correrPruebas() {
  const grupo = exigir(
    await profe
      .from('grupos')
      .insert({ nombre: `PRUEBA-AUTO-${Date.now()}`, materia: 'Prueba automática', minutos_ventana: 2, minutos_retardo: 1 })
      .select('id, nombre')
      .single(),
    'Crear grupo de prueba',
  )
  console.log(`Grupo temporal: ${grupo.nombre}`)

  try {
    // --- Alumnos, códigos y activación (como lo haría cada celular) ---
    const alumnos = exigir(
      await profe
        .from('alumnos')
        .insert([
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA A', numero_control: `99${Date.now() % 1e6}1` },
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA B', numero_control: `99${Date.now() % 1e6}2` },
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA C', numero_control: `99${Date.now() % 1e6}3` },
          { grupo_id: grupo.id, nombre: 'ALUMNO PRUEBA D', numero_control: `99${Date.now() % 1e6}4` },
        ])
        .select('id, nombre, numero_control'),
      'Crear alumnos',
    ).sort((a, b) => a.nombre.localeCompare(b.nombre))

    const codigos = exigir(
      await profe.rpc('generar_codigos_activacion', { p_grupo_id: grupo.id, p_alumno_ids: alumnos.map((a) => a.id) }),
      'Generar códigos',
    )
    const codigoDe = (alumno) => codigos.find((c) => c.alumno_id === alumno.id).codigo

    const anon = nuevoCliente()
    async function activar(alumno, deviceId) {
      const { data, error } = await anon.functions.invoke('activar-alumno', {
        body: { codigo: codigoDe(alumno), numero_control: alumno.numero_control, device_id: deviceId, user_agent: 'prueba-fase5' },
      })
      if (error) return { codigo: 'error_http', mensaje: (await error.context?.json?.().catch(() => null))?.mensaje ?? error.message }
      return data
    }

    const [A, B, C, D] = alumnos
    const celular = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() }
    const cliente = {}

    console.log('\nActivación')
    let r = await activar(A, celular.A)
    revisar('el alumno A activa su cuenta', r.codigo === 'ok' && r.estado_dispositivo === 'activo', r)
    cliente.A = nuevoCliente()
    exigir(await cliente.A.auth.setSession(r.sesion), 'Sesión de A')

    r = await activar(B, celular.A)
    revisar('B no puede activar en el celular de A', r.codigo !== 'ok' && /otro alumno/.test(r.mensaje), r)

    for (const [letra, alumno] of [['B', B], ['C', C], ['D', D]]) {
      r = await activar(alumno, celular[letra])
      if (r.codigo !== 'ok') throw new Error(`No se pudo activar a ${letra}: ${JSON.stringify(r)}`)
      cliente[letra] = nuevoCliente()
      exigir(await cliente[letra].auth.setSession(r.sesion), `Sesión de ${letra}`)
    }

    const registrar = async (letra, token, deviceId = celular[letra]) =>
      exigir(await cliente[letra].rpc('registrar_asistencia', { p_token: token, p_device_id: deviceId }), `Registrar ${letra}`)
    const tokenActual = async () => exigir(await profe.rpc('token_qr_actual', { p_sesion_id: sesion.id }), 'token_qr_actual')
    const intervaloDe = (token) => Number(token.split('.')[1])

    // --- Abrir lista ---
    const sesion = exigir(await profe.rpc('abrir_sesion', { p_grupo_id: grupo.id }), 'Abrir sesión')
    const antes = Date.now()
    const qr1 = await tokenActual()
    // Hora del servidor - hora local (el servidor tomó su hora a la mitad del viaje).
    const desfase = new Date(qr1.ahora).getTime() - (antes + Date.now()) / 2
    const esperarHasta = async (fechaServidor, extraMs) => {
      const ms = new Date(fechaServidor).getTime() - desfase - Date.now() + extraMs
      if (ms > 0) {
        process.stdout.write(`  … esperando ${Math.ceil(ms / 1000)} s\n`)
        await esperar(ms)
      }
    }

    console.log('\nPruebas obligatorias (CLAUDE.md)')

    // 1
    r = await registrar('A', qr1.token)
    revisar('1. Un alumno se registra correctamente', r.codigo === 'presente' && r.mensaje === 'Registrado', r)

    // 4
    r = await registrar('A', (await tokenActual()).token)
    revisar('4. Un alumno no puede registrarse dos veces', r.codigo === 'ya_registrado', r)

    // 3
    r = await registrar('B', (await tokenActual()).token, celular.A)
    revisar('3. El mismo celular no puede registrar a un segundo alumno', r.codigo === 'dispositivo_no_vinculado', r)

    // 7
    const intentoToken = await cliente.A.rpc('token_qr_actual', { p_sesion_id: sesion.id })
    const intentoSecreto = await cliente.A.schema('privado').from('sesion_secretos').select('*')
    const sesionVistaPorAlumno = await cliente.A.from('sesiones').select('*').eq('id', sesion.id)
    revisar(
      '7. Un alumno no puede llamar a token_qr_actual ni leer el secreto',
      !!intentoToken.error &&
        !!intentoSecreto.error &&
        !sesionVistaPorAlumno.error &&
        sesionVistaPorAlumno.data.length === 1 &&
        !JSON.stringify(sesionVistaPorAlumno.data).includes('secreto'),
      { token: intentoToken.error?.message, secreto: intentoSecreto.error?.message, sesion: sesionVistaPorAlumno.data },
    )

    console.log('\nQR cada 5 s con 3 s de gracia')
    revisar(
      'el QR cambia cada 5 s y el siguiente llega por adelantado',
      qr1.segundos === 5 &&
        intervaloDe(qr1.token_siguiente) === intervaloDe(qr1.token) + 1 &&
        new Date(qr1.siguiente_cambio) - new Date(qr1.ahora) <= 5000,
      qr1,
    )

    // Se pide justo al empezar un intervalo: al QR siguiente le faltan ~4.5 s.
    let q = await tokenActual()
    await esperarHasta(q.siguiente_cambio, 300)
    q = await tokenActual()
    r = await registrar('B', q.token_siguiente)
    revisar('el QR siguiente no sirve antes de su turno', r.codigo === 'qr_expirado', r)

    // Como alguien que lo leyó justo antes del cambio y su registro llegó tarde.
    q = await tokenActual()
    await esperarHasta(q.siguiente_cambio, 1000)
    r = await registrar('D', q.token)
    revisar('QR anterior 1 s después del cambio (dentro de la gracia) se acepta', r.codigo === 'presente', r)

    q = await tokenActual()
    await esperarHasta(q.siguiente_cambio, 4000)
    r = await registrar('B', q.token)
    revisar('QR anterior 4 s después del cambio (ya sin gracia) se rechaza', r.codigo === 'qr_expirado', r)

    // 2: se guarda el QR actual y se espera a que tenga 21 s de haber aparecido.
    const qrViejo = (await tokenActual()).token
    await esperarHasta(new Date((intervaloDe(qrViejo) * qr1.segundos + 21) * 1000), 0)
    r = await registrar('B', qrViejo)
    revisar('2. Un QR de hace más de 20 segundos se rechaza', r.codigo === 'qr_expirado' && r.mensaje === 'QR expirado, escanea de nuevo', r)

    // 6
    await esperarHasta(sesion.retardo_desde, 1500)
    r = await registrar('B', (await tokenActual()).token)
    revisar('6. Un registro después de los minutos de retardo queda como retardo', r.codigo === 'retardo' && r.mensaje === 'Registrado con retardo', r)

    // 8
    const deA = exigir(await cliente.A.from('asistencias').select('alumno_id'), 'Asistencias de A')
    const deB = exigir(await cliente.B.from('asistencias').select('alumno_id'), 'Asistencias de B')
    revisar(
      '8. Un alumno no puede leer asistencias de otros alumnos',
      deA.length === 1 && deA[0].alumno_id === A.id && deB.length === 1 && deB[0].alumno_id === B.id,
      { deA, deB },
    )

    // 5: C espera a que se acabe el tiempo (pg_cron o la propia función la cierran).
    const qrFinal = (await tokenActual()).token
    await esperarHasta(sesion.cierra_en, 1500)
    r = await registrar('C', qrFinal)
    revisar('5. Un registro después del cierre se rechaza', r.codigo === 'lista_cerrada' && r.mensaje === 'La lista ya se cerró', r)

    // Extra: al cerrar, C quedó con falta.
    const finales = exigir(
      await profe.from('asistencias').select('alumno_id, estado').eq('sesion_id', sesion.id),
      'Asistencias finales',
    )
    const estadoDe = (alumno) => finales.find((f) => f.alumno_id === alumno.id)?.estado
    revisar(
      'Extra: al cerrar, quien no se registró queda con falta',
      estadoDe(A) === 'presente' && estadoDe(B) === 'retardo' && estadoDe(C) === 'falta' && estadoDe(D) === 'presente',
      finales,
    )
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
