import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { mensajeDeError } from '../../lib/errores.js'
import { Aviso, Boton, Campo } from '../../components/ui.jsx'

// Paso 1 de "olvidé mi contraseña": Supabase manda al correo un enlace de
// un solo uso. Al abrirlo, el profesor llega a /restablecer-contrasena con
// una sesión temporal para poner una contraseña nueva.
//
// La respuesta es la misma exista o no el correo: así nadie puede usar
// esta pantalla para averiguar qué correos tienen cuenta.
export default function OlvideContrasena() {
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState('')

  async function pedirEnlace(evento) {
    evento.preventDefault()
    if (!supabase) return
    setEnviando(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), {
      // Esta dirección debe estar en Supabase → Authentication → URL
      // Configuration → Redirect URLs; si no, Supabase usa la "Site URL".
      redirectTo: `${window.location.origin}/restablecer-contrasena`,
    })
    setEnviando(false)
    if (error) setError(mensajeDeError(error))
    else setEnviado(true)
  }

  return (
    <section className="mx-auto max-w-sm pt-6">
      <h1 className="text-2xl font-bold">Recuperar contraseña</h1>

      {enviado ? (
        <div className="mt-6 flex flex-col gap-4">
          <Aviso tipo="exito">
            Si <strong>{correo.trim()}</strong> tiene cuenta, te llegará un correo con un enlace para poner una
            contraseña nueva. El enlace sirve una sola vez y vence en una hora. Revisa también la carpeta de spam.
          </Aviso>
          <Link to="/login" className="font-medium text-indigo-700 dark:text-indigo-300">
            ← Volver a entrar
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-slate-500 dark:text-slate-400">Te enviaremos un enlace a tu correo.</p>
          <form onSubmit={pedirEnlace} className="mt-8 flex flex-col gap-4">
            <Campo
              etiqueta="Correo"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
            <Aviso tipo="error">{error}</Aviso>
            <Boton type="submit" cargando={enviando} className="mt-2 w-full py-4 text-lg">
              Enviar enlace
            </Boton>
            <Link to="/login" className="text-center text-sm font-medium text-indigo-700 dark:text-indigo-300">
              Volver a entrar
            </Link>
          </form>
        </>
      )}
    </section>
  )
}
