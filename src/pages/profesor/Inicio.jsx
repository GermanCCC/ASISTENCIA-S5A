import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { mensajeDeError } from '../../lib/errores.js'
import { Aviso, Cargando, clasesBoton } from '../../components/ui.jsx'
import MedidorAsistencia from '../../components/MedidorAsistencia.jsx'
import { resumirGrupo } from '../../lib/estadisticas.js'

export default function InicioProfesor() {
  const [grupos, setGrupos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false

    async function cargar() {
      // Primero se cierran las listas vencidas para que sus faltas ya
      // cuenten en los porcentajes (pg_cron lo hace cada minuto, esto
      // cubre el hueco). Si falla no importa, los datos siguen sirviendo.
      await supabase.rpc('cerrar_sesiones_vencidas')

      const [respGrupos, respResumen, respPendientes] = await Promise.all([
        supabase.from('grupos').select('id, nombre, materia, periodo, porcentaje_minimo_asistencia').order('creado_en'),
        // El RLS ya filtra: solo llegan alumnos de los grupos de este profesor.
        supabase
          .from('resumen_asistencia_alumno')
          .select('grupo_id, activo, total_clases, presentes, retardos, justificadas, en_riesgo'),
        supabase.rpc('contar_solicitudes_pendientes'),
      ])
      if (cancelado) return

      const fallo = respGrupos.error ?? respResumen.error
      if (fallo) {
        setError(mensajeDeError(fallo))
        return
      }
      // Si el conteo falla no se detiene la pantalla: solo no se muestra el aviso.
      const pendientes = new Map((respPendientes.data ?? []).map((p) => [p.grupo_id, p.total]))
      setGrupos(
        respGrupos.data.map((g) => ({
          ...g,
          ...resumirGrupo(respResumen.data.filter((r) => r.grupo_id === g.id)),
          pendientes: pendientes.get(g.id) ?? 0,
        })),
      )
    }

    cargar()
    return () => {
      cancelado = true
    }
  }, [])

  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (!grupos) return <Cargando />

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Mis grupos</h1>
        {grupos.length > 0 && (
          <Link to="/profesor/grupos/nuevo" className={clasesBoton('secundario', 'py-2')}>
            + Nuevo grupo
          </Link>
        )}
      </div>

      {grupos.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="font-medium">Todavía no tienes grupos</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Crea uno para agregar a tus alumnos y pasar lista.
          </p>
          <Link to="/profesor/grupos/nuevo" className={clasesBoton('primario', 'mt-6')}>
            Crear grupo
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {grupos.map((g) => (
            <li key={g.id}>
              <Link
                to={`/profesor/grupos/${g.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-400 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold">{g.nombre}</h2>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                      {[g.materia, g.periodo].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    {g.alumnosActivos} {g.alumnosActivos === 1 ? 'alumno' : 'alumnos'}
                  </span>
                </div>

                <div className="mt-5">
                  <MedidorAsistencia porcentaje={g.porcentaje} minimo={Number(g.porcentaje_minimo_asistencia)} />
                </div>

                {g.pendientes > 0 && (
                  <p className="mt-4 mr-2 inline-flex rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                    {g.pendientes} {g.pendientes === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}
                  </p>
                )}
                {g.enRiesgo > 0 && (
                  <p className="mt-4 inline-flex rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                    {g.enRiesgo} {g.enRiesgo === 1 ? 'alumno en riesgo' : 'alumnos en riesgo'}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
