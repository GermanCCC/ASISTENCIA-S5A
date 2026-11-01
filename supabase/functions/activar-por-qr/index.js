// =====================================================================
// Edge Function: activar-por-qr (activación con el QR del grupo)
// =====================================================================
//
// Una sola función con cuatro acciones, en el orden en que las usa el
// celular del alumno:
//
//   listar     { token }                    → nombres del grupo + pase de 5 min
//   solicitar  { pase, alumno_id, tipo, numero_control, device_id,
//                user_agent, secreto, unirme? } → solicitud + número de verificación
//   consultar  { solicitud_id, secreto }    → pendiente / aprobada / rechazada / vencida
//   canjear    { solicitud_id, secreto, device_id } → sesión del alumno
//
// unirme: true → el alumno ya tiene sesión y se une a esta clase con su
// cuenta (ver cuentaParaUnirse). Al canjear no se manda sesión nueva.
//
// El "secreto" lo genera el celular al pedir y nunca sale de él salvo
// para hablar con esta función; la base de datos solo guarda su hash.
// Así, una solicitud aprobada solo la puede canjear el celular que la hizo.
//
// Las reglas viven en SQL (migración 6, funciones qr_*), que solo acepta
// llamadas con la llave secreta (service_role) que existe solo aquí.
import { withSupabase } from '@supabase/server'
import { UUID, cuentaParaUnirse, errorInterno, iniciarSesion, prepararUsuario, responder } from '../_shared/cuentaAlumno.js'

const FUNCION = 'activar-por-qr'

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (req.method !== 'POST') return responder(405, 'error', 'Método no permitido')

    let cuerpo
    try {
      cuerpo = await req.json()
    } catch {
      return responder(400, 'error', 'Petición inválida')
    }

    const admin = ctx.supabaseAdmin
    const texto = (valor) => String(valor ?? '')

    // Llama a una función qr_* y responde 400 si dice que algo no es válido.
    async function llamar(nombre, parametros) {
      const { data, error } = await admin.rpc(nombre, parametros)
      if (error) return { respuesta: errorInterno(FUNCION, nombre, error) }
      if (data.codigo !== 'ok') return { respuesta: responder(400, data.codigo, data.mensaje) }
      return { data }
    }

    switch (cuerpo.accion) {
      case 'listar': {
        const { data, respuesta } = await llamar('qr_alumnos_del_grupo', { p_token: texto(cuerpo.token) })
        return respuesta ?? Response.json(data)
      }

      case 'solicitar': {
        if (!UUID.test(texto(cuerpo.device_id)) || !UUID.test(texto(cuerpo.alumno_id))) {
          return responder(400, 'error', 'Petición inválida. Recarga la página.')
        }
        // ¿Se une a esta clase con la cuenta que ya tiene en su celular?
        const cuenta = await cuentaParaUnirse(req, admin, cuerpo)
        if (cuenta.respuesta) return cuenta.respuesta
        const { data, respuesta } = await llamar('qr_solicitar_activacion', {
          p_pase: texto(cuerpo.pase),
          p_alumno_id: cuerpo.alumno_id,
          p_tipo: texto(cuerpo.tipo),
          p_numero_control: texto(cuerpo.numero_control),
          p_device_id: cuerpo.device_id,
          p_user_agent: texto(cuerpo.user_agent).slice(0, 300),
          p_secreto: texto(cuerpo.secreto),
          p_user_id: cuenta.userId,
        })
        return respuesta ?? Response.json(data)
      }

      case 'consultar': {
        if (!UUID.test(texto(cuerpo.solicitud_id))) return responder(400, 'no_encontrada', 'No se encontró la solicitud')
        const { data, respuesta } = await llamar('qr_consultar_solicitud', {
          p_solicitud_id: cuerpo.solicitud_id,
          p_secreto: texto(cuerpo.secreto),
        })
        return respuesta ?? Response.json(data)
      }

      case 'canjear':
        return await canjear(ctx, cuerpo, llamar)

      default:
        return responder(400, 'error', 'Acción desconocida')
    }
  }),
}

// Igual que activar-alumno: preparar → crear/reutilizar usuario → completar → sesión.
// Si la solicitud se hizo para unirse con una cuenta (migración 12), se usa
// esa cuenta tal cual: ni se le cambia la contraseña ni se manda sesión.
async function canjear(ctx, cuerpo, llamar) {
  const admin = ctx.supabaseAdmin
  if (!UUID.test(String(cuerpo.solicitud_id ?? '')) || !UUID.test(String(cuerpo.device_id ?? ''))) {
    return responder(400, 'no_encontrada', 'No se encontró la solicitud')
  }
  const parametros = {
    p_solicitud_id: cuerpo.solicitud_id,
    p_secreto: String(cuerpo.secreto ?? ''),
    p_device_id: cuerpo.device_id,
  }

  const preparado = await llamar('qr_preparar_canje', parametros)
  if (preparado.respuesta) return preparado.respuesta

  if (preparado.data.union) {
    const completado = await llamar('qr_completar_canje', { ...parametros, p_user_id: preparado.data.user_id })
    if (completado.respuesta) return completado.respuesta
    return Response.json({ codigo: 'ok', nombre: completado.data.nombre, estado_dispositivo: 'activo', union: true })
  }

  const usuario = await prepararUsuario(admin, {
    userId: preparado.data.user_id,
    alumnoId: preparado.data.alumno_id,
    nombre: preparado.data.nombre,
  })
  if (usuario.error) return errorInterno(FUNCION, 'prepararUsuario', usuario.error)

  const completado = await llamar('qr_completar_canje', { ...parametros, p_user_id: usuario.userId })
  if (completado.respuesta) {
    if (usuario.nuevo) await admin.auth.admin.deleteUser(usuario.userId)
    return completado.respuesta
  }

  const { sesion, error } = await iniciarSesion(ctx.supabase, usuario)
  if (error) return errorInterno(FUNCION, 'iniciarSesion', error)

  return Response.json({ codigo: 'ok', nombre: completado.data.nombre, estado_dispositivo: 'activo', sesion })
}
