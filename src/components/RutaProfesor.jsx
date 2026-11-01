import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth.jsx'
import { Cargando } from './ui.jsx'

// Envuelve todas las rutas /profesor/...: si no hay sesión manda al login
// (y después regresa a donde iba); si quien entró es alumno, lo saca.
export default function RutaProfesor() {
  const { cargando, sesion, rol } = useAuth()
  const ubicacion = useLocation()

  if (cargando) return <Cargando />
  if (!sesion) return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />
  if (rol !== 'profesor') return <Navigate to="/" replace />
  return <Outlet />
}
