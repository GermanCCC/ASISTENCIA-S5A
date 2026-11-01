import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalServer } from './server.mjs'
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = await startLocalServer({ rootDir, dataDir: process.env.ASISTENCIA_DATA_DIR || path.join(process.env.APPDATA || rootDir, 'AsistenciaLocal') })
console.log(`Asistencia local: ${runtime.url}`)
console.log('Mantén esta ventana abierta mientras se usa el sistema.')
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.stop().then(() => process.exit(0)))
