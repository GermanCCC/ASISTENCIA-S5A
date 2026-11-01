// =====================================================================
// Edge Function: limpiar-selfies
// =====================================================================
//
// Borra las selfies con más de 30 días. La llama pg_cron todos los días
// (migración 9). También se puede llamar a mano para probarla.
//
// auth: 'secret' → solo acepta la llave SECRETA del proyecto: nadie desde
// la app (ni con sesión) puede ejecutarla.
import { withSupabase } from '@supabase/server'

// Pocas a la vez: después se quitan sus rutas de "asistencias" con un
// filtro en la URL, y una lista muy larga no cabría.
const POR_VUELTA = 100
const MAXIMO_DE_VUELTAS = 50

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    const admin = ctx.supabaseAdmin
    let borradas = 0

    for (let vuelta = 0; vuelta < MAXIMO_DE_VUELTAS; vuelta++) {
      const { data: rutas, error } = await admin.rpc('selfies_vencidas', { p_limite: POR_VUELTA })
      if (error) return falla('selfies_vencidas', error)
      if (rutas.length === 0) break

      const { error: errBorrar } = await admin.storage.from('selfies').remove(rutas)
      if (errBorrar) return falla('remove', errBorrar)

      // La asistencia se conserva; solo deja de apuntar a una foto que ya no existe.
      const { error: errRutas } = await admin.from('asistencias').update({ selfie_path: null }).in('selfie_path', rutas)
      if (errRutas) return falla('asistencias', errRutas)

      borradas += rutas.length
    }

    console.log(`limpiar-selfies: ${borradas} fotos borradas`)
    return Response.json({ borradas })
  }),
}

function falla(paso, error) {
  console.error(`limpiar-selfies: falló ${paso}:`, error?.message ?? error)
  return Response.json({ error: `Falló ${paso}` }, { status: 500 })
}
