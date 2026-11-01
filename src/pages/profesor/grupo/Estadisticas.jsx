import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { cargarDatosGrupo } from '../../../lib/datosGrupo.js'
import { exportarExcel } from '../../../lib/exportarExcel.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearPorcentaje, resumirGrupo } from '../../../lib/estadisticas.js'
import { Aviso, Boton, Cargando, Spinner } from '../../../components/ui.jsx'
import MedidorAsistencia from '../../../components/MedidorAsistencia.jsx'

// recharts se descarga solo al abrir esta pestaña (ver GraficaAsistencia.jsx).
const GraficaAsistencia = lazy(() => import('../../../components/GraficaAsistencia.jsx'))

// Estadísticas del grupo: asistencia general, gráfica por clase, porcentaje
// de cada alumno (los que están en riesgo, resaltados) y exportar a Excel.
export default function Estadisticas() {
  const { grupo } = useOutletContext()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    let cancelado = false
    cargarDatosGrupo(grupo.id)
      .then((d) => !cancelado && setDatos(d))
      .catch((e) => !cancelado && setError(mensajeDeError(e)))
    return () => {
      cancelado = true
    }
  }, [grupo.id])

  async function exportar() {
    setExportando(true)
    setError('')
    try {
      await exportarExcel(grupo)
    } catch (e) {
      setError(`No se pudo generar el Excel: ${mensajeDeError(e)}`)
    }
    setExportando(false)
  }

  if (error && !datos) return <Aviso tipo="error">{error}</Aviso>
  if (!datos) return <Cargando />

  const { resumen, sesiones } = datos
  const general = resumirGrupo(resumen)
  const minimo = Number(grupo.porcentaje_minimo_asistencia)
  const activos = resumen.filter((r) => r.activo)
  const visibles = filtro === 'riesgo' ? activos.filter((r) => r.en_riesgo) : activos

  if (sesiones.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <p className="font-medium">Todavía no hay listas cerradas</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Las estadísticas aparecen cuando cierres el primer pase de lista.
        </p>
        <Link to="../lista" className="mt-3 inline-block font-medium text-indigo-700 dark:text-indigo-300">
          Pasar lista
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Resumen del grupo */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">Asistencia del grupo</p>
          <MedidorAsistencia porcentaje={general.porcentaje} minimo={minimo} />
        </div>
        <Dato numero={sesiones.length} texto={sesiones.length === 1 ? 'clase' : 'clases'} />
        <Dato
          numero={general.enRiesgo}
          texto={general.enRiesgo === 1 ? 'alumno en riesgo' : 'alumnos en riesgo'}
          alerta={general.enRiesgo > 0}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Asistencia por clase</h2>
        <Boton variante="secundario" className="py-2" cargando={exportando} onClick={exportar}>
          Exportar a Excel
        </Boton>
      </div>
      <Aviso tipo="error">{error}</Aviso>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Suspense
          fallback={
            <div className="grid h-72 place-items-center">
              <Spinner className="size-6" />
            </div>
          }
        >
          <GraficaAsistencia sesiones={sesiones} />
        </Suspense>
      </div>

      {/* Alumnos */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Alumnos</h2>
        <div className="flex gap-2" role="group" aria-label="Filtrar">
          {[
            ['todos', `Todos (${activos.length})`],
            ['riesgo', `En riesgo (${general.enRiesgo})`],
          ].map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setFiltro(valor)}
              aria-pressed={filtro === valor}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                filtro === valor
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {visibles.map((r) => (
          <li key={r.alumno_id}>
            <Link
              to={r.alumno_id}
              className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                r.en_riesgo ? 'bg-red-50 dark:bg-red-950/30' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.nombre}</span>
                <span className="text-sm text-slate-500 tabular-nums dark:text-slate-400">
                  P {r.presentes} · R {r.retardos} · F {r.faltas} · J {r.justificadas}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.en_riesgo && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                    En riesgo
                  </span>
                )}
                <span
                  className={`w-16 text-right text-xl font-bold tabular-nums ${
                    r.en_riesgo ? 'text-red-600 dark:text-red-400' : ''
                  }`}
                >
                  {formatearPorcentaje(r.porcentaje)}
                </span>
              </span>
            </Link>
          </li>
        ))}
        {visibles.length === 0 && (
          <li className="p-4 text-center text-slate-500 dark:text-slate-400">
            {filtro === 'riesgo' ? 'Nadie está en riesgo' : 'No hay alumnos activos'}
          </li>
        )}
      </ul>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Cuentan como asistencia: presente, retardo y justificada. Solo se cuentan las listas cerradas. Toca un
        alumno para ver su historial.
      </p>
    </div>
  )
}

function Dato({ numero, texto, alerta = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className={`text-3xl font-bold tabular-nums ${alerta ? 'text-red-600 dark:text-red-400' : ''}`}>{numero}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{texto}</p>
    </div>
  )
}
