# Sistema de Pase de Lista con QR

## Contexto

Sistema web para que un profesor pase lista en segundos al inicio de clase. El profesor proyecta o muestra en su celular un QR que cambia cada 5 segundos, y los alumnos lo escanean con su propio celular. El sistema evita que un alumno registre asistencia por otro.

Se usará primero con un solo grupo (S5A, Ingeniería en Sistemas, ITH Hermosillo), pero debe soportar varios grupos y materias del mismo profesor desde el inicio.

El autor (Alexis) debe poder explicar cada parte del sistema al profesor. Por eso:
- Comenta el código en español, explicando el porqué, no lo obvio.
- Al terminar cada fase, explica en el chat qué se hizo, qué archivos se crearon y cómo funciona la parte importante.
- Prefiere soluciones claras sobre soluciones ingeniosas.

## Stack

- Frontend: React + Vite + JavaScript (no TypeScript) + Tailwind CSS
- Rutas: React Router
- Backend: Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions)
- Escaneo de QR: librería `qr-scanner` (nimiq)
- Generación de QR: `qrcode`
- Gráficas: `recharts`
- Exportar a Excel: `exceljs`
- PWA: `vite-plugin-pwa` (instalable en el celular, con ícono y nombre)
- Deploy: Netlify (HTTPS obligatorio para usar la cámara)
- Desarrollo local en el celular: `@vitejs/plugin-basic-ssl` + `vite --host` para probar la cámara por la red local

Zona horaria de todas las fechas: America/Hermosillo.

## Roles

### Profesor
- Inicia sesión con correo y contraseña (Supabase Auth).
- Administra sus grupos, alumnos, sesiones de clase, dispositivos y estadísticas.

### Alumno
- No se registra solo. El profesor lo da de alta (o importa la lista) y el sistema genera un código de activación de un solo uso.
- El alumno activa su cuenta en su celular con número de control + código de activación. En ese momento su celular queda vinculado a su cuenta.
- La sesión del alumno queda guardada en ese celular para no tener que iniciar sesión cada clase.
- Una sola cuenta por alumno en todas sus clases, aunque sean de profesores distintos. Para unirse a otra clase usa "Unirme a otra clase" (o escanea el QR de activación desde Escanear) y se une con la sesión que ya tiene: la Edge Function la verifica con el servidor de Auth. Nunca se unen cuentas solo por número de control entre profesores distintos.

## Medidas anti-trampa (núcleo del proyecto)

Todas las validaciones se hacen en la base de datos (función RPC `security definer` o Edge Function), nunca solo en el frontend. Aunque alguien modifique el código de la página, no debe poder registrar asistencia indebida.

1. Un celular = un alumno
   - Al activar la cuenta se genera un `device_id` (UUID) guardado en localStorage e IndexedDB del navegador, y se registra en la tabla `dispositivos` ligado al alumno.
   - Cada registro de asistencia envía el `device_id`. Si no coincide con un dispositivo activo de ese alumno, se rechaza.
   - Un mismo dispositivo no puede registrar a dos alumnos distintos en la misma sesión (restricción única en la tabla).
   - Si el alumno cambia de celular o borra los datos del navegador, debe volver a activar y el nuevo dispositivo queda en estado `pendiente` hasta que el profesor lo apruebe. Al aprobarlo, el dispositivo anterior pasa a `revocado`.

2. QR rotativo
   - El QR contiene: `sesion_id`, número de intervalo (`floor(epoch / 5)`) y una firma HMAC-SHA256 calculada con un secreto aleatorio propio de cada sesión.
   - El secreto nunca sale del servidor hacia los alumnos. La pantalla del profesor obtiene del servidor (RPC accesible solo para el dueño del grupo) el token firmado actual y el siguiente; cambia sola al siguiente en el segundo exacto, sin depender de la red en ese momento.
   - Al validar se acepta el intervalo actual, y el anterior solo durante los primeros 3 segundos del intervalo nuevo (gracia para quien lo leyó justo al cambiar). En total, un QR vale 8 s desde que aparece. Cualquier otro (incluido uno de un intervalo que aún no empieza) se rechaza como "QR expirado".
   - Si el primer intento da "QR expirado", la app del alumno vuelve a leer sola una vez antes de mostrar el error.
   - El QR de activación es aparte: cambia cada 10 s y acepta el anterior completo (solo sirve para pedir una activación que el profesor aprueba).
   - Usar `pgcrypto` (`hmac()`) en PostgreSQL.

3. Ventana de tiempo
   - El profesor abre el pase de lista y la sesión queda abierta N minutos (configurable por grupo, default 5).
   - Registros después de M minutos (configurable, default 3) cuentan como `retardo`.
   - Al terminar la ventana la sesión se cierra sola. Cerrar también se puede hacer manualmente.
   - Al cerrar, se insertan registros `falta` para los alumnos que no se registraron (función `cerrar_sesion`). Para el cierre automático usar `pg_cron`; además, cualquier consulta sobre una sesión vencida debe cerrarla si sigue abierta.

4. Ubicación (opcional, configurable por grupo)
   - El profesor guarda la ubicación del salón (lat, lng) y un radio en metros (default 100).
   - El alumno envía sus coordenadas al registrarse. Si está fuera del radio o no da permiso, la asistencia se registra pero marcada como `sospechosa` con el motivo, para que el profesor decida. No se rechaza directamente porque el GPS dentro de edificios falla.

5. Selfie (opcional, configurable por grupo)
   - Si está activa, al registrarse el alumno toma una foto con la cámara frontal que se sube a Supabase Storage (bucket privado).
   - Solo el profesor dueño del grupo puede ver las fotos. Se borran automáticamente después de 30 días.

6. Una asistencia por alumno por sesión (restricción única).

7. Respuestas claras al alumno: "Registrado", "Registrado con retardo", "QR expirado, escanea de nuevo", "Este celular no está vinculado a tu cuenta", "La lista ya se cerró", "Ya estabas registrado".

## Base de datos

Usar migraciones SQL en `supabase/migrations/`. Activar Row Level Security en todas las tablas.

### Tablas

- profesores: id (= auth.users.id), nombre, creado_en
- grupos: id, profesor_id, nombre (ej. S5A), materia, periodo (ej. AGO-DIC 2026), minutos_ventana, minutos_retardo, porcentaje_minimo_asistencia (default 80), requiere_ubicacion, lat, lng, radio_m, requiere_selfie, creado_en
- alumnos: id, grupo_id, numero_control (nullable: si el profesor no lo tiene, el alumno lo captura al activar su cuenta), nombre, user_id (nullable, = auth.users.id al activar), codigo_activacion_hash, activado_en, activo; único (grupo_id, numero_control) cuando no sea nulo
- dispositivos: id, alumno_id, device_id, user_agent, estado (activo | pendiente | revocado), creado_en, aprobado_en
- sesiones: id, grupo_id, fecha, abierta_en, cierra_en, secreto (no visible para alumnos), estado (abierta | cerrada)
- asistencias: id, sesion_id, alumno_id, estado (presente | retardo | falta | justificada), metodo (qr | manual), registrado_en, dispositivo_id, lat, lng, distancia_m, selfie_path, sospechosa, motivo_sospecha, editado_por, editado_en; único (sesion_id, alumno_id); único (sesion_id, dispositivo_id) donde dispositivo_id no sea nulo

### Funciones

- `registrar_asistencia(token, device_id, lat, lng, selfie_path)`: hace todas las validaciones anti-trampa y devuelve un resultado con código y mensaje.
- `token_qr_actual(sesion_id)`: solo para el profesor dueño; devuelve el token firmado del intervalo actual y el del siguiente.
- `abrir_sesion(grupo_id)` y `cerrar_sesion(sesion_id)`.
- `aprobar_dispositivo(dispositivo_id)`.
- Vista `resumen_asistencia_alumno`: por alumno y grupo, total de clases, presentes, retardos, faltas, justificadas, porcentaje y bandera `en_riesgo` si está bajo el mínimo.

### Edge Function

- `activar-alumno`: recibe código de activación, número de control y device_id. El código identifica al alumno; si su número de control está vacío, se guarda el que capture (validando que no lo tenga otro alumno del grupo); si ya existe, debe coincidir. Verifica el código (hash), crea el usuario de Auth del alumno si no existe, liga `user_id`, registra el dispositivo (activo si es la primera activación, pendiente si ya tenía uno) e invalida el código. Usa la service role key solo dentro de la función.

### Seguridad
- La service role key nunca va en el frontend. Variables en `.env` (agregar `.env.example` sin valores reales).
- El alumno solo puede leer sus propios datos y su propio historial.
- El profesor solo puede ver y modificar sus propios grupos.

## Pantallas

### Profesor
1. Login
2. Inicio: lista de sus grupos con porcentaje de asistencia general y alumnos en riesgo
3. Grupo
   - Alumnos: alta manual, importar lista desde Excel o CSV (nombre obligatorio, número de control opcional), editar, dar de baja
   - Generar códigos de activación y exportarlos en PDF imprimible (una tarjeta por alumno con nombre, número de control, código y un QR con el enlace de activación)
   - Configuración del grupo (tiempos, ubicación, selfie, porcentaje mínimo)
4. Pase de lista (la pantalla estrella)
   - Botón grande "Abrir lista"
   - QR grande que rota cada 5 s con una barra de progreso que muestra cuándo cambia
   - Temporizador de cierre
   - Contador en vivo "18 / 32" y lista de alumnos que van llegando, actualizada con Supabase Realtime
   - Modo pantalla completa para proyectar
   - Botón "Cerrar lista"
5. Detalle de sesión: tabla de alumnos con su estado, cambiar estado a mano (por ejemplo justificar), ver sospechosos con su motivo y su selfie
6. Dispositivos pendientes: aprobar o rechazar cambios de celular
7. Estadísticas: porcentaje por alumno, alumnos en riesgo resaltados, gráfica de asistencia por fecha, historial por alumno
8. Exportar a Excel: hoja tipo lista de asistencia (alumnos en filas, fechas en columnas, P/R/F/J) más hoja de resumen con porcentajes

### Alumno
1. Activar cuenta (número de control + código, o llegar desde el QR de su tarjeta con el código ya puesto)
2. Escanear: abre la cámara directamente y registra al leer el QR, con retroalimentación grande (verde, amarillo o rojo) y vibración
3. Mi asistencia: porcentaje, clases faltadas, aviso si está en riesgo, y botón "Unirme a otra clase"

## Diseño
- Mobile first, todo debe verse bien en un celular.
- Modo claro y oscuro.
- Interfaz limpia y moderna, botones grandes, pocas palabras.
- La pantalla de pase de lista debe verse impecable proyectada.
- Todo el texto de la interfaz en español.

## Fases de desarrollo

Trabaja una fase a la vez. Al terminar cada una, detente, explica lo que hiciste y espera confirmación antes de seguir.

1. Proyecto base: Vite + React + Tailwind + Router + PWA + cliente de Supabase + estructura de carpetas + `.env.example`
2. Base de datos: migraciones de tablas, RLS, funciones y vista. Incluir datos de prueba (`supabase/seed.sql`) con un grupo y 10 alumnos ficticios.
3. Login del profesor, inicio y gestión de grupos y alumnos (incluida importación de Excel/CSV)
4. Activación de alumnos (Edge Function) y tarjetas PDF de activación
5. Pase de lista: QR rotativo, escaneo del alumno, validaciones, Realtime
6. Detalle de sesión, edición manual, dispositivos pendientes
7. Ubicación y selfie opcionales
8. Estadísticas, historial del alumno y exportación a Excel
9. Pulido: diseño, estados de carga y error, pruebas en celular real, deploy en Netlify
10. README con instrucciones de instalación y una sección "Cómo funciona la seguridad" explicada en lenguaje sencillo para presentarle al profesor

## Pruebas obligatorias antes de dar por terminada la fase 5

- Un alumno se registra correctamente.
- Un QR de hace más de 20 segundos se rechaza.
- Un QR anterior se acepta dentro de los 3 s de gracia y se rechaza después; el QR siguiente no sirve antes de su turno.
- El mismo celular no puede registrar a un segundo alumno.
- Un alumno no puede registrarse dos veces.
- Un registro después del cierre se rechaza.
- Un registro después de los minutos de retardo queda como retardo.
- Un alumno no puede llamar a `token_qr_actual` ni leer el secreto de la sesión.
- Un alumno no puede leer asistencias de otros alumnos.
