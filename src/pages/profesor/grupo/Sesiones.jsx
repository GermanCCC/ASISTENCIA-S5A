import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearFecha, formatearHora } from '../../../lib/fechas.js'
import { Aviso, Cargando } from '../../../components/ui.jsx'

// Historial de pases de lista del grupo, del más reciente al más antiguo.
export default function Sesiones() {
  const { grupo } = useOutletContext()
  const [sesiones, setSesiones] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      // Así ninguna lista vencida aparece como "abierta" y ya trae sus faltas.
      await supabase.rpc('cerrar_sesiones_vencidas')
      // asistencias(...) trae las asistencias de cada sesión en la misma
      // consulta (Supabase sigue la relación entre las tablas).
      const { data, error } = await supabase
        .from('sesiones')
        .select('id, abierta_en, estado, asistencias(estado, sospechosa)')
        .eq('grupo_id', grupo.id)
        .order('abierta_en', { ascending: false })
      if (cancelado) return
      if (error) setError(mensajeDeError(error))
      else setSesiones(data)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [grupo.id])

  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (!sesiones) return <Cargando />

  if (sesiones.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <p className="font-medium">Todavía no hay pases de lista</p>
        <Link to="../lista" className="mt-2 inline-block font-medium text-indigo-700 dark:text-indigo-300">
          Pasar lista
        </Link>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {sesiones.map((s) => {
        const contar = (estado) => s.asistencias.filter((a) => a.estado === estado).length
        const sospechosas = s.asistencias.filter((a) => a.sospechosa).length
        return (
          <li key={s.id}>
            <Link
              to={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900"
            >
              <span>
                <span className="block font-medium capitalize">{formatearFecha(s.abierta_en)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {formatearHora(s.abierta_en)}
                  {s.estado === 'abierta' && (
                    <span className="ml-2 font-semibold text-green-700 dark:text-green-400">● Abierta</span>
                  )}
                </span>
              </span>
              <span className="flex flex-wrap gap-2 text-sm font-medium tabular-nums">
                <Contador letra="P" numero={contar('presente')} clases="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" />
                <Contador letra="R" numero={contar('retardo')} clases="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" />
                <Contador letra="F" numero={contar('falta')} clases="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" />
                <Contador letra="J" numero={contar('justificada')} clases="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" />
                {sospechosas > 0 && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100" title="Registros sospechosos">
                    ⚠ {sospechosas}
                  </span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Contador({ letra, numero, clases }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${clases}`}>
      {letra} {numero}
    </span>
  )
}
