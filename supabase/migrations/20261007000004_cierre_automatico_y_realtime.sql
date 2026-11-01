-- =====================================================================
-- Fase 2 · Migración 4: cierre automático (pg_cron) y Realtime
-- =====================================================================

-- pg_cron ejecuta tareas programadas dentro de la base de datos.
-- Cada minuto cierra las listas a las que ya se les acabó el tiempo y
-- pone las faltas. Aunque el profesor cierre la pestaña sin presionar
-- "Cerrar lista", la sesión se cierra sola.
--
-- El minuto de margen no permite registros tardíos: registrar_asistencia
-- compara contra la hora exacta de cierre y además cierra la sesión ella
-- misma si la encuentra vencida.
create extension if not exists pg_cron with schema pg_catalog;

-- cron.schedule con un nombre que ya existe reemplaza la tarea,
-- así que correr esta migración dos veces no duplica nada.
select cron.schedule(
  'cerrar-sesiones-vencidas',
  '* * * * *',
  $$ select privado.cerrar_sesiones_vencidas(); $$
);


-- Realtime: la pantalla de pase de lista del profesor se suscribe a los
-- cambios de "asistencias" para mostrar en vivo quién va llegando.
-- Realtime respeta el RLS: cada profesor solo recibe los de sus grupos.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asistencias'
     ) then
    alter publication supabase_realtime add table public.asistencias;
  end if;
end;
$$;
