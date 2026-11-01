import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { supabase } from '../../../lib/supabase.js'
import { mensajeDeError } from '../../../lib/errores.js'
import { Aviso, Boton, Tarjeta } from '../../../components/ui.jsx'
import FormularioGrupo from '../../../components/FormularioGrupo.jsx'

export default function Configuracion() {
  const { grupo, setGrupo } = useOutletContext()
  const navegar = useNavigate()
  const [guardado, setGuardado] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState('')

  async function guardar(datos) {
    setGuardado(false)
    const { data, error } = await supabase.from('grupos').update(datos).eq('id', grupo.id).select('*').single()
    if (error) return mensajeDeError(error)
    setGrupo(data)
    setGuardado(true)
  }

  async function eliminar() {
    const confirmado = window.confirm(
      `¿Eliminar el grupo ${grupo.nombre}?\n\nSe borrarán sus alumnos y TODO su historial de asistencia. No se puede deshacer.`,
    )
    if (!confirmado) return
    setEliminando(true)
    const { error } = await supabase.from('grupos').delete().eq('id', grupo.id)
    setEliminando(false)
    if (error) {
      setErrorEliminar(mensajeDeError(error))
      return
    }
    navegar('/profesor', { replace: true })
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <FormularioGrupo inicial={grupo} textoBoton="Guardar cambios" alGuardar={guardar} />
        {guardado && <Aviso tipo="exito">Cambios guardados.</Aviso>}
      </div>

      <Tarjeta className="border-red-200 dark:border-red-900">
        <h2 className="font-semibold">Eliminar grupo</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Borra el grupo, sus alumnos y todo su historial. Si solo terminó el semestre, mejor déjalo: no estorba.
        </p>
        <Aviso tipo="error" className="mt-3">
          {errorEliminar}
        </Aviso>
        <Boton variante="peligro" className="mt-4" cargando={eliminando} onClick={eliminar}>
          Eliminar grupo
        </Boton>
      </Tarjeta>
    </div>
  )
}
