import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { mensajeDeError } from '../lib/errores.js'
import { describirCelular } from '../lib/celular.js'
import { formatearFecha, haceCuanto } from '../lib/fechas.js'
import { Aviso, Boton, Cargando } from './ui.jsx'

// Bandeja de solicitudes pendientes de un grupo, actualizada en vivo.
// Junta dos orígenes en una sola lista:
//   - "qr": solicitudes hechas escaneando el QR de activación
//   - "codigo": celulares nuevos que llegaron con el código de una tarjeta
// alCambiar: se llama después de aprobar/rechazar (para refrescar contadores).
export default function BandejaSolicitudes({ grupoId, alCambiar }) {
  const [lista, setLista] = useState(null)
  const [error, setError] = useState('')
  const [procesando, setProcesando] = useState(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('listar_solicitudes', { p_grupo_id: grupoId })
    if (error) setError(mensajeDeError(error))
    else {
      setError('')
      setLista(data)
    }
  }, [grupoId])

  useEffect(() => {
    cargar()
    // Cualquier cambio en solicitudes o celulares vuelve a pedir la lista.
    // El RLS hace que solo lleguen avisos de los grupos de este profesor.
    const canal = supabase
      .channel(`bandeja-${grupoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solicitudes_activacion', filter: `grupo_id=eq.${grupoId}` },
        cargar,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispositivos' }, cargar)
      .subscribe()
    // Red de seguridad por si Realtime se desconecta; también quita de la
    // lista las solicitudes que vencen solas.
    const respaldo = setInterval(cargar, 15_000)
    return () => {
      clearInterval(respaldo)
      supabase.removeChannel(canal)
    }
  }, [grupoId, cargar])

  async function resolver(solicitud, aprobar) {
    if (
      aprobar &&
      solicitud.tipo === 'cambio' &&
      !window.confirm(
        `¿Aprobar el celular nuevo de ${solicitud.nombre}?\n\nSu celular actual dejará de funcionar. Confirma que hablas con él o ella.`,
      )
    ) {
      return
    }

    // Cada origen tiene sus propias funciones en la base de datos.
    const [funcion, parametros] =
      solicitud.origen === 'qr'
        ? [aprobar ? 'aprobar_solicitud' : 'rechazar_solicitud', { p_solicitud_id: solicitud.id }]
        : [aprobar ? 'aprobar_dispositivo' : 'rechazar_dispositivo', { p_dispositivo_id: solicitud.id }]

    setProcesando(solicitud.id)
    const { error } = await supabase.rpc(funcion, parametros)
    setProcesando(null)
    if (error) setError(mensajeDeError(error))
    await cargar()
    alCambiar?.()
  }

  if (!lista) return error ? <Aviso tipo="error">{error}</Aviso> : <Cargando />

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold">
        Solicitudes {lista.length > 0 && <span className="text-indigo-700 dark:text-indigo-300">({lista.length})</span>}
      </h2>
      <Aviso tipo="error">{error}</Aviso>

      {lista.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No hay solicitudes pendientes. Aparecerán aquí en cuanto un alumno escanee y elija su nombre.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {lista.map((s) => {
          const cambio = s.tipo === 'cambio'
          return (
            <li
              key={s.id}
              className={`rounded-2xl border p-4 ${
                cambio
                  ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* El número que el alumno ve en su celular: se lo pides en voz alta */}
                <div className="shrink-0 text-center">
                  {s.numero_verificacion ? (
                    <>
                      <p className="font-mono text-4xl font-bold tabular-nums tracking-wider">{s.numero_verificacion}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">verificación</p>
                    </>
                  ) : (
                    <p className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-medium dark:bg-slate-800">Con tarjeta</p>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.nombre}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    <span className="font-mono">{s.numero_control ?? '—'}</span> · {describirCelular(s.user_agent)} ·{' '}
                    {haceCuanto(s.creada_en)}
                  </p>
                  {/* Se une con la cuenta que ya usa en otras clases (puede ser
                      de otro profesor). Solo se muestran los nombres con los
                      que está registrado ahí, no cuáles clases son: sirve para
                      notar si alguien usa el celular de otra persona. */}
                  {s.cuenta_existente && (
                    <p className="mt-2 text-sm text-indigo-900 dark:text-indigo-200">
                      <span className="font-medium">Ya tiene cuenta en otra clase.</span>
                      {s.otros_nombres?.length > 0 && (
                        <span className="block">Registrado ahí como: {s.otros_nombres.join(', ')}</span>
                      )}
                    </p>
                  )}
                  {cambio && (
                    <p className="mt-2 text-sm font-medium text-red-800 dark:text-red-300">
                      Cambio de celular: desactivará su celular actual.
                      <span className="block font-normal">
                        {s.ultimo_uso
                          ? `Su celular actual registró asistencia por última vez el ${formatearFecha(s.ultimo_uso)}.`
                          : 'Su celular actual nunca ha registrado asistencia.'}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Boton className="flex-1 py-2" cargando={procesando === s.id} onClick={() => resolver(s, true)}>
                  Aprobar
                </Boton>
                <Boton
                  variante="secundario"
                  className="flex-1 py-2"
                  disabled={procesando === s.id}
                  onClick={() => resolver(s, false)}
                >
                  Rechazar
                </Boton>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
