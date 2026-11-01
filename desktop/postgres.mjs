import { spawn } from 'node:child_process'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

// Los binarios viajan dentro del instalador. No se descargan al abrir la app,
// no se instala un servicio de Windows y no aparecen consolas auxiliares.
export function embeddedPostgres({ databaseDir, password, port, log }) {
  let started = false
  const binaries = import('@embedded-postgres/windows-x64')
  async function run(binary, args) {
    await new Promise((resolve, reject) => {
      // pg_ctl lanza un proceso persistente: no debe heredar tuberías que
      // mantengan pendiente la promesa aunque pg_ctl ya haya terminado.
      const child = spawn(binary, args, { windowsHide: true, stdio: 'ignore', env: { ...process.env, LC_MESSAGES: 'C' } })
      const timeout = setTimeout(() => { child.kill(); reject(new Error('La base local tardó demasiado. Consulta postgres.log.')) }, 60000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => {
        clearTimeout(timeout)
        if (code === 0) resolve()
        else reject(new Error(`No se pudo iniciar o detener la base local (código ${code}). Consulta postgres.log.`))
      })
    })
    log(`PostgreSQL: ${args.at(-1)}`)
  }
  return {
    async initialise() {
      const { initdb } = await binaries
      await mkdir(path.dirname(databaseDir), { recursive: true })
      const passwordFile = path.join(path.dirname(databaseDir), 'init-password.tmp')
      await writeFile(passwordFile, password, { mode: 0o600 })
      try {
        await run(initdb, ['-D', databaseDir, '--username=postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C', '--lc-messages=C'])
      } finally { await unlink(passwordFile).catch(() => {}) }
    },
    async start() {
      const { pg_ctl } = await binaries
      await run(pg_ctl, ['-D', databaseDir, '-l', path.join(path.dirname(databaseDir), 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start'])
      started = true
    },
    async stop() {
      if (!started) return
      const { pg_ctl } = await binaries
      await run(pg_ctl, ['-D', databaseDir, '-m', 'fast', '-w', '-t', '30', 'stop'])
      started = false
    },
  }
}
