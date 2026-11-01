import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { supabase, modoLocal } from '../../../lib/supabase.js'
import { localRequest } from '../../../lib/localClient.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { generarPdfTarjetas } from '../../../lib/tarjetasPdf.js'
import { Aviso, Boton, Cargando } from '../../../components/ui.jsx'

// Dirección que llevan los QR de las tarjetas. En desarrollo es
// localhost, que no abre desde el celular de un alumno; por eso se puede
// fijar la dirección publicada con VITE_URL_PUBLICA en el .env.
const URL_BASE = (import.meta.env.VITE_URL_PUBLICA || window.location.origin).replace(/\/$/, '')
const URL_LOCAL = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(URL_BASE)

export default function Tarjetas() {
  const { grupo } = useOutletContext()
  const [alumnos, setAlumnos] = useState(null)
  const [seleccion, setSeleccion] = useState(new Set())
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')

  useEffect(() => {
    supabase
      .from('alumnos')
      .select('id, nombre, numero_control, activado_en')
      .eq('grupo_id', grupo.id)
      .eq('activo', true)
      .then(({ data, error }) => {
        if (error) {
          setError(mensajeDeError(error))
          return
        }
        const ordenados = data.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        setAlumnos(ordenados)
        // Por defecto: los que todavía no activan su cuenta.
        setSeleccion(new Set(ordenados.filter((a) => !a.activado_en).map((a) => a.id)))
      })
  }, [grupo.id])

  function alternar(id) {
    setSeleccion((anterior) => {
      const nueva = new Set(anterior)
      if (nueva.has(id)) nueva.delete(id)
      else nueva.add(id)
      return nueva
    })
  }

  async function generar() {
    setGenerando(true)
    setError('')
    setListo('')
    try {
      // Aquí se crean los códigos. Es el único momento en que existen en
      // texto: la base de datos solo guarda su hash.
      const { data, error } = await supabase.rpc('generar_codigos_activacion', {
        p_grupo_id: grupo.id,
        p_alumno_ids: [...seleccion],
      })
      if (error) {
        setError(mensajeDeError(error))
        return
      }

      const porId = new Map(alumnos.map((a) => [a.id, a]))
      const tarjetas = data
        .map(({ alumno_id, codigo }) => ({ ...porId.get(alumno_id), codigo }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

      let urlBase = URL_BASE
      if (modoLocal) {
        const { data: conexion, error: fallo } = await localRequest('/connection')
        if (fallo || !conexion?.addresses.length) throw new Error('Conecta esta computadora al wifi del salón para generar las tarjetas.')
        const elegida = localStorage.getItem('asistencia-url-telefonos')
        urlBase = conexion.addresses.find(item => item.url === elegida)?.url ?? conexion.addresses[0].url
      }
      await generarPdfTarjetas({ grupo, tarjetas, urlBase })
      setListo(`Se descargó el PDF con ${tarjetas.length} ${tarjetas.length === 1 ? 'tarjeta' : 'tarjetas'}.`)
    } catch (e) {
      setError(`No se pudo crear el PDF: ${e.message}`)
    } finally {
      setGenerando(false)
    }
  }

  if (error && !alumnos) return <Aviso tipo="error">{error}</Aviso>
  if (!alumnos) return <Cargando />

  const sinActivar = alumnos.filter((a) => !a.activado_en)
  const elegirSolo = (lista) => setSeleccion(new Set(lista.map((a) => a.id)))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to=".." className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ← Alumnos
        </Link>
        <h2 className="mt-2 text-xl font-bold">Tarjetas de activación</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Un PDF con una tarjeta por alumno (10 por hoja) con su código y un QR para activar su cuenta.
        </p>
      </div>

      <Aviso tipo="info">
        Se crean <strong>códigos nuevos</strong>: los anteriores de estos alumnos dejan de funcionar. Los códigos solo
        aparecen en el PDF, así que guárdalo o imprímelo. Si un alumno ya activado cambió de celular, genérale una
        tarjeta nueva: su celular nuevo quedará pendiente de tu aprobación.
      </Aviso>

      {URL_LOCAL && !modoLocal && (
        <Aviso tipo="error">
          Los QR apuntarán a <strong>{URL_BASE}</strong>, que no abre desde el celular de los alumnos. Genera las
          tarjetas desde la versión publicada o pon la dirección correcta en <code>VITE_URL_PUBLICA</code>.
        </Aviso>
      )}

      <div className="flex flex-wrap gap-2">
        <Boton variante="secundario" className="py-2" onClick={() => elegirSolo(sinActivar)}>
          Sin activar ({sinActivar.length})
        </Boton>
        <Boton variante="secundario" className="py-2" onClick={() => elegirSolo(alumnos)}>
          Todos
        </Boton>
        <Boton variante="secundario" className="py-2" onClick={() => elegirSolo([])}>
          Ninguno
        </Boton>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {alumnos.map((a) => (
          <li key={a.id}>
            <label className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <input
                type="checkbox"
                checked={seleccion.has(a.id)}
                onChange={() => alternar(a.id)}
                className="size-5 accent-indigo-600"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{a.nombre}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">
                  {a.numero_control && <span className="mr-3 font-mono">{a.numero_control}</span>}
                  {a.activado_en ? 'Ya activó (cambio de celular)' : 'Sin activar'}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <Aviso tipo="error">{error}</Aviso>
      <Aviso tipo="exito">{listo}</Aviso>

      <div className="sticky bottom-4">
        <Boton
          onClick={generar}
          cargando={generando}
          disabled={seleccion.size === 0}
          className="w-full py-4 text-lg shadow-lg"
        >
          {seleccion.size === 0
            ? 'Elige al menos un alumno'
            : `Generar PDF (${seleccion.size} ${seleccion.size === 1 ? 'tarjeta' : 'tarjetas'})`}
        </Boton>
      </div>
    </div>
  )
}
