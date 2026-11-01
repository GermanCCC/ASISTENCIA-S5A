import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ZONA_HORARIA, formatearFecha, formatearHora } from '../lib/fechas.js'

// Gráfica de asistencia por clase: una barra por lista cerrada, apilando
// cuántos alumnos llegaron a tiempo, con retardo, justificados y faltaron.
//
// Está en su propio archivo porque recharts pesa bastante: Estadisticas.jsx
// la carga con lazy() solo cuando el profesor abre esa pestaña, así los
// alumnos nunca la descargan.
//   sesiones: [{ id, abierta_en, asistencias: [{ estado }] }] de la más antigua a la más reciente

const etiquetaDia = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, day: 'numeric', month: 'short' })
const etiquetaHora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hour12: false })

// Texto del eje: "8 oct". Si ese día hubo más de una clase, todas dirían
// "8 oct"; entonces se agrega la hora ("8 oct 08:05", "8 oct 12:10").
function etiquetasDelEje(sesiones) {
  const dias = sesiones.map((s) => etiquetaDia.format(new Date(s.abierta_en)))
  const clasesPorDia = new Map()
  for (const dia of dias) clasesPorDia.set(dia, (clasesPorDia.get(dia) ?? 0) + 1)
  return sesiones.map((s, i) =>
    clasesPorDia.get(dias[i]) > 1 ? `${dias[i]} ${etiquetaHora.format(new Date(s.abierta_en))}` : dias[i],
  )
}

// Texto del cuadro al pasar el mouse: siempre tinta oscura sobre el fondo
// blanco del cuadro (en modo claro y oscuro). Los números tampoco van en
// el color de la serie: el nombre ("Falta: 3") ya dice cuál es.
const TINTA = '#0f172a'
const TINTA_SECUNDARIA = '#334155'

// Mismos colores que las etiquetas P / R / F / J de la app.
const SERIES = [
  { clave: 'presentes', nombre: 'A tiempo', color: '#16a34a' },
  { clave: 'retardos', nombre: 'Retardo', color: '#f59e0b' },
  { clave: 'justificadas', nombre: 'Justificada', color: '#0284c7' },
  { clave: 'faltas', nombre: 'Falta', color: '#dc2626' },
]

export default function GraficaAsistencia({ sesiones }) {
  const etiquetas = etiquetasDelEje(sesiones)
  const datos = sesiones.map((s, i) => {
    const contar = (estado) => s.asistencias.filter((a) => a.estado === estado).length
    return {
      id: s.id,
      etiqueta: etiquetas[i],
      cuando: `${formatearFecha(s.abierta_en)}, ${formatearHora(s.abierta_en)}`,
      presentes: contar('presente'),
      retardos: contar('retardo'),
      justificadas: contar('justificada'),
      faltas: contar('falta'),
    }
  })

  return (
    // El alto fijo es necesario: ResponsiveContainer toma el tamaño del contenedor.
    <div className="h-72 w-full text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="#94a3b8" strokeOpacity={0.3} />
          <XAxis dataKey="etiqueta" tick={{ fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={8} />
          <YAxis allowDecimals={false} tick={{ fill: '#64748b' }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: '#94a3b8', fillOpacity: 0.15 }}
            labelFormatter={(_, carga) => carga?.[0]?.payload.cuando ?? ''}
            contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1', backgroundColor: '#ffffff' }}
            labelStyle={{ color: TINTA, fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ color: TINTA_SECUNDARIA }}
          />
          <Legend iconType="circle" />
          {SERIES.map((s, i) => (
            <Bar
              key={s.clave}
              dataKey={s.clave}
              name={s.nombre}
              stackId="clase"
              fill={s.color}
              // Solo la parte de arriba de la pila lleva esquinas redondeadas.
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
