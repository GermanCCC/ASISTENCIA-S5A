-- =====================================================================
-- Migración 12: un alumno con cuenta puede unirse a otra clase
-- (aunque sea de otro profesor) sin perder su cuenta
-- =====================================================================
--
-- Antes: la cuenta de un alumno solo se reutilizaba en grupos del MISMO
-- profesor con el mismo número de control. En cualquier otro caso, al
-- activarse en otro grupo se le creaba una cuenta nueva, su celular se
-- cambiaba a esa cuenta y perdía el acceso a sus otras clases.
--
-- Por qué no se unen cuentas por número de control entre profesores: el
-- número lo escribe una persona y no prueba identidad. Cualquiera con un
-- grupo podría dar de alta a alguien con el número de control de otra
-- persona, aprobarse a sí mismo y quedarse con su cuenta.
--
-- Ahora: si el alumno YA tiene sesión en su celular, se une con ESA
-- cuenta. Tener la sesión sí prueba quién es. La Edge Function verifica
-- la sesión con el servidor de Auth y pasa aquí el user_id; el celular
-- no puede inventarlo. Igual que siempre, el profesor del grupo nuevo
-- aprueba la solicitud (QR) y se valida el número de control.
--
-- Resultado: una sola cuenta por alumno en todas sus clases.


-- La cuenta con la que se une el alumno (NULL = activación normal: se le
-- crea cuenta o se reutiliza la del mismo profesor, como antes).
alter table public.solicitudes_activacion
  add column user_id uuid references auth.users (id) on delete cascade;


-- ¿Puede la cuenta p_user_id quedarse con el alumno p_alumno?
-- Devuelve NULL si sí, o la respuesta de error.
create function privado.revisar_union(p_alumno public.alumnos, p_user_id uuid)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  -- Solo cuentas de alumno (app_metadata.rol lo escribe solo el servidor).
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and u.raw_app_meta_data ->> 'rol' = 'alumno'
  ) then
    return privado.respuesta('cuenta_invalida', 'Solo una cuenta de alumno puede unirse a una clase');
  end if;

  -- Ese nombre ya es de otra cuenta (otra persona ya lo activó).
  if p_alumno.user_id is not null and p_alumno.user_id <> p_user_id then
    return privado.respuesta('otra_cuenta', 'Ese nombre ya está ligado a otra cuenta. Si eres tú, pide ayuda a tu profesor.');
  end if;

  -- La cuenta ya tiene OTRO nombre en este mismo grupo.
  if exists (
    select 1 from public.alumnos a
    where a.grupo_id = p_alumno.grupo_id and a.user_id = p_user_id and a.id <> p_alumno.id
  ) then
    return privado.respuesta('ya_en_grupo', 'Ya estás en esta clase con otro nombre. Pide ayuda a tu profesor.');
  end if;

  return null;
end;
$$;

-- Funciones de privado: nadie las ejecuta salvo las funciones que las
-- usan (ver migración 11; Postgres le da permiso a PUBLIC al crearla).
revoke execute on function privado.revisar_union(public.alumnos, uuid) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- Activación con tarjeta: revisar_activacion recibe la cuenta con la que
-- se une (opcional). Cambia la lista de parámetros, por eso se borra.
-- ---------------------------------------------------------------------
drop function public.revisar_activacion(text, text, uuid);

-- p_user_id: cuenta con la que se une el alumno, si ya tiene sesión (NULL si no).
create function public.revisar_activacion(
  p_codigo         text,
  p_numero_control text,
  p_device_id      uuid,
  p_user_id        uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alumno  public.alumnos;
  v_control text := privado.normalizar_numero_control(p_numero_control);
  v_error   jsonb;
begin
  select * into v_alumno
  from public.alumnos
  where codigo_activacion_hash = privado.hash_codigo(p_codigo) and activo;

  v_error := privado.validar_activacion(v_alumno, v_control, p_device_id);
  if v_error is not null then
    return v_error;
  end if;

  if p_user_id is not null then
    v_error := privado.revisar_union(v_alumno, p_user_id);
    if v_error is not null then
      return v_error;
    end if;
  end if;

  return jsonb_build_object(
    'codigo', 'ok',
    'alumno_id', v_alumno.id,
    'nombre', v_alumno.nombre,
    'user_id', coalesce(p_user_id, privado.usuario_para_alumno(v_alumno, v_control)),
    'union', p_user_id is not null
  );
end;
$$;
revoke execute on function public.revisar_activacion(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revisar_activacion(text, text, uuid, uuid) to service_role;


-- ---------------------------------------------------------------------
-- Activación por QR: la solicitud guarda con qué cuenta se une.
-- ---------------------------------------------------------------------
drop function public.qr_solicitar_activacion(text, uuid, text, text, uuid, text, text);

-- p_user_id: cuenta con la que se une el alumno, si ya tiene sesión (NULL si no).
create function public.qr_solicitar_activacion(
  p_pase           text,
  p_alumno_id      uuid,
  p_tipo           text,
  p_numero_control text,
  p_device_id      uuid,
  p_user_agent     text,
  p_secreto        text,
  p_user_id        uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_revision jsonb := privado.revisar_pase(p_pase);
  v_grupo_id uuid;
  v_alumno   public.alumnos;
  v_control  text := privado.normalizar_numero_control(p_numero_control);
  v_error    jsonb;
  v_sol      public.solicitudes_activacion;
begin
  if v_revision ->> 'codigo' <> 'ok' then
    return v_revision;
  end if;
  v_grupo_id := (v_revision ->> 'grupo_id')::uuid;

  -- El secreto lo genera el celular: 32 bytes aleatorios en hexadecimal.
  if coalesce(p_secreto, '') !~ '^[0-9a-f]{64}$' or p_tipo not in ('nueva', 'cambio') then
    return privado.respuesta('error', 'Solicitud inválida. Actualiza la app e intenta de nuevo.');
  end if;

  select * into v_alumno from public.alumnos where id = p_alumno_id and grupo_id = v_grupo_id and activo;
  if not found then
    return privado.respuesta('alumno_invalido', 'Ese alumno no está en este grupo');
  end if;

  v_error := privado.validar_activacion(v_alumno, v_control, p_device_id);
  if v_error is not null then
    return v_error;
  end if;

  if p_user_id is not null then
    v_error := privado.revisar_union(v_alumno, p_user_id);
    if v_error is not null then
      return v_error;
    end if;
  end if;

  if p_tipo = 'nueva' and v_alumno.activado_en is not null then
    return privado.respuesta('ya_activado', 'Este alumno ya activó su cuenta. Si cambiaste de celular, elige «Cambié de celular».');
  end if;
  if p_tipo = 'cambio' and v_alumno.activado_en is null then
    return privado.respuesta('no_activado', 'Ese alumno todavía no activa su cuenta. Elige tu nombre en la lista principal.');
  end if;

  -- Protección contra que alguien llene la bandeja del profesor.
  if (
    select count(*) from public.solicitudes_activacion
    where grupo_id = v_grupo_id and estado = 'pendiente' and vence_en > now()
  ) >= 60 then
    return privado.respuesta('demasiadas', 'Hay muchas solicitudes pendientes. Espera a que el profesor las revise.');
  end if;

  -- Si este celular ya tenía una solicitud pendiente (por ejemplo, eligió
  -- mal su nombre), la nueva la reemplaza.
  update public.solicitudes_activacion
  set estado = 'vencida', resuelta_en = now()
  where grupo_id = v_grupo_id and device_id = p_device_id and estado = 'pendiente';

  insert into public.solicitudes_activacion (
    grupo_id, alumno_id, tipo, numero_control, device_id, user_agent, numero_verificacion, secreto_hash, user_id
  ) values (
    v_grupo_id, v_alumno.id, p_tipo, v_control, p_device_id, left(p_user_agent, 300),
    -- No es secreto (se ve en ambas pantallas), por eso basta random().
    lpad(floor(random() * 1000)::int::text, 3, '0'),
    encode(extensions.digest(p_secreto, 'sha256'), 'hex'),
    p_user_id
  )
  returning * into v_sol;

  return jsonb_build_object(
    'codigo', 'ok',
    'solicitud_id', v_sol.id,
    'numero_verificacion', v_sol.numero_verificacion,
    'nombre', v_alumno.nombre,
    'vence_en', v_sol.vence_en
  );
end;
$$;
revoke execute on function public.qr_solicitar_activacion(text, uuid, text, text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.qr_solicitar_activacion(text, uuid, text, text, uuid, text, text, uuid) to service_role;


-- ---------------------------------------------------------------------
-- Aprobar: se vuelve a revisar que la cuenta pueda quedarse con el alumno
-- (pudo cambiar algo desde que se pidió).
-- ---------------------------------------------------------------------

create or replace function public.aprobar_solicitud(p_solicitud_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol    public.solicitudes_activacion;
  v_alumno public.alumnos;
  v_error  jsonb;
begin
  select * into v_sol from public.solicitudes_activacion where id = p_solicitud_id for update;
  if not found or not privado.es_dueno_del_grupo(v_sol.grupo_id) then
    raise exception 'No tienes acceso a esta solicitud' using errcode = '42501';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente';
  end if;
  if v_sol.vence_en <= now() then
    raise exception 'La solicitud venció. Pídele al alumno que escanee de nuevo.';
  end if;

  select * into v_alumno from public.alumnos where id = v_sol.alumno_id and activo for update;
  if not found then
    raise exception 'Este alumno ya no está activo en el grupo';
  end if;

  v_error := privado.validar_activacion(v_alumno, v_sol.numero_control, v_sol.device_id);
  if v_error is not null then
    raise exception '%', v_error ->> 'mensaje';
  end if;
  if v_sol.user_id is not null then
    v_error := privado.revisar_union(v_alumno, v_sol.user_id);
    if v_error is not null then
      raise exception '%', v_error ->> 'mensaje';
    end if;
  end if;
  if v_sol.tipo = 'nueva' and v_alumno.activado_en is not null then
    raise exception 'Este alumno ya activó su cuenta (con otra solicitud o con su tarjeta)';
  end if;
  if v_sol.tipo = 'cambio' and v_alumno.activado_en is null then
    raise exception 'Este alumno todavía no había activado su cuenta';
  end if;

  update public.alumnos
  set numero_control = coalesce(numero_control, v_sol.numero_control),
      activado_en = coalesce(activado_en, now()),
      -- Si tenía una tarjeta impresa sin usar, ese código ya no sirve.
      codigo_activacion_hash = null
  where id = v_alumno.id;

  -- El celular nuevo queda activo y cualquier otro de este alumno
  -- (el anterior o uno pendiente por código) queda revocado.
  if not exists (
    select 1 from public.dispositivos
    where alumno_id = v_alumno.id and device_id = v_sol.device_id and estado = 'activo'
  ) then
    update public.dispositivos set estado = 'revocado'
    where alumno_id = v_alumno.id and estado in ('activo', 'pendiente');

    insert into public.dispositivos (alumno_id, device_id, user_agent, estado, aprobado_en)
    values (v_alumno.id, v_sol.device_id, v_sol.user_agent, 'activo', now());
  end if;

  update public.solicitudes_activacion
  set estado = 'aprobada', resuelta_en = now()
  where id = v_sol.id;

  -- Si otros celulares pidieron el mismo nombre, se rechazan solos.
  update public.solicitudes_activacion
  set estado = 'rechazada', resuelta_en = now()
  where alumno_id = v_alumno.id and estado = 'pendiente';
end;
$$;


-- ---------------------------------------------------------------------
-- Bandeja del profesor: marca "ya tiene cuenta en otra clase" y los
-- nombres con los que está registrado en sus otras clases, SIN decir
-- cuáles clases ni de qué profesor. Sirve para notar si alguien intenta
-- unirse con el celular de otra persona.
-- ---------------------------------------------------------------------

create or replace function public.listar_solicitudes(p_grupo_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_lista jsonb;
begin
  if not privado.es_dueno_del_grupo(p_grupo_id) then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t.fila order by t.fila ->> 'creada_en'), '[]'::jsonb) into v_lista
  from (
    select jsonb_build_object(
      'origen', 'qr',
      'id', s.id,
      'tipo', s.tipo,
      'alumno_id', a.id,
      'nombre', a.nombre,
      'numero_control', s.numero_control,
      'numero_verificacion', s.numero_verificacion,
      'user_agent', s.user_agent,
      'creada_en', s.creada_en,
      'vence_en', s.vence_en,
      'cuenta_existente', s.user_id is not null,
      'otros_nombres', coalesce((
        select jsonb_agg(distinct o.nombre)
        from public.alumnos o
        where s.user_id is not null and o.user_id = s.user_id and o.id <> a.id
      ), '[]'::jsonb),
      -- Para cambios de celular: cuándo se usó por última vez el actual.
      'ultimo_uso', (select max(registrado_en) from public.asistencias where alumno_id = a.id and metodo = 'qr')
    ) as fila
    from public.solicitudes_activacion s
    join public.alumnos a on a.id = s.alumno_id
    where s.grupo_id = p_grupo_id and s.estado = 'pendiente' and s.vence_en > now()

    union all

    select jsonb_build_object(
      'origen', 'codigo',
      'id', d.id,
      'tipo', 'cambio',
      'alumno_id', a.id,
      'nombre', a.nombre,
      'numero_control', a.numero_control,
      'numero_verificacion', null,
      'user_agent', d.user_agent,
      'creada_en', d.creado_en,
      'vence_en', null,
      'cuenta_existente', false,
      'otros_nombres', '[]'::jsonb,
      'ultimo_uso', (select max(registrado_en) from public.asistencias where alumno_id = a.id and metodo = 'qr')
    )
    from public.dispositivos d
    join public.alumnos a on a.id = d.alumno_id
    where a.grupo_id = p_grupo_id and d.estado = 'pendiente'
  ) t;

  return v_lista;
end;
$$;


-- ---------------------------------------------------------------------
-- Canje: si la solicitud trae cuenta, se usa esa (y la Edge Function no
-- crea cuenta ni manda sesión nueva: el celular ya tiene la suya).
-- ---------------------------------------------------------------------

create or replace function public.qr_preparar_canje(p_solicitud_id uuid, p_secreto text, p_device_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol    public.solicitudes_activacion := privado.solicitud_con_secreto(p_solicitud_id, p_secreto);
  v_error  jsonb := privado.revisar_canje(v_sol, p_device_id);
  v_alumno public.alumnos;
begin
  if v_error is not null then
    return v_error;
  end if;
  select * into v_alumno from public.alumnos where id = v_sol.alumno_id;
  return jsonb_build_object(
    'codigo', 'ok',
    'alumno_id', v_alumno.id,
    'nombre', v_alumno.nombre,
    'user_id', coalesce(v_sol.user_id, privado.usuario_para_alumno(v_alumno, v_alumno.numero_control)),
    'union', v_sol.user_id is not null
  );
end;
$$;



create or replace function public.qr_completar_canje(p_solicitud_id uuid, p_secreto text, p_device_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol    public.solicitudes_activacion;
  v_error  jsonb;
  v_alumno public.alumnos;
begin
  -- Se bloquea la solicitud: si el celular manda dos canjes a la vez,
  -- el segundo espera y luego la encuentra ya canjeada.
  select * into v_sol from public.solicitudes_activacion
  where id = (privado.solicitud_con_secreto(p_solicitud_id, p_secreto)).id
  for update;

  v_error := privado.revisar_canje(v_sol, p_device_id);
  if v_error is not null then
    return v_error;
  end if;

  -- Si la solicitud trae cuenta, solo se puede canjear con esa misma.
  if v_sol.user_id is not null and p_user_id is distinct from v_sol.user_id then
    return privado.respuesta('error', 'La cuenta no coincide. Pide ayuda a tu profesor.');
  end if;

  select * into v_alumno from public.alumnos where id = v_sol.alumno_id for update;
  if v_alumno.user_id is not null and v_alumno.user_id <> p_user_id then
    return privado.respuesta('error', 'La cuenta no coincide. Pide ayuda a tu profesor.');
  end if;

  update public.alumnos set user_id = p_user_id where id = v_alumno.id;
  -- Red de seguridad: un usuario de alumno nunca tiene perfil de profesor.
  delete from public.profesores where id = p_user_id;

  update public.solicitudes_activacion
  set estado = 'canjeada', canjeada_en = now()
  where id = v_sol.id;

  return jsonb_build_object('codigo', 'ok', 'nombre', v_alumno.nombre);

exception when unique_violation then
  return privado.respuesta('error', 'No se pudo activar. Pide ayuda a tu profesor.');
end;
$$;

