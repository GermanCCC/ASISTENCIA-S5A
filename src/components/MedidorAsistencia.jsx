import { formatearPorcentaje } from '../lib/estadisticas.js'

// Barra de porcentaje de asistencia con una marca vertical en el mínimo
// requerido. Así se ve de un vistazo si el grupo (o alumno) está arriba o
// abajo de la línea, sin tener que comparar dos números.
export default function MedidorAsistencia({ porcentaje, minimo }) {
  if (porcentaje == null) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Sin clases registradas todavía</p>
  }

  const debajo = porcentaje < minimo

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`text-3xl font-bold tabular-nums ${debajo ? 'text-red-600 dark:text-red-400' : ''}`}
        >
          {formatearPorcentaje(porcentaje)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">mínimo {formatearPorcentaje(minimo)}</span>
      </div>
      <div
        role="meter"
        aria-label="Asistencia"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentaje}
        className="relative mt-2 h-2.5 rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div
          className={`h-full rounded-full ${debajo ? 'bg-red-500' : 'bg-green-600 dark:bg-green-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, porcentaje))}%` }}
        />
        {/* Marca del mínimo: sobresale de la barra para que se note */}
        <div
          aria-hidden="true"
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-slate-900 dark:bg-slate-100"
          style={{ left: `${minimo}%` }}
        />
      </div>
    </div>
  )
}
