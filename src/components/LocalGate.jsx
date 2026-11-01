import { useEffect, useState } from 'react'
import { modoLocal } from '../lib/supabase.js'
import { localRequest } from '../lib/localClient.js'
import { PrimeraConfiguracion } from '../pages/profesor/ConfiguracionLocal.jsx'
import { Aviso, Cargando } from './ui.jsx'

export default function LocalGate({ children }) {
  const [configured, setConfigured] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (modoLocal) localRequest('/status').then(({ data, error }) => {
      if (data) setConfigured(data.configured)
      else setError(error.message)
    })
  }, [])
  if (!modoLocal) return children
  if (error) return <div className="mx-auto max-w-lg p-6"><Aviso tipo="error">{error}</Aviso></div>
  if (configured === null) return <Cargando />
  if (!configured) {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return <div className="p-6"><Aviso tipo="info">El profesor debe crear su cuenta desde la aplicación de Windows antes de conectar los teléfonos.</Aviso></div>
    return <div className="mx-auto max-w-lg p-6"><PrimeraConfiguracion onComplete={() => setConfigured(true)} /></div>
  }
  return children
}
