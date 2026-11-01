import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { useSolicitudesPendientes } from '../../../hooks/useSolicitudesPendientes.js'
import { Aviso, Cargando } from '../../../components/ui.jsx'

// Carga el grupo una sola vez y lo comparte con sus pestañas (pase de
// lista, activar, alumnos, sesiones, estadísticas, configuración) por medio del
// "contexto" del Outlet.
export default function GrupoLayout() {
  const { grupoId } = useParams()
  const [grupo, setGrupo] = useState(null)
  const [error, setError] = useState('')
  const pendientes = useSolicitudesPendientes(grupoId)

  useEffect(() => {
    let cancelado = false
    setGrupo(null)
    setError('')

    // maybeSingle: si el grupo no existe o es de otro profesor (el RLS lo
    // oculta), regresa null en vez de error.
    supabase
      .from('grupos')
      .select('*')
      .eq('id', grupoId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) setError(mensajeDeError(error))
        else if (!data) setError('Este grupo no existe o no es tuyo.')
        else setGrupo(data)
      })

    return () => {
      cancelado = true
    }
  }, [grupoId])

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tipo="error">{error}</Aviso>
        <Link to="/profesor" className="font-medium text-indigo-700 dark:text-indigo-300">
          ← Mis grupos
        </Link>
      </div>
    )
  }
  if (!grupo) return <Cargando />

  const pestana = ({ isActive }) =>
    'border-b-2 px-1 pb-3 font-medium transition ' +
    (isActive
      ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100')

  return (
    <section>
      <Link to="/profesor" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
        ← Mis grupos
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{grupo.nombre}</h1>
      <p className="text-slate-500 dark:text-slate-400">{[grupo.materia, grupo.periodo].filter(Boolean).join(' · ')}</p>

      {/* En celular las pestañas no caben: se desplazan de lado. */}
      <nav className="-mx-4 mt-6 mb-6 flex gap-6 overflow-x-auto border-b border-slate-200 px-4 whitespace-nowrap dark:border-slate-800">
        <NavLink to="lista" className={pestana}>
          Pase de lista
        </NavLink>
        <NavLink to="activar" className={pestana}>
          Activar alumnos
          {pendientes > 0 && (
            <span className="ml-1.5 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">{pendientes}</span>
          )}
        </NavLink>
        {/* "end" hace que Alumnos solo se marque en su ruta exacta */}
        <NavLink to="" end className={pestana}>
          Alumnos
        </NavLink>
        <NavLink to="sesiones" className={pestana}>
          Sesiones
        </NavLink>
        <NavLink to="estadisticas" className={pestana}>
          Estadísticas
        </NavLink>
        <NavLink to="configuracion" className={pestana}>
          Configuración
        </NavLink>
      </nav>

      <Outlet context={{ grupo, setGrupo }} />
    </section>
  )
}
