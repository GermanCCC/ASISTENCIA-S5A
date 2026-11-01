// Identificador del celular (device_id).
//
// Es un UUID aleatorio que se crea la primera vez y se guarda en DOS
// lugares del navegador: localStorage e IndexedDB. Si uno se borra (por
// ejemplo, algunas limpiezas solo vacían localStorage), se recupera del
// otro. Si se borran los dos, el celular "parece nuevo" y el alumno
// tendrá que pedir un código y la aprobación del profesor.
//
// Esto NO es la seguridad: la seguridad está en que la base de datos solo
// acepta el device_id que quedó registrado al activar la cuenta.

const CLAVE = 'device_id'
const BD = 'pase-de-lista'
const ALMACEN = 'config'

let pendiente = null

// Siempre devuelve el mismo UUID en este navegador. Se cachea la promesa
// para que dos llamadas al mismo tiempo no creen dos UUID distintos.
export function obtenerDeviceId() {
  pendiente ??= resolver()
  return pendiente
}

async function resolver() {
  const deLocal = leerLocal()
  const deIndexed = await leerIndexed()
  const id = deLocal ?? deIndexed ?? crypto.randomUUID()

  // Se reescribe en ambos lados por si faltaba en alguno.
  if (deLocal !== id) guardarLocal(id)
  if (deIndexed !== id) await guardarIndexed(id)

  // Pide al navegador que no borre estos datos cuando le falte espacio.
  // No todos lo conceden, pero no cuesta nada pedirlo.
  navigator.storage?.persist?.().catch(() => {})

  return id
}

function leerLocal() {
  try {
    return localStorage.getItem(CLAVE)
  } catch {
    return null
  }
}

function guardarLocal(id) {
  try {
    localStorage.setItem(CLAVE, id)
  } catch {
    // Almacenamiento bloqueado: queda al menos IndexedDB.
  }
}

// IndexedDB tiene una API de eventos antigua; estas funciones la
// envuelven en promesas para poder usar await.
function abrirBd() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(BD, 1)
    solicitud.onupgradeneeded = () => solicitud.result.createObjectStore(ALMACEN)
    solicitud.onsuccess = () => resolve(solicitud.result)
    solicitud.onerror = () => reject(solicitud.error)
  })
}

async function leerIndexed() {
  try {
    const bd = await abrirBd()
    return await new Promise((resolve, reject) => {
      const solicitud = bd.transaction(ALMACEN).objectStore(ALMACEN).get(CLAVE)
      solicitud.onsuccess = () => resolve(solicitud.result ?? null)
      solicitud.onerror = () => reject(solicitud.error)
    })
  } catch {
    return null
  }
}

async function guardarIndexed(id) {
  try {
    const bd = await abrirBd()
    await new Promise((resolve, reject) => {
      const tx = bd.transaction(ALMACEN, 'readwrite')
      tx.objectStore(ALMACEN).put(id, CLAVE)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Sin IndexedDB (navegación privada en algunos navegadores): queda localStorage.
  }
}
