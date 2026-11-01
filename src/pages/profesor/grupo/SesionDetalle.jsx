import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearFecha, formatearHora } from '../../../lib/fechas.js'
import { Aviso, Boton, Cargando } from '../../../components/ui.jsx'

const ESTADOS = [
  { valor: 'presente', letra: 'P', nombre: 'Presente', activo: 'bg-green-600 text-white' },
  { valor: 'retardo', letra: 'R', nombre: 'Retardo', activo: 'bg-amber-500 text-white' },
  { valor: 'falta', letra: 'F', nombre: 'Falta', activo: 'bg-red-600 text-white' },
  { valor: 'justificada', letra: 'J', nombre: 'Justificada', activo: 'bg-sky-600 text-white' },
]

const METODOS = { qr: 'QR', manual: 'A mano', automatico: 'Al cerrar' }

// Detalle de un pase de lista: estado de cada alumno, cambios a mano
// (por ejemplo, justificar) y revisión de registros sospechosos.
export default function SesionDetalle() {
  const { grupo } = useOutletContext()
  const { sesionId } = useParams()
  const navegar = useNavigate()
  const [sesion, setSesion] = useState(null)
  const [filas, setFilas] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [guardando, setGuardando] = useState(null)
  const [error, setError] = useState('')
  const [fotos, setFotos] = useState(new Map()) // ruta de la selfie → enlace temporal

  const cargar = useCallback(async () => {
    const [respSesion, respAlumnos, respAsistencias] = await Promise.all([
      supabase.from('sesiones').select('id, abierta_en, cierra_en, estado').eq('id', sesionId).maybeSingle(),
      supabase.from('alumnos').select('id, nombre, numero_control, activo').eq('grupo_id', grupo.id),
      supabase
        .from('asistencias')
        .select(
          'id, alumno_id, estado, metodo, registrado_en, sospechosa, motivo_sospecha, editado_en, selfie_path, distancia_m, precision_m',
        )
        .eq('sesion_id', sesionId),
    ])
    const fallo = respSesion.error ?? respAlumnos.error ?? respAsistencias.error
    if (fallo) {
      setError(mensajeDeError(fallo))
      return
    }
    if (!respSesion.data) {
      setError('Esta sesión no existe o no es de tus grupos.')
      return
    }

    // Una fila por alumno: los activos, más los dados de baja que sí
    // tienen registro en esta sesión (para no perder su historial).
    const porAlumno = new Map(respAsistencias.data.map((a) => [a.alumno_id, a]))
    const lista = respAlumnos.data
      .filter((al) => al.activo || porAlumno.has(al.id))
      .map((al) => ({ alumno: al, asistencia: porAlumno.get(al.id) ?? null }))
      .sort((a, b) => a.alumno.nombre.localeCompare(b.alumno.nombre, 'es'))

    // Selfies: el bucket es privado, así que se piden enlaces firmados que
    // duran 1 hora. Solo el profesor dueño puede obtenerlos (política de Storage).
    const rutas = respAsistencias.data.map((a) => a.selfie_path).filter(Boolean)
    if (rutas.length > 0) {
      const { data: enlaces } = await supabase.storage.from('selfies').createSignedUrls(rutas, 3600)
      setFotos(new Map((enlaces ?? []).filter((e) => e.signedUrl).map((e) => [e.path, e.signedUrl])))
    }

    setSesion(respSesion.data)
    setFilas(lista)
  }, [grupo.id, sesionId])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Cambiar el estado: si ya tiene registro se actualiza; si no (por
  // ejemplo, la lista sigue abierta), se crea uno "a mano". La base de
  // datos anota quién y cuándo lo cambió (trigger revisar_asistencia).
  async function cambiarEstado(fila, estado) {
    if (fila.asistencia?.estado === estado) return
    setGuardando(fila.alumno.id)
    setError('')
    const { error } = fila.asistencia
      ? await supabase.from('asistencias').update({ estado }).eq('id', fila.asistencia.id)
      : await supabase
          .from('asistencias')
          .insert({ sesion_id: sesionId, alumno_id: fila.alumno.id, estado, metodo: 'manual' })
    setGuardando(null)
    if (error) setError(mensajeDeError(error))
    await cargar()
  }

  // "Revisado": el profesor ya vio el motivo y decidió. El motivo se
  // conserva para el historial; solo deja de resaltarse.
  async function marcarRevisada(fila) {
    setGuardando(fila.alumno.id)
    const { error } = await supabase.from('asistencias').update({ sospechosa: false }).eq('id', fila.asistencia.id)
    setGuardando(null)
    if (error) setError(mensajeDeError(error))
    await cargar()
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este pase de lista? Se borran todos sus registros. No se puede deshacer.')) return
    const { error } = await supabase.from('sesiones').delete().eq('id', sesionId)
    if (error) {
      setError(mensajeDeError(error))
      return
    }
    navegar('..', { relative: 'path', replace: true })
  }

  if (error && !filas) return <Aviso tipo="error">{error}</Aviso>
  if (!filas) return <Cargando />

  const visibles = filas.filter((f) => {
    if (filtro === 'sospechosos') return f.asistencia?.sospechosa
    if (filtro === 'faltas') return !f.asistencia || f.asistencia.estado === 'falta'
    return true
  })
  const totalSospechosos = filas.filter((f) => f.asistencia?.sospechosa).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to=".." relative="path" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ← Sesiones
        </Link>
        <h2 className="mt-2 text-xl font-bold capitalize">{formatearFecha(sesion.abierta_en)}</h2>
        <p className="text-slate-500 dark:text-slate-400">
          {formatearHora(sesion.abierta_en)}
          {sesion.estado === 'abierta' && (
            <span className="ml-2 font-semibold text-green-700 dark:text-green-400">● Lista abierta</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar">
        {[
          ['todos', `Todos (${filas.length})`],
          ['sospechosos', `Sospechosos (${totalSospechosos})`],
          ['faltas', 'Faltas'],
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

      <Aviso tipo="error">{error}</Aviso>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {visibles.map((fila) => {
          const a = fila.asistencia
          return (
            <li key={fila.alumno.id} className={`flex flex-col gap-3 p-4 ${a?.sospechosa ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {a?.selfie_path && <Selfie enlace={fotos.get(a.selfie_path)} nombre={fila.alumno.nombre} />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {fila.alumno.nombre}
                    {!fila.alumno.activo && <span className="ml-2 text-xs text-slate-500">(dado de baja)</span>}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {a ? (
                      <>
                        {a.metodo !== 'automatico' && <span className="tabular-nums">{formatearHora(a.registrado_en)} · </span>}
                        {METODOS[a.metodo]}
                        {a.editado_en && ' · editado a mano'}
                        {a.distancia_m != null && (
                          <span className="block">
                            📍 a {Math.round(a.distancia_m)} m del salón
                            {a.precision_m != null && ` (GPS ±${Math.round(a.precision_m)} m)`}
                          </span>
                        )}
                      </>
                    ) : (
                      'Sin registro todavía'
                    )}
                  </p>
                </div>

                {/* Selector P / R / F / J */}
                <div className="flex gap-1" role="group" aria-label={`Estado de ${fila.alumno.nombre}`}>
                  {ESTADOS.map((e) => (
                    <button
                      key={e.valor}
                      type="button"
                      title={e.nombre}
                      aria-label={e.nombre}
                      aria-pressed={a?.estado === e.valor}
                      disabled={guardando === fila.alumno.id}
                      onClick={() => cambiarEstado(fila, e.valor)}
                      className={`size-10 rounded-lg font-bold transition disabled:opacity-50 ${
                        a?.estado === e.valor
                          ? e.activo
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {e.letra}
                    </button>
                  ))}
                </div>
              </div>

              {a?.sospechosa && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  <span>⚠ {a.motivo_sospecha ?? 'Registro sospechoso'}</span>
                  <button type="button" onClick={() => marcarRevisada(fila)} className="font-semibold underline">
                    Marcar como revisado
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {visibles.length === 0 && <li className="p-4 text-center text-slate-500 dark:text-slate-400">Nada que mostrar</li>}
      </ul>
      {fotos.size > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">Las selfies se borran solas a los 30 días.</p>
      )}

      <div className="mt-4 border-t border-slate-200 pt-6 dark:border-slate-800">
        <Boton variante="secundario" className="text-red-700 dark:text-red-400" onClick={eliminar}>
          Eliminar este pase de lista
        </Boton>
      </div>
    </div>
  )
}

// Miniatura de la selfie; al tocarla se abre en grande en otra pestaña.
// Si ya no hay enlace (la foto se borró a los 30 días), se indica.
function Selfie({ enlace, nombre }) {
  if (!enlace) {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-slate-200 text-center text-[10px] leading-tight text-slate-500 dark:bg-slate-800">
        sin foto
      </span>
    )
  }
  return (
    <a href={enlace} target="_blank" rel="noreferrer" className="shrink-0" title="Ver la selfie en grande">
      <img src={enlace} alt={`Selfie de ${nombre}`} className="size-14 rounded-xl object-cover" loading="lazy" />
    </a>
  )
}
