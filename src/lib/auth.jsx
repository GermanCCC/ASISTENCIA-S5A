import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

// Guarda la sesión actual de Supabase y la comparte con toda la app.
// Supabase la recuerda en el navegador, así que al volver a abrir la app
// la sesión sigue iniciada.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined = todavía no sabemos (cargando); null = sin sesión.
  const [sesion, setSesion] = useState(undefined)

  useEffect(() => {
    if (!supabase) {
      setSesion(null)
      return
    }
    // onAuthStateChange avisa de inmediato con la sesión guardada
    // (evento INITIAL_SESSION) y luego en cada login, logout o renovación.
    const { data } = supabase.auth.onAuthStateChange((_evento, nueva) => setSesion(nueva))
    return () => data.subscription.unsubscribe()
  }, [])

  const valor = useMemo(() => {
    // El rol se usa solo para decidir qué pantallas mostrar. La seguridad
    // real está en la base de datos: aunque alguien cambie esto en el
    // navegador, el RLS no le deja ver nada que no sea suyo.
    // app_metadata.rol solo lo puede escribir el servidor (fase 4).
    let rol = null
    if (sesion) rol = sesion.user.app_metadata?.rol === 'alumno' ? 'alumno' : 'profesor'

    return {
      sesion,
      cargando: sesion === undefined,
      usuario: sesion?.user ?? null,
      rol,
      cerrarSesion: () => supabase?.auth.signOut(),
    }
  }, [sesion])

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
