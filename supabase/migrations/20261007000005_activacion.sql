-- =====================================================================
-- Fase 4: códigos de activación y activación de alumnos
-- =====================================================================
--
-- Flujo completo:
--   1. El profesor genera códigos (generar_codigos_activacion). La base
--      guarda solo el hash; el código en texto se devuelve UNA vez para
--      imprimir las tarjetas y no se puede volver a consultar.
--   2. El alumno escribe su número de control y el código en su celular.
--   3. La Edge Function "activar-alumno" llama a revisar_activacion,
--      crea (o reutiliza) su usuario de Auth y llama a completar_activacion,
--      que liga todo e invalida el código en una sola transacción.
--
-- Los alumnos usan correos internos "<id>@alumnos.invalid" que nunca
-- reciben correo (".invalid" es un dominio reservado que no existe).
-- El alumno nunca ve ese correo ni una contraseña.


-- ---------------------------------------------------------------------
-- Funciones internas
-- ---------------------------------------------------------------------

-- Código aleatorio de 8 caracteres, sin los que se confunden al leerlos
-- en papel (0/O, 1/I/L). 31 símbolos ^ 8 ≈ 850 mil millones de códigos.
create function privado.codigo_aleatorio()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  c_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes  bytea;
  v_byte   integer;
  v_codigo text := '';
begin
  while length(v_codigo) < 8 loop
    v_bytes := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      v_byte := get_byte(v_bytes, i);
      -- 248 = 31 × 8. Descartar 248-255 evita que los primeros símbolos
      -- del alfabeto salgan un poco más seguido que los demás.
      if v_byte < 248 and length(v_codigo) < 8 then
        v_codigo := v_codigo || substr(c_alfabeto, v_byte % 31 + 1, 1);
      end if;
    end loop;
  end loop;
  return v_codigo;
end;
$$;

-- Normaliza lo que escribe el alumno: "abcd-efgh " → "ABCDEFGH".
create function privado.normalizar_codigo(p_codigo text)
returns text
language sql immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- SHA-256 del código normalizado. Es lo único que se guarda en la tabla.
create function privado.hash_codigo(p_codigo text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(privado.normalizar_codigo(p_codigo), 'sha256'), 'hex');
$$;

-- Igual que limpiarNumeroControl del frontend: sin espacios y en mayúsculas.
create function privado.normalizar_numero_control(p_numero_control text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_numero_control, ''), '\s', '', 'g')), '');
$$;

-- Todas las reglas para activar. La usan revisar_activacion (antes de
-- crear el usuario) y completar_activacion (otra vez, con la fila
-- bloqueada, por si algo cambió entre una y otra).
-- Devuelve NULL si todo está bien, o la respuesta de error.
create function privado.validar_activacion(
  p_alumno         public.alumnos,
  p_numero_control text,
  p_device_id      uuid
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if p_alumno.id is null then
    return privado.respuesta('codigo_invalido', 'El código no es válido o ya se usó. Pide uno nuevo a tu profesor.');
  end if;

  if p_device_id is null then
    return privado.respuesta('error', 'No se pudo identificar este celular. Recarga la página.');
  end if;

  if p_numero_control is null then
    return privado.respuesta('falta_numero_control', 'Escribe tu número de control');
  end if;

  if p_numero_control !~ '^[A-Z0-9]{4,20}$' then
    return privado.respuesta('numero_control_invalido', 'El número de control solo lleva letras y números');
  end if;

  if p_alumno.numero_control is not null and p_alumno.numero_control <> p_numero_control then
    return privado.respuesta('numero_control_no_coincide', 'Ese número de control no corresponde a este código');
  end if;

  -- Si el profesor no lo tenía, el que captura el alumno no debe ser de otro.
  if p_alumno.numero_control is null and exists (
    select 1 from public.alumnos a
    where a.grupo_id = p_alumno.grupo_id and a.numero_control = p_numero_control
  ) then
    return privado.respuesta('numero_control_ocupado', 'Ese número de control ya lo tiene otro alumno del grupo');
  end if;

  -- Un celular = un alumno: no se puede activar en un celular que ya
  -- está vinculado a otro alumno del mismo grupo.
  if exists (
    select 1 from public.dispositivos d
    join public.alumnos a on a.id = d.alumno_id
    where d.device_id = p_device_id
      and d.estado = 'activo'
      and a.grupo_id = p_alumno.grupo_id
      and a.id <> p_alumno.id
  ) then
    return privado.respuesta('dispositivo_de_otro', 'Este celular ya está vinculado a otro alumno del grupo');
  end if;

  return null;
end;
$$;


-- ---------------------------------------------------------------------
-- El trigger de profesores ahora también reconoce a los alumnos por su
-- correo interno. Supabase crea el usuario y DESPUÉS le pone el
-- app_metadata, así que al momento del INSERT todavía no trae
-- rol = 'alumno'; el correo sí viene desde el principio.
-- ---------------------------------------------------------------------
create or replace function privado.crear_perfil_profesor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'rol', '') <> 'alumno'
     and coalesce(new.email, '') not like '%@alumnos.invalid' then
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


-- ---------------------------------------------------------------------
-- generar_codigos_activacion: para el profesor.
-- Crea un código nuevo para cada alumno indicado (activo y del grupo) y
-- devuelve los códigos en texto. El código anterior de esos alumnos deja
-- de servir.
--
-- También sirve para el cambio de celular: un alumno ya activado recibe
-- un código nuevo, lo usa en su celular nuevo y ese celular queda
-- pendiente hasta que el profesor lo apruebe.
-- ---------------------------------------------------------------------
create function public.generar_codigos_activacion(p_grupo_id uuid, p_alumno_ids uuid[])
returns table (alumno_id uuid, codigo text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_codigo text;
begin
  if not privado.es_dueno_del_grupo(p_grupo_id) then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;

  for v_id in
    select a.id from public.alumnos a
    where a.grupo_id = p_grupo_id and a.activo and a.id = any (p_alumno_ids)
  loop
    -- El índice único de códigos impide repetidos; si por una casualidad
    -- astronómica sale uno que ya existe, se genera otro.
    loop
      v_codigo := privado.codigo_aleatorio();
      begin
        update public.alumnos set codigo_activacion_hash = privado.hash_codigo(v_codigo) where id = v_id;
        exit;
      exception when unique_violation then
        -- se intenta de nuevo
      end;
    end loop;

    alumno_id := v_id;
    codigo := v_codigo;
    return next;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- revisar_activacion: paso 1 de la Edge Function (solo lectura).
-- Dice si el código y el número de control son válidos y, si el alumno
-- ya tiene cuenta, cuál es su usuario de Auth para reutilizarlo.
-- ---------------------------------------------------------------------
create function public.revisar_activacion(p_codigo text, p_numero_control text, p_device_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alumno  public.alumnos;
  v_control text := privado.normalizar_numero_control(p_numero_control);
  v_error   jsonb;
  v_user_id uuid;
begin
  select * into v_alumno
  from public.alumnos
  where codigo_activacion_hash = privado.hash_codigo(p_codigo) and activo;

  v_error := privado.validar_activacion(v_alumno, v_control, p_device_id);
  if v_error is not null then
    return v_error;
  end if;

  -- ¿Qué usuario de Auth le toca?
  --   * Si ya activó antes (cambio de celular): el mismo de siempre.
  --   * Si está en otro grupo del MISMO profesor y ya activó ahí: ese
  --     usuario, así tiene una sola cuenta en su celular para todas sus
  --     materias. Se limita al mismo profesor para que otro profesor no
  --     pueda "adueñarse" de la cuenta de un alumno dando de alta su
  --     número de control.
  --   * Si no: NULL, y la Edge Function crea uno nuevo.
  v_user_id := v_alumno.user_id;
  if v_user_id is null then
    select a.user_id into v_user_id
    from public.alumnos a
    join public.grupos g on g.id = a.grupo_id
    where g.profesor_id = (select profesor_id from public.grupos where id = v_alumno.grupo_id)
      and a.numero_control = v_control
      and a.user_id is not null
    limit 1;
  end if;

  return jsonb_build_object(
    'codigo', 'ok',
    'alumno_id', v_alumno.id,
    'nombre', v_alumno.nombre,
    'user_id', v_user_id
  );
end;
$$;


-- ---------------------------------------------------------------------
-- completar_activacion: paso 2 de la Edge Function.
-- Todo en una transacción: si algo falla, no queda nada a medias.
-- ---------------------------------------------------------------------
create function public.completar_activacion(
  p_codigo         text,
  p_numero_control text,
  p_device_id      uuid,
  p_user_agent     text,
  p_user_id        uuid
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alumno  public.alumnos;
  v_control text := privado.normalizar_numero_control(p_numero_control);
  v_error   jsonb;
  v_estado  text;
begin
  -- "for update" bloquea al alumno: si llegan dos activaciones con el
  -- mismo código al mismo tiempo, la segunda espera y luego ya no lo
  -- encuentra (el código se invalida abajo).
  select * into v_alumno
  from public.alumnos
  where codigo_activacion_hash = privado.hash_codigo(p_codigo) and activo
  for update;

  v_error := privado.validar_activacion(v_alumno, v_control, p_device_id);
  if v_error is not null then
    return v_error;
  end if;

  if v_alumno.user_id is not null and v_alumno.user_id <> p_user_id then
    return privado.respuesta('error', 'La cuenta no coincide. Pide ayuda a tu profesor.');
  end if;

  -- Liga la cuenta, guarda el número de control (si no lo tenía) e
  -- invalida el código: cada código sirve una sola vez.
  update public.alumnos
  set user_id = p_user_id,
      numero_control = coalesce(numero_control, v_control),
      activado_en = coalesce(activado_en, now()),
      codigo_activacion_hash = null
  where id = v_alumno.id;

  -- Red de seguridad: un usuario de alumno nunca debe tener perfil de profesor.
  delete from public.profesores where id = p_user_id;

  -- Celular
  if exists (
    select 1 from public.dispositivos
    where alumno_id = v_alumno.id and device_id = p_device_id and estado = 'activo'
  ) then
    -- Es el mismo celular de siempre (por ejemplo, se cerró la sesión):
    -- no hay nada que aprobar.
    v_estado := 'activo';

  elsif exists (select 1 from public.dispositivos where alumno_id = v_alumno.id and estado = 'activo') then
    -- Ya tenía otro celular: este queda pendiente hasta que el profesor
    -- lo apruebe. Si había otra solicitud pendiente, esta la reemplaza.
    update public.dispositivos set estado = 'revocado'
    where alumno_id = v_alumno.id and estado = 'pendiente';

    insert into public.dispositivos (alumno_id, device_id, user_agent, estado)
    values (v_alumno.id, p_device_id, left(p_user_agent, 300), 'pendiente');
    v_estado := 'pendiente';

  else
    -- Primera activación: el celular queda activo de inmediato.
    insert into public.dispositivos (alumno_id, device_id, user_agent, estado, aprobado_en)
    values (v_alumno.id, p_device_id, left(p_user_agent, 300), 'activo', now());
    v_estado := 'activo';
  end if;

  return jsonb_build_object(
    'codigo', 'ok',
    'nombre', v_alumno.nombre,
    'estado_dispositivo', v_estado
  );

exception when unique_violation then
  -- Carrera muy rara (dos activaciones a la vez con datos que chocan).
  return privado.respuesta('error', 'No se pudo activar. Intenta de nuevo.');
end;
$$;


-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.generar_codigos_activacion(uuid, uuid[]) from public, anon;
grant execute on function public.generar_codigos_activacion(uuid, uuid[]) to authenticated;

-- revisar y completar solo los llama la Edge Function con la llave
-- secreta (rol service_role). Nadie desde el navegador, ni siquiera
-- con sesión, puede llamarlas.
revoke execute on function
  public.revisar_activacion(text, text, uuid),
  public.completar_activacion(text, text, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.revisar_activacion(text, text, uuid),
  public.completar_activacion(text, text, uuid, text, uuid)
to service_role;

-- Nadie desde la app necesita leer el hash del código (ni el profesor ni
-- el alumno). En Postgres no basta con quitar una columna si el rol puede
-- leer toda la tabla, así que se quita la lectura completa y se vuelve a
-- dar columna por columna, sin el hash.
-- OJO: si en el futuro se agrega una columna a "alumnos", hay que darle
-- permiso aquí también, o no se podrá leer desde la app.
revoke select on public.alumnos from authenticated;
grant select (id, grupo_id, numero_control, nombre, user_id, activado_en, activo, creado_en)
  on public.alumnos to authenticated;
