import { createClient } from '@supabase/supabase-js'
import { localClient } from './localClient.js'

export const modoLocal = window.__ASISTENCIA_LOCAL__ === true || import.meta.env.MODE === 'escritorio'

// Solo se usan la URL y la llave pública (anon/publishable). Esa llave puede
// estar en el navegador sin problema porque la seguridad real la ponen las
// políticas RLS y las funciones de la base de datos.
// La service role key NUNCA va aquí: esa solo vive dentro de las Edge Functions.
const url = import.meta.env.VITE_SUPABASE_URL
const llavePublica = import.meta.env.VITE_SUPABASE_ANON_KEY

// Permite que la app muestre un aviso claro en vez de fallar sin explicación
// cuando falta el archivo .env.
export const supabaseConfigurado = modoLocal || Boolean(url && llavePublica)

export const supabase = modoLocal ? localClient : supabaseConfigurado
  ? createClient(url, llavePublica, {
      auth: {
        // La sesión se guarda en el celular para que el alumno no tenga
        // que iniciar sesión en cada clase.
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
