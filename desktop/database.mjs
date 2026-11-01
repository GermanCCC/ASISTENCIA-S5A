import { embeddedPostgres } from './postgres.mjs'
import pg from 'pg'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import net from 'node:net'

// PostgREST enviaba números JSON. El controlador SQL devuelve NUMERIC e INT8
// como texto por defecto; aquí los conteos y porcentajes de la app son números.
pg.types.setTypeParser(1700, Number)
pg.types.setTypeParser(20, Number)

export async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

// Se conserva PostgreSQL para ejecutar las mismas restricciones y firmas del QR.
// El proceso sólo escucha en localhost: los teléfonos nunca acceden a la base.
export async function openDatabase(dataDir, rootDir, log = console.log) {
  await mkdir(dataDir, { recursive: true })
  const credentialPath = path.join(dataDir, 'database-secret.json')
  let password
  if (existsSync(credentialPath)) password = JSON.parse(await readFile(credentialPath, 'utf8')).password
  else {
    password = randomBytes(32).toString('hex')
    await writeFile(credentialPath, JSON.stringify({ password }), { mode: 0o600 })
  }
  const databaseDir = path.join(dataDir, 'postgres')
  const port = await freePort()
  const embedded = embeddedPostgres({ databaseDir, password, port, log })
  let pool
  try {
    if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await embedded.initialise()
    await embedded.start()
    pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', max: 12 })
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.local_migrations (name text PRIMARY KEY);
    `)
    const { rows } = await pool.query('SELECT name FROM public.local_migrations')
    const applied = new Set(rows.map(row => row.name))
    if (!applied.has('local-bootstrap-v1')) {
      await pool.query(await readFile(path.join(rootDir, 'desktop', 'bootstrap.sql'), 'utf8'))
      await pool.query("INSERT INTO public.local_migrations VALUES ('local-bootstrap-v1')")
    }
    for (const name of (await readdir(path.join(rootDir, 'supabase', 'migrations'))).sort()) {
      // Estas dos migraciones sólo programan servicios de la nube. El servidor
      // local ejecuta el cierre y la limpieza sin pg_cron, pg_net ni internet.
      if (!name.endsWith('.sql') || /000004_|000009_/.test(name) || applied.has(name)) continue
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(await readFile(path.join(rootDir, 'supabase', 'migrations', name), 'utf8'))
        await client.query('INSERT INTO public.local_migrations VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); error.message = `${name}: ${error.message}`; throw error }
      finally { client.release() }
    }
    await pool.query(`
      GRANT USAGE ON SCHEMA public, auth, extensions, storage TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.profesores, public.grupos,
        public.alumnos, public.dispositivos, public.sesiones, public.asistencias,
        public.solicitudes_activacion TO authenticated;
      GRANT SELECT, INSERT ON storage.objects TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      REVOKE ALL ON public.local_migrations FROM PUBLIC, anon, authenticated;
    `)
    return {
      pool,
      async asUser(userId, action) {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
          await client.query('SET LOCAL ROLE authenticated')
          const result = await action(client)
          await client.query('COMMIT')
          return result
        } catch (error) { await client.query('ROLLBACK'); throw error }
        finally { client.release() }
      },
      async close() { await pool.end(); await embedded.stop() },
    }
  } catch (error) {
    await pool?.end().catch(() => {})
    await embedded.stop().catch(() => {})
    throw error
  }
}
