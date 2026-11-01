-- =====================================================================
-- Fase 6: activación con el QR del grupo y bandeja de solicitudes
-- =====================================================================
--
-- Flujo:
--   1. El profesor abre la "ventana de activación" del grupo (10 min,
--      puede reabrirla). Su pantalla muestra un QR que rota cada 10 s.
--   2. El alumno escanea con la app. Como el QR dura solo 10-20 s y
--      elegir su nombre y escribir su número toma más, al escanear recibe
--      un "pase" firmado de 5 minutos para enviar su solicitud. Elige su
--      nombre y captura su número de control. Su celular genera un
--      SECRETO aleatorio; aquí solo se guarda su hash. Se crea una
--      solicitud con un número de verificación de 3 dígitos que se ve en
--      ambas pantallas.
--   3. El profesor aprueba o rechaza en vivo. Al aprobar, el celular
--      queda vinculado.
--   4. El celular del alumno presenta su secreto para recibir la sesión
--      (Edge Function "activar-por-qr"). Sin el secreto, una solicitud
--      aprobada no le sirve a nadie más.
--
-- Las funciones qr_* solo las llama la Edge Function (rol service_role).


-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

-- Ventana de activación abierta de cada grupo. Tiene su PROPIO secreto,
-- distinto al de las sesiones: un QR de pase de lista no sirve para
-- activar cuentas, ni al revés.
create table privado.ventanas_activacion (
  grupo_id   uuid primary key references public.grupos (id) on delete cascade,
  secreto    bytea not null default extensions.gen_random_bytes(32),
  abierta_en timestamptz not null default now(),
  cierra_en  timestamptz not null
);
revoke all on privado.ventanas_activacion from public, anon, authenticated;
alter table privado.ventanas_activacion enable row level security;

create table public.solicitudes_activacion (
  id                  uuid primary key default gen_random_uuid(),
  grupo_id            uuid not null references public.grupos (id) on delete cascade,
  alumno_id           uuid not null references public.alumnos (id) on delete cascade,
  -- nueva = primera activación; cambio = ya tenía cuenta y cambió de celular
  tipo                text not null check (tipo in ('nueva', 'cambio')),
  numero_control      text not null,
  device_id           uuid not null,
  user_agent          text,
  -- Se muestra en el celular del alumno y en la pantalla del profesor
  -- para confirmar en persona que la solicitud es de quien dice ser.
  numero_verificacion text not null check (numero_verificacion ~ '^[0-9]{3}$'),
  -- SHA-256 del secreto que solo conoce el celular que hizo la solicitud.
  secreto_hash        text not null,
  estado              text not null default 'pendiente'
                      check (estado in ('pendiente', 'aprobada', 'rechazada', 'vencida', 'canjeada')),
  creada_en           timestamptz not null default now(),
  -- Si el profesor no responde en 15 min, la solicitud ya no se puede aprobar.
  vence_en            timestamptz not null default now() + interval '15 minutes',
  resuelta_en         timestamptz,
  canjeada_en         timestamptz
);
-- Un celular solo puede tener una solicitud pendiente por grupo.
create unique index solicitudes_una_pendiente_por_celular on public.solicitudes_activacion (grupo_id, device_id)
  where estado = 'pendiente';
create index solicitudes_grupo_estado_idx on public.solicitudes_activacion (grupo_id, estado);


-- ---------------------------------------------------------------------
-- Permisos y RLS de solicitudes
-- ---------------------------------------------------------------------
alter table public.solicitudes_activacion enable row level security;

-- Solo el profesor dueño del grupo las ve (para su bandeja en vivo).
-- Nadie las escribe desde la app: solo las funciones de abajo.
create policy "Profesor ve las solicitudes de sus grupos" on public.solicitudes_activacion
  for select to authenticated
  using (privado.es_dueno_del_grupo(grupo_id));

-- Sin acceso para quien no tiene sesión, y el hash del secreto no se
-- puede leer ni siquiera con sesión (se dan las columnas una por una).
revoke all on public.solicitudes_activacion from anon, authenticated;
grant select (
  id, grupo_id, alumno_id, tipo, numero_control, device_id, user_agent,
  numero_verificacion, estado, creada_en, vence_en, resuelta_en, canjeada_en
) on public.solicitudes_activacion to authenticated;

-- Realtime: la bandeja del profesor se actualiza sola cuando llega una
-- solicitud (por QR) o un celular pendiente (por código de tarjeta).
do $$
declare
  v_tabla text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tabla in array array['solicitudes_activacion', 'dispositivos'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_tabla);
      end if;
    end loop;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Funciones internas: QR de activación y pase
-- ---------------------------------------------------------------------

-- Firma del QR de activación. Igual que la del pase de lista, pero con
-- el secreto de la ventana y el texto "activacion:" al inicio.
-- Devuelve NULL si la ventana está cerrada o vencida.
create function privado.firmar_activacion(p_grupo_id uuid, p_intervalo bigint)
returns text
language sql stable
set search_path = ''
as $$
  select left(
    encode(
      extensions.hmac(convert_to('activacion:' || p_grupo_id::text || ':' || p_intervalo::text, 'UTF8'), v.secreto, 'sha256'),
      'hex'
    ),
    32
  )
  from privado.ventanas_activacion v
  where v.grupo_id = p_grupo_id and v.cierra_en > now();
$$;

-- Valida un QR de activación ("A.<grupo_id>.<intervalo>.<firma>").
-- Devuelve { codigo: 'ok', grupo_id } o la respuesta de error.
create function privado.revisar_token_activacion(p_token text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_partes    text[] := string_to_array(coalesce(p_token, ''), '.');
  v_grupo_id  uuid;
  v_intervalo bigint;
begin
  if array_length(v_partes, 1) is distinct from 4
     or v_partes[1] <> 'A'
     or v_partes[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_partes[3] !~ '^[0-9]{1,15}$'
     or v_partes[4] !~ '^[0-9a-f]{32}$' then
    return privado.respuesta('qr_invalido', 'Este no es el QR para activar cuentas');
  end if;
  v_grupo_id := v_partes[2]::uuid;
  v_intervalo := v_partes[3]::bigint;

  if not exists (select 1 from privado.ventanas_activacion where grupo_id = v_grupo_id and cierra_en > now()) then
    return privado.respuesta('activacion_cerrada', 'El profesor ya cerró la activación. Pídele que la abra de nuevo.');
  end if;

  if v_partes[4] is distinct from privado.firmar_activacion(v_grupo_id, v_intervalo) then
    return privado.respuesta('qr_invalido', 'Este no es el QR para activar cuentas');
  end if;

  if v_intervalo not in (privado.intervalo_actual(), privado.intervalo_actual() - 1) then
    return privado.respuesta('qr_expirado', 'QR expirado, escanea de nuevo');
  end if;

  return jsonb_build_object('codigo', 'ok', 'grupo_id', v_grupo_id);
end;
$$;

-- Pase de 5 minutos que recibe el alumno al escanear un QR válido.
-- Formato "P.<grupo_id>.<segundo en que se emitió>.<firma>", firmado con
-- el mismo secreto de la ventana: no se puede inventar, y deja de servir
-- si el profesor cierra o reabre la ventana.
create function privado.firmar_pase(p_grupo_id uuid, p_emitido bigint)
returns text
language sql stable
set search_path = ''
as $$
  select left(
    encode(
      extensions.hmac(convert_to('pase:' || p_grupo_id::text || ':' || p_emitido::text, 'UTF8'), v.secreto, 'sha256'),
      'hex'
    ),
    32
  )
  from privado.ventanas_activacion v
  where v.grupo_id = p_grupo_id and v.cierra_en > now();
$$;

create function privado.crear_pase(p_grupo_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select 'P.' || p_grupo_id::text || '.' || t.emitido::text || '.' || privado.firmar_pase(p_grupo_id, t.emitido)
  from (select floor(extract(epoch from now()))::bigint as emitido) t;
$$;

-- Devuelve { codigo: 'ok', grupo_id } o la respuesta de error.
create function privado.revisar_pase(p_pase text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_partes   text[] := string_to_array(coalesce(p_pase, ''), '.');
  v_grupo_id uuid;
  v_emitido  bigint;
begin
  if array_length(v_partes, 1) is distinct from 4
     or v_partes[1] <> 'P'
     or v_partes[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_partes[3] !~ '^[0-9]{1,15}$'
     or v_partes[4] !~ '^[0-9a-f]{32}$' then
    return privado.respuesta('error', 'Solicitud inválida. Escanea el QR de nuevo.');
  end if;
  v_grupo_id := v_partes[2]::uuid;
  v_emitido := v_partes[3]::bigint;

  if not exists (select 1 from privado.ventanas_activacion where grupo_id = v_grupo_id and cierra_en > now()) then
    return privado.respuesta('activacion_cerrada', 'El profesor ya cerró la activación. Pídele que la abra de nuevo.');
  end if;
  if v_partes[4] is distinct from privado.firmar_pase(v_grupo_id, v_emitido) then
    return privado.respuesta('error', 'Solicitud inválida. Escanea el QR de nuevo.');
  end if;
  if extract(epoch from now()) - v_emitido > 300 then
    return privado.respuesta('pase_vencido', 'Se acabó el tiempo. Escanea el QR de nuevo.');
  end if;

  return jsonb_build_object('codigo', 'ok', 'grupo_id', v_grupo_id);
end;
$$;


-- ---------------------------------------------------------------------
-- Funciones internas: cuentas y solicitudes
-- ---------------------------------------------------------------------

-- Usuario de Auth que le corresponde a un alumno (ver migración 5):
-- el suyo si ya tiene, o el de su misma persona en otro grupo del MISMO
-- profesor (mismo número de control). NULL si hay que crear uno.
create function privado.usuario_para_alumno(p_alumno public.alumnos, p_numero_control text)
returns uuid
language sql stable
set search_path = ''
as $$
  select coalesce(
    p_alumno.user_id,
    (
      select a.user_id
      from public.alumnos a
      join public.grupos g on g.id = a.grupo_id
      where g.profesor_id = (select profesor_id from public.grupos where id = p_alumno.grupo_id)
        and a.numero_control = p_numero_control
        and a.user_id is not null
      limit 1
    )
  );
$$;

-- revisar_activacion (fase 4) ahora usa la misma función para no repetir la regla.
create or replace function public.revisar_activacion(p_codigo text, p_numero_control text, p_device_id uuid)
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

  return jsonb_build_object(
    'codigo', 'ok',
    'alumno_id', v_alumno.id,
    'nombre', v_alumno.nombre,
    'user_id', privado.usuario_para_alumno(v_alumno, v_control)
  );
end;
$$;

-- Busca una solicitud por id + secreto. Si el secreto no coincide, no la
-- encuentra: así nadie puede consultar ni canjear solicitudes ajenas.
create function privado.solicitud_con_secreto(p_id uuid, p_secreto text)
returns public.solicitudes_activacion
language sql stable
set search_path = ''
as $$
  select * from public.solicitudes_activacion
  where id = p_id
    and secreto_hash = encode(extensions.digest(coalesce(p_secreto, ''), 'sha256'), 'hex');
$$;

-- Revisión común para canjear: la solicitud debe estar aprobada, ser de
-- este celular y tener menos de 24 h. Devuelve NULL si todo está bien.
create function privado.revisar_canje(p_sol public.solicitudes_activacion, p_device_id uuid)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if p_sol.id is null or p_sol.device_id <> p_device_id then
    return privado.respuesta('no_encontrada', 'No se encontró la solicitud');
  end if;
  if p_sol.estado = 'canjeada' then
    return privado.respuesta('ya_canjeada', 'Esta solicitud ya se usó');
  end if;
  if p_sol.estado <> 'aprobada' then
    return privado.respuesta('no_aprobada', 'El profesor todavía no aprueba tu solicitud');
  end if;
  if p_sol.resuelta_en < now() - interval '24 hours' then
    return privado.respuesta('vencida', 'Pasó demasiado tiempo. Escanea el QR de nuevo.');
  end if;
  return null;
end;
$$;


-- =====================================================================
-- Funciones del profesor
-- =====================================================================

-- Abre (o vuelve a abrir) la ventana de activación por 10 minutos.
-- Reabrir genera un secreto nuevo: los QR y pases anteriores dejan de servir.
create function public.abrir_activacion(p_grupo_id uuid)
returns timestamptz
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cierra_en timestamptz;
begin
  if not privado.es_dueno_del_grupo(p_grupo_id) then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;

  insert into privado.ventanas_activacion (grupo_id, cierra_en)
  values (p_grupo_id, now() + interval '10 minutes')
  on conflict (grupo_id) do update
    set secreto = extensions.gen_random_bytes(32),
        abierta_en = now(),
        cierra_en = excluded.cierra_en
  returning cierra_en into v_cierra_en;

  return v_cierra_en;
end;
$$;

create function public.cerrar_activacion(p_grupo_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not privado.es_dueno_del_grupo(p_grupo_id) then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;
  delete from privado.ventanas_activacion where grupo_id = p_grupo_id;
end;
$$;

-- Lo que muestra el QR de activación ahora (como token_qr_actual).
create function public.token_activacion_actual(p_grupo_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cierra_en timestamptz;
  v_intervalo bigint := privado.intervalo_actual();
begin
  if not privado.es_dueno_del_grupo(p_grupo_id) then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;

  select cierra_en into v_cierra_en
  from privado.ventanas_activacion
  where grupo_id = p_grupo_id and cierra_en > now();

  if v_cierra_en is null then
    delete from privado.ventanas_activacion where grupo_id = p_grupo_id;
    return jsonb_build_object('abierta', false);
  end if;

  return jsonb_build_object(
    'abierta', true,
    'token', 'A.' || p_grupo_id::text || '.' || v_intervalo::text || '.' || privado.firmar_activacion(p_grupo_id, v_intervalo),
    'ahora', now(),
    'siguiente_cambio', to_timestamp((v_intervalo + 1) * 10),
    'cierra_en', v_cierra_en
  );
end;
$$;

-- Bandeja: solicitudes por QR pendientes + celulares pendientes que
-- llegaron con el código de la tarjeta (fase 4), en una sola lista.
create function public.listar_solicitudes(p_grupo_id uuid)
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
      'ultimo_uso', (select max(registrado_en) from public.asistencias where alumno_id = a.id and metodo = 'qr')
    )
    from public.dispositivos d
    join public.alumnos a on a.id = d.alumno_id
    where a.grupo_id = p_grupo_id and d.estado = 'pendiente'
  ) t;

  return v_lista;
end;
$$;

-- Cuántas solicitudes pendientes tiene cada grupo del profesor (para
-- los avisos en Inicio y en el grupo).
create function public.contar_solicitudes_pendientes()
returns table (grupo_id uuid, total integer)
language sql stable security definer
set search_path = ''
as $$
  select g.id, (
    (select count(*) from public.solicitudes_activacion s
     where s.grupo_id = g.id and s.estado = 'pendiente' and s.vence_en > now())
    +
    (select count(*) from public.dispositivos d join public.alumnos a on a.id = d.alumno_id
     where a.grupo_id = g.id and d.estado = 'pendiente')
  )::integer
  from public.grupos g
  where g.profesor_id = (select auth.uid());
$$;

-- Aprobar: aquí queda vinculado el celular. Se vuelven a revisar todas
-- las reglas, porque pudo cambiar algo desde que se pidió.
create function public.aprobar_solicitud(p_solicitud_id uuid)
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

create function public.rechazar_solicitud(p_solicitud_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes_activacion;
begin
  select * into v_sol from public.solicitudes_activacion where id = p_solicitud_id for update;
  if not found or not privado.es_dueno_del_grupo(v_sol.grupo_id) then
    raise exception 'No tienes acceso a esta solicitud' using errcode = '42501';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente';
  end if;
  update public.solicitudes_activacion set estado = 'rechazada', resuelta_en = now() where id = v_sol.id;
end;
$$;


-- =====================================================================
-- Funciones de la Edge Function "activar-por-qr" (solo service_role)
-- =====================================================================

-- Paso 1: el alumno escaneó. Si el QR es válido, regresa los nombres
-- (solo nombres) para que elija el suyo, y el pase de 5 minutos.
create function public.qr_alumnos_del_grupo(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_revision jsonb := privado.revisar_token_activacion(p_token);
  v_grupo    public.grupos;
begin
  if v_revision ->> 'codigo' <> 'ok' then
    return v_revision;
  end if;
  select * into v_grupo from public.grupos where id = (v_revision ->> 'grupo_id')::uuid;

  return jsonb_build_object(
    'codigo', 'ok',
    'pase', privado.crear_pase(v_grupo.id),
    'grupo', jsonb_build_object('nombre', v_grupo.nombre, 'materia', v_grupo.materia),
    'sin_activar', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.nombre)
      from public.alumnos a where a.grupo_id = v_grupo.id and a.activo and a.activado_en is null
    ), '[]'::jsonb),
    'activados', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.nombre)
      from public.alumnos a where a.grupo_id = v_grupo.id and a.activo and a.activado_en is not null
    ), '[]'::jsonb)
  );
end;
$$;

-- Paso 2: crear la solicitud (con el pase del paso 1).
create function public.qr_solicitar_activacion(
  p_pase           text,
  p_alumno_id      uuid,
  p_tipo           text,
  p_numero_control text,
  p_device_id      uuid,
  p_user_agent     text,
  p_secreto        text
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
    grupo_id, alumno_id, tipo, numero_control, device_id, user_agent, numero_verificacion, secreto_hash
  ) values (
    v_grupo_id, v_alumno.id, p_tipo, v_control, p_device_id, left(p_user_agent, 300),
    -- No es secreto (se ve en ambas pantallas), por eso basta random().
    lpad(floor(random() * 1000)::int::text, 3, '0'),
    encode(extensions.digest(p_secreto, 'sha256'), 'hex')
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

-- Paso 3: el celular pregunta cada pocos segundos cómo va su solicitud.
create function public.qr_consultar_solicitud(p_solicitud_id uuid, p_secreto text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes_activacion := privado.solicitud_con_secreto(p_solicitud_id, p_secreto);
begin
  if v_sol.id is null then
    return privado.respuesta('no_encontrada', 'No se encontró la solicitud');
  end if;
  if v_sol.estado = 'pendiente' and v_sol.vence_en <= now() then
    update public.solicitudes_activacion set estado = 'vencida', resuelta_en = now() where id = v_sol.id;
    v_sol.estado := 'vencida';
  end if;
  return jsonb_build_object('codigo', 'ok', 'estado', v_sol.estado);
end;
$$;

-- Paso 4a: ¿qué usuario de Auth le toca? (la Edge Function lo crea si no hay)
create function public.qr_preparar_canje(p_solicitud_id uuid, p_secreto text, p_device_id uuid)
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
    'user_id', privado.usuario_para_alumno(v_alumno, v_alumno.numero_control)
  );
end;
$$;

-- Paso 4b: ligar el usuario al alumno y marcar la solicitud como usada.
create function public.qr_completar_canje(p_solicitud_id uuid, p_secreto text, p_device_id uuid, p_user_id uuid)
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


-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function
  public.abrir_activacion(uuid),
  public.cerrar_activacion(uuid),
  public.token_activacion_actual(uuid),
  public.listar_solicitudes(uuid),
  public.contar_solicitudes_pendientes(),
  public.aprobar_solicitud(uuid),
  public.rechazar_solicitud(uuid)
from public, anon;
grant execute on function
  public.abrir_activacion(uuid),
  public.cerrar_activacion(uuid),
  public.token_activacion_actual(uuid),
  public.listar_solicitudes(uuid),
  public.contar_solicitudes_pendientes(),
  public.aprobar_solicitud(uuid),
  public.rechazar_solicitud(uuid)
to authenticated;

revoke execute on function
  public.qr_alumnos_del_grupo(text),
  public.qr_solicitar_activacion(text, uuid, text, text, uuid, text, text),
  public.qr_consultar_solicitud(uuid, text),
  public.qr_preparar_canje(uuid, text, uuid),
  public.qr_completar_canje(uuid, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.qr_alumnos_del_grupo(text),
  public.qr_solicitar_activacion(text, uuid, text, text, uuid, text, text),
  public.qr_consultar_solicitud(uuid, text),
  public.qr_preparar_canje(uuid, text, uuid),
  public.qr_completar_canje(uuid, text, uuid, uuid)
to service_role;
