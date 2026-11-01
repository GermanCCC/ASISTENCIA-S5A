import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { formatearCuentaRegresiva } from '../../../lib/fechas.js'
import { useTokenQr } from '../../../hooks/useTokenQr.js'
import { useAhora } from '../../../hooks/useAhora.js'
import { usePantallaEncendida } from '../../../hooks/usePantallaEncendida.js'
import { Aviso, Boton, Cargando } from '../../../components/ui.jsx'
import QrGrande from '../../../components/QrGrande.jsx'
import BandejaSolicitudes from '../../../components/BandejaSolicitudes.jsx'

// Pantalla "Activar alumnos": QR del grupo que rota cada 10 s mientras la
// ventana de activación está abierta, y al lado la bandeja de solicitudes.
export default function ActivarAlumnos() {
  const { grupo } = useOutletContext()
  // Cambiar "version" obliga a pedir el token otra vez (después de abrir o cerrar).
  const [version, setVersion] = useState(0)
  const { token, siguienteCambio, duracion, desfase, cierraEn, cerrada, error } = useTokenQr(
    'token_activacion_actual',
    'p_grupo_id',
    grupo.id,
    version,
  )
  const ahora = useAhora(250)
  const [ocupado, setOcupado] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')
  const [progreso, setProgreso] = useState(null) // { activados, total }

  usePantallaEncendida(Boolean(token))

  const cargarProgreso = useCallback(async () => {
    const { data } = await supabase.from('alumnos').select('activado_en').eq('grupo_id', grupo.id).eq('activo', true)
    if (data) setProgreso({ activados: data.filter((a) => a.activado_en).length, total: data.length })
  }, [grupo.id])

  useEffect(() => {
    cargarProgreso()
  }, [cargarProgreso])

  async function ejecutar(funcion) {
    setOcupado(true)
    setErrorAccion('')
    const { error } = await supabase.rpc(funcion, { p_grupo_id: grupo.id })
    setOcupado(false)
    if (error) setErrorAccion(mensajeDeError(error))
    setVersion((v) => v + 1)
  }

  // Cuando se acaba el tiempo (según el reloj del servidor) se vuelve a
  // preguntar: el servidor responderá que ya está cerrada.
  const restante = cierraEn ? new Date(cierraEn).getTime() - (ahora + desfase) : null
  const vencida = token && restante !== null && restante <= 0
  useEffect(() => {
    if (vencida) setVersion((v) => v + 1)
  }, [vencida])

  const abierta = Boolean(token) && !cerrada

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-4 text-center">
        {!abierta && !cerrada ? (
          <Cargando />
        ) : abierta ? (
          <>
            <p className="text-slate-600 dark:text-slate-300">
              Los alumnos abren <strong>Pase de Lista</strong> → <strong>Activar mi cuenta</strong> y escanean.
            </p>
            <QrGrande
              token={token}
              siguienteCambio={siguienteCambio}
              duracion={duracion}
              ancho="min(100%, 380px)"
              etiqueta="Código QR para activar cuentas"
            />
            <p className="font-mono text-3xl font-bold tabular-nums" aria-label="Tiempo para cerrar">
              {formatearCuentaRegresiva(restante ?? 0)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {/* Reabrir reinicia los 10 minutos (y cambia el secreto) */}
              <Boton variante="secundario" className="py-2" cargando={ocupado} onClick={() => ejecutar('abrir_activacion')}>
                Reiniciar 10 min
              </Boton>
              <Boton variante="peligro" className="py-2" disabled={ocupado} onClick={() => ejecutar('cerrar_activacion')}>
                Cerrar
              </Boton>
            </div>
          </>
        ) : (
          <>
            <p className="max-w-sm text-slate-600 dark:text-slate-300">
              Muestra un QR durante <strong>10 minutos</strong>. Cada alumno lo escanea, elige su nombre y tú apruebas
              su solicitud. Si no alcanza el tiempo, puedes volver a abrirlo.
            </p>
            <Boton onClick={() => ejecutar('abrir_activacion')} cargando={ocupado} className="w-full max-w-sm py-5 text-xl">
              Abrir activación
            </Boton>
          </>
        )}

        <Aviso tipo="error">{errorAccion || error}</Aviso>

        {progreso && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <strong className="tabular-nums">
              {progreso.activados} de {progreso.total}
            </strong>{' '}
            alumnos ya activaron su cuenta
          </p>
        )}
        <Link to="../tarjetas" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ¿Prefieres tarjetas impresas con código? Generar PDF
        </Link>
      </div>

      <BandejaSolicitudes grupoId={grupo.id} alCambiar={cargarProgreso} />
    </div>
  )
}
