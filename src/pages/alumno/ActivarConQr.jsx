import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { llamarFuncion } from '../../lib/funciones.js'
import { obtenerDeviceId } from '../../lib/dispositivo.js'
import { claveNombre, limpiarNumeroControl, problemaNumeroControl } from '../../lib/texto.js'
import { mensajeDeError } from '../../lib/errores.js'
import { Aviso, Boton, Campo, Spinner } from '../../components/ui.jsx'
import CamaraQr from '../../components/CamaraQr.jsx'

// Activación con el QR del grupo. Pasos:
//   escanear → elegir nombre → capturar número de control → esperar
//   aprobación (mostrando el número de verificación) → recibir la sesión.
//
// La solicitud en espera se guarda en el celular: si el alumno cierra la
// app, al volver sigue esperando donde se quedó.

const CLAVE = 'solicitud_activacion'

export function hayActivacionPendiente() {
  return Boolean(leerPendiente())
}
function leerPendiente() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE))
  } catch {
    return null
  }
}
function guardarPendiente(datos) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos))
  } catch {
    // Sin almacenamiento: funciona igual mientras la pantalla siga abierta.
  }
}
function borrarPendiente() {
  try {
    localStorage.removeItem(CLAVE)
  } catch {
    // nada que hacer
  }
}

// 32 bytes aleatorios en hexadecimal. Este secreto prueba que la solicitud
// es de ESTE celular; el servidor solo guarda su hash.
function secretoAleatorio() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// tokenInicial: el QR ya leído en Escanear (el alumno no tiene que volver a
// escanearlo). unirme: el alumno ya tiene sesión y se une con su cuenta.
export default function ActivarConQr({ tokenInicial = null, unirme = false, alListo, alVolver }) {
  const [solicitud, setSolicitud] = useState(leerPendiente)
  const [paso, setPaso] = useState(() =>
    leerPendiente() ? 'esperando' : tokenInicial ? 'cargando' : 'escaneando',
  )
  const [grupo, setGrupo] = useState(null) // respuesta de "listar": pase, grupo, nombres
  const [elegido, setElegido] = useState(null) // { alumno, tipo }
  const [aviso, setAviso] = useState('')
  const ocupado = useRef(false)

  async function alLeer(texto) {
    if (ocupado.current) return
    ocupado.current = true
    if (!texto.startsWith('A.')) {
      setAviso('Ese no es el QR de activación. Pídele a tu profesor que abra «Activar alumnos».')
      setPaso('error')
      return
    }
    setPaso('cargando')
    const r = await llamarFuncion('activar-por-qr', { accion: 'listar', token: texto })
    if (r.codigo !== 'ok') {
      setAviso(r.mensaje)
      setPaso('error')
      return
    }
    setGrupo(r)
    setPaso('eligiendo')
  }

  // QR que llegó ya leído desde Escanear: se revisa enseguida, porque solo
  // dura unos segundos. Solo al abrir la pantalla (por eso la lista vacía);
  // "ocupado" evita revisarlo dos veces.
  useEffect(() => {
    if (tokenInicial && !leerPendiente()) alLeer(tokenInicial)
  }, [])

  function escanearDeNuevo() {
    ocupado.current = false
    setAviso('')
    setGrupo(null)
    setElegido(null)
    setPaso('escaneando')
  }

  if (paso === 'eligiendo') {
    return (
      <ElegirNombre
        datos={grupo}
        alElegir={(alumno, tipo) => {
          setElegido({ alumno, tipo })
          setPaso('capturando')
        }}
        alCancelar={escanearDeNuevo}
      />
    )
  }

  if (paso === 'capturando') {
    return (
      <CapturarNumero
        pase={grupo.pase}
        elegido={elegido}
        grupoNombre={grupo.grupo.nombre}
        unirme={unirme}
        alEnviar={(nueva) => {
          guardarPendiente(nueva)
          setSolicitud(nueva)
          setPaso('esperando')
        }}
        alVolver={() => setPaso('eligiendo')}
        alReescanear={escanearDeNuevo}
      />
    )
  }

  if (paso === 'esperando') {
    return (
      <Esperando
        solicitud={solicitud}
        alListo={(resultado) => {
          borrarPendiente()
          alListo(resultado)
        }}
        alReiniciar={() => {
          borrarPendiente()
          setSolicitud(null)
          escanearDeNuevo()
        }}
        alCancelar={() => {
          borrarPendiente()
          alVolver()
        }}
      />
    )
  }

  // escaneando | cargando | error
  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">Escanea el QR de activación</h1>
      <CamaraQr activa={paso === 'escaneando'} alLeer={alLeer}>
        {paso === 'cargando' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-lg text-white">
            <Spinner className="size-8" />
            Revisando…
          </div>
        )}
        {paso === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-600 p-6 text-center text-2xl font-bold text-white">
            {aviso}
          </div>
        )}
      </CamaraQr>
      {paso === 'error' ? (
        <Boton onClick={escanearDeNuevo} className="w-full py-4 text-lg">
          Escanear de nuevo
        </Boton>
      ) : (
        <p className="text-center text-slate-600 dark:text-slate-300">
          Apunta al QR que tu profesor muestra en «Activar alumnos».
        </p>
      )}
      <button type="button" onClick={alVolver} className="text-sm font-medium text-slate-600 dark:text-slate-400">
        ← Volver
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------
// Elegir nombre
// ---------------------------------------------------------------------
function ElegirNombre({ datos, alElegir, alCancelar }) {
  const [busqueda, setBusqueda] = useState('')
  const [cambio, setCambio] = useState(false)

  const lista = cambio ? datos.activados : datos.sin_activar
  const filtro = claveNombre(busqueda)
  const visibles = lista.filter((a) => !filtro || claveNombre(a.nombre).includes(filtro))

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {datos.grupo.nombre} · {datos.grupo.materia}
        </p>
        <h1 className="text-2xl font-bold">{cambio ? '¿Quién eres? (cambio de celular)' : '¿Quién eres?'}</h1>
      </div>

      {cambio && (
        <Aviso tipo="error">
          Elige esto solo si ya tenías cuenta en otro celular. Al aprobarse, tu celular anterior dejará de funcionar.
        </Aviso>
      )}

      {lista.length > 8 && (
        <input
          type="search"
          placeholder="Busca tu nombre"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
        />
      )}

      <ul className="flex flex-col gap-2">
        {visibles.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => alElegir(a, cambio ? 'cambio' : 'nueva')}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-left font-medium hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900"
            >
              {a.nombre}
            </button>
          </li>
        ))}
        {visibles.length === 0 && (
          <li className="p-4 text-center text-slate-500 dark:text-slate-400">
            {lista.length === 0 && !cambio ? 'Todos los alumnos ya activaron su cuenta.' : 'Ningún nombre coincide.'}
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={() => {
          setCambio(!cambio)
          setBusqueda('')
        }}
        className="text-sm font-medium text-indigo-700 dark:text-indigo-300"
      >
        {cambio ? '← No, es mi primera vez' : 'Ya tenía cuenta, cambié de celular'}
      </button>
      <button type="button" onClick={alCancelar} className="text-sm font-medium text-slate-600 dark:text-slate-400">
        Cancelar
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------
// Número de control y envío de la solicitud
// ---------------------------------------------------------------------
function CapturarNumero({ pase, elegido, grupoNombre, unirme, alEnviar, alVolver, alReescanear }) {
  const [numeroControl, setNumeroControl] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null) // { codigo, mensaje }

  async function enviar(evento) {
    evento.preventDefault()
    // La base de datos vuelve a revisar esto; aquí es solo para avisar al momento.
    const problema = problemaNumeroControl(limpiarNumeroControl(numeroControl))
    if (problema) {
      setError({ codigo: 'numero_control', mensaje: problema })
      return
    }
    setEnviando(true)
    setError(null)
    const secreto = secretoAleatorio()
    const r = await llamarFuncion('activar-por-qr', {
      accion: 'solicitar',
      pase,
      alumno_id: elegido.alumno.id,
      tipo: elegido.tipo,
      numero_control: numeroControl,
      device_id: await obtenerDeviceId(),
      user_agent: navigator.userAgent,
      secreto,
      // Con sesión de alumno: se une con su cuenta (el servidor la verifica).
      unirme,
    })
    setEnviando(false)
    if (r.codigo !== 'ok') {
      setError(r)
      return
    }
    alEnviar({
      solicitud_id: r.solicitud_id,
      secreto,
      numero_verificacion: r.numero_verificacion,
      nombre: r.nombre,
      grupo: grupoNombre,
    })
  }

  // Si se acabó el pase o el profesor cerró la ventana, hay que volver a escanear.
  const hayQueReescanear = ['pase_vencido', 'activacion_cerrada', 'error'].includes(error?.codigo)

  return (
    <section className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">{elegido.alumno.nombre}</h1>
      {unirme && (
        <Aviso tipo="info">
          Te unirás a <strong>{grupoNombre}</strong> con tu cuenta actual. No pierdes tus otras clases.
        </Aviso>
      )}
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Campo
          etiqueta="Tu número de control"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          autoFocus
          value={numeroControl}
          onChange={(e) => setNumeroControl(e.target.value)}
        />
        <Aviso tipo="error">{error?.mensaje}</Aviso>
        {hayQueReescanear ? (
          <Boton onClick={alReescanear} className="w-full py-4 text-lg">
            Escanear de nuevo
          </Boton>
        ) : (
          <Boton type="submit" cargando={enviando} disabled={!numeroControl.trim()} className="w-full py-4 text-lg">
            Enviar solicitud
          </Boton>
        )}
      </form>
      <button type="button" onClick={alVolver} className="text-sm font-medium text-slate-600 dark:text-slate-400">
        ← No soy yo
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------
// Esperar la aprobación y recibir la sesión
// ---------------------------------------------------------------------
const MENSAJES_FINALES = {
  rechazada: 'El profesor rechazó la solicitud. Si fue un error, escanea de nuevo y avísale.',
  vencida: 'La solicitud venció sin respuesta. Escanea de nuevo.',
  canjeada: 'Esta solicitud ya se usó.',
  no_encontrada: 'No se encontró la solicitud. Escanea de nuevo.',
}

function Esperando({ solicitud, alListo, alReiniciar, alCancelar }) {
  const [final, setFinal] = useState(null) // mensaje si terminó sin éxito
  const [problema, setProblema] = useState('')
  // Se guarda en una ref para que el sondeo no se reinicie cada vez que la
  // pantalla de arriba se vuelve a dibujar (alListo sería otra función).
  const alListoActual = useRef(alListo)
  useEffect(() => {
    alListoActual.current = alListo
  }, [alListo])

  useEffect(() => {
    let cancelado = false
    let temporizador

    async function consultar() {
      const r = await llamarFuncion('activar-por-qr', {
        accion: 'consultar',
        solicitud_id: solicitud.solicitud_id,
        secreto: solicitud.secreto,
      })
      if (cancelado) return
      if (r.codigo === 'error') {
        // Sin conexión: se sigue intentando.
        setProblema(r.mensaje)
        temporizador = setTimeout(consultar, 5000)
        return
      }
      setProblema('')
      if (r.codigo === 'ok' && r.estado === 'pendiente') {
        temporizador = setTimeout(consultar, 3000)
        return
      }
      if (r.codigo === 'ok' && r.estado === 'aprobada') {
        canjear()
        return
      }
      setFinal(MENSAJES_FINALES[r.estado ?? r.codigo] ?? r.mensaje)
    }

    async function canjear() {
      const r = await llamarFuncion('activar-por-qr', {
        accion: 'canjear',
        solicitud_id: solicitud.solicitud_id,
        secreto: solicitud.secreto,
        device_id: await obtenerDeviceId(),
      })
      if (cancelado) return
      if (r.codigo === 'error') {
        setProblema(r.mensaje)
        temporizador = setTimeout(canjear, 3000)
        return
      }
      if (r.codigo !== 'ok') {
        setFinal(MENSAJES_FINALES[r.codigo] ?? r.mensaje)
        return
      }
      // Se unió con su cuenta: su celular ya tiene la sesión, no se toca.
      if (r.union) {
        alListoActual.current({ nombre: r.nombre, estado_dispositivo: 'activo', union: true })
        return
      }
      // La sesión se guarda en este celular: ya no tendrá que activar otra vez.
      const { error } = await supabase.auth.setSession(r.sesion)
      if (error) {
        setProblema(mensajeDeError(error))
        temporizador = setTimeout(canjear, 3000)
        return
      }
      alListoActual.current({ nombre: r.nombre, estado_dispositivo: 'activo' })
    }

    consultar()
    return () => {
      cancelado = true
      clearTimeout(temporizador)
    }
  }, [solicitud])

  if (final) {
    return (
      <section className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-6 text-center">
        <p className="text-xl font-semibold">{final}</p>
        <Boton onClick={alReiniciar} className="w-full py-4 text-lg">
          Escanear de nuevo
        </Boton>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col items-center gap-4 pt-6 text-center">
      <p className="text-sm text-slate-500 dark:text-slate-400">{solicitud.grupo}</p>
      <h1 className="text-xl font-bold">{solicitud.nombre}</h1>
      <p className="text-slate-600 dark:text-slate-300">Muéstrale este número a tu profesor:</p>
      <p className="font-mono text-8xl font-bold tabular-nums tracking-widest">{solicitud.numero_verificacion}</p>
      <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
        <Spinner /> Esperando aprobación…
      </p>
      <Aviso tipo="info">{problema}</Aviso>
      <button type="button" onClick={alCancelar} className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">
        Cancelar
      </button>
    </section>
  )
}
