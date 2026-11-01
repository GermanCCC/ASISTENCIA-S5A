import { Link, Navigate } from 'react-router'
import { useAuth } from '../lib/auth.jsx'
import { Cargando, clasesBoton } from '../components/ui.jsx'

// Pantalla de entrada. Si ya hay sesión, manda directo a la pantalla de
// cada rol: así el alumno abre la app y cae en el escáner sin tocar nada.
export default function Bienvenida() {
  const { cargando, sesion, rol } = useAuth()

  if (cargando) return <Cargando />
  if (sesion && rol === 'profesor') return <Navigate to="/profesor" replace />
  if (sesion && rol === 'alumno') return <Navigate to="/escanear" replace />

  return (
    <section className="flex flex-col items-center gap-8 pt-10 text-center">
      <img src="/favicon.svg" alt="" className="size-24" />
      <div>
        <h1 className="text-3xl font-bold">Pase de Lista</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Asistencia en segundos con QR</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <Link to="/activar" className={clasesBoton('primario', 'py-4 text-lg')}>
          Soy alumno
        </Link>
        <Link to="/login" className={clasesBoton('secundario', 'py-4 text-lg')}>
          Soy profesor
        </Link>
      </div>
    </section>
  )
}
