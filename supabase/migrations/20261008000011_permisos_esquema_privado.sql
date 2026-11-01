-- =====================================================================
-- Migración 11: nadie puede ejecutar las funciones del esquema privado
-- (salvo las 7 que necesitan las políticas RLS)
-- =====================================================================
--
-- La migración 2 intentaba esto con
--   alter default privileges in schema privado revoke execute on functions from public;
-- pero en Postgres eso no hace nada: los permisos por defecto "por
-- esquema" solo pueden AGREGAR permisos, no quitar el que Postgres da a
-- todos (PUBLIC) al crear una función. Así que cualquier usuario con
-- sesión podía ejecutar las funciones de privado.
--
-- No era aprovechable desde la app: la API de Supabase no publica el
-- esquema privado, y las funciones que firman QR además necesitan leer
-- tablas que los alumnos no pueden leer. Pero la regla debe cumplirse en
-- la base de datos, no depender de eso.
--
-- ¿Por qué no se rompe nada al quitarlo?
--   * Las funciones públicas que usan privado son "security definer": se
--     ejecutan como el dueño de la base, que siempre puede.
--   * Los triggers (crear_perfil_profesor, revisar_asistencia): Postgres
--     no revisa este permiso al dispararlos.
--   * pg_cron corre como el dueño.
--   * Las políticas RLS sí se evalúan con el rol del usuario: por eso esas
--     7 funciones vuelven a tener permiso para "authenticated".

revoke execute on all functions in schema privado from public, anon, authenticated, service_role;

grant execute on function
  -- RLS de grupos, alumnos, sesiones, asistencias, dispositivos y solicitudes
  privado.es_dueno_del_grupo(uuid),
  privado.es_dueno_del_alumno(uuid),
  privado.es_dueno_de_la_sesion(uuid),
  privado.mis_alumnos(),
  privado.mis_grupos_como_alumno(),
  -- RLS del bucket de selfies (migración 8)
  privado.puede_subir_selfie(text),
  privado.puede_ver_selfie(text)
to authenticated;

-- Una función que se agregue después a privado vuelve a quedar abierta
-- para PUBLIC (así es Postgres). Las pruebas del proyecto revisan que solo
-- estas 7 sean ejecutables por "authenticated" y ninguna por "anon".
