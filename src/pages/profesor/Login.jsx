import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { mensajeDeError } from '../../lib/errores.js'
import { Aviso, Boton, Campo } from '../../components/ui.jsx'

export default function Login() {
  const { sesion, rol } = useAuth()
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Si ya había sesión de profesor, no tiene caso mostrar el login.
  if (sesion && rol === 'profesor') return <Navigate to="/profesor" replace />

  async function entrar(evento) {
    evento.preventDefault()
    if (!supabase) return
    setEnviando(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password: contrasena,
    })
    setEnviando(false)
    if (error) {
      setError(mensajeDeError(error))
      return
    }
    // Regresa a la pantalla que intentaba abrir antes de pedirle el login.
    navegar(ubicacion.state?.desde ?? '/profesor', { replace: true })
  }

  return (
    <section className="mx-auto max-w-sm pt-6">
      <h1 className="text-2xl font-bold">Entrar como profesor</h1>
      <p className="mt-1 text-slate-500 dark:text-slate-400">Usa el correo de tu cuenta.</p>

      <form onSubmit={entrar} className="mt-8 flex flex-col gap-4">
        <Campo
          etiqueta="Correo"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
        <Aviso tipo="error">{error}</Aviso>
        <Boton type="submit" cargando={enviando} className="mt-2 w-full py-4 text-lg">
          Entrar
        </Boton>
        <Link to="/olvide-contrasena" className="text-center text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ¿Olvidaste tu contraseña?
        </Link>
      </form>
    </section>
  )
}
