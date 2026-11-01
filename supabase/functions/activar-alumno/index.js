// =====================================================================
// Edge Function: activar-alumno (activación con el código de la tarjeta)
// =====================================================================
//
// La llama la pantalla /activar del alumno con:
//   { codigo, numero_control, device_id, user_agent, unirme? }
//
// Responde con la sesión del alumno ya iniciada, o con { codigo, mensaje }
// si algo no es válido.
//
// unirme: true → el alumno ya tiene sesión y se une a esta clase con su
// cuenta (ver cuentaParaUnirse). No se crea cuenta ni se manda sesión.
//
// Por qué es una Edge Function y no una función SQL: crear usuarios de
// Auth e iniciar su sesión requiere la llave secreta (service role), y
// esa llave nunca puede estar en el navegador. Aquí vive del lado del
// servidor; Supabase la inyecta sola como variable de entorno.
//
// Las reglas (código válido, número de control, celular) están en SQL
// (migración 5) para que corran en una transacción y se puedan probar.
// Esta función solo coordina: revisar → crear/reutilizar usuario → completar.
import { withSupabase } from '@supabase/server'
import { UUID, cuentaParaUnirse, errorInterno, iniciarSesion, prepararUsuario, responder } from '../_shared/cuentaAlumno.js'

const FUNCION = 'activar-alumno'

export default {
  // auth: 'publishable' → solo acepta peticiones que traigan la llave
  // pública de nuestra app. El alumno todavía no tiene sesión, así que no
  // se puede pedir un usuario. withSupabase también responde el CORS.
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (req.method !== 'POST') return responder(405, 'error', 'Método no permitido')

    let cuerpo
    try {
      cuerpo = await req.json()
    } catch {
      return responder(400, 'error', 'Petición inválida')
    }
    const codigo = String(cuerpo.codigo ?? '')
    const numeroControl = String(cuerpo.numero_control ?? '')
    const deviceId = String(cuerpo.device_id ?? '')
    const userAgent = String(cuerpo.user_agent ?? '').slice(0, 300)

    if (!UUID.test(deviceId)) {
      return responder(400, 'error', 'No se pudo identificar este celular. Recarga la página.')
    }

    // ctx.supabaseAdmin usa la llave secreta: puede crear usuarios y llamar
    // a las funciones que solo acepta el rol service_role.
    const admin = ctx.supabaseAdmin

    // 0. ¿Se une a esta clase con la cuenta que ya tiene en su celular?
    const cuenta = await cuentaParaUnirse(req, admin, cuerpo)
    if (cuenta.respuesta) return cuenta.respuesta

    // 1. ¿Código y número de control válidos? ¿Ya tiene cuenta?
    const { data: revision, error: errRevision } = await admin.rpc('revisar_activacion', {
      p_codigo: codigo,
      p_numero_control: numeroControl,
      p_device_id: deviceId,
      p_user_id: cuenta.userId,
    })
    if (errRevision) return errorInterno(FUNCION, 'revisar_activacion', errRevision)
    if (revision.codigo !== 'ok') return responder(400, revision.codigo, revision.mensaje)

    // 2. Usuario de Auth: el de su sesión si se une, o uno nuevo / el que ya tenía.
    const usuario = cuenta.userId
      ? { userId: cuenta.userId, nuevo: false }
      : await prepararUsuario(admin, {
          userId: revision.user_id,
          alumnoId: revision.alumno_id,
          nombre: revision.nombre,
        })
    if (usuario.error) return errorInterno(FUNCION, 'prepararUsuario', usuario.error)

    // 3. Ligar cuenta y celular e invalidar el código (una transacción).
    const { data: resultado, error: errCompletar } = await admin.rpc('completar_activacion', {
      p_codigo: codigo,
      p_numero_control: numeroControl,
      p_device_id: deviceId,
      p_user_agent: userAgent,
      p_user_id: usuario.userId,
    })
    if (errCompletar || resultado.codigo !== 'ok') {
      // No dejar usuarios huérfanos si algo cambió entre el paso 1 y el 3.
      if (usuario.nuevo) await admin.auth.admin.deleteUser(usuario.userId)
      if (errCompletar) return errorInterno(FUNCION, 'completar_activacion', errCompletar)
      return responder(400, resultado.codigo, resultado.mensaje)
    }

    // Se unió con su cuenta: su celular ya tiene la sesión, no se manda otra.
    if (cuenta.userId) {
      return Response.json({
        codigo: 'ok',
        nombre: resultado.nombre,
        estado_dispositivo: resultado.estado_dispositivo,
        union: true,
      })
    }

    // 4. Iniciar la sesión del alumno.
    const { sesion, error: errLogin } = await iniciarSesion(ctx.supabase, usuario)
    if (errLogin) return errorInterno(FUNCION, 'iniciarSesion', errLogin)

    return Response.json({
      codigo: 'ok',
      nombre: resultado.nombre,
      estado_dispositivo: resultado.estado_dispositivo,
      sesion,
    })
  }),
}
