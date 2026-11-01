import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { obtenerDeviceId } from '../../lib/dispositivo.js'
import { llamarFuncion } from '../../lib/funciones.js'
import { mensajeDeError } from '../../lib/errores.js'
import { limpiarNumeroControl, problemaNumeroControl } from '../../lib/texto.js'
import { Aviso, Boton, Campo, clasesBoton } from '../../components/ui.jsx'
import ActivarConQr, { hayActivacionPendiente } from './ActivarConQr.jsx'

// Dos formas de activar la cuenta:
//   - Escaneando el QR que el profesor muestra en «Activar alumnos» (principal).
//   - Con el código de una tarjeta impresa (si llega con ?codigo=... desde
//     el QR de la tarjeta, va directo a esta).
//
// Si el alumno YA tiene sesión, esta misma pantalla sirve para "Unirme a
// otra clase": se une con su cuenta actual, aunque la clase sea de otro
// profesor, y no pierde las demás (migración 12). Si llega desde Escanear
// con el QR de activación ya leído (state.tokenQr), empieza con ese QR.
export default function Activar() {
  const { rol } = useAuth()
  const [parametros] = useSearchParams()
  const ubicacion = useLocation()
  const codigoUrl = parametros.get('codigo')
  const tokenQr = ubicacion.state?.tokenQr ?? null
  const unirme = rol === 'alumno'
  const [modo, setModo] = useState(() =>
    codigoUrl ? 'codigo' : tokenQr || hayActivacionPendiente() ? 'qr' : 'inicio',
  )
  const [resultado, setResultado] = useState(null)

  if (resultado) return <Resultado {...resultado} />

  // Útil al hacer pruebas en la computadora del profesor
  const avisoProfesor = rol === 'profesor' && (
    <Aviso tipo="info" className="mx-auto mb-6 max-w-sm">
      Tienes abierta una sesión de profesor en este navegador. Si activas una cuenta de alumno, esa sesión se cerrará.
    </Aviso>
  )

  if (modo === 'qr') {
    return (
      <>
        {avisoProfesor}
        <ActivarConQr tokenInicial={tokenQr} unirme={unirme} alListo={setResultado} alVolver={() => setModo('inicio')} />
      </>
    )
  }

  if (modo === 'codigo') {
    return (
      <>
        {avisoProfesor}
        <ConCodigo codigoInicial={codigoUrl ?? ''} unirme={unirme} alListo={setResultado} alVolver={() => setModo('inicio')} />
      </>
    )
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col gap-4 pt-6">
      {avisoProfesor}
      {unirme ? (
        <>
          <Link to="/mi-asistencia" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            ← Mi asistencia
          </Link>
          <h1 className="text-2xl font-bold">Unirme a otra clase</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Te unirás con tu cuenta actual: verás todas tus clases juntas en «Mi asistencia».
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Activar mi cuenta</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Hazlo en <strong>tu</strong> celular: quedará ligado a tu cuenta.
          </p>
        </>
      )}
      <Boton onClick={() => setModo('qr')} className="mt-4 w-full py-5 text-lg">
        Escanear el QR del profesor
      </Boton>
      <Boton variante="secundario" onClick={() => setModo('codigo')} className="w-full py-4">
        Tengo una tarjeta con código
      </Boton>
    </section>
  )
}

// ---------------------------------------------------------------------
// Activación con el código de la tarjeta (fase 4)
// ---------------------------------------------------------------------

// "abcd efgh" → "ABCD-EFGH" mientras se escribe: más fácil de comparar
// con la tarjeta impresa.
function formatearCodigo(texto) {
  const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio
}

function ConCodigo({ codigoInicial, unirme, alListo, alVolver }) {
  const [codigo, setCodigo] = useState(() => formatearCodigo(codigoInicial))
  const [numeroControl, setNumeroControl] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  async function activar(evento) {
    evento.preventDefault()
    // La base de datos vuelve a revisar esto; aquí es solo para avisar al momento.
    const problema = problemaNumeroControl(limpiarNumeroControl(numeroControl))
    if (problema) {
      setError(problema)
      return
    }
    setEnviando(true)
    setError('')
    try {
      const r = await llamarFuncion('activar-alumno', {
        codigo,
        numero_control: numeroControl,
        device_id: await obtenerDeviceId(),
        user_agent: navigator.userAgent,
        // Con sesión de alumno: se une con su cuenta (el servidor la verifica).
        unirme,
      })
      if (r.codigo !== 'ok') {
        setError(r.mensaje)
        return
      }
      // Si se unió con su cuenta, su celular ya tiene la sesión. Si no, la
      // función ya inició la sesión en el servidor y aquí se guarda en este
      // celular para que no tenga que volver a entrar.
      if (!r.union) {
        const { error: errSesion } = await supabase.auth.setSession(r.sesion)
        if (errSesion) {
          setError(mensajeDeError(errSesion))
          return
        }
      }
      alListo(r)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="mx-auto max-w-sm pt-6">
      <h1 className="text-2xl font-bold">{unirme ? 'Unirme con tarjeta' : 'Activar con tarjeta'}</h1>
      <p className="mt-1 text-slate-500 dark:text-slate-400">Usa los datos de la tarjeta que te dio tu profesor.</p>

      <form onSubmit={activar} className="mt-8 flex flex-col gap-4">
        <Campo
          etiqueta="Número de control"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          value={numeroControl}
          onChange={(e) => setNumeroControl(e.target.value)}
        />
        <Campo
          etiqueta="Código de activación"
          placeholder="XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          value={codigo}
          onChange={(e) => setCodigo(formatearCodigo(e.target.value))}
          className="[&_input]:font-mono [&_input]:text-xl [&_input]:tracking-widest"
        />
        <Aviso tipo="error">{error}</Aviso>
        <Boton
          type="submit"
          cargando={enviando}
          disabled={codigo.length < 9 || !numeroControl.trim()}
          className="mt-2 w-full py-4 text-lg"
        >
          Activar
        </Boton>
      </form>
      <button type="button" onClick={alVolver} className="mt-6 text-sm font-medium text-slate-600 dark:text-slate-400">
        ← Volver
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------
// Pantalla final (para las dos formas)
// ---------------------------------------------------------------------

// "JESUS ANTONIO AGUILAR" → "Jesus"
function primerNombre(nombre) {
  const primero = nombre.trim().split(/\s+/)[0] ?? ''
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
}

function Resultado({ nombre, estado_dispositivo, union }) {
  const pendiente = estado_dispositivo === 'pendiente'

  if (union && !pendiente) {
    return (
      <section className="mx-auto flex max-w-sm flex-col items-center pt-10 text-center">
        <div aria-hidden="true" className="grid size-24 place-items-center rounded-full bg-green-600 text-5xl text-white">
          ✓
        </div>
        <h1 className="mt-6 text-2xl font-bold">¡Te uniste a la clase!</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Quedaste como <strong>{nombre}</strong>, con tu misma cuenta. Ya puedes pasar lista en esta clase y verla en
          «Mi asistencia» junto con las demás.
        </p>
        <Link to="/escanear" replace className={clasesBoton('primario', 'mt-8 w-full py-4 text-lg')}>
          Ir a escanear
        </Link>
        <Link to="/mi-asistencia" replace className="mt-4 font-medium text-indigo-700 dark:text-indigo-300">
          Ver mi asistencia
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col items-center pt-10 text-center">
      <div
        aria-hidden="true"
        className={`grid size-24 place-items-center rounded-full text-5xl text-white ${pendiente ? 'bg-amber-500' : 'bg-green-600'}`}
      >
        {pendiente ? '⏳' : '✓'}
      </div>

      <h1 className="mt-6 text-2xl font-bold">{pendiente ? 'Falta un paso' : `¡Listo, ${primerNombre(nombre)}!`}</h1>

      {pendiente ? (
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Ya tenías otro celular registrado. Pídele a tu profesor que apruebe este; después podrás registrar tu
          asistencia desde aquí.
        </p>
      ) : (
        <p className="mt-2 text-slate-600 dark:text-slate-300">Tu cuenta quedó activada en este celular.</p>
      )}

      {/* En iPhone, Safari borra los datos de las páginas que no se usan en
          7 días; las apps agregadas a la pantalla de inicio no. Por eso se
          recomienda instalarla: así no se pierde la sesión ni el celular. */}
      <div className="mt-8 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="font-semibold">Agrega la app a tu pantalla de inicio</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">
          Así la abres directo y no pierdes tu sesión. En el menú del navegador (⋮ o el botón de compartir) elige
          «Agregar a pantalla de inicio» o «Instalar app».
        </p>
      </div>

      {!pendiente && (
        <Link to="/escanear" replace className={clasesBoton('primario', 'mt-8 w-full py-4 text-lg')}>
          Ir a escanear
        </Link>
      )}
    </section>
  )
}
