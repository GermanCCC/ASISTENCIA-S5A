-- =====================================================================
-- Regla única del número de control: de 4 a 20 letras o números.
-- =====================================================================
--
-- Antes la regla solo se revisaba al activar, y con un mensaje que no
-- distinguía el problema ("solo lleva letras y números" aunque fuera muy
-- corto). Además el profesor podía guardar un número que después no
-- servía para activar. Ahora:
--   * la tabla alumnos no acepta números fuera de la regla, y
--   * al activar, el mensaje dice exactamente qué está mal.
-- La misma regla está en el frontend (src/lib/texto.js) para avisar al
-- momento; si se cambia aquí, hay que cambiarla allá también.

-- 1. Números ya guardados que no cumplen la regla: nunca servirían para
--    activar, así que se dejan vacíos. Así el alumno lo captura él mismo
--    al activar (igual que cuando el profesor no lo tenía).
update public.alumnos
set numero_control = null
where numero_control is not null
  and numero_control !~ '^[A-Z0-9]{4,20}$';

-- 2. La tabla ya no acepta números fuera de la regla (la regla anterior,
--    "sin espacios", queda incluida en esta).
alter table public.alumnos drop constraint if exists alumnos_numero_control_check;
alter table public.alumnos
  add constraint alumnos_numero_control_formato check (numero_control ~ '^[A-Z0-9]{4,20}$');

-- 3. Al activar: un mensaje distinto para cada problema.
create or replace function privado.validar_activacion(
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

  if p_numero_control !~ '^[A-Z0-9]+$' then
    return privado.respuesta('numero_control_invalido', 'El número de control solo lleva letras y números');
  end if;

  if length(p_numero_control) not between 4 and 20 then
    return privado.respuesta('numero_control_longitud', 'El número de control debe tener entre 4 y 20 caracteres');
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
