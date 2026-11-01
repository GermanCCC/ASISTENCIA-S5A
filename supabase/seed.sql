-- =====================================================================
-- Datos de prueba: un grupo con 10 alumnos ficticios.
--
-- Requisito: haber creado antes tu usuario de profesor en Supabase
-- (Authentication > Users > Add user). El grupo se le asigna al primer
-- profesor registrado.
--
-- Se puede correr varias veces: si el grupo de prueba ya existe, no hace nada.
-- =====================================================================
do $$
declare
  v_profesor uuid;
  v_grupo    uuid;
begin
  select id into v_profesor from public.profesores order by creado_en limit 1;
  if v_profesor is null then
    raise exception 'Primero crea tu usuario de profesor en Authentication > Users';
  end if;

  if exists (select 1 from public.grupos where profesor_id = v_profesor and nombre = 'PRUEBA') then
    raise notice 'El grupo PRUEBA ya existe, no se insertó nada';
    return;
  end if;

  insert into public.grupos (profesor_id, nombre, materia, periodo)
  values (v_profesor, 'PRUEBA', 'Materia de prueba', 'AGO-DIC 2026')
  returning id into v_grupo;

  -- Los tres últimos no tienen número de control, para probar el caso en
  -- que el alumno lo captura al activar su cuenta.
  insert into public.alumnos (grupo_id, numero_control, nombre) values
    (v_grupo, '99000001', 'ANDREA PRUEBA LÓPEZ'),
    (v_grupo, '99000002', 'BRUNO PRUEBA MARTÍNEZ'),
    (v_grupo, '99000003', 'CARLA PRUEBA SÁNCHEZ'),
    (v_grupo, '99000004', 'DIEGO PRUEBA RAMÍREZ'),
    (v_grupo, '99000005', 'ELENA PRUEBA TORRES'),
    (v_grupo, '99000006', 'FERNANDO PRUEBA RUIZ'),
    (v_grupo, '99000007', 'GABRIELA PRUEBA DÍAZ'),
    (v_grupo, null,       'HÉCTOR PRUEBA MORALES'),
    (v_grupo, null,       'ISABEL PRUEBA ORTIZ'),
    (v_grupo, null,       'JORGE PRUEBA CASTRO');
end;
$$;
