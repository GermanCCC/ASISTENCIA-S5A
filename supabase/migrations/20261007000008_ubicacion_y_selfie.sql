-- =====================================================================
-- Fase 7: ubicación y selfie opcionales
-- =====================================================================
--
-- Ubicación: el celular manda sus coordenadas (y la precisión del GPS)
-- al registrarse. Si está lejos del salón o no dio permiso, el registro
-- se guarda pero marcado como sospechoso, para que el profesor decida.
--
-- Selfie: el QR solo dura 10-20 s y tomarse una foto tarda más. Por eso,
-- si el grupo pide selfie, registrar_asistencia primero valida el QR como
-- siempre y, si todo está bien, responde "selfie_requerida" con un PASE
-- DE SELFIE de 90 segundos. Con la foto ya subida, el celular presenta el
-- pase y queda registrado con la hora del ESCANEO (la foto no causa
-- retardos). El pase va firmado con el secreto de la sesión y con el id
-- del alumno: no sirve para nadie más.


-- ---------------------------------------------------------------------
-- Bucket privado de selfies
-- ---------------------------------------------------------------------
-- Ruta de cada foto: <sesion_id>/<alumno_id>/<uuid>.jpg
-- Máximo 1 MB y solo JPEG (el celular la reduce a ~60 KB antes de subirla).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ¿Puede el usuario actual SUBIR esta foto? Solo a la carpeta de una
-- sesión ABIERTA de su propio grupo, con su propio id de alumno, y solo si
-- el grupo pide selfie. Así nadie puede subir fotos a nombre de otro ni
-- preparar una foto para una clase que todavía no empieza.
create function privado.puede_subir_selfie(p_nombre text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_nombre, ''), '/');
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if array_length(v_partes, 1) is distinct from 3
     or v_partes[1] !~ c_uuid
     or v_partes[2] !~ c_uuid
     or v_partes[3] !~ '^[0-9a-f-]{36}\.jpg$' then
    return false;
  end if;

  return exists (
    select 1
    from public.sesiones s
    join public.grupos g on g.id = s.grupo_id
    join public.alumnos a on a.grupo_id = s.grupo_id
    where s.id = v_partes[1]::uuid
      and a.id = v_partes[2]::uuid
      and a.user_id = (select auth.uid())
      and a.activo
      and s.estado = 'abierta'
      and g.requiere_selfie
  );
end;
$$;

-- ¿Puede el usuario actual VER esta foto? Solo el profesor dueño de la sesión.
create function privado.puede_ver_selfie(p_nombre text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sesion text := split_part(coalesce(p_nombre, ''), '/', 1);
begin
  if v_sesion !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return privado.es_dueno_de_la_sesion(v_sesion::uuid);
end;
$$;

grant execute on function privado.puede_subir_selfie(text), privado.puede_ver_selfie(text) to authenticated;

-- Solo estas dos políticas: nadie puede modificar ni borrar fotos desde
-- la app. Se borran solas a los 30 días (migración 9 + Edge Function
-- "limpiar-selfies").
create policy "Alumno sube su selfie" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'selfies' and privado.puede_subir_selfie(name));

create policy "Profesor ve las selfies de sus sesiones" on storage.objects
  for select to authenticated
  using (bucket_id = 'selfies' and privado.puede_ver_selfie(name));


-- ---------------------------------------------------------------------
-- Precisión del GPS
-- ---------------------------------------------------------------------
-- El GPS dentro de un edificio puede equivocarse decenas de metros. Se
-- guarda la precisión que reportó el celular para que el profesor pueda
-- juzgar mejor un "fuera del salón".
alter table public.asistencias add column precision_m double precision;


-- ---------------------------------------------------------------------
-- Pase de selfie
-- ---------------------------------------------------------------------
create function privado.firmar_pase_selfie(p_sesion_id uuid, p_alumno_id uuid, p_emitido bigint)
returns text
language sql stable
set search_path = ''
as $$
  select left(
    encode(
      extensions.hmac(
        convert_to('selfie:' || p_sesion_id::text || ':' || p_alumno_id::text || ':' || p_emitido::text, 'UTF8'),
        s.secreto,
        'sha256'
      ),
      'hex'
    ),
    32
  )
  from privado.sesion_secretos s
  where s.sesion_id = p_sesion_id;
$$;


-- ---------------------------------------------------------------------
-- registrar_asistencia (versión con selfie y precisión del GPS)
-- ---------------------------------------------------------------------
-- Se borra la versión anterior porque cambia la lista de parámetros
-- (si no, quedarían dos funciones con el mismo nombre).
drop function public.registrar_asistencia(text, uuid, double precision, double precision, text);

create function public.registrar_asistencia(
  p_token        text,
  p_device_id    uuid,
  p_lat          double precision default null,
  p_lng          double precision default null,
  p_selfie_path  text default null,
  p_precision_m  double precision default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_partes      text[];
  v_es_pase     boolean;
  v_sesion_id   uuid;
  v_numero      bigint;  -- intervalo (QR) o segundo en que se emitió (pase de selfie)
  v_firma       text;
  v_momento     timestamptz;
  v_emitido     bigint;
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
  v_precision   double precision;
  v_selfie      text;
  v_restriccion text;
begin
  -- 1. Debe haber sesión iniciada (la del alumno, guardada en su celular).
  if (select auth.uid()) is null then
    return privado.respuesta('no_autenticado', 'Inicia sesión para registrar tu asistencia');
  end if;

  -- 2. Dos formatos posibles:
  --      QR:              "<sesion_id>.<intervalo>.<firma>"
  --      pase de selfie:  "S.<sesion_id>.<segundo de emisión>.<firma>"
  v_partes := string_to_array(coalesce(p_token, ''), '.');
  v_es_pase := coalesce(array_length(v_partes, 1) = 4 and v_partes[1] = 'S', false);
  if v_es_pase then
    v_partes := v_partes[2:4];
  end if;
  if array_length(v_partes, 1) is distinct from 3
     or v_partes[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_partes[2] !~ '^[0-9]{1,15}$'
     or v_partes[3] !~ '^[0-9a-f]{32}$' then
    return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
  end if;
  v_sesion_id := v_partes[1]::uuid;
  v_numero    := v_partes[2]::bigint;
  v_firma     := v_partes[3];

  select * into v_sesion from public.sesiones where id = v_sesion_id;
  if not found then
    return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
  end if;

  -- 3. Ventana de tiempo. "El momento" del registro es ahora (QR) o el
  --    segundo en que escaneó (pase de selfie): así tomarse la foto no
  --    lo deja fuera ni lo vuelve retardo.
  v_momento := case when v_es_pase then to_timestamp(v_numero) else now() end;
  if v_sesion.estado = 'abierta' and v_momento >= v_sesion.cierra_en then
    perform privado.cerrar_sesion_interna(v_sesion.id);
    v_sesion.estado := 'cerrada';
  end if;
  if v_sesion.estado = 'cerrada' then
    return privado.respuesta('lista_cerrada', 'La lista ya se cerró');
  end if;

  -- 4 y 5. QR: firma e intervalo (el actual o el anterior).
  if not v_es_pase then
    if v_firma is distinct from privado.firmar(v_sesion_id, v_numero) then
      return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
    end if;
    if v_numero not in (privado.intervalo_actual(), privado.intervalo_actual() - 1) then
      return privado.respuesta('qr_expirado', 'QR expirado, escanea de nuevo');
    end if;
  end if;

  -- 6. El usuario debe ser alumno activo de este grupo.
  select * into v_alumno
  from public.alumnos
  where grupo_id = v_sesion.grupo_id and user_id = (select auth.uid()) and activo;
  if not found then
    return privado.respuesta('no_inscrito', 'No estás inscrito en este grupo');
  end if;

  -- Pase de selfie: firmado para ESTE alumno y con máximo 90 s de vida.
  if v_es_pase then
    if v_firma is distinct from privado.firmar_pase_selfie(v_sesion_id, v_alumno.id, v_numero) then
      return privado.respuesta('qr_invalido', 'Escanea el QR de nuevo');
    end if;
    if extract(epoch from now()) - v_numero > 90 or v_numero > extract(epoch from now()) + 5 then
      return privado.respuesta('qr_expirado', 'Se acabó el tiempo para la selfie. Escanea el QR de nuevo.');
    end if;
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
  --    esta sesión y este alumno, y existir de verdad en Storage.
  if v_grupo.requiere_selfie then
    if p_selfie_path is null
       or p_selfie_path not like v_sesion.id::text || '/' || v_alumno.id::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'selfies' and o.name = p_selfie_path) then
      -- Todo lo demás está bien: se entrega el pase para tomarse la foto.
      -- Si ya venía con pase, se conserva su hora (el plazo no se alarga).
      v_emitido := case when v_es_pase then v_numero else floor(extract(epoch from now()))::bigint end;
      return privado.respuesta('selfie_requerida', 'Tómate una selfie para terminar tu registro', jsonb_build_object(
        'pase', 'S.' || v_sesion.id::text || '.' || v_emitido::text || '.' || privado.firmar_pase_selfie(v_sesion.id, v_alumno.id, v_emitido),
        'sesion_id', v_sesion.id,
        'alumno_id', v_alumno.id,
        'segundos', 90 - (floor(extract(epoch from now()))::bigint - v_emitido)
      ));
    end if;
    v_selfie := p_selfie_path;
  end if;

  -- 10. Ubicación (si el grupo la pide). No se rechaza: el GPS falla dentro
  --     de los edificios, así que solo se marca como sospechosa para que
  --     el profesor decida.
  if v_grupo.requiere_ubicacion then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      v_sospechosa := true;
      v_motivo := 'No compartió su ubicación';
    else
      v_lat := p_lat;
      v_lng := p_lng;
      v_precision := case when p_precision_m > 0 then round(p_precision_m::numeric)::double precision end;
      v_distancia := round(privado.distancia_metros(v_grupo.lat, v_grupo.lng, p_lat, p_lng)::numeric, 1);
      if v_distancia > v_grupo.radio_m then
        v_sospechosa := true;
        v_motivo := format('Fuera del salón: a %s m (máximo %s m)', round(v_distancia), v_grupo.radio_m)
          || coalesce(format(', GPS con precisión de ±%s m', v_precision), '');
      end if;
    end if;
  end if;

  -- 11. ¿A tiempo o con retardo? (según el momento del escaneo)
  v_estado := case when v_momento >= v_sesion.retardo_desde then 'retardo' else 'presente' end;

  -- 12. Guardar. Las restricciones únicas de la tabla son la última
  --     defensa: si dos peticiones llegan al mismo tiempo, una falla aquí.
  begin
    insert into public.asistencias (
      sesion_id, alumno_id, estado, metodo, registrado_en, dispositivo_id, device_id,
      lat, lng, distancia_m, precision_m, selfie_path, sospechosa, motivo_sospecha
    ) values (
      v_sesion.id, v_alumno.id, v_estado, 'qr', v_momento, v_dispositivo.id, p_device_id,
      v_lat, v_lng, v_distancia, v_precision, v_selfie, v_sospechosa, v_motivo
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

revoke execute on function
  public.registrar_asistencia(text, uuid, double precision, double precision, text, double precision)
from public, anon;
grant execute on function
  public.registrar_asistencia(text, uuid, double precision, double precision, text, double precision)
to authenticated;


-- ---------------------------------------------------------------------
-- Limpieza: selfies con más de 30 días (la usa la Edge Function
-- "limpiar-selfies"; solo con la llave secreta).
-- ---------------------------------------------------------------------
-- Los archivos de Storage no se pueden borrar con SQL (quedarían en el
-- almacenamiento); se borran con la API de Storage desde la función.
create function public.selfies_vencidas(p_limite integer default 100)
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'selfies' and o.created_at < now() - interval '30 days'
  order by o.created_at
  limit p_limite;
$$;

revoke execute on function public.selfies_vencidas(integer) from public, anon, authenticated;
grant execute on function public.selfies_vencidas(integer) to service_role;
