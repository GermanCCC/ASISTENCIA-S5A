import { useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { mensajeDeError } from '../../lib/errores.js'
import { Aviso, Boton, Campo, Cargando, clasesBoton } from '../../components/ui.jsx'

const LARGO_MINIMO = 8

// Paso 2 de "olvidé mi contraseña". El enlace del correo trae una sesión
// temporal: Supabase la lee de la dirección al cargar la app, y con ella
// se puede cambiar la contraseña. Sin esa sesión (enlace vencido o ya
// usado) no hay nada que hacer aquí más que pedir otro enlace.
export default function RestablecerContrasena() {
  const { cargando, sesion, rol } = useAuth()
  const [contrasena, setContrasena] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)
  const [error, setError] = useState('')

  if (cargando) return <Cargando />

  if (!sesion || rol !== 'profesor') {
    return (
      <section className="mx-auto flex max-w-sm flex-col gap-4 pt-6">
        <h1 className="text-2xl font-bold">Enlace no válido</h1>
        <p className="text-slate-600 dark:text-slate-300">
          El enlace ya venció o ya se usó. Pide uno nuevo; sirve una sola vez y dura una hora.
        </p>
        <Link to="/olvide-contrasena" className={clasesBoton('primario', 'w-full py-4 text-lg')}>
          Pedir otro enlace
        </Link>
      </section>
    )
  }

  async function guardar(evento) {
    evento.preventDefault()
    setError('')
    if (contrasena.length < LARGO_MINIMO) {
      setError(`La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`)
      return
    }
    if (contrasena !== confirmacion) {
      setError('Las dos contraseñas no coinciden.')
      return
    }
    setGuardando(true)
    const { error } = await supabase.auth.updateUser({ password: contrasena })
    setGuardando(false)
    if (error) setError(mensajeDeError(error))
    else setListo(true)
  }

  if (listo) {
    return (
      <section className="mx-auto flex max-w-sm flex-col gap-4 pt-6">
        <Aviso tipo="exito">Listo, tu contraseña cambió. Ya puedes usarla para entrar.</Aviso>
        <Link to="/profesor" replace className={clasesBoton('primario', 'w-full py-4 text-lg')}>
          Ir a mis grupos
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-sm pt-6">
      <h1 className="text-2xl font-bold">Contraseña nueva</h1>
      <p className="mt-1 text-slate-500 dark:text-slate-400">{sesion.user.email}</p>

      <form onSubmit={guardar} className="mt-8 flex flex-col gap-4">
        <Campo
          etiqueta="Contraseña nueva"
          ayuda={`Al menos ${LARGO_MINIMO} caracteres.`}
          type="password"
          autoComplete="new-password"
          required
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
        />
        <Campo
          etiqueta="Repítela"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
        />
        <Aviso tipo="error">{error}</Aviso>
        <Boton type="submit" cargando={guardando} className="mt-2 w-full py-4 text-lg">
          Guardar contraseña
        </Boton>
      </form>
    </section>
  )
}
