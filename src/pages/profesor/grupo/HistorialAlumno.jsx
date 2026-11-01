import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearFecha, formatearHora } from '../../../lib/fechas.js'
import { COLORES_ESTADO, ESTADOS, asistenciasDe, clasesParaRecuperarse } from '../../../lib/estadisticas.js'
import { Aviso, Cargando } from '../../../components/ui.jsx'
import MedidorAsistencia from '../../../components/MedidorAsistencia.jsx'

const METODOS = { qr: 'QR', manual: 'A mano', automatico: 'Al cerrar la lista' }

// Historial de un alumno en el grupo: su porcentaje y cada clase con su
// estado. Desde aquí se puede ir al detalle de la clase para corregirla.
export default function HistorialAlumno() {
  const { grupo } = useOutletContext()
  const { alumnoId } = useParams()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      const [respAlumno, respResumen, respAsistencias] = await Promise.all([
        supabase
          .from('alumnos')
          .select('id, nombre, numero_control, activo')
          .eq('id', alumnoId)
          .eq('grupo_id', grupo.id)
          .maybeSingle(),
        supabase
          .from('resumen_asistencia_alumno')
          .select('total_clases, presentes, retardos, faltas, justificadas, porcentaje, en_riesgo')
          .eq('alumno_id', alumnoId)
          .maybeSingle(),
        // !inner + el filtro: solo los registros de listas ya cerradas
        // (las mismas que cuentan en el porcentaje).
        supabase
          .from('asistencias')
          .select('id, estado, metodo, registrado_en, sospechosa, motivo_sospecha, editado_en, sesiones!inner(id, abierta_en, estado)')
          .eq('alumno_id', alumnoId)
          .eq('sesiones.estado', 'cerrada'),
      ])
      if (cancelado) return
      const fallo = respAlumno.error ?? respResumen.error ?? respAsistencias.error
      if (fallo) {
        setError(mensajeDeError(fallo))
        return
      }
      if (!respAlumno.data) {
        setError('Este alumno no existe o no es de este grupo.')
        return
      }
      setDatos({
        alumno: respAlumno.data,
        resumen: respResumen.data,
        clases: respAsistencias.data.sort((a, b) => b.sesiones.abierta_en.localeCompare(a.sesiones.abierta_en)),
      })
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [grupo.id, alumnoId])

  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (!datos) return <Cargando />

  const { alumno, resumen, clases } = datos
  const minimo = Number(grupo.porcentaje_minimo_asistencia)
  const faltan = resumen?.en_riesgo ? clasesParaRecuperarse(asistenciasDe(resumen), resumen.total_clases, minimo) : 0

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to=".." relative="path" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ← Estadísticas
        </Link>
        <h2 className="mt-2 text-xl font-bold">
          {alumno.nombre}
          {!alumno.activo && <span className="ml-2 text-sm font-normal text-slate-500">(dado de baja)</span>}
        </h2>
        <p className="text-slate-500 dark:text-slate-400">{alumno.numero_control ?? 'Sin número de control'}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <MedidorAsistencia porcentaje={resumen?.porcentaje == null ? null : Number(resumen.porcentaje)} minimo={minimo} />
        {resumen && resumen.total_clases > 0 && (
          <p className="mt-3 text-sm text-slate-600 tabular-nums dark:text-slate-300">
            {resumen.total_clases} clases · {resumen.presentes} a tiempo · {resumen.retardos} con retardo ·{' '}
            {resumen.faltas} faltas · {resumen.justificadas} justificadas
          </p>
        )}
      </div>

      {resumen?.en_riesgo && (
        <Aviso tipo="error">
          Está debajo del mínimo de {minimo}%.{' '}
          {faltan == null
            ? 'Con un mínimo de 100% ya no puede recuperarse.'
            : `Necesita asistir a las próximas ${faltan} ${faltan === 1 ? 'clase' : 'clases'} para recuperarse.`}
        </Aviso>
      )}

      {clases.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">Todavía no tiene clases registradas.</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {clases.map((c) => (
            <li key={c.id}>
              <Link
                to={`../../sesiones/${c.sesiones.id}`}
                relative="path"
                className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                  c.sospechosa ? 'bg-amber-50 dark:bg-amber-950/30' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-medium capitalize">{formatearFecha(c.sesiones.abierta_en)}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {c.metodo === 'qr' && <span className="tabular-nums">{formatearHora(c.registrado_en)} · </span>}
                    {METODOS[c.metodo]}
                    {c.editado_en && ' · editado a mano'}
                  </span>
                  {c.sospechosa && (
                    <span className="block text-sm text-amber-800 dark:text-amber-300">⚠ {c.motivo_sospecha ?? 'Sospechoso'}</span>
                  )}
                </span>
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${COLORES_ESTADO[c.estado]}`}>
                  {ESTADOS[c.estado].nombre}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
