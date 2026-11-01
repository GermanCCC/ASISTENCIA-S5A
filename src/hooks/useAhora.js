import { useEffect, useState } from 'react'

// Hora actual (Date.now()) que se actualiza sola cada `cadaMs`.
// Sirve para animar la barra de progreso y los temporizadores.
export function useAhora(cadaMs = 250) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs)
    return () => clearInterval(id)
  }, [cadaMs])
  return ahora
}
