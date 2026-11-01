// Código compartido por las Edge Functions de activación
// (activar-alumno: con código de tarjeta; activar-por-qr: con el QR del grupo).
//
// Supabase incluye la carpeta _shared al publicar cada función que la importa.

// Correo interno de los alumnos. ".invalid" es un dominio reservado que no
// existe, así que nunca se envía nada. Debe coincidir con el trigger
// privado.crear_perfil_profesor (migración 5).
const DOMINIO_ALUMNOS = 'alumnos.invalid'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function responder(estado, codigo, mensaje) {
  return Response.json({ codigo, mensaje }, { status: estado })
}

// El detalle técnico va al log de Supabase (Edge Functions → Logs);
// al alumno solo se le muestra un mensaje general.
export function errorInterno(funcion, paso, error) {
  console.error(`${funcion}: falló ${paso}:`, error?.message ?? error)
  return responder(500, 'error', 'No se pudo activar tu cuenta. Intenta de nuevo en un momento.')
}

// "Unirme a otra clase": si el alumno ya tiene sesión en su celular, se
// une con ESA cuenta en vez de crearle otra (migración 12). El celular
// manda { unirme: true } y su sesión en el encabezado Authorization; aquí
// se le pregunta al servidor de Auth si esa sesión es válida. El celular
// no puede inventar con qué cuenta se une.
// Devuelve { userId } (null si no pidió unirse) o { respuesta } con el error.
export async function cuentaParaUnirse(req, admin, cuerpo) {
  if (cuerpo.unirme !== true) return { userId: null }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data, error } = token ? await admin.auth.getUser(token) : { data: null, error: true }
  // Si pidió unirse pero la sesión no sirve, NO se sigue como activación
  // normal: eso le crearía otra cuenta y perdería sus otras clases.
  if (error || !data?.user) {
    return { respuesta: responder(401, 'sesion_vencida', 'Tu sesión venció. Cierra la app, ábrela de nuevo e intenta otra vez.') }
  }
  if (data.user.app_metadata?.rol !== 'alumno') {
    return { respuesta: responder(400, 'cuenta_invalida', 'Solo una cuenta de alumno puede unirse a una clase') }
  }
  return { userId: data.user.id }
}

// Deja listo el usuario de Auth del alumno con una contraseña aleatoria
// nueva (nadie la conoce; solo sirve para iniciar su sesión enseguida).
//   - userId existente: se le cambia la contraseña.
//   - sin userId: se crea con app_metadata.rol = 'alumno', que solo el
//     servidor puede escribir.
// Devuelve { userId, correo, contrasena, nuevo } o { error }.
export async function prepararUsuario(admin, { userId, alumnoId, nombre }) {
  const contrasena = contrasenaAleatoria()

  if (userId) {
    const { data, error } = await admin.auth.admin.updateUserById(userId, { password: contrasena })
    if (error) return { error }
    return { userId, correo: data.user.email, contrasena, nuevo: false }
  }

  const correo = `${alumnoId}@${DOMINIO_ALUMNOS}`
  const { data, error } = await admin.auth.admin.createUser({
    email: correo,
    password: contrasena,
    email_confirm: true,
    app_metadata: { rol: 'alumno' },
    user_metadata: { nombre },
  })
  if (error) return { error }
  return { userId: data.user.id, correo, contrasena, nuevo: true }
}

// Inicia la sesión del alumno y devuelve los tokens para su celular.
// Se usa el cliente con la llave PÚBLICA (ctx.supabase), no el admin,
// para no mezclar la sesión del alumno con el cliente con permisos de
// administrador.
export async function iniciarSesion(clientePublico, { correo, contrasena }) {
  const { data, error } = await clientePublico.auth.signInWithPassword({ email: correo, password: contrasena })
  if (error) return { error }
  return {
    sesion: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  }
}

function contrasenaAleatoria() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}
