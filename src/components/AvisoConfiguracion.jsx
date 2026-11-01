import { supabaseConfigurado } from '../lib/supabase.js'

// Si falta el archivo .env, la app no puede hablar con Supabase.
// Mejor decirlo claramente que mostrar errores raros más adelante.
export default function AvisoConfiguracion() {
  if (supabaseConfigurado) return null

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-semibold">Falta conectar Supabase</p>
      <p className="mt-1">
        Copia <code>.env.example</code> como <code>.env</code>, llena{' '}
        <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> y reinicia el
        servidor.
      </p>
    </div>
  )
}
