-- =====================================================================
-- Migración 10: el QR del pase de lista cambia cada 5 segundos
-- =====================================================================
--
-- Antes: el QR cambiaba cada 10 s y se aceptaba también el anterior
-- completo, así que una foto del QR servía hasta 20 s (suficiente para
-- mandarla por WhatsApp a alguien que no está en el salón).
--
-- Ahora:
--   * El QR cambia cada 5 s.
--   * Al cambiar, el anterior sigue valiendo solo 3 s más ("gracia"),
--     para no rechazar a quien lo leyó justo antes del cambio y su
--     registro tardó un poco en llegar.
--   * En total, un QR vale 8 s desde que aparece en pantalla.
--   * Un QR de un intervalo que todavía no empieza se rechaza.
--
-- token_qr_actual ahora también entrega el QR SIGUIENTE. La pantalla del
-- profesor lo tiene listo y cambia sola en el segundo exacto, sin
-- depender de la red en ese momento. Solo lo recibe el profesor dueño,
-- igual que el actual, y no sirve antes de su turno.
--
-- El QR de activación NO cambia: sigue con privado.intervalo_actual()
-- (10 s, aceptando el anterior). Ese QR solo permite PEDIR una
-- activación; la protección real es que el profesor aprueba cada
-- solicitud viendo el número de verificación.


-- ---------------------------------------------------------------------
-- Las dos constantes del QR del pase de lista. Si en clase real hay
-- muchos "QR expirado", basta con subir la gracia aquí.
-- ---------------------------------------------------------------------
create function privado.qr_segundos()
returns integer
language sql immutable
set search_path = ''
as $$
  select 5;
$$;

create function privado.qr_gracia()
returns integer
language sql immutable
set search_path = ''
as $$
  select 3;
$$;

-- Número de intervalo de 5 segundos en el que estamos (o en el que cae
-- p_momento). Ej. de 12:00:00 a 12:00:04 da el mismo número.
create function privado.intervalo_qr(p_momento timestamptz default now())
returns bigint
language sql stable
set search_path = ''
as $$
  select floor(extract(epoch from p_momento) / privado.qr_segundos())::bigint;
$$;

-- ¿El QR del intervalo p_intervalo vale en el momento p_momento?
-- Vale desde que empieza su intervalo hasta "gracia" segundos después de
-- que termina:
--
--   intervalo k:  |--- 5 s en pantalla ---|-- 3 s de gracia --|
--                 ^ aparece                ^ lo reemplaza el k+1   ^ ya no vale
--
-- p_momento existe para poder probar los bordes con horas inventadas.
create function privado.qr_vigente(p_intervalo bigint, p_momento timestamptz default now())
returns boolean
language sql stable
set search_path = ''
as $$
  select extract(epoch from p_momento) >= p_intervalo * privado.qr_segundos()
     and extract(epoch from p_momento) < (p_intervalo + 1) * privado.qr_segundos() + privado.qr_gracia();
$$;


-- ---------------------------------------------------------------------
-- token_qr_actual: ahora entrega el QR actual y el siguiente.
-- ---------------------------------------------------------------------
create or replace function public.token_qr_actual(p_sesion_id uuid)
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

  v_intervalo := privado.intervalo_qr();

  return jsonb_build_object(
    'abierta', true,
    'token', p_sesion_id::text || '.' || v_intervalo::text || '.' || privado.firmar(p_sesion_id, v_intervalo),
    -- El que va después. La pantalla lo muestra al llegar "siguiente_cambio";
    -- antes de esa hora el servidor lo rechaza.
    'token_siguiente', p_sesion_id::text || '.' || (v_intervalo + 1)::text || '.' || privado.firmar(p_sesion_id, v_intervalo + 1),
    -- Hora del servidor y momento del próximo cambio: con esto la pantalla
    -- se sincroniza aunque el reloj de la computadora esté mal.
    'ahora', now(),
    'siguiente_cambio', to_timestamp((v_intervalo + 1) * privado.qr_segundos()),
    'segundos', privado.qr_segundos(),
    'cierra_en', v_sesion.cierra_en
  );
end;
$$;


-- ---------------------------------------------------------------------
-- registrar_asistencia: igual que en la migración 8, salvo el paso 4-5
-- (vigencia del QR), que ahora usa privado.qr_vigente.
-- "create or replace" conserva los permisos que ya tenía la función.
-- ---------------------------------------------------------------------
create or replace function public.registrar_asistencia(
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

  -- 4 y 5. QR: firma y vigencia (5 s en pantalla + 3 s de gracia;
  --        ver privado.qr_vigente).
  if not v_es_pase then
    if v_firma is distinct from privado.firmar(v_sesion_id, v_numero) then
      return privado.respuesta('qr_invalido', 'Este QR no es de pase de lista');
    end if;
    if not privado.qr_vigente(v_numero) then
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
