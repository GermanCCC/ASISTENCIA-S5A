-- =====================================================================
-- Fase 2 · Migración 1: extensiones y tablas
-- =====================================================================

-- pgcrypto aporta hmac() (para firmar el QR) y gen_random_bytes()
-- (para el secreto de cada sesión). En Supabase vive en el esquema
-- "extensions" y normalmente ya está activada; esto solo lo asegura.
create extension if not exists pgcrypto with schema extensions;

-- Esquema "privado": funciones internas y datos secretos.
-- Supabase solo publica en su API el esquema "public", así que nada de lo
-- que esté aquí se puede llamar ni leer directamente desde el navegador.
create schema if not exists privado;


-- ---------------------------------------------------------------------
-- profesores: uno por cada usuario de Auth que no sea alumno.
-- La fila se crea sola con un trigger (ver migración 2).
-- ---------------------------------------------------------------------
create table public.profesores (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text not null,
  creado_en  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- grupos: un grupo = un grupo + una materia + un periodo.
-- Aquí vive toda la configuración del pase de lista.
-- ---------------------------------------------------------------------
create table public.grupos (
  id               uuid primary key default gen_random_uuid(),
  -- Por defecto el dueño es quien lo crea, así el frontend no tiene que mandarlo.
  profesor_id      uuid not null default auth.uid()
                   references public.profesores (id) on delete cascade,
  nombre           text not null check (trim(nombre) <> ''),
  materia          text not null check (trim(materia) <> ''),
  periodo          text,
  minutos_ventana  integer not null default 5 check (minutos_ventana between 1 and 240),
  minutos_retardo  integer not null default 3 check (minutos_retardo >= 1),
  porcentaje_minimo_asistencia numeric(5, 2) not null default 80
                   check (porcentaje_minimo_asistencia between 0 and 100),
  requiere_ubicacion boolean not null default false,
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),
  radio_m          integer not null default 100 check (radio_m > 0),
  requiere_selfie  boolean not null default false,
  creado_en        timestamptz not null default now(),

  -- Si el retardo empezara después del cierre nunca habría retardos;
  -- si se quiere eso, basta con poner retardo = ventana.
  constraint retardo_dentro_de_ventana check (minutos_retardo <= minutos_ventana),
  -- No se puede pedir ubicación sin haber guardado dónde está el salón.
  constraint ubicacion_completa check (not requiere_ubicacion or (lat is not null and lng is not null))
);
create index grupos_profesor_idx on public.grupos (profesor_id);


-- ---------------------------------------------------------------------
-- alumnos: una fila por alumno en cada grupo.
-- Si la misma persona está en dos grupos del profesor tiene dos filas,
-- pero las dos apuntan al mismo user_id (una sola cuenta en su celular).
-- ---------------------------------------------------------------------
create table public.alumnos (
  id               uuid primary key default gen_random_uuid(),
  grupo_id         uuid not null references public.grupos (id) on delete cascade,
  -- Nulo si el profesor no lo tiene; el alumno lo captura al activar.
  numero_control   text check (numero_control ~ '^\S+$'),
  nombre           text not null check (trim(nombre) <> ''),
  user_id          uuid references auth.users (id) on delete set null,
  -- Se guarda solo el hash SHA-256 del código, nunca el código en texto:
  -- si alguien llegara a ver la tabla, no podría usar los códigos.
  codigo_activacion_hash text,
  activado_en      timestamptz,
  -- false = dado de baja. No se borra para conservar su historial.
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),

  -- En Postgres los NULL no chocan entre sí en un UNIQUE, así que varios
  -- alumnos pueden no tener número de control todavía.
  constraint alumnos_numero_control_unico unique (grupo_id, numero_control),
  constraint alumnos_usuario_unico unique (grupo_id, user_id)
);
-- El código de activación identifica al alumno, así que no puede repetirse.
create unique index alumnos_codigo_unico on public.alumnos (codigo_activacion_hash)
  where codigo_activacion_hash is not null;
create index alumnos_user_idx on public.alumnos (user_id);


-- ---------------------------------------------------------------------
-- dispositivos: los celulares vinculados a cada alumno.
-- device_id es el UUID que el navegador del alumno genera y guarda.
-- ---------------------------------------------------------------------
create table public.dispositivos (
  id           uuid primary key default gen_random_uuid(),
  alumno_id    uuid not null references public.alumnos (id) on delete cascade,
  device_id    uuid not null,
  user_agent   text,
  estado       text not null default 'pendiente'
               check (estado in ('activo', 'pendiente', 'revocado')),
  creado_en    timestamptz not null default now(),
  aprobado_en  timestamptz
);
-- Un alumno tiene como máximo UN celular activo y UNO esperando aprobación.
-- Lo garantiza la base de datos, no el código de la página.
create unique index dispositivos_un_activo_por_alumno on public.dispositivos (alumno_id)
  where estado = 'activo';
create unique index dispositivos_un_pendiente_por_alumno on public.dispositivos (alumno_id)
  where estado = 'pendiente';
create index dispositivos_device_idx on public.dispositivos (device_id);


-- ---------------------------------------------------------------------
-- sesiones: cada vez que el profesor abre el pase de lista.
-- ---------------------------------------------------------------------
create table public.sesiones (
  id             uuid primary key default gen_random_uuid(),
  grupo_id       uuid not null references public.grupos (id) on delete cascade,
  fecha          date not null default (now() at time zone 'America/Hermosillo')::date,
  abierta_en     timestamptz not null default now(),
  -- Se calculan al abrir con la configuración del grupo en ese momento,
  -- así cambiar la configuración no afecta a una lista ya abierta.
  retardo_desde  timestamptz not null,
  cierra_en      timestamptz not null,
  estado         text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_en     timestamptz,

  constraint orden_de_tiempos check (abierta_en <= retardo_desde and retardo_desde <= cierra_en)
);
-- Solo puede haber una lista abierta por grupo a la vez.
create unique index sesiones_una_abierta_por_grupo on public.sesiones (grupo_id)
  where estado = 'abierta';
create index sesiones_grupo_fecha_idx on public.sesiones (grupo_id, fecha);
-- Acelera la búsqueda de listas vencidas que hace el cierre automático.
create index sesiones_abiertas_idx on public.sesiones (cierra_en) where estado = 'abierta';


-- ---------------------------------------------------------------------
-- Secreto de cada sesión, en una tabla aparte dentro de "privado".
--
-- Por qué no es una columna de "sesiones": si estuviera ahí, un
-- `select *` o una suscripción de Realtime podrían llegar a enviarlo al
-- navegador. Aquí no tiene ningún permiso para los usuarios de la app;
-- solo lo leen las funciones del servidor que firman y validan el QR.
-- ---------------------------------------------------------------------
create table privado.sesion_secretos (
  sesion_id  uuid primary key references public.sesiones (id) on delete cascade,
  secreto    bytea not null default extensions.gen_random_bytes(32)
);


-- ---------------------------------------------------------------------
-- asistencias: un registro por alumno por sesión.
-- ---------------------------------------------------------------------
create table public.asistencias (
  id               uuid primary key default gen_random_uuid(),
  sesion_id        uuid not null references public.sesiones (id) on delete cascade,
  alumno_id        uuid not null references public.alumnos (id) on delete cascade,
  estado           text not null check (estado in ('presente', 'retardo', 'falta', 'justificada')),
  -- qr = el alumno escaneó; manual = lo puso el profesor;
  -- automatico = falta generada al cerrar la lista.
  metodo           text not null check (metodo in ('qr', 'manual', 'automatico')),
  registrado_en    timestamptz not null default now(),
  dispositivo_id   uuid references public.dispositivos (id) on delete set null,
  -- Copia del UUID físico del celular. Ver el índice de abajo.
  device_id        uuid,
  lat              double precision,
  lng              double precision,
  distancia_m      double precision,
  selfie_path      text,
  sospechosa       boolean not null default false,
  motivo_sospecha  text,
  editado_por      uuid references public.profesores (id) on delete set null,
  editado_en       timestamptz,

  -- Regla 6: una asistencia por alumno por sesión.
  constraint asistencias_una_por_alumno unique (sesion_id, alumno_id)
);
-- Regla 1: un mismo celular no registra a dos alumnos en la misma sesión.
-- Se usa device_id (el celular físico) y no dispositivo_id (la fila de la
-- tabla dispositivos) porque cada alumno tiene sus propias filas: si un
-- celular quedara ligado a dos alumnos, tendría dos dispositivo_id
-- distintos y la restricción no lo detectaría.
create unique index asistencias_un_celular_por_sesion on public.asistencias (sesion_id, device_id)
  where device_id is not null;
create index asistencias_alumno_idx on public.asistencias (alumno_id);
