import { createClient } from '@supabase/supabase-js'
import { createInterface, emitKeypressEvents } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

async function ask(question, secret = false) {
  if (!secret) {
    const rl = createInterface({ input: stdin, output: stdout })
    const answer = await new Promise(resolve => rl.question(question, resolve))
    rl.close(); return answer.trim()
  }
  if (!stdin.isTTY) throw new Error('La contraseña debe escribirse en una terminal interactiva')
  stdout.write(question); emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const listener = (text, key) => {
      if (key?.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelado')) }
      else if (key?.name === 'return') { finish(); resolve(value) }
      else if (key?.name === 'backspace') value = value.slice(0, -1)
      else if (text && !key?.ctrl) value += text
    }
    function finish() { stdin.removeListener('keypress', listener); stdin.setRawMode(false); stdin.pause(); stdout.write('\n') }
    stdin.on('keypress', listener)
  })
}

console.log('Exportar alumnos e historial de Supabase. Este proceso sólo lee datos; no modifica la nube.')
const url = process.env.VITE_SUPABASE_URL || await ask('URL del proyecto Supabase: ')
const key = process.env.VITE_SUPABASE_ANON_KEY || await ask('Llave pública (anon/publishable): ')
if (/sb_secret_|service_role/.test(key)) throw new Error('Usa la llave pública, no una llave secreta')
const email = await ask('Correo del profesor: ')
const password = await ask('Contraseña (no se muestra): ', true)
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
try {
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (data.user.app_metadata?.rol === 'alumno') throw new Error('Se necesita la cuenta del profesor')
  const tables = {}
  for (const name of ['profesores', 'grupos', 'alumnos', 'sesiones', 'asistencias']) {
    tables[name] = []
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await client.from(name).select('*').order('id').range(offset, offset + 999)
      if (error) throw error
      tables[name].push(...rows)
      if (rows.length < 1000) break
    }
    console.log(`${name}: ${tables[name].length}`)
  }
  const target = path.resolve(process.argv[2] || `supabase-${Date.now()}.local-backup.json`)
  await writeFile(target, JSON.stringify({ format: 'asistencia-supabase-v1', exported_at: new Date().toISOString(), tables, photos: [] }), { flag: 'wx' })
  console.log(`Exportado a: ${target}\nImporta este archivo desde Teléfonos → Importar datos en Windows. Las fotos y las cuentas requieren nueva configuración.`)
} finally { await client.auth.signOut({ scope: 'local' }) }
