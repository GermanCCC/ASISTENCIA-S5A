import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import QRCode from 'qrcode'
import { localRequest } from '../../lib/localClient.js'
import { modoLocal, supabase } from '../../lib/supabase.js'
import { useAuth } from '../../lib/auth.jsx'
import { Aviso, Boton, Campo, Cargando } from '../../components/ui.jsx'

export function PrimeraConfiguracion({ onComplete }) {
  const [credentials, setCredentials] = useState({ name: '', email: '', password: '' })
  const [recovery, setRecovery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const { sesion } = useAuth()
  if (done || sesion && !recovery && !busy) return <Navigate to="/profesor/conexion" replace />
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    const result = await supabase.auth.setup(credentials)
    if (result.error) setError(result.error.message)
    else setRecovery(result.data.recovery)
    setBusy(false)
  }
  return <section className="mx-auto flex max-w-md flex-col gap-5">
    <h1 className="text-2xl font-bold">Bienvenido a Asistencia local</h1>
    {recovery ? <>
      <p>Guarda este código de recuperación fuera de esta computadora. Te permitirá cambiar tu contraseña sin internet.</p>
      <code className="break-all rounded-xl bg-slate-100 p-4 text-lg dark:bg-slate-800">{recovery}</code>
      <Boton onClick={() => {
        const url = URL.createObjectURL(new Blob([`Asistencia local\nCódigo de recuperación: ${recovery}\nGuárdalo en un lugar privado.\n`], { type: 'text/plain' }))
        const a = document.createElement('a'); a.href = url; a.download = 'recuperacion-asistencia.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Guardar código en un archivo</Boton>
      <Boton variante="secundario" onClick={() => { onComplete?.(); setDone(true) }}>Ya guardé mi código. Continuar</Boton>
    </> : <>
      <p>Crea tu cuenta de profesor en esta computadora. El correo será tu nombre de acceso; no se enviarán mensajes ni se necesita internet.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Campo etiqueta="Tu nombre" required maxLength={100} value={credentials.name} onChange={e => setCredentials({ ...credentials, name: e.target.value })} />
        <Campo etiqueta="Correo" type="email" required autoComplete="username" value={credentials.email} onChange={e => setCredentials({ ...credentials, email: e.target.value })} />
        <Campo etiqueta="Contraseña" type="password" required minLength={10} maxLength={200} autoComplete="new-password" ayuda="Al menos 10 caracteres" value={credentials.password} onChange={e => setCredentials({ ...credentials, password: e.target.value })} />
        <Aviso tipo="error">{error}</Aviso>
        <Boton type="submit" cargando={busy}>Crear mi cuenta local</Boton>
      </form>
    </>}
  </section>
}

export default function ConfiguracionLocal() {
  const [info, setInfo] = useState(null)
  const [selected, setSelected] = useState(0)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!modoLocal) return
    localRequest('/connection').then(({ data, error }) => { if (error) setError(error.message); else setInfo(data) })
  }, [])
  const connection = info?.addresses[selected]
  useEffect(() => {
    let cancelled = false
    if (connection) {
      localStorage.setItem('asistencia-url-telefonos', connection.url)
      QRCode.toDataURL(connection.setup, { width: 300, margin: 2 }).then(url => { if (!cancelled) setQr(url) })
    }
    return () => { cancelled = true }
  }, [connection])
  if (!modoLocal) return <Navigate to="/profesor" replace />
  if (!info) return error ? <Aviso tipo="error">{error}</Aviso> : <Cargando />
  async function backup() {
    setBusy(true); setError(''); setMessage('')
    const { data, error } = await localRequest('/backup')
    if (error) setError(error.message)
    else {
      // localRequest devuelve data; el respaldo usa su propio formato de archivo.
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = `asistencia-respaldo-${new Date().toISOString().slice(0, 10)}.json`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Respaldo descargado. Guárdalo también en una memoria USB.')
    }
    setBusy(false)
  }
  async function restore(event) {
    const file = event.target.files[0]
    if (!file) return
    setError(''); setMessage('')
    if (file.size > 100 * 1024 * 1024) { setError('El archivo supera 100 MB. Solicita ayuda para importar un respaldo grande.'); return }
    setBusy(true)
    try {
      const input = JSON.parse(await file.text())
      if (!window.confirm('¿Importar grupos, alumnos e historial? Esta opción requiere que todavía no hayas creado grupos. Los alumnos tendrán que activar su teléfono de nuevo.')) return
      const { data, error } = await localRequest('/import', input)
      if (error) setError(error.message)
      else setMessage(`Importación terminada: ${data.grupos} grupos, ${data.alumnos} alumnos y ${data.asistencias} asistencias. Los alumnos deben activar sus teléfonos de nuevo.`)
    } catch { setError('No se pudo leer el archivo. Selecciona un respaldo JSON de Asistencia.') }
    finally { setBusy(false); event.target.value = '' }
  }
  return <section className="flex flex-col gap-6">
    <div><h1 className="text-2xl font-bold">Conectar teléfonos</h1><p className="mt-2 text-slate-600 dark:text-slate-300">La computadora y los teléfonos deben estar en el mismo wifi. El router puede funcionar sin internet. Mantén abierta esta aplicación durante la clase.</p></div>
    {!connection ? <Aviso tipo="error">No se encontró una conexión de red. Conecta la computadora al router y reinicia la aplicación.</Aviso> : <>
      {info.addresses.length > 1 && <label className="flex flex-col gap-2">Dirección de la red del salón<select className="rounded-lg border bg-white p-3 dark:bg-slate-800" value={selected} onChange={e => setSelected(Number(e.target.value))}>{info.addresses.map((item, index) => <option key={item.url} value={index}>{item.url}</option>)}</select></label>}
      <div className="rounded-2xl border border-slate-200 p-6 text-center dark:border-slate-700">
        <h2 className="text-xl font-semibold">Primera conexión de los alumnos</h2>
        {qr && <img src={qr} alt="QR para configurar el teléfono en la red del salón" className="mx-auto my-4 size-64 rounded-xl bg-white" />}
        <p>Escanea con la cámara normal del teléfono para instalar el certificado y abrir Asistencia.</p>
        <p className="mt-3 break-all font-mono text-lg">{connection.setup}</p>
      </div>
      <p>Después de configurarlo, entra desde el icono de Asistencia o abre <strong className="break-all">{connection.url}</strong>. Dentro de la aplicación podrás escanear el QR de activación y el de cada pase de lista.</p>
      <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer font-semibold">Comprobar el certificado del salón</summary><p className="mt-3">Esta huella debe coincidir con la que aparece en el teléfono:</p><code className="mt-2 block break-all text-xs">{info.fingerprint}</code></details>
    </>}
    <Aviso tipo="info">Si los teléfonos no se conectan, comprueba que el router permita comunicación entre dispositivos y que Windows permita Asistencia en redes privadas. Conviene reservar la dirección de esta computadora en el router para conservar los accesos de los teléfonos.</Aviso>
    {info.dataDir && <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h2 className="text-xl font-semibold">Respaldar mis datos</h2><p>Incluye grupos, alumnos, historial y fotos. Si se restaura en otra instalación, los alumnos deberán volver a activar sus teléfonos.</p>
      <Boton onClick={backup} cargando={busy}>Descargar respaldo</Boton>
      <h2 className="mt-4 text-xl font-semibold">Importar datos</h2><p>Antes de crear grupos, puedes importar un respaldo local o una exportación de Supabase. Se conserva el historial y los alumnos vuelven a activar sus teléfonos.</p>
      <input type="file" accept=".json,application/json" aria-label="Importar respaldo de Asistencia" disabled={busy} onChange={restore} />
      <Aviso tipo="error">{error}</Aviso><Aviso tipo="exito">{message}</Aviso>
      <details><summary>Ubicación de los datos</summary><p className="mt-2 break-all text-sm">{info.dataDir}</p></details>
    </div>}
  </section>
}

export function RecuperacionLocal() {
  const [recovery, setRecovery] = useState('')
  const [password, setPassword] = useState('')
  const [replacement, setReplacement] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    const result = await localRequest('/auth/recover', { recovery, password })
    if (result.error) setError(result.error.message)
    else setReplacement(result.data.recovery)
    setBusy(false)
  }
  return <section className="mx-auto flex max-w-md flex-col gap-5"><h1 className="text-2xl font-bold">Recuperar acceso local</h1>
    <p>Hazlo en la aplicación de Windows con el código que guardaste al crear tu cuenta.</p>
    {replacement ? <><p>Tu contraseña cambió. Guarda este código nuevo; el anterior dejó de servir:</p><code className="break-all rounded-xl bg-slate-100 p-4 dark:bg-slate-800">{replacement}</code><a href="/login" className="font-semibold text-indigo-600">Volver a entrar</a></> :
      <form onSubmit={submit} className="flex flex-col gap-4"><Campo etiqueta="Código de recuperación" required value={recovery} onChange={e => setRecovery(e.target.value)} /><Campo etiqueta="Nueva contraseña" type="password" minLength={10} maxLength={200} autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /><Aviso tipo="error">{error}</Aviso><Boton type="submit" cargando={busy}>Cambiar contraseña</Boton></form>}
  </section>
}
