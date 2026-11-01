import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Cuántas solicitudes pendientes (QR o celular nuevo con tarjeta) tiene un
// grupo. Se actualiza sola con Realtime para mostrar el aviso en la pestaña.
export function useSolicitudesPendientes(grupoId) {
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelado = false
    async function contar() {
      const { data } = await supabase.rpc('contar_solicitudes_pendientes')
      if (!cancelado && data) setTotal(data.find((g) => g.grupo_id === grupoId)?.total ?? 0)
    }

    contar()
    const canal = supabase
      .channel(`pendientes-${grupoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solicitudes_activacion', filter: `grupo_id=eq.${grupoId}` },
        contar,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispositivos' }, contar)
      .subscribe()
    // Las solicitudes también vencen solas (15 min), sin que nada cambie en la tabla.
    const respaldo = setInterval(contar, 30_000)

    return () => {
      cancelado = true
      clearInterval(respaldo)
      supabase.removeChannel(canal)
    }
  }, [grupoId])

  return total
}
