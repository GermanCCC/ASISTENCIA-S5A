-- =====================================================================
-- Fase 2 · Migración 3: funciones del pase de lista y vista de resumen
-- =====================================================================
--
-- Todas las funciones públicas son "security definer": se ejecutan con
-- permisos del dueño de la base, por eso pueden leer el secreto del QR
-- o insertar asistencias aunque el usuario no tenga esos permisos.
-- A cambio, cada una revisa a mano quién la está llamando.
--
-- "set search_path = ''" obliga a escribir cada tabla con su esquema
-- (public.grupos, privado.sesion_secretos...). Es una recomendación de
-- seguridad de Postgres para funciones security definer: impide que
-- alguien cree una tabla con el mismo nombre en otro esquema y engañe
-- a la función.


-- =====================================================================
-- Funciones internas (esquema privado, no accesibles desde la API)
-- =====================================================================

-- Número de intervalo de 10 segundos en el que estamos.
-- Ej. a las 12:00:00 y a las 12:00:09 da el mismo número; a las 12:00:10 cambia.
create function privado.intervalo_actual()
returns bigint
language sql stable
set search_path = ''
as $$
  select floor(extract(epoch from now()) / 10)::bigint;
$$;

-- Firma HMAC-SHA256 de "sesion_id:intervalo" con el secreto de la sesión.
-- Sin el secreto es imposible calcular la firma de otro intervalo, así que
-- nadie puede "adelantar" ni fabricar un QR válido.
-- Se usan los primeros 32 caracteres hex (128 bits): sigue siendo
-- imposible de adivinar y el QR queda menos denso, más fácil de leer
-- de lejos cuando se proyecta.
create function privado.firmar(p_sesion_id uuid, p_intervalo bigint)
returns text
language sql stable
set search_path = ''
as $$
  select left(
    encode(
      extensions.hmac(convert_to(p_sesion_id::text || ':' || p_intervalo::text, 'UTF8'), s.secreto, 'sha256'),
      'hex'
    ),
    32
  )
  from privado.sesion_secretos s
  where s.sesion_id = p_sesion_id;
$$;

-- Distancia en metros entre dos coordenadas (fórmula de haversine).
create function privado.distancia_metros(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Cierra una sesión y pone "falta" a los alumnos activos que no se
-- registraron. No revisa permisos: la usan las funciones públicas
-- (que ya los revisaron) y el cierre automático de pg_cron.
create function privado.cerrar_sesion_interna(p_sesion_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- El "and estado = 'abierta'" evita cerrar dos veces si dos procesos
  -- intentan cerrar la misma sesión al mismo tiempo.
  update public.sesiones
  set estado = 'cerrada', cerrada_en = now()
  where id = p_sesion_id and estado = 'abierta';

  if not found then
    return;
  end if;

  insert into public.asistencias (sesion_id, alumno_id, estado, metodo)
  select s.id, a.id, 'falta', 'automatico'
  from public.sesiones s
  join public.alumnos a on a.grupo_id = s.grupo_id
  where s.id = p_sesion_id and a.activo
  -- Los que ya tienen registro (presente, retardo...) se respetan.
  on conflict (sesion_id, alumno_id) do nothing;

  -- Con la lista cerrada el secreto ya no sirve para nada.
  delete from privado.sesion_secretos where sesion_id = p_sesion_id;
end;
$$;

-- Cierra todas las sesiones cuyo tiempo ya terminó. La ejecuta pg_cron
-- cada minuto (migración 4). Devuelve cuántas cerró.
create function privado.cerrar_sesiones_vencidas()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_total integer := 0;
begin
  for v_id in
    select id from public.sesiones where estado = 'abierta' and cierra_en <= now()
  loop
    perform privado.cerrar_sesion_interna(v_id);
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

-- Arma la respuesta de registrar_asistencia: siempre un código fijo
-- (para que el frontend decida el color) y un mensaje para el alumno.
create function privado.respuesta(p_codigo text, p_mensaje text, p_extra jsonb default '{}')
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('codigo', p_codigo, 'mensaje', p_mensaje) || p_extra;
$$;


-- =====================================================================
-- Funciones públicas (se llaman desde el frontend con supabase.rpc)
-- =====================================================================

-- ---------------------------------------------------------------------
-- abrir_sesion: el profesor abre el pase de lista de un grupo.
-- Si ya hay una lista abierta y vigente, la devuelve en vez de abrir otra
-- (así un doble clic no causa problemas).
-- ---------------------------------------------------------------------
create function public.abrir_sesion(p_grupo_id uuid)
returns public.sesiones
language plpgsql security definer
set search_path = ''
as $$
declare
  v_grupo  public.grupos;
  v_sesion public.sesiones;
begin
  select * into v_grupo
  from public.grupos
  where id = p_grupo_id and profesor_id = (select auth.uid());

  if not found then
    raise exception 'No tienes acceso a este grupo' using errcode = '42501';
  end if;

  select * into v_sesion
  from public.sesiones
  where grupo_id = p_grupo_id and estado = 'abierta';

  if found then
    if now() < v_sesion.cierra_en then
      return v_sesion;
    end if;
    -- Estaba abierta pero ya se le acabó el tiempo: se cierra primero.
    perform privado.cerrar_sesion_interna(v_sesion.id);
  end if;

  insert into public.sesiones (grupo_id, retardo_desde, cierra_en)
  values (
    p_grupo_id,
    now() + make_interval(mins => v_grupo.minutos_retardo),
    now() + make_interval(mins => v_grupo.minutos_ventana)
  )
  returning * into v_sesion;

  -- El secreto se genera solo (32 bytes aleatorios, ver la tabla).
  insert into privado.sesion_secretos (sesion_id) values (v_sesion.id);

  return v_sesion;

exception
  -- Dos clics al mismo tiempo: el índice "una abierta por grupo" frena
  -- al segundo, que simplemente devuelve la sesión que abrió el primero.
  when unique_violation then
    select * into v_sesion
    from public.sesiones
    where grupo_id = p_grupo_id and estado = 'abierta';
    return v_sesion;
end;
$$;


-- ---------------------------------------------------------------------
-- cerrar_sesion: el profesor cierra la lista a mano.
-- ---------------------------------------------------------------------
create function public.cerrar_sesion(p_sesion_id uuid)
returns public.sesiones
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sesion public.sesiones;
begin
  if not privado.es_dueno_de_la_sesion(p_sesion_id) then
    raise exception 'No tienes acceso a esta sesión' using errcode = '42501';
  end if;

  perform privado.cerrar_sesion_interna(p_sesion_id);

  select * into v_sesion from public.sesiones where id = p_sesion_id;
  return v_sesion;
end;
$$;


-- ---------------------------------------------------------------------
-- cerrar_sesiones_vencidas: el frontend la llama antes de mostrar
-- estadísticas o el detalle de una sesión, para que nunca se vea una
-- lista "abierta" que ya debió cerrarse (pg_cron corre cada minuto, y
-- esto cubre el hueco). Es seguro que cualquiera la llame: solo hace lo
-- mismo que el cierre automático.
-- ---------------------------------------------------------------------
create function public.cerrar_sesiones_vencidas()
returns integer
language sql security definer
set search_path = ''
as $$
  select privado.cerrar_sesiones_vencidas();
$$;


-- ---------------------------------------------------------------------
-- token_qr_actual: lo que muestra el QR del profesor en este momento.
-- Solo el profesor dueño del grupo puede pedirlo; a cualquier otro
-- (incluidos los alumnos) le responde con error.
--
-- Formato del token: "<sesion_id>.<intervalo>.<firma>"
-- ---------------------------------------------------------------------
create function public.token_qr_actual(p_sesion_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sesion    public.sesiones;
  v_intervalo bigint;
begin
  if not privado.es_dueno_de_la_sesion(p_sesion_id) then
    raise exception 'No tienes acceso a esta sesión' using errcode = '42501';
  end if;

  select * into v_sesion from public.sesiones where id = p_sesion_id;

  if v_sesion.estado = 'abierta' and now() >= v_sesion.cierra_en then
    perform privado.cerrar_sesion_interna(p_sesion_id);
    v_sesion.estado := 'cerrada';
  end if;

  if v_sesion.estado = 'cerrada' then
    return jsonb_build_object('abierta', false);
  end if;

  v_intervalo := privado.intervalo_actual();

  return jsonb_build_object(
    'abierta', true,
    'token', p_sesion_id::text || '.' || v_intervalo::text || '.' || privado.firmar(p_sesion_id, v_intervalo),
    -- Hora del servidor y momento del próximo cambio: con esto la barra de
    -- progreso se sincroniza aunque el reloj de la computadora esté mal.
    'ahora', now(),
    'siguiente_cambio', to_timestamp((v_intervalo + 1) * 10),
    'cierra_en', v_sesion.cierra_en
  );
end;
$$;


-- ---------------------------------------------------------------------
-- registrar_asistencia: lo que pasa cuando el alumno escanea el QR.
--
-- Hace TODAS las validaciones aquí, en el servidor. Aunque alguien
-- modifique la página, no puede saltarse ninguna. Nunca lanza error:
-- siempre devuelve { codigo, mensaje } para mostrarlo al alumno.
-- ---------------------------------------------------------------------
create function public.registrar_asistencia(
  p_token        text,
  p_device_id    uuid,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_selfie_path  text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_partes      text[];
  v_sesion_id   uuid;
  v_intervalo   bigint;
  v_firma       text;
  v_sesion      public.sesiones;
  v_grupo       public.grupos;
  v_alumno      public.alumnos;
  v_dispositivo public.dispositivos;
  v_estado      text;
  v_sospechosa  boolean := false;
  v_motivo      text;
  v_distancia   double precision;
  v_lat         double precision;
  v_lng         double precision;
  v_selfie      text;
  v_restriccion text;
begin
  -- 1. Debe haber sesión iniciada (la del alumno, guardada en su celular).
  if (select auth.uid()) is null then
    return privado.respuesta('no_autenticado', 'Inicia sesión para registrar tu asistencia');
  end if;

  -- 2. El token debe tener la forma "<uuid>.<número>.<32 hex>".
  v_partes := string_to_array(p_token, '.');
  if array_length(v_partes, 1) is distinct from 3
     or v_partes[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_partes[2] !~ '^[0-9]{1,15}$'
     or v_partes[3] !~ '^[0-9a-f]{32}$' then
    return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
  end if;
  v_sesion_id := v_partes[1]::uuid;
  v_intervalo := v_partes[2]::bigint;
  v_firma     := v_partes[3];

  select * into v_sesion from public.sesiones where id = v_sesion_id;
  if not found then
    return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
  end if;

  -- 3. Ventana de tiempo. Si ya pasó la hora de cierre y la sesión sigue
  --    abierta (pg_cron aún no pasa), se cierra aquí mismo.
  if v_sesion.estado = 'abierta' and now() >= v_sesion.cierra_en then
    perform privado.cerrar_sesion_interna(v_sesion.id);
    v_sesion.estado := 'cerrada';
  end if;
  if v_sesion.estado = 'cerrada' then
    return privado.respuesta('lista_cerrada', 'La lista ya se cerró');
  end if;

  -- 4. Firma: prueba que el QR lo generó el servidor y no fue alterado.
  if v_firma is distinct from privado.firmar(v_sesion_id, v_intervalo) then
    return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
  end if;

  -- 5. QR rotativo: solo valen el intervalo actual y el anterior
  --    (de 10 a 20 segundos de vida). Una foto del QR enviada por
  --    WhatsApp llega tarde y se rechaza.
  if v_intervalo not in (privado.intervalo_actual(), privado.intervalo_actual() - 1) then
    return privado.respuesta('qr_expirado', 'QR expirado, escanea de nuevo');
  end if;

  -- 6. El usuario debe ser alumno activo de este grupo.
  select * into v_alumno
  from public.alumnos
  where grupo_id = v_sesion.grupo_id and user_id = (select auth.uid()) and activo;
  if not found then
    return privado.respuesta('no_inscrito', 'No estás inscrito en este grupo');
  end if;

  -- 7. Un celular = un alumno: el device_id debe ser el celular ACTIVO
  --    de este alumno.
  select * into v_dispositivo
  from public.dispositivos
  where alumno_id = v_alumno.id and device_id = p_device_id and estado = 'activo';
  if not found then
    if exists (
      select 1 from public.dispositivos
      where alumno_id = v_alumno.id and device_id = p_device_id and estado = 'pendiente'
    ) then
      return privado.respuesta('dispositivo_pendiente', 'Tu celular nuevo está esperando que el profesor lo apruebe');
    end if;
    return privado.respuesta('dispositivo_no_vinculado', 'Este celular no está vinculado a tu cuenta');
  end if;

  -- 8. ¿Ya estaba registrado? (respuesta amable antes de intentar insertar)
  if exists (select 1 from public.asistencias where sesion_id = v_sesion.id and alumno_id = v_alumno.id) then
    return privado.respuesta('ya_registrado', 'Ya estabas registrado');
  end if;

  select * into v_grupo from public.grupos where id = v_sesion.grupo_id;

  -- 9. Selfie (si el grupo la pide). La foto debe estar en la carpeta de
  --    esta sesión y este alumno, para que no se reuse la de otro.
  if v_grupo.requiere_selfie then
    if p_selfie_path is null
       or p_selfie_path not like v_sesion.id::text || '/' || v_alumno.id::text || '/%' then
      return privado.respuesta('selfie_requerida', 'Tómate la selfie para registrarte');
    end if;
    v_selfie := p_selfie_path;
  end if;

  -- 10. Ubicación (si el grupo la pide). No se rechaza: el GPS falla dentro
  --     de los edificios, así que solo se marca como sospechosa para que
  --     el profesor decida.
  if v_grupo.requiere_ubicacion then
    if p_lat is null or p_lng is null then
      v_sospechosa := true;
      v_motivo := 'No compartió su ubicación';
    else
      v_lat := p_lat;
      v_lng := p_lng;
      v_distancia := round(privado.distancia_metros(v_grupo.lat, v_grupo.lng, p_lat, p_lng)::numeric, 1);
      if v_distancia > v_grupo.radio_m then
        v_sospechosa := true;
        v_motivo := format('Fuera del salón: a %s m (máximo %s m)', round(v_distancia), v_grupo.radio_m);
      end if;
    end if;
  end if;

  -- 11. ¿A tiempo o con retardo?
  v_estado := case when now() >= v_sesion.retardo_desde then 'retardo' else 'presente' end;

  -- 12. Guardar. Las restricciones únicas de la tabla son la última
  --     defensa: si dos peticiones llegan al mismo tiempo, una falla aquí.
  begin
    insert into public.asistencias (
      sesion_id, alumno_id, estado, metodo, dispositivo_id, device_id,
      lat, lng, distancia_m, selfie_path, sospechosa, motivo_sospecha
    ) values (
      v_sesion.id, v_alumno.id, v_estado, 'qr', v_dispositivo.id, p_device_id,
      v_lat, v_lng, v_distancia, v_selfie, v_sospechosa, v_motivo
    );
  exception when unique_violation then
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion = 'asistencias_un_celular_por_sesion' then
      return privado.respuesta('dispositivo_usado', 'Este celular ya registró a otro alumno en esta clase');
    end if;
    -- Si el profesor cerró la lista justo en este instante, ya existe su falta.
    if (select estado from public.sesiones where id = v_sesion.id) = 'cerrada' then
      return privado.respuesta('lista_cerrada', 'La lista ya se cerró');
    end if;
    return privado.respuesta('ya_registrado', 'Ya estabas registrado');
  end;

  if v_estado = 'retardo' then
    return privado.respuesta('retardo', 'Registrado con retardo',
      jsonb_build_object('estado', v_estado, 'sospechosa', v_sospechosa));
  end if;
  return privado.respuesta('presente', 'Registrado',
    jsonb_build_object('estado', v_estado, 'sospechosa', v_sospechosa));
end;
$$;


-- ---------------------------------------------------------------------
-- aprobar_dispositivo: el profesor acepta el celular nuevo de un alumno.
-- El celular anterior queda revocado (ya no sirve para registrar).
-- ---------------------------------------------------------------------
create function public.aprobar_dispositivo(p_dispositivo_id uuid)
returns public.dispositivos
language plpgsql security definer
set search_path = ''
as $$
declare
  v_disp     public.dispositivos;
  v_grupo_id uuid;
begin
  -- "for update" bloquea la fila para que dos aprobaciones simultáneas
  -- no se pisen.
  select * into v_disp from public.dispositivos where id = p_dispositivo_id for update;

  if not found or not privado.es_dueno_del_alumno(v_disp.alumno_id) then
    raise exception 'No tienes acceso a este dispositivo' using errcode = '42501';
  end if;
  if v_disp.estado <> 'pendiente' then
    raise exception 'Este celular no está pendiente de aprobación';
  end if;

  -- Un celular = un alumno: no se aprueba si ese celular ya está activo
  -- para otro alumno del mismo grupo (señal de que lo están compartiendo).
  select grupo_id into v_grupo_id from public.alumnos where id = v_disp.alumno_id;
  if exists (
    select 1 from public.dispositivos d
    join public.alumnos a on a.id = d.alumno_id
    where d.device_id = v_disp.device_id
      and d.estado = 'activo'
      and d.alumno_id <> v_disp.alumno_id
      and a.grupo_id = v_grupo_id
  ) then
    raise exception 'Este celular ya está vinculado a otro alumno del grupo';
  end if;

  -- Primero se revoca el anterior: el índice único solo permite un
  -- celular activo por alumno.
  update public.dispositivos
  set estado = 'revocado'
  where alumno_id = v_disp.alumno_id and estado = 'activo';

  update public.dispositivos
  set estado = 'activo', aprobado_en = now()
  where id = p_dispositivo_id
  returning * into v_disp;

  return v_disp;
end;
$$;


-- ---------------------------------------------------------------------
-- rechazar_dispositivo: el profesor no acepta el celular nuevo.
-- El celular anterior (si lo hay) sigue funcionando.
-- ---------------------------------------------------------------------
create function public.rechazar_dispositivo(p_dispositivo_id uuid)
returns public.dispositivos
language plpgsql security definer
set search_path = ''
as $$
declare
  v_disp public.dispositivos;
begin
  select * into v_disp from public.dispositivos where id = p_dispositivo_id for update;

  if not found or not privado.es_dueno_del_alumno(v_disp.alumno_id) then
    raise exception 'No tienes acceso a este dispositivo' using errcode = '42501';
  end if;
  if v_disp.estado <> 'pendiente' then
    raise exception 'Este celular no está pendiente de aprobación';
  end if;

  update public.dispositivos
  set estado = 'revocado'
  where id = p_dispositivo_id
  returning * into v_disp;

  return v_disp;
end;
$$;


-- =====================================================================
-- Vista: resumen de asistencia por alumno
-- =====================================================================
-- "security_invoker" hace que la vista respete el RLS de quien la consulta:
-- el profesor ve a los alumnos de sus grupos y el alumno solo su propia
-- fila. Sin esto, una vista en Postgres se salta el RLS.
--
-- Solo cuentan las sesiones cerradas: una lista abierta todavía no tiene
-- las faltas, y el porcentaje saldría inflado.
--
-- Para el porcentaje cuentan como asistencia: presente, retardo y
-- justificada. Si el reglamento dice otra cosa (por ejemplo, que 3
-- retardos sean 1 falta), aquí es donde se ajusta.
create view public.resumen_asistencia_alumno
with (security_invoker = true)
as
select
  a.id              as alumno_id,
  a.grupo_id,
  a.nombre,
  a.numero_control,
  a.activo,
  count(asi.id)                                          as total_clases,
  count(asi.id) filter (where asi.estado = 'presente')    as presentes,
  count(asi.id) filter (where asi.estado = 'retardo')     as retardos,
  count(asi.id) filter (where asi.estado = 'falta')       as faltas,
  count(asi.id) filter (where asi.estado = 'justificada') as justificadas,
  -- NULL si todavía no hay clases (no es 0% ni 100%).
  round(
    100.0 * count(asi.id) filter (where asi.estado in ('presente', 'retardo', 'justificada'))
    / nullif(count(asi.id), 0),
    1
  )                                                      as porcentaje,
  g.porcentaje_minimo_asistencia                         as porcentaje_minimo,
  coalesce(
    100.0 * count(asi.id) filter (where asi.estado in ('presente', 'retardo', 'justificada'))
    / nullif(count(asi.id), 0) < g.porcentaje_minimo_asistencia,
    false
  )                                                      as en_riesgo
from public.alumnos a
join public.grupos g on g.id = a.grupo_id
left join (
  public.asistencias asi
  join public.sesiones s on s.id = asi.sesion_id and s.estado = 'cerrada'
) on asi.alumno_id = a.id
group by a.id, g.id;


-- =====================================================================
-- Permisos de ejecución
-- =====================================================================
-- Por defecto Postgres (y Supabase) dejan ejecutar funciones a todos,
-- incluso sin sesión. Se quita y se da solo a usuarios con sesión.
revoke execute on function
  public.abrir_sesion(uuid),
  public.cerrar_sesion(uuid),
  public.cerrar_sesiones_vencidas(),
  public.token_qr_actual(uuid),
  public.registrar_asistencia(text, uuid, double precision, double precision, text),
  public.aprobar_dispositivo(uuid),
  public.rechazar_dispositivo(uuid)
from public, anon;

grant execute on function
  public.abrir_sesion(uuid),
  public.cerrar_sesion(uuid),
  public.cerrar_sesiones_vencidas(),
  public.token_qr_actual(uuid),
  public.registrar_asistencia(text, uuid, double precision, double precision, text),
  public.aprobar_dispositivo(uuid),
  public.rechazar_dispositivo(uuid)
to authenticated;

revoke all on public.resumen_asistencia_alumno from anon;
grant select on public.resumen_asistencia_alumno to authenticated;
