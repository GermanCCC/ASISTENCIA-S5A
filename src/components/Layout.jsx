import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../lib/auth.jsx'
import BotonTema from './BotonTema.jsx'
import AvisoConfiguracion from './AvisoConfiguracion.jsx'
import LocalGate from './LocalGate.jsx'
import { modoLocal } from '../lib/supabase.js'

// Marco común de todas las pantallas: barra superior y contenido centrado.
// El ancho máximo pequeño es intencional: la app se diseña primero para celular.
//
// env(safe-area-inset-*): en iPhone la app ocupa toda la pantalla
// (viewport-fit=cover en index.html), así que se deja espacio para la
// muesca de arriba, la barra de inicio de abajo y los lados en horizontal.
export default function Layout() {
  const { sesion, rol, cerrarSesion } = useAuth()
  const navegar = useNavigate()

  async function salir() {
    await cerrarSesion()
    navegar('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-[max(1rem,env(safe-area-inset-left))]">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" />
            Pase de Lista
          </Link>
          <div className="flex items-center gap-1">
            {/* El alumno no tiene botón de salir: su sesión debe quedarse
                fija en su celular (ver CLAUDE.md, "Roles"). */}
            {sesion && rol === 'profesor' && (
              <>
              {modoLocal && <Link to="/profesor/conexion" className="rounded-lg px-2 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-300">Teléfonos</Link>}
              <button
                type="button"
                onClick={salir}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Salir
              </button>
              </>
            )}
            <BotonTema />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-[max(1rem,env(safe-area-inset-left))] pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <AvisoConfiguracion />
        <LocalGate><Outlet /></LocalGate>
      </main>
    </div>
  )
}
