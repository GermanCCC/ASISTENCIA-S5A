import { useState } from 'react'
import { guardarPreferencia, leerPreferencia } from '../lib/tema.js'

// Cada toque pasa a la siguiente opción: sistema → claro → oscuro → sistema.
const SIGUIENTE = { sistema: 'claro', claro: 'oscuro', oscuro: 'sistema' }
const ICONO = { sistema: '🖥️', claro: '☀️', oscuro: '🌙' }
const ETIQUETA = { sistema: 'Tema del sistema', claro: 'Tema claro', oscuro: 'Tema oscuro' }

export default function BotonTema() {
  const [preferencia, setPreferencia] = useState(leerPreferencia)

  function cambiar() {
    const nueva = SIGUIENTE[preferencia]
    guardarPreferencia(nueva)
    setPreferencia(nueva)
  }

  return (
    <button
      type="button"
      onClick={cambiar}
      title={ETIQUETA[preferencia]}
      aria-label={`${ETIQUETA[preferencia]}. Toca para cambiar.`}
      className="grid size-10 place-items-center rounded-full text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {ICONO[preferencia]}
    </button>
  )
}
