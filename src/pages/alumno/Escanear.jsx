import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { obtenerDeviceId } from '../../lib/dispositivo.js'
import { mensajeDeError } from '../../lib/errores.js'
import { useUbicacion } from '../../hooks/useUbicacion.js'
import { Aviso, Boton, Cargando, Spinner, clasesBoton } from '../../components/ui.jsx'
import CamaraQr from '../../components/CamaraQr.jsx'
import CamaraSelfie from '../../components/CamaraSelfie.jsx'

export default function Escanear() {
  const { cargando, sesion, rol } = useAuth()

  if (cargando) return <Cargando />
  if (!sesion) {
    return (
      <section className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-10 text-center">
        <h1 className="text-2xl font-bold">Primero activa tu cuenta</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Escanea el QR de activación que muestra tu profesor, o usa el código de tu tarjeta.
        </p>
        <Link to="/activar" className={clasesBoton('primario', 'w-full py-4 text-lg')}>
          Activar mi cuenta
        </Link>
      </section>
    )
  }
  if (rol !== 'alumno') {
    return <Aviso tipo="info">Esta pantalla es para que los alumnos registren su asistencia.</Aviso>
  }
  return <Escaner />
}

// Cómo se ve cada respuesta del servidor: verde, amarillo o rojo.
const COLORES = {
  verde: 'bg-green-600',
  amarillo: 'bg-amber-500',
  rojo: 'bg-red-600',
}
function colorDe(codigo) {
  if (codigo === 'presente' || codigo === 'ya_registrado') return 'verde'
  if (codigo === 'retardo') return 'amarillo'
  return 'rojo'
}
const ICONOS = { verde: '✓', amarillo: '✓', rojo: '✕' }
// Android vibra; iPhone no tiene esta función y simplemente se ignora.
const VIBRACION = { verde: [120], amarillo: [120, 80, 120], rojo: [300] }

// Una ubicación de hace más de 2 minutos ya no dice dónde está el celular.
const UBICACION_VIGENTE_MS = 120_000

// Reintento automático: el QR vale solo 3 s después de cambiar, así que a
// quien lo leyó justo en el cambio (o tiene la red lenta) le puede llegar
// "QR expirado". La primera vez no se muestra el rojo: la cámara sigue
// leyendo y manda el QR nuevo que ya está en pantalla. Si en 8 s no lee
// uno nuevo, o el nuevo también expira, entonces sí se muestra el rojo.
// No debilita nada: cada intento necesita un QR vigente.
const REINTENTO_MS = 8000

function Escaner() {
  const navegar = useNavigate()
  // Evita mandar dos registros si la cámara lee el mismo QR varias veces
  // seguidas (lo hace hasta 10 veces por segundo).
  const ocupado = useRef(false)
  const reintento = useRef(null) // { texto, temporizador } mientras se reintenta solo
  const [reintentando, setReintentando] = useState(false)
  const [fase, setFase] = useState('escaneando') // escaneando | enviando | selfie | resultado
  const [resultado, setResultado] = useState(null)
  const [pedidoSelfie, setPedidoSelfie] = useState(null)
  const [pideUbicacion, setPideUbicacion] = useState(false)
  const { posicion, problema: problemaUbicacion } = useUbicacion(pideUbicacion)

  // ¿Alguno de mis grupos pide ubicación? Solo entonces se usa el GPS.
  // (El RLS solo deja ver los grupos en los que el alumno está inscrito.)
  // Esta consulta también "calienta" la conexión mientras abre la cámara:
  // si la sesión del alumno venció (app cerrada por horas), Supabase la
  // renueva aquí y no en el registro, donde cada segundo cuenta.
  useEffect(() => {
    supabase
      .from('grupos')
      .select('requiere_ubicacion')
      .then(({ data }) => setPideUbicacion(Boolean(data?.some((g) => g.requiere_ubicacion))))
  }, [])

  // Al salir de la pantalla no debe quedar un reintento pendiente.
  useEffect(() => () => clearTimeout(reintento.current?.temporizador), [])

  function terminarReintento() {
    clearTimeout(reintento.current?.temporizador)
    reintento.current = null
    setReintentando(false)
  }

  function mostrar(respuesta) {
    navigator.vibrate?.(VIBRACION[colorDe(respuesta.codigo)])
    setResultado(respuesta)
    setFase('resultado')
  }

  // Manda el registro. Todas las validaciones las hace la base de datos
  // (registrar_asistencia): firma del QR, tiempo, celular, duplicados,
  // ubicación y selfie. Aquí solo se muestra la respuesta.
  async function enviar(token, rutaSelfie = null) {
    const vigente = posicion && Date.now() - posicion.cuando < UBICACION_VIGENTE_MS
    const { data, error } = await supabase.rpc('registrar_asistencia', {
      p_token: token,
      p_device_id: await obtenerDeviceId(),
      p_lat: vigente ? posicion.lat : null,
      p_lng: vigente ? posicion.lng : null,
      p_precision_m: vigente ? posicion.precision : null,
      p_selfie_path: rutaSelfie,
    })
    return error ? { codigo: 'error', mensaje: mensajeDeError(error) } : data
  }

  async function registrar(texto) {
    if (ocupado.current) return
    // Durante el reintento se ignora el QR que ya venció: el proyector
    // puede tardar un instante en mostrar el nuevo.
    if (texto === reintento.current?.texto) return
    ocupado.current = true
    const esReintento = Boolean(reintento.current)
    // Ya se leyó un QR distinto: el plazo de 8 s deja de correr.
    clearTimeout(reintento.current?.temporizador)

    // El QR de activación empieza con "A.": el alumno quiere unirse a otra
    // clase. Se le lleva a ese flujo con el QR ya leído (dura ~10 s, así
    // que se usa enseguida).
    if (texto.startsWith('A.')) {
      terminarReintento()
      navegar('/activar', { state: { tokenQr: texto } })
      return
    }

    setFase('enviando')
    const respuesta = await enviar(texto.trim())

    if (respuesta.codigo === 'qr_expirado' && !esReintento) {
      reintento.current = {
        texto,
        temporizador: setTimeout(() => {
          ocupado.current = true
          terminarReintento()
          mostrar(respuesta)
        }, REINTENTO_MS),
      }
      setReintentando(true)
      ocupado.current = false
      setFase('escaneando')
      return
    }
    terminarReintento()

    if (respuesta.codigo === 'selfie_requerida') {
      // El QR ya se validó; el pase da 90 s para tomarse la foto.
      setPedidoSelfie({ ...respuesta, limite: Date.now() + respuesta.segundos * 1000 })
      setFase('selfie')
      return
    }
    mostrar(respuesta)
  }

  // Sube la foto y completa el registro con el pase. Si algo falla,
  // devuelve el mensaje para que la cámara deje intentar otra vez.
  async function conSelfie(foto) {
    const ruta = `${pedidoSelfie.sesion_id}/${pedidoSelfie.alumno_id}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from('selfies')
      .upload(ruta, foto, { contentType: 'image/jpeg', upsert: false })
    if (error) return `No se pudo subir la foto: ${mensajeDeError(error)}`

    const respuesta = await enviar(pedidoSelfie.pase, ruta)
    if (respuesta.codigo === 'selfie_requerida') return 'No se pudo guardar la foto. Intenta de nuevo.'
    if (respuesta.codigo === 'error') return respuesta.mensaje
    mostrar(respuesta)
    return null
  }

  function otraVez() {
    terminarReintento()
    ocupado.current = false
    setResultado(null)
    setPedidoSelfie(null)
    setFase('escaneando')
  }

  const color = resultado ? colorDe(resultado.codigo) : null

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{fase === 'selfie' ? 'Tómate una selfie' : 'Escanear'}</h1>
        {fase !== 'selfie' && (
          <Link to="/mi-asistencia" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            Mi asistencia →
          </Link>
        )}
      </div>

      {/* Las dos cámaras no se usan a la vez: en iPhone abrir la frontal con
          la trasera encendida puede fallar. Por eso se cambia una por otra. */}
      {fase === 'selfie' ? (
        <CamaraSelfie limite={pedidoSelfie.limite} alCapturar={conSelfie} alCancelar={otraVez} />
      ) : (
        <CamaraQr activa={fase === 'escaneando'} alLeer={registrar}>
          {fase === 'enviando' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-lg text-white">
              <Spinner className="size-8" />
              Registrando…
            </div>
          )}

          {fase === 'resultado' && (
            <div
              role="status"
              className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white ${COLORES[color]}`}
            >
              <span aria-hidden="true" className="text-8xl font-bold leading-none">
                {ICONOS[color]}
              </span>
              <p className="text-3xl font-bold">{resultado.mensaje}</p>
            </div>
          )}
        </CamaraQr>
      )}

      {fase === 'escaneando' && (
        <p className="text-center text-slate-600 dark:text-slate-300">
          {reintentando ? 'El QR acaba de cambiar. Sigue apuntando…' : 'Apunta al QR que muestra tu profesor.'}
        </p>
      )}
      {fase === 'escaneando' && !reintentando && (
        <Link to="/activar" className="text-center text-sm font-medium text-indigo-700 dark:text-indigo-300">
          Unirme a otra clase
        </Link>
      )}

      {/* Después de un registro exitoso no hace falta volver a escanear;
          en cualquier otro caso (QR expirado, etc.) sí. */}
      {fase === 'resultado' && color === 'rojo' && (
        <Boton onClick={otraVez} className="w-full py-4 text-lg">
          Escanear de nuevo
        </Boton>
      )}

      {pideUbicacion && fase !== 'selfie' && (
        <Aviso tipo={problemaUbicacion ? 'error' : 'info'}>
          {problemaUbicacion === 'denegada'
            ? 'No diste permiso de ubicación: tu registro quedará marcado para que el profesor lo revise. Actívalo en los ajustes del navegador.'
            : problemaUbicacion
              ? 'No se pudo obtener tu ubicación: tu registro quedará marcado para que el profesor lo revise.'
              : posicion
                ? `Ubicación lista (precisión ±${Math.round(posicion.precision)} m).`
                : 'Tu profesor pide tu ubicación al registrarte. Buscando…'}
        </Aviso>
      )}
    </section>
  )
}
