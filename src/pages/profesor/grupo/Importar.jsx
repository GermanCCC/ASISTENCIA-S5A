import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { interpretarFilas, leerArchivo, revisarImportacion } from '../../../lib/importarAlumnos.js'
import { Aviso, Boton, Cargando, Spinner } from '../../../components/ui.jsx'

export default function Importar() {
  const { grupo } = useOutletContext()
  const navegar = useNavigate()
  const [existentes, setExistentes] = useState(null)
  const [archivo, setArchivo] = useState(null) // { nombre, filas }
  const [leyendo, setLeyendo] = useState(false)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState('')
  const [arrastrando, setArrastrando] = useState(false)

  // Los alumnos que ya están en el grupo (incluidos los dados de baja),
  // para no volver a importarlos.
  useEffect(() => {
    supabase
      .from('alumnos')
      .select('nombre, numero_control')
      .eq('grupo_id', grupo.id)
      .then(({ data, error }) => {
        if (error) setError(mensajeDeError(error))
        else setExistentes(data)
      })
  }, [grupo.id])

  async function procesar(elegido) {
    if (!elegido || !existentes) return
    setLeyendo(true)
    setError('')
    setArchivo(null)
    try {
      const filas = revisarImportacion(interpretarFilas(await leerArchivo(elegido)), existentes)
      setArchivo({ nombre: elegido.name, filas })
    } catch (e) {
      setError(e.message)
    } finally {
      setLeyendo(false)
    }
  }

  async function importar() {
    const nuevos = archivo.filas
      .filter((f) => !f.problema)
      .map((f) => ({ grupo_id: grupo.id, nombre: f.nombre, numero_control: f.numero_control }))

    setImportando(true)
    setError('')
    // Un solo insert con todos: o entran todos o ninguno, así no queda
    // la lista a medias si algo falla.
    const { error } = await supabase.from('alumnos').insert(nuevos)
    setImportando(false)
    if (error) {
      setError(
        mensajeDeError(error, {
          alumnos_numero_control_unico: 'Algún número de control ya existe en el grupo. Recarga la página e intenta de nuevo.',
        }),
      )
      return
    }
    navegar('..', {
      replace: true,
      state: { aviso: `Se importaron ${nuevos.length} ${nuevos.length === 1 ? 'alumno' : 'alumnos'}.` },
    })
  }

  if (!existentes && !error) return <Cargando />

  const aImportar = archivo?.filas.filter((f) => !f.problema).length ?? 0
  const omitidos = (archivo?.filas.length ?? 0) - aImportar

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to=".." className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          ← Alumnos
        </Link>
        <h2 className="mt-2 text-xl font-bold">Importar lista</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Archivo de Excel (.xlsx) o CSV con una columna <strong>nombre</strong> y, si la tienes, otra de{' '}
          <strong>número de control</strong>. La primera fila puede ser el encabezado.
        </p>
      </div>

      {/* La zona completa es un <label>: tocarla abre el selector de archivos,
          y en computadora también se puede arrastrar el archivo encima. */}
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastrando(false)
          procesar(e.dataTransfer.files[0])
        }}
        className={
          'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition ' +
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-500 ' +
          (arrastrando
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
            : 'border-slate-300 hover:border-indigo-400 dark:border-slate-700')
        }
      >
        <input
          type="file"
          accept=".xlsx,.csv,.txt"
          className="sr-only"
          onChange={(e) => {
            procesar(e.target.files[0])
            e.target.value = '' // permite volver a elegir el mismo archivo
          }}
        />
        {leyendo ? (
          <span className="flex items-center gap-2">
            <Spinner /> Leyendo archivo…
          </span>
        ) : (
          <>
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">
              {archivo ? 'Elegir otro archivo' : 'Elegir archivo'}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {archivo ? archivo.nombre : '.xlsx o .csv'}
            </span>
          </>
        )}
      </label>

      <Aviso tipo="error">{error}</Aviso>

      {archivo && (
        <>
          <div className="flex flex-wrap gap-2 text-sm font-medium">
            <span className="rounded-full bg-green-100 px-3 py-1 text-green-800 dark:bg-green-950 dark:text-green-300">
              {aImportar} se importarán
            </span>
            {omitidos > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {omitidos} se omitirán
              </span>
            )}
          </div>

          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {archivo.filas.map((f) => (
              <li key={f.renglon} className={`flex items-start gap-3 px-4 py-3 ${f.problema ? 'opacity-60' : ''}`}>
                {/* El renglón ayuda a encontrar la fila en el archivo original */}
                <span className="w-8 shrink-0 text-right font-mono text-slate-400">{f.renglon}</span>
                <div className="min-w-0 flex-1">
                  <p className={f.problema ? 'line-through' : 'font-medium'}>{f.nombre || '—'}</p>
                  <p className="font-mono text-slate-500 dark:text-slate-400">{f.numero_control ?? ''}</p>
                  {f.problema && <p className="text-amber-700 dark:text-amber-400">{f.problema}</p>}
                </div>
              </li>
            ))}
          </ul>

          {/* sticky: con listas largas el botón queda siempre a la mano */}
          <div className="sticky bottom-4">
            <Boton
              onClick={importar}
              cargando={importando}
              disabled={aImportar === 0}
              className="w-full py-4 text-lg shadow-lg"
            >
              {aImportar === 0
                ? 'No hay alumnos nuevos'
                : `Importar ${aImportar} ${aImportar === 1 ? 'alumno' : 'alumnos'}`}
            </Boton>
          </div>
        </>
      )}
    </div>
  )
}
