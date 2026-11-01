-- =====================================================================
-- Fase 2 · Migración 2: permisos, Row Level Security y triggers
-- =====================================================================
--
-- Cómo se protege cada tabla:
--   * RLS activado en todas: sin una política que lo permita, no se ve
--     ni se modifica nada.
--   * "anon" (alguien sin sesión iniciada) no tiene ningún permiso.
--   * Las acciones delicadas (abrir/cerrar lista, registrar asistencia,
--     aprobar celulares) NO se pueden hacer escribiendo directo en las
--     tablas: solo a través de las funciones de la migración 3, que
--     validan todo.

-- Postgres deja que cualquiera ejecute una función nueva salvo que se
-- diga lo contrario. Para el esquema privado lo invertimos: ninguna
-- función de aquí se puede ejecutar a menos que se otorgue a propósito.
alter default privileges in schema privado revoke execute on functions from public;


-- ---------------------------------------------------------------------
-- Funciones auxiliares para las políticas
--
-- Son "security definer" (se ejecutan con permisos del dueño) por dos
-- razones: evitan que una política de grupos consulte alumnos y la de
-- alumnos consulte grupos en un ciclo infinito, y son más rápidas.
-- Solo responden preguntas sobre el usuario actual, no exponen datos.
-- ---------------------------------------------------------------------

-- ¿El usuario actual es el profesor dueño de este grupo?
create function privado.es_dueno_del_grupo(p_grupo_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.grupos g
    where g.id = p_grupo_id and g.profesor_id = (select auth.uid())
  );
$$;

-- ¿El usuario actual es el profesor dueño del grupo de este alumno?
create function privado.es_dueno_del_alumno(p_alumno_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.alumnos a
    join public.grupos g on g.id = a.grupo_id
    where a.id = p_alumno_id and g.profesor_id = (select auth.uid())
  );
$$;

-- ¿El usuario actual es el profesor dueño del grupo de esta sesión?
create function privado.es_dueno_de_la_sesion(p_sesion_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sesiones s
    join public.grupos g on g.id = s.grupo_id
    where s.id = p_sesion_id and g.profesor_id = (select auth.uid())
  );
$$;

-- Las filas de "alumnos" que pertenecen al usuario actual
-- (una por cada grupo en el que está inscrito).
create function privado.mis_alumnos()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select a.id from public.alumnos a where a.user_id = (select auth.uid());
$$;

-- Los grupos en los que el usuario actual está inscrito como alumno.
create function privado.mis_grupos_como_alumno()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select a.grupo_id from public.alumnos a
  where a.user_id = (select auth.uid()) and a.activo;
$$;


-- ---------------------------------------------------------------------
-- Permisos base
-- ---------------------------------------------------------------------

-- Las políticas se ejecutan con el rol del usuario, por eso "authenticated"
-- necesita poder usar el esquema privado y ejecutar las funciones de arriba.
-- Aun así, este esquema no está publicado en la API: no se puede llamar
-- nada de aquí desde el navegador.
grant usage on schema privado to authenticated;
grant execute on function
  privado.es_dueno_del_grupo(uuid),
  privado.es_dueno_del_alumno(uuid),
  privado.es_dueno_de_la_sesion(uuid),
  privado.mis_alumnos(),
  privado.mis_grupos_como_alumno()
to authenticated;

-- El secreto del QR: ningún usuario de la app tiene permiso alguno.
revoke all on privado.sesion_secretos from public, anon, authenticated;
alter table privado.sesion_secretos enable row level security;

-- Sin sesión iniciada no se puede tocar ninguna tabla.
revoke all on all tables in schema public from anon;


-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profesores   enable row level security;
alter table public.grupos       enable row level security;
alter table public.alumnos      enable row level security;
alter table public.dispositivos enable row level security;
alter table public.sesiones     enable row level security;
alter table public.asistencias  enable row level security;

-- profesores: cada quien ve y edita solo su propio perfil.
-- (La fila la crea el trigger de abajo, no el usuario.)
create policy "Profesor ve su perfil" on public.profesores
  for select to authenticated using (id = (select auth.uid()));
create policy "Profesor edita su perfil" on public.profesores
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- grupos
create policy "Profesor administra sus grupos" on public.grupos
  for all to authenticated
  using (profesor_id = (select auth.uid()))
  with check (profesor_id = (select auth.uid()));
-- El alumno necesita leer la configuración de su grupo
-- (por ejemplo, saber si debe tomarse selfie).
create policy "Alumno ve sus grupos" on public.grupos
  for select to authenticated
  using (id in (select privado.mis_grupos_como_alumno()));

-- alumnos
create policy "Profesor administra los alumnos de sus grupos" on public.alumnos
  for all to authenticated
  using (privado.es_dueno_del_grupo(grupo_id))
  with check (privado.es_dueno_del_grupo(grupo_id));
create policy "Alumno ve sus propios datos" on public.alumnos
  for select to authenticated
  using (user_id = (select auth.uid()));

-- dispositivos: solo lectura desde la app. Se crean en la Edge Function
-- de activación y se aprueban/rechazan con funciones (migración 3).
create policy "Profesor ve los celulares de sus alumnos" on public.dispositivos
  for select to authenticated
  using (privado.es_dueno_del_alumno(alumno_id));
create policy "Alumno ve sus celulares" on public.dispositivos
  for select to authenticated
  using (alumno_id in (select privado.mis_alumnos()));

-- sesiones: se abren y cierran solo con abrir_sesion / cerrar_sesion.
create policy "Profesor ve las sesiones de sus grupos" on public.sesiones
  for select to authenticated
  using (privado.es_dueno_del_grupo(grupo_id));
-- Permite borrar una lista abierta por error.
create policy "Profesor borra sesiones de sus grupos" on public.sesiones
  for delete to authenticated
  using (privado.es_dueno_del_grupo(grupo_id));
create policy "Alumno ve las sesiones de sus grupos" on public.sesiones
  for select to authenticated
  using (grupo_id in (select privado.mis_grupos_como_alumno()));

-- asistencias: el profesor puede corregir a mano (justificar, etc.).
-- El alumno solo puede leer las suyas; registra únicamente a través de
-- registrar_asistencia, que hace todas las validaciones.
create policy "Profesor administra asistencias de sus sesiones" on public.asistencias
  for all to authenticated
  using (privado.es_dueno_de_la_sesion(sesion_id))
  with check (privado.es_dueno_de_la_sesion(sesion_id));
create policy "Alumno ve sus asistencias" on public.asistencias
  for select to authenticated
  using (alumno_id in (select privado.mis_alumnos()));


-- ---------------------------------------------------------------------
-- Trigger: crear el perfil de profesor al crear un usuario de Auth
--
-- Los alumnos también son usuarios de Auth, pero la Edge Function de
-- activación los crea con app_metadata.rol = 'alumno'. app_metadata solo
-- se puede escribir con la service role key, así que nadie puede
-- hacerse pasar por alumno o profesor desde el navegador.
-- ---------------------------------------------------------------------
create function privado.crear_perfil_profesor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'rol', '') <> 'alumno' then
    insert into public.profesores (id, nombre)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function privado.crear_perfil_profesor();

-- Si ya habías creado tu usuario de profesor antes de esta migración,
-- aquí se crea su perfil.
insert into public.profesores (id, nombre)
select u.id, split_part(u.email, '@', 1)
from auth.users u
where coalesce(u.raw_app_meta_data ->> 'rol', '') <> 'alumno'
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- Trigger: revisar cada asistencia antes de guardarla
-- ---------------------------------------------------------------------
create function privado.revisar_asistencia()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- El alumno debe ser del mismo grupo que la sesión. Evita, por ejemplo,
  -- que un profesor anote por error a un alumno de otro grupo.
  if not exists (
    select 1 from public.alumnos a
    join public.sesiones s on s.grupo_id = a.grupo_id
    where a.id = new.alumno_id and s.id = new.sesion_id
  ) then
    raise exception 'El alumno no pertenece al grupo de esta sesión';
  end if;

  -- Si un profesor hace un cambio a mano, queda registrado quién y cuándo.
  if (tg_op = 'UPDATE' or new.metodo = 'manual')
     and exists (select 1 from public.profesores p where p.id = (select auth.uid())) then
    new.editado_por := (select auth.uid());
    new.editado_en := now();
  end if;

  return new;
end;
$$;

create trigger revisar_asistencia
  before insert or update on public.asistencias
  for each row execute function privado.revisar_asistencia();
