import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearCuentaRegresiva, formatearHora } from '../../../lib/fechas.js'
import { useTokenQr } from '../../../hooks/useTokenQr.js'
import { useAhora } from '../../../hooks/useAhora.js'
import { usePantallaEncendida } from '../../../hooks/usePantallaEncendida.js'
import { Aviso, Boton, Cargando } from '../../../components/ui.jsx'
import QrGrande from '../../../components/QrGrande.jsx'

export default function PaseDeLista() {
  const { grupo } = useOutletContext()
  const [alumnos, setAlumnos] = useState(null)
  const [sesion, setSesion] = useState(undefined) // undefined = cargando, null = no hay lista abierta
  const [sesionCerrada, setSesionCerrada] = useState(null) // para mostrar el resumen
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      // Si quedó una lista vencida (por ejemplo, se cerró la pestaña), se
      // cierra primero para no mostrarla como abierta.
      await supabase.rpc('cerrar_sesiones_vencidas')
      const [respAlumnos, respSesion] = await Promise.all([
        supabase.from('alumnos').select('id, nombre').eq('grupo_id', grupo.id).eq('activo', true),
        supabase
          .from('sesiones')
          .select('id, abierta_en, retardo_desde, cierra_en, estado')
          .eq('grupo_id', grupo.id)
          .eq('estado', 'abierta')
          .maybeSingle(),
      ])
      if (cancelado) return
      const fallo = respAlumnos.error ?? respSesion.error
      if (fallo) {
        setError(mensajeDeError(fallo))
        return
      }
      setAlumnos(respAlumnos.data)
      setSesion(respSesion.data)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [grupo.id])

  async function abrir() {
    setAbriendo(true)
    setError('')
    const { data, error } = await supabase.rpc('abrir_sesion', { p_grupo_id: grupo.id })
    setAbriendo(false)
    if (error) {
      setError(mensajeDeError(error))
      return
    }
    setSesionCerrada(null)
    setSesion(data)
  }

  // useCallback: ListaAbierta lo usa dentro de un efecto.
  const alTerminar = useCallback((idSesion) => {
    setSesion(null)
    setSesionCerrada(idSesion)
  }, [])

  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (sesion === undefined || !alumnos) return <Cargando />

  if (sesion) return <ListaAbierta grupo={grupo} sesion={sesion} alumnos={alumnos} alTerminar={alTerminar} />

  if (sesionCerrada) return <Resumen sesionId={sesionCerrada} alumnos={alumnos} />

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <p className="max-w-sm text-slate-600 dark:text-slate-300">
        La lista estará abierta <strong>{grupo.minutos_ventana} min</strong>. Desde el minuto{' '}
        <strong>{grupo.minutos_retardo}</strong> cuenta como retardo.
      </p>
      {alumnos.length === 0 ? (
        <Aviso tipo="info">Agrega alumnos al grupo antes de pasar lista.</Aviso>
      ) : (
        <Boton onClick={abrir} cargando={abriendo} className="w-full max-w-sm py-6 text-2xl">
          Abrir lista
        </Boton>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Lista abierta: QR rotativo, temporizador y llegadas en vivo
// ---------------------------------------------------------------------
function ListaAbierta({ grupo, sesion, alumnos, alTerminar }) {
  const { token, siguienteCambio, duracion, desfase, cerrada, error } = useTokenQr(
    'token_qr_actual',
    'p_sesion_id',
    sesion.id,
  )
  const ahora = useAhora(200)
  const [registros, setRegistros] = useState([])
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [errorCierre, setErrorCierre] = useState('')
  const contenedor = useRef(null)
  const cierreIniciado = useRef(false)

  usePantallaEncendida(true)

  // Llegadas en vivo con Supabase Realtime. La base de datos avisa cada
  // vez que se inserta una asistencia de esta sesión; el RLS garantiza
  // que solo el profesor dueño reciba estos avisos.
  useEffect(() => {
    let cancelado = false

    async function cargar() {
      const { data } = await supabase
        .from('asistencias')
        .select('id, alumno_id, estado, registrado_en, sospechosa')
        .eq('sesion_id', sesion.id)
      if (!cancelado && data) setRegistros(data)
    }

    cargar()
    const canal = supabase
      .channel(`lista-${sesion.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'asistencias', filter: `sesion_id=eq.${sesion.id}` },
        ({ new: fila }) =>
          setRegistros((lista) => (lista.some((r) => r.id === fila.id) ? lista : [...lista, fila])),
      )
      .subscribe()

    // Red de seguridad: si Realtime se desconecta (wifi de la escuela),
    // cada 15 s se vuelve a pedir la lista completa.
    const respaldo = setInterval(cargar, 15_000)

    return () => {
      cancelado = true
      clearInterval(respaldo)
      supabase.removeChannel(canal)
    }
  }, [sesion.id])

  // Pantalla completa (para proyectar). Se escucha el evento porque el
  // usuario también puede salir con la tecla Esc.
  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(document.fullscreenElement === contenedor.current)
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  function alternarPantallaCompleta() {
    if (document.fullscreenElement) document.exitFullscreen()
    else contenedor.current.requestFullscreen().catch(() => {})
  }

  const ahoraServidor = ahora + desfase
  const restante = new Date(sesion.cierra_en).getTime() - ahoraServidor
  const enRetardo = ahoraServidor >= new Date(sesion.retardo_desde).getTime()

  const cerrar = useCallback(
    async (preguntar) => {
      if (cierreIniciado.current) return
      if (preguntar && !window.confirm('¿Cerrar la lista? Los que no se registraron quedarán con falta.')) return
      cierreIniciado.current = true
      setCerrando(true)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      setErrorCierre('')
      // cerrar_sesion pone las faltas. Si ya se había cerrado sola, no pasa nada.
      const { error } = await supabase.rpc('cerrar_sesion', { p_sesion_id: sesion.id })
      // Si el profesor la cerró a mano y falló (por ejemplo, sin internet),
      // la lista SIGUE abierta: no se puede mostrar "Lista cerrada". Se
      // avisa y se deja intentar otra vez. Si se cerró sola por tiempo, el
      // servidor la cierra de todos modos (pg_cron), así que se continúa.
      if (error && preguntar) {
        setErrorCierre(`No se pudo cerrar la lista: ${mensajeDeError(error)}`)
        cierreIniciado.current = false
        setCerrando(false)
        return
      }
      alTerminar(sesion.id)
    },
    [sesion.id, alTerminar],
  )

  // Se acabó el tiempo (según el reloj del servidor) o el servidor ya la cerró.
  // Hasta recibir el primer token no se conoce el desfase de relojes, así
  // que antes de eso no se decide nada (una laptop con la hora adelantada
  // cerraría la lista apenas abrirla).
  useEffect(() => {
    if (cerrada || (token && restante <= 0)) cerrar(false)
  }, [token, restante, cerrada, cerrar])

  const porId = new Map(alumnos.map((a) => [a.id, a.nombre]))
  const llegadas = [...registros].sort((a, b) => b.registrado_en.localeCompare(a.registrado_en))

  return (
    <div
      ref={contenedor}
      className={
        pantallaCompleta
          ? 'flex h-full flex-col gap-6 overflow-auto bg-slate-50 p-8 dark:bg-slate-950'
          : 'flex flex-col gap-6'
      }
    >
      {/* Barra superior: tiempo y botones */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-4xl font-bold tabular-nums" aria-label="Tiempo para cerrar">
            {formatearCuentaRegresiva(restante)}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              enRetardo
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
            }`}
          >
            {enRetardo ? 'Ahora cuenta como retardo' : 'A tiempo'}
          </span>
        </div>
        <div className="flex gap-2">
          {document.fullscreenEnabled && (
            <Boton variante="secundario" className="py-2" onClick={alternarPantallaCompleta}>
              {pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
            </Boton>
          )}
          <Boton variante="peligro" className="py-2" cargando={cerrando} onClick={() => cerrar(true)}>
            Cerrar lista
          </Boton>
        </div>
      </div>

      {pantallaCompleta && (
        <p className="-mt-2 text-xl text-slate-600 dark:text-slate-300">
          {grupo.nombre} · {grupo.materia} — abre <strong>Pase de Lista</strong> en tu celular y escanea
        </p>
      )}

      <Aviso tipo="error">{error}</Aviso>
      <Aviso tipo="error">{errorCierre}</Aviso>

      <div className={`grid gap-6 ${pantallaCompleta ? 'flex-1 lg:grid-cols-[auto_1fr]' : 'md:grid-cols-[auto_1fr]'}`}>
        <QrGrande
          token={token}
          siguienteCambio={siguienteCambio}
          duracion={duracion}
          ancho={pantallaCompleta ? 'min(78vh, 60vw)' : 'min(100%, 420px)'}
          etiqueta="Código QR del pase de lista"
        />

        {/* Llegadas */}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="tabular-nums">
            <span className={`font-bold ${pantallaCompleta ? 'text-7xl' : 'text-5xl'}`}>{registros.length}</span>
            <span className={`text-slate-500 dark:text-slate-400 ${pantallaCompleta ? 'text-4xl' : 'text-2xl'}`}>
              {' '}
              / {alumnos.length}
            </span>
          </p>
          <ul className="flex flex-col gap-1.5">
            {llegadas.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5 dark:bg-slate-900"
              >
                <span className="min-w-0 truncate font-medium">
                  {porId.get(r.alumno_id) ?? 'Alumno'}
                  {r.sospechosa && (
                    <span className="ml-2 text-amber-600" title="Registro sospechoso">
                      ⚠
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm">
                  {r.estado === 'retardo' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      Retardo
                    </span>
                  )}
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">{formatearHora(r.registrado_en)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Resumen al cerrar
// ---------------------------------------------------------------------
function Resumen({ sesionId, alumnos }) {
  const [conteo, setConteo] = useState(null)
  const [faltaron, setFaltaron] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('asistencias')
      .select('alumno_id, estado, sospechosa')
      .eq('sesion_id', sesionId)
      .then(({ data, error }) => {
        // La lista ya está cerrada; solo falló leer el resumen. El detalle
        // de la sesión tiene la misma información.
        if (error) {
          setError(mensajeDeError(error))
          return
        }
        const contar = (estado) => data.filter((a) => a.estado === estado).length
        setConteo({
          presentes: contar('presente'),
          retardos: contar('retardo'),
          faltas: contar('falta'),
          sospechosas: data.filter((a) => a.sospechosa).length,
        })
        const nombres = new Map(alumnos.map((a) => [a.id, a.nombre]))
        setFaltaron(
          data
            .filter((a) => a.estado === 'falta')
            .map((a) => ({ id: a.alumno_id, nombre: nombres.get(a.alumno_id) ?? 'Alumno' }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        )
      })
  }, [sesionId, alumnos])

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">Lista cerrada</h2>
        <Aviso tipo="error">No se pudo cargar el resumen: {error}</Aviso>
        <Link to={`../sesiones/${sesionId}`} className="font-medium text-indigo-700 dark:text-indigo-300">
          Ver el detalle de la sesión →
        </Link>
      </div>
    )
  }
  if (!conteo) return <Cargando texto="Cerrando lista…" />

  const tarjeta = (numero, texto, color) => (
    <div className="rounded-2xl bg-white p-4 text-center dark:bg-slate-900">
      <p className={`text-4xl font-bold tabular-nums ${color}`}>{numero}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{texto}</p>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-bold">Lista cerrada</h2>
      <div className="grid grid-cols-3 gap-3">
        {tarjeta(conteo.presentes, 'presentes', 'text-green-700 dark:text-green-400')}
        {tarjeta(conteo.retardos, 'retardos', 'text-amber-600 dark:text-amber-400')}
        {tarjeta(conteo.faltas, 'faltas', 'text-red-600 dark:text-red-400')}
      </div>
      {conteo.sospechosas > 0 && (
        <Aviso tipo="info">
          {conteo.sospechosas} {conteo.sospechosas === 1 ? 'registro marcado' : 'registros marcados'} como sospechoso.
          Podrás revisarlos en el detalle de la sesión.
        </Aviso>
      )}
      {faltaron.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Faltaron</h3>
          <ul className="flex flex-col gap-1 text-slate-700 dark:text-slate-300">
            {faltaron.map((a) => (
              <li key={a.id}>{a.nombre}</li>
            ))}
          </ul>
        </div>
      )}
      <Link to={`../sesiones/${sesionId}`} className="font-medium text-indigo-700 dark:text-indigo-300">
        Ver detalle y corregir →
      </Link>
    </div>
  )
}
