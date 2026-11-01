import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { registerSW } from 'virtual:pwa-register'
import { AuthProvider } from './lib/auth.jsx'
import { router } from './router.jsx'
import './index.css'

// Service worker (PWA). La primera carga después de un deploy sale de la
// caché, o sea, con la versión ANTERIOR; mientras tanto el service worker
// descarga la nueva. Con esto, en cuanto la nueva está lista la página se
// recarga sola (pasa a los pocos segundos de abrir la app), y nadie se
// queda usando una versión vieja sin saberlo.
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
