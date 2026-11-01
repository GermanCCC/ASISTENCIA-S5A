import { Link, useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { mensajeDeError } from '../../lib/errores.js'
import FormularioGrupo, { GRUPO_NUEVO } from '../../components/FormularioGrupo.jsx'

export default function NuevoGrupo() {
  const navegar = useNavigate()

  async function crear(datos) {
    // No se manda profesor_id: la base de datos pone el del usuario actual
    // (default auth.uid()) y el RLS impide crear grupos a nombre de otro.
    const { data, error } = await supabase.from('grupos').insert(datos).select('id').single()
    if (error) return mensajeDeError(error)
    navegar(`/profesor/grupos/${data.id}`, { replace: true })
  }

  return (
    <section>
      <Link to="/profesor" className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
        ← Mis grupos
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-bold">Nuevo grupo</h1>
      <FormularioGrupo inicial={GRUPO_NUEVO} textoBoton="Crear grupo" alGuardar={crear} />
    </section>
  )
}
