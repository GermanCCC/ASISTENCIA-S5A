import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { mensajeDeError } from '../../lib/errores.js'
import { formatearFecha, formatearHora } from '../../lib/fechas.js'
import {
  COLORES_ESTADO,
  ESTADOS,
  asistenciasDe,
  clasesParaRecuperarse,
  faltasPermitidas,
  formatearPorcentaje,
  resumirGrupo,
} from '../../lib/estadisticas.js'
import { Aviso, Cargando, clasesBoton } from '../../components/ui.jsx'
import MedidorAsistencia from '../../components/MedidorAsistencia.jsx'

export default function MiAsistencia() {
  const { cargando, sesion, rol } = useAuth()

  if (cargando) return <Cargando />
  if (!sesion) {
    return (
      <section className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-10 text-center">
        <h1 className="text-2xl font-bold">Primero activa tu cuenta</h1>
        <Link to="/activar" className={clasesBoton('primario', 'w-full py-4 text-lg')}>
          Activar mi cuenta
        </Link>
      </section>
    )
  }
  if (rol !== 'alumno') {
    return <Aviso tipo="info">Esta pantalla es para que cada alumno vea su asistencia.</Aviso>
  }
  return <Resumen />
}

// Una tarjeta por cada grupo del alumno (puede estar en varias materias
// del mismo profesor). Todo lo filtra el RLS: el alumno solo puede leer
// sus propios renglones, aunque alguien modifique esta página.
function Resumen() {
  const [grupos, setGrupos] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      const [respResumen, respGrupos, respHistorial] = await Promise.all([
        supabase
          .from('resumen_asistencia_alumno')
          .select('alumno_id, grupo_id, activo, total_clases, presentes, retardos, faltas, justificadas, porcentaje, porcentaje_minimo, en_riesgo'),
        supabase.from('grupos').select('id, nombre, materia, periodo'),
        // Su historial: los mismos registros que se guardan al escanear el QR
        // (o que pone el profesor, o la falta al cerrar la lista).
        supabase
          .from('asistencias')
          .select('id, alumno_id, estado, metodo, registrado_en, sesiones!inner(abierta_en, estado)'),
      ])
      if (cancelado) return
      const fallo = respResumen.error ?? respGrupos.error ?? respHistorial.error
      if (fallo) {
        setError(mensajeDeError(fallo))
        return
      }
      const grupoPorId = new Map(respGrupos.data.map((g) => [g.id, g]))
      setGrupos(
        respResumen.data
          .filter((r) => r.activo && grupoPorId.has(r.grupo_id))
          .map((r) => ({
            ...r,
            porcentaje: r.porcentaje == null ? null : Number(r.porcentaje),
            porcentaje_minimo: Number(r.porcentaje_minimo),
            grupo: grupoPorId.get(r.grupo_id),
            // De la clase más reciente a la más antigua.
            historial: respHistorial.data
              .filter((h) => h.alumno_id === r.alumno_id)
              .sort((a, b) => b.sesiones.abierta_en.localeCompare(a.sesiones.abierta_en)),
          })),
      )
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [])

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mi asistencia</h1>
        <Link to="/escanear" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ← Escanear
        </Link>
      </div>

      {error ? (
        <Aviso tipo="error">{error}</Aviso>
      ) : !grupos ? (
        <Cargando />
      ) : grupos.length === 0 ? (
        <Aviso tipo="info">No estás inscrito en ningún grupo activo.</Aviso>
      ) : (
        <>
          {grupos.length > 1 && <Total grupos={grupos} />}
          {grupos.map((g) => (
            <TarjetaGrupo key={g.alumno_id} datos={g} />
          ))}
        </>
      )}

      {/* Para otra materia (aunque sea de otro profesor): se une con esta
          misma cuenta, sin perder las clases de arriba. */}
      {grupos && (
        <Link to="/activar" className={clasesBoton('secundario', 'w-full py-4')}>
          + Unirme a otra clase
        </Link>
      )}
    </section>
  )
}

function TarjetaGrupo({ datos }) {
  const { grupo, total_clases: clases, porcentaje_minimo: minimo } = datos
  const asistencias = asistenciasDe(datos)

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="text-lg font-bold">{grupo.materia || grupo.nombre}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {[grupo.materia ? grupo.nombre : null, grupo.periodo].filter(Boolean).join(' · ')}
        </p>
      </div>

      <MedidorAsistencia porcentaje={datos.porcentaje} minimo={minimo} />

      {clases > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Conteo numero={datos.presentes} texto="a tiempo" />
          <Conteo numero={datos.retardos} texto="retardos" />
          <Conteo numero={datos.faltas} texto="faltas" alerta={datos.faltas > 0} />
          <Conteo numero={datos.justificadas} texto="justif." />
        </div>
      )}

      {clases > 0 && <Consejo asistencias={asistencias} clases={clases} minimo={minimo} enRiesgo={datos.en_riesgo} />}

      {datos.historial.length > 0 && <Historial registros={datos.historial} />}
    </article>
  )
}

// Porcentaje total cuando el alumno está en varias materias: suma sus
// clases y asistencias de todas (igual que el porcentaje de un grupo).
function Total({ grupos }) {
  const { porcentaje } = resumirGrupo(grupos)
  return (
    <p className="rounded-2xl bg-indigo-50 px-5 py-3 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
      Asistencia total en tus materias: <strong className="tabular-nums">{formatearPorcentaje(porcentaje)}</strong>
    </p>
  )
}

// Cada clase con su fecha, la hora y cómo quedó. La hora es la del
// escaneo si registró con QR; si no (falta al cerrar la lista o anotado
// por el profesor), la hora de la clase.
function Historial({ registros }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Historial</h3>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {registros.map((r) => {
          const abierta = r.sesiones.estado === 'abierta'
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium capitalize">{formatearFecha(r.sesiones.abierta_en)}</span>
                <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {r.metodo === 'qr'
                    ? `Registrado a las ${formatearHora(r.registrado_en)}`
                    : `Clase de las ${formatearHora(r.sesiones.abierta_en)}`}
                  {r.metodo === 'manual' && ' · anotado por el profesor'}
                  {abierta && ' · lista abierta, aún no cuenta en el porcentaje'}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLORES_ESTADO[r.estado]}`}>
                {ESTADOS[r.estado].nombre}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Aviso en palabras: si está en riesgo, cuántas clases seguidas necesita
// para recuperarse; si no, cuántas puede faltar sin quedar en riesgo.
function Consejo({ asistencias, clases, minimo, enRiesgo }) {
  if (enRiesgo) {
    const necesita = clasesParaRecuperarse(asistencias, clases, minimo)
    return (
      <Aviso tipo="error">
        <strong>Estás en riesgo:</strong> tu asistencia está debajo del mínimo de {minimo}%.{' '}
        {necesita == null
          ? 'Habla con tu profesor.'
          : `Para recuperarte necesitas asistir a las próximas ${necesita} ${necesita === 1 ? 'clase' : 'clases'}.`}
      </Aviso>
    )
  }
  const puede = faltasPermitidas(asistencias, clases, minimo)
  if (puede == null) return null
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300">
      {puede === 0
        ? `Si faltas a la próxima clase quedarás debajo del ${minimo}%.`
        : `Puedes faltar a ${puede === 1 ? 'la próxima clase' : `las próximas ${puede} clases`} sin quedar debajo del ${minimo}%.`}
    </p>
  )
}

function Conteo({ numero, texto, alerta = false }) {
  return (
    <div className="rounded-xl bg-slate-100 py-2 dark:bg-slate-800">
      <p className={`text-xl font-bold tabular-nums ${alerta ? 'text-red-600 dark:text-red-400' : ''}`}>{numero}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{texto}</p>
    </div>
  )
}
