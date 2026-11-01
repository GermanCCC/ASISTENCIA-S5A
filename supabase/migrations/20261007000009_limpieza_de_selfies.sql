-- =====================================================================
-- Fase 7: borrar las selfies con más de 30 días, todos los días
-- =====================================================================
--
-- Los archivos de Storage solo se pueden borrar con su API (no con SQL),
-- así que el borrado lo hace la Edge Function "limpiar-selfies". Aquí se
-- programa con pg_cron para que pg_net la llame todos los días a las
-- 2:15 a.m. de Hermosillo (9:15 UTC; Sonora no cambia de horario).
--
-- La función exige la llave SECRETA del proyecto, que no puede ir en una
-- migración (quedaría en el repositorio). Se guarda una sola vez en el
-- Vault de Supabase (secretos cifrados) desde el SQL Editor:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'url_proyecto');
--   select vault.create_secret('<llave sb_secret_...>', 'llave_secreta_limpieza');
--
-- Mientras no existan esos secretos, la tarea no hace nada.

create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'limpiar-selfies',
  '15 9 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'url_proyecto')
             || '/functions/v1/limpiar-selfies',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'llave_secreta_limpieza')
      ),
      body := '{}'::jsonb
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'url_proyecto')
      and exists (select 1 from vault.decrypted_secrets where name = 'llave_secreta_limpieza');
  $$
);
