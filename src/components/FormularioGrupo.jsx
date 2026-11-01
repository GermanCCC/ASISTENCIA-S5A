import { useState } from 'react'
import { Aviso, Boton, Campo, Interruptor, Tarjeta } from './ui.jsx'

// Valores por defecto de un grupo nuevo (los mismos que en la base de datos).
export const GRUPO_NUEVO = {
  nombre: '',
  materia: '',
  periodo: '',
  minutos_ventana: 5,
  minutos_retardo: 3,
  porcentaje_minimo_asistencia: 80,
  requiere_ubicacion: false,
  lat: null,
  lng: null,
  radio_m: 100,
  requiere_selfie: false,
}

// Formulario compartido por "Nuevo grupo" y "Configuración".
// Revisa los datos aquí para dar mensajes claros al momento, pero la base
// de datos vuelve a validar lo mismo con sus CHECK (la última palabra la
// tiene el servidor).
export default function FormularioGrupo({ inicial, textoBoton, alGuardar }) {
  // Los números se manejan como texto mientras se escriben para que el
  // campo pueda quedar vacío a medio editar.
  const [v, setV] = useState(() => ({
    ...inicial,
    periodo: inicial.periodo ?? '',
    minutos_ventana: String(inicial.minutos_ventana),
    minutos_retardo: String(inicial.minutos_retardo),
    porcentaje_minimo_asistencia: String(Number(inicial.porcentaje_minimo_asistencia)),
    lat: inicial.lat == null ? '' : String(inicial.lat),
    lng: inicial.lng == null ? '' : String(inicial.lng),
    radio_m: String(inicial.radio_m),
  }))
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState('')
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false)

  const cambiar = (campo) => (e) => setV((prev) => ({ ...prev, [campo]: e.target.value }))

  function usarUbicacionActual() {
    if (!navigator.geolocation) {
      setErrores((e) => ({ ...e, ubicacion: 'Este navegador no puede obtener la ubicación' }))
      return
    }
    setBuscandoUbicacion(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoUbicacion(false)
        setErrores((e) => ({ ...e, ubicacion: undefined, lat: undefined, lng: undefined }))
        setV((prev) => ({
          ...prev,
          // 6 decimales ≈ 10 cm, más que suficiente
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }))
      },
      () => {
        setBuscandoUbicacion(false)
        setErrores((e) => ({ ...e, ubicacion: 'No se pudo obtener la ubicación. Revisa el permiso del navegador.' }))
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  async function enviar(evento) {
    evento.preventDefault()
    const { datos, errores } = validar(v)
    setErrores(errores)
    if (Object.keys(errores).length > 0) return

    setGuardando(true)
    setErrorGeneral('')
    const mensaje = await alGuardar(datos)
    setGuardando(false)
    if (mensaje) setErrorGeneral(mensaje)
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      <Tarjeta className="flex flex-col gap-4">
        <h2 className="font-semibold">Datos del grupo</h2>
        <Campo etiqueta="Grupo" placeholder="S5A" value={v.nombre} onChange={cambiar('nombre')} error={errores.nombre} />
        <Campo
          etiqueta="Materia"
          placeholder="Programación Web"
          value={v.materia}
          onChange={cambiar('materia')}
          error={errores.materia}
        />
        <Campo etiqueta="Periodo" placeholder="AGO-DIC 2026" value={v.periodo} onChange={cambiar('periodo')} />
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-4">
        <h2 className="font-semibold">Tiempos del pase de lista</h2>
        <div className="grid grid-cols-2 gap-4">
          <Campo
            etiqueta="Lista abierta (min)"
            type="number"
            inputMode="numeric"
            min={1}
            max={240}
            value={v.minutos_ventana}
            onChange={cambiar('minutos_ventana')}
            error={errores.minutos_ventana}
          />
          <Campo
            etiqueta="Retardo desde (min)"
            type="number"
            inputMode="numeric"
            min={1}
            value={v.minutos_retardo}
            onChange={cambiar('minutos_retardo')}
            error={errores.minutos_retardo}
          />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ejemplo: con 5 y 3, quien escanee en los primeros 3 minutos queda presente, del minuto 3 al 5 con retardo, y
          después la lista se cierra sola.
        </p>
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-4">
        <h2 className="font-semibold">Asistencia mínima</h2>
        <Campo
          etiqueta="Porcentaje mínimo (%)"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          value={v.porcentaje_minimo_asistencia}
          onChange={cambiar('porcentaje_minimo_asistencia')}
          error={errores.porcentaje_minimo_asistencia}
          ayuda="Los alumnos por debajo se marcan en riesgo."
        />
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-4">
        <Interruptor
          etiqueta="Revisar ubicación"
          ayuda="Marca como sospechoso a quien escanee lejos del salón. No lo rechaza, porque el GPS falla dentro de los edificios."
          checked={v.requiere_ubicacion}
          onChange={(valor) => setV((prev) => ({ ...prev, requiere_ubicacion: valor }))}
        />
        {v.requiere_ubicacion && (
          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Boton variante="secundario" onClick={usarUbicacionActual} cargando={buscandoUbicacion}>
              Usar mi ubicación actual
            </Boton>
            <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">
              Hazlo estando dentro del salón.
            </p>
            {errores.ubicacion && <Aviso tipo="error">{errores.ubicacion}</Aviso>}
            <div className="grid grid-cols-2 gap-4">
              <Campo
                etiqueta="Latitud"
                inputMode="decimal"
                value={v.lat}
                onChange={cambiar('lat')}
                error={errores.lat}
              />
              <Campo
                etiqueta="Longitud"
                inputMode="decimal"
                value={v.lng}
                onChange={cambiar('lng')}
                error={errores.lng}
              />
            </div>
            <Campo
              etiqueta="Radio permitido (metros)"
              type="number"
              inputMode="numeric"
              min={1}
              value={v.radio_m}
              onChange={cambiar('radio_m')}
              error={errores.radio_m}
            />
          </div>
        )}
      </Tarjeta>

      <Tarjeta>
        <Interruptor
          etiqueta="Pedir selfie"
          ayuda="El alumno se toma una foto al registrarse. Solo tú puedes verla y se borra a los 30 días."
          checked={v.requiere_selfie}
          onChange={(valor) => setV((prev) => ({ ...prev, requiere_selfie: valor }))}
        />
      </Tarjeta>

      <Aviso tipo="error">{errorGeneral}</Aviso>
      <Boton type="submit" cargando={guardando} className="w-full py-4 text-lg">
        {textoBoton}
      </Boton>
    </form>
  )
}

// Devuelve los datos listos para la base de datos, o los errores por campo.
function validar(v) {
  const errores = {}
  const entero = (texto) => (/^\d+$/.test(String(texto).trim()) ? Number(texto) : NaN)
  const decimal = (texto) => (String(texto).trim() === '' ? NaN : Number(String(texto).replace(',', '.')))

  const datos = {
    nombre: v.nombre.trim(),
    materia: v.materia.trim(),
    periodo: v.periodo.trim() || null,
    minutos_ventana: entero(v.minutos_ventana),
    minutos_retardo: entero(v.minutos_retardo),
    porcentaje_minimo_asistencia: decimal(v.porcentaje_minimo_asistencia),
    requiere_ubicacion: v.requiere_ubicacion,
    lat: v.lat === '' ? null : decimal(v.lat),
    lng: v.lng === '' ? null : decimal(v.lng),
    radio_m: entero(v.radio_m),
    requiere_selfie: v.requiere_selfie,
  }

  if (!datos.nombre) errores.nombre = 'Escribe el nombre del grupo'
  if (!datos.materia) errores.materia = 'Escribe la materia'
  if (!(datos.minutos_ventana >= 1 && datos.minutos_ventana <= 240))
    errores.minutos_ventana = 'Entre 1 y 240 minutos'
  if (!(datos.minutos_retardo >= 1)) errores.minutos_retardo = 'Mínimo 1 minuto'
  else if (datos.minutos_retardo > datos.minutos_ventana)
    errores.minutos_retardo = 'No puede ser mayor que el tiempo abierta'
  if (!(datos.porcentaje_minimo_asistencia >= 0 && datos.porcentaje_minimo_asistencia <= 100))
    errores.porcentaje_minimo_asistencia = 'Entre 0 y 100'

  if (datos.requiere_ubicacion) {
    if (datos.lat == null || !(datos.lat >= -90 && datos.lat <= 90)) errores.lat = 'Latitud no válida'
    if (datos.lng == null || !(datos.lng >= -180 && datos.lng <= 180)) errores.lng = 'Longitud no válida'
  }
  // El radio se guarda aunque la ubicación esté apagada, así que siempre debe ser válido.
  if (!(datos.radio_m >= 1)) errores.radio_m = 'Mínimo 1 metro'

  // Si apagan la ubicación con coordenadas a medias, no se guardan basura.
  if (!datos.requiere_ubicacion && (Number.isNaN(datos.lat) || Number.isNaN(datos.lng))) {
    datos.lat = null
    datos.lng = null
  }

  return { datos, errores }
}
