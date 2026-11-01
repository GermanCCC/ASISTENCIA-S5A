import { useId } from 'react'

// Piezas de interfaz reutilizables. Todas las pantallas las usan para que
// botones, campos y avisos se vean y se comporten igual en toda la app.

const BASE_BOTON =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

const VARIANTES = {
  primario: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700',
  secundario:
    'border border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
  peligro: 'bg-red-600 text-white hover:bg-red-500 active:bg-red-700',
  texto:
    'px-3 py-2 text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950',
}

// Para usar el mismo estilo en un <Link>.
export function clasesBoton(variante = 'primario', extra = '') {
  return `${BASE_BOTON} ${VARIANTES[variante]} ${extra}`
}

export function Boton({ variante = 'primario', cargando = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cargando}
      className={clasesBoton(variante, className)}
    >
      {cargando && <Spinner />}
      {children}
    </button>
  )
}

export function Campo({ etiqueta, ayuda, error, className = '', ...props }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={ayuda || error ? `${id}-ayuda` : undefined}
        {...props}
        className={
          'w-full rounded-xl border bg-white px-4 py-3 text-base outline-none transition ' +
          'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:bg-slate-900 ' +
          (error ? 'border-red-500' : 'border-slate-300 dark:border-slate-700')
        }
      />
      {(error || ayuda) && (
        <p
          id={`${id}-ayuda`}
          className={`mt-1.5 text-sm ${error ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
        >
          {error || ayuda}
        </p>
      )}
    </div>
  )
}

// Interruptor de encendido/apagado (para opciones como "Pedir selfie").
export function Interruptor({ etiqueta, ayuda, checked, onChange }) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block font-medium">{etiqueta}</span>
        {ayuda && <span className="block text-sm text-slate-500 dark:text-slate-400">{ayuda}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ' +
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-500 ' +
          (checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700')
        }
      >
        <span
          className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`}
        />
      </span>
    </label>
  )
}

const ESTILOS_AVISO = {
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  exito: 'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  info: 'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
}

export function Aviso({ tipo = 'info', children, className = '' }) {
  if (!children) return null
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm ${ESTILOS_AVISO[tipo]} ${className}`}
    >
      {children}
    </div>
  )
}

export function Spinner({ className = 'size-5' }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

export function Cargando({ texto = 'Cargando…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500 dark:text-slate-400">
      <Spinner />
      {texto}
    </div>
  )
}

export function Tarjeta({ className = '', children }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {children}
    </section>
  )
}
