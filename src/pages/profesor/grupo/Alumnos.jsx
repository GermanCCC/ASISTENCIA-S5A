import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import {
  LARGO_NUMERO_CONTROL,
  claveNombre,
  limpiarNombre,
  limpiarNumeroControl,
  problemaNumeroControl,
} from '../../../lib/texto.js'
import { Aviso, Boton, Campo, Cargando, Tarjeta, clasesBoton } from '../../../components/ui.jsx'

// Mensajes para las reglas de la tabla alumnos que el profesor puede romper.
// (La de formato normalmente se detecta antes con problemaNumeroControl;
// esta es por si la base de datos la rechaza de todos modos.)
const ERRORES_ALUMNO = {
  alumnos_numero_control_unico: 'Ese número de control ya está en el grupo',
  alumnos_numero_control_formato: `El número de control debe tener entre ${LARGO_NUMERO_CONTROL.min} y ${LARGO_NUMERO_CONTROL.max} letras o números`,
  alumnos_nombre_check: 'Escribe el nombre',
}

const ordenarPorNombre = (lista) => [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

export default function Alumnos() {
  const { grupo } = useOutletContext()
  const ubicacion = useLocation()
  const [alumnos, setAlumnos] = useState(null)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [editandoId, setEditandoId] = useState(null)
  const [verBajas, setVerBajas] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('alumnos')
      .select('id, nombre, numero_control, activo, activado_en')
      .eq('grupo_id', grupo.id)
    if (error) setError(mensajeDeError(error))
    else setAlumnos(ordenarPorNombre(data))
  }, [grupo.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Reemplaza un alumno en la lista después de editarlo o darlo de baja,
  // sin volver a pedir todo al servidor.
  const actualizarEnLista = (alumno) =>
    setAlumnos((lista) => ordenarPorNombre(lista.map((a) => (a.id === alumno.id ? alumno : a))))

  if (error) return <Aviso tipo="error">{error}</Aviso>
  if (!alumnos) return <Cargando />

  const filtro = claveNombre(busqueda)
  const coincide = (a) =>
    !filtro || claveNombre(a.nombre).includes(filtro) || (a.numero_control ?? '').includes(filtro)
  const activos = alumnos.filter((a) => a.activo && coincide(a))
  const bajas = alumnos.filter((a) => !a.activo && coincide(a))
  const totalActivos = alumnos.filter((a) => a.activo).length

  return (
    <div className="flex flex-col gap-6">
      <Aviso tipo="exito">{ubicacion.state?.aviso}</Aviso>

      <FormularioAlta
        grupoId={grupo.id}
        alAgregar={(nuevo) => setAlumnos((lista) => ordenarPorNombre([...lista, nuevo]))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">
          {totalActivos} {totalActivos === 1 ? 'alumno' : 'alumnos'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="activar" className={clasesBoton('secundario', 'py-2')}>
            Activar alumnos
          </Link>
          <Link to="importar" className={clasesBoton('secundario', 'py-2')}>
            Importar lista
          </Link>
        </div>
      </div>

      {alumnos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="font-medium">Este grupo no tiene alumnos</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Agrégalos uno por uno arriba o importa la lista desde Excel o CSV.
          </p>
        </div>
      ) : (
        <>
          {alumnos.length > 8 && (
            <input
              type="search"
              placeholder="Buscar por nombre o número de control"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
            />
          )}

          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {activos.map((a) => (
              <FilaAlumno
                key={a.id}
                alumno={a}
                editando={editandoId === a.id}
                alEditar={() => setEditandoId(a.id)}
                alTerminar={(cambiado) => {
                  setEditandoId(null)
                  if (cambiado) actualizarEnLista(cambiado)
                }}
              />
            ))}
            {activos.length === 0 && (
              <li className="p-4 text-center text-slate-500 dark:text-slate-400">Ningún alumno coincide</li>
            )}
          </ul>

          {bajas.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setVerBajas(!verBajas)}
                aria-expanded={verBajas}
                className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {verBajas ? '▾' : '▸'} Dados de baja ({bajas.length})
              </button>
              {verBajas && (
                <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white opacity-80 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  {bajas.map((a) => (
                    <FilaAlumno
                      key={a.id}
                      alumno={a}
                      editando={false}
                      alTerminar={(cambiado) => cambiado && actualizarEnLista(cambiado)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Alta manual de un alumno
// ---------------------------------------------------------------------
function FormularioAlta({ grupoId, alAgregar }) {
  const [nombre, setNombre] = useState('')
  const [numeroControl, setNumeroControl] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function agregar(evento) {
    evento.preventDefault()
    const datos = {
      grupo_id: grupoId,
      nombre: limpiarNombre(nombre),
      numero_control: limpiarNumeroControl(numeroControl),
    }
    if (!datos.nombre) {
      setError('Escribe el nombre')
      return
    }
    const problema = problemaNumeroControl(datos.numero_control)
    if (problema) {
      setError(problema)
      return
    }
    setGuardando(true)
    setError('')
    const { data, error } = await supabase
      .from('alumnos')
      .insert(datos)
      .select('id, nombre, numero_control, activo, activado_en')
      .single()
    setGuardando(false)
    if (error) {
      setError(mensajeDeError(error, ERRORES_ALUMNO))
      return
    }
    alAgregar(data)
    setNombre('')
    setNumeroControl('')
  }

  return (
    <Tarjeta>
      <h2 className="font-semibold">Agregar alumno</h2>
      <form onSubmit={agregar} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <Campo
          etiqueta="Nombre"
          className="sm:flex-[2]"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoComplete="off"
        />
        <Campo
          etiqueta="Número de control"
          className="sm:flex-1"
          value={numeroControl}
          onChange={(e) => setNumeroControl(e.target.value)}
          placeholder="Opcional"
          autoComplete="off"
        />
        <Boton type="submit" cargando={guardando}>
          Agregar
        </Boton>
      </form>
      <Aviso tipo="error" className="mt-3">
        {error}
      </Aviso>
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------
// Un alumno de la lista (modo vista y modo edición)
// ---------------------------------------------------------------------
function FilaAlumno({ alumno, editando, alEditar, alTerminar }) {
  const [nombre, setNombre] = useState(alumno.nombre)
  const [numeroControl, setNumeroControl] = useState(alumno.numero_control ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar(cambios) {
    setGuardando(true)
    setError('')
    const { data, error } = await supabase
      .from('alumnos')
      .update(cambios)
      .eq('id', alumno.id)
      .select('id, nombre, numero_control, activo, activado_en')
      .single()
    setGuardando(false)
    if (error) {
      setError(mensajeDeError(error, ERRORES_ALUMNO))
      return
    }
    alTerminar(data)
  }

  function guardarEdicion(evento) {
    evento.preventDefault()
    const cambios = { nombre: limpiarNombre(nombre), numero_control: limpiarNumeroControl(numeroControl) }
    if (!cambios.nombre) {
      setError('Escribe el nombre')
      return
    }
    const problema = problemaNumeroControl(cambios.numero_control)
    if (problema) {
      setError(problema)
      return
    }
    guardar(cambios)
  }

  function cancelar() {
    setNombre(alumno.nombre)
    setNumeroControl(alumno.numero_control ?? '')
    setError('')
    alTerminar(null)
  }

  function cambiarActivo() {
    // Dar de baja no borra al alumno: se conserva su historial de
    // asistencia y deja de contar para las faltas de clases nuevas.
    if (alumno.activo) {
      const ok = window.confirm(
        `¿Dar de baja a ${alumno.nombre}?\n\nYa no podrá registrar asistencia. Su historial se conserva.`,
      )
      if (!ok) return
    }
    guardar({ activo: !alumno.activo })
  }

  if (editando) {
    return (
      <li className="bg-indigo-50/50 p-4 dark:bg-indigo-950/30">
        <form onSubmit={guardarEdicion} className="flex flex-col gap-3">
          <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          <Campo
            etiqueta="Número de control"
            value={numeroControl}
            onChange={(e) => setNumeroControl(e.target.value)}
            placeholder="Opcional"
          />
          <Aviso tipo="error">{error}</Aviso>
          <div className="flex gap-2">
            <Boton type="submit" cargando={guardando}>
              Guardar
            </Boton>
            <Boton variante="secundario" onClick={cancelar}>
              Cancelar
            </Boton>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{alumno.nombre}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {alumno.numero_control ? (
            <span className="font-mono tracking-wide">{alumno.numero_control}</span>
          ) : (
            <span className="italic">Sin número de control</span>
          )}
          {alumno.activado_en ? (
            <span className="text-green-700 dark:text-green-400">● Cuenta activada</span>
          ) : (
            <span>○ Sin activar</span>
          )}
        </p>
        {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <div className="flex gap-1">
        {alumno.activo && alEditar && (
          <Boton variante="texto" onClick={alEditar}>
            Editar
          </Boton>
        )}
        <Boton variante="texto" onClick={cambiarActivo} cargando={guardando}>
          {alumno.activo ? 'Dar de baja' : 'Reactivar'}
        </Boton>
      </div>
    </li>
  )
}
