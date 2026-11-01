# Pase de Lista con QR

**Versión local para Windows y teléfonos:** consulta [USAR-EN-WINDOWS.md](USAR-EN-WINDOWS.md). Incluye base de datos en la computadora, conexión por router sin internet y QR desde Android y iPhone. Las instrucciones de Netlify y Supabase de este documento corresponden a la versión web original.

Aplicación web para pasar lista en segundos al inicio de la clase. El profesor muestra un código QR que cambia cada 5 segundos, y cada alumno lo escanea con su propio celular. El sistema impide que un alumno registre la asistencia de otro.

Se creó para el grupo S5A de Ingeniería en Sistemas del ITH Hermosillo, pero sirve para varios grupos y materias del mismo profesor.

**App publicada:** https://asistencia-s5a.netlify.app

---

## Contenido

1. [Cómo se usa](#cómo-se-usa)
2. [Cómo funciona la seguridad](#cómo-funciona-la-seguridad)
3. [Instalación](#instalación)
4. [Pruebas](#pruebas)
5. [Estructura del proyecto](#estructura-del-proyecto)
6. [Situaciones comunes](#situaciones-comunes)

---

## Cómo se usa

### El profesor

1. Entra con su correo y contraseña.
2. Crea un grupo y agrega a sus alumnos, a mano o importando una lista de Excel o CSV.
3. Activa a los alumnos, una sola vez al inicio del semestre:
   - **Con el QR de activación** (recomendado): abre "Activar alumnos", proyecta el QR y aprueba cada solicitud que llega a su pantalla.
   - **Con tarjetas impresas**: genera un PDF con una tarjeta por alumno, cada una con su código.
4. En cada clase toca **Abrir lista** y proyecta el QR. Los alumnos van apareciendo en vivo ("18 / 32"). La lista se cierra sola al terminar el tiempo, o con **Cerrar lista**.
5. Puede corregir asistencias a mano (por ejemplo, justificar una falta), revisar registros sospechosos, ver estadísticas y exportar la lista a Excel.

### El alumno

1. Activa su cuenta una sola vez en su celular. Desde ese momento el celular queda ligado a su cuenta y no tiene que volver a iniciar sesión.
2. En cada clase abre la app y apunta la cámara al QR. La pantalla se pone verde (registrado), amarilla (retardo) o roja (algo falló, con el motivo).
3. En "Mi asistencia" ve su porcentaje, su historial y si está en riesgo de no alcanzar el mínimo.
4. Si toma otra materia (aunque sea con otro profesor), toca **Unirme a otra clase** y escanea el QR de activación de esa clase. Se une con **la misma cuenta**: ve todas sus clases juntas y no pierde ninguna.

---

## Cómo funciona la seguridad

*Esta sección explica, sin términos técnicos, qué hace el sistema para que nadie pueda registrar asistencia por otro.*

### La regla más importante: todo se revisa en el servidor

Cada vez que un alumno escanea el QR, su celular solo **envía** lo que leyó. Quien decide si el registro vale es la **base de datos**, en el servidor, no el celular.

Por eso, aunque alguien modifique la aplicación de su celular, no puede saltarse ninguna regla. Las reglas de abajo están programadas dentro de la base de datos.

### "¿Y si un alumno le presta su cuenta a otro?"

**Un celular = un alumno.**

- Al activar su cuenta, el celular del alumno recibe una identificación única que queda ligada a él.
- Al pasar lista, el servidor revisa que el registro venga de **ese** celular. Desde otro celular se rechaza: *"Este celular no está vinculado a tu cuenta"*.
- Un mismo celular no puede registrar a dos alumnos en la misma clase.
- Si un alumno cambia de celular (o borra los datos del navegador), tiene que volver a activar su cuenta, y **el profesor tiene que aprobarlo**:
  - La solicitud aparece marcada en rojo como "cambio de celular".
  - Trae un número de verificación de 3 dígitos que el alumno muestra en su pantalla, para que el profesor confirme que es él.
  - Al aprobarla, el celular anterior deja de funcionar.

### "¿Y si le manda una foto del QR por WhatsApp a un amigo?"

**El QR caduca en segundos.**

- El QR cambia cada 5 segundos. Cada uno vale como máximo **8 segundos** desde que aparece: 5 en pantalla y 3 de tolerancia para quien lo leyó justo cuando cambiaba. En lo que alguien toma la foto, la envía y el otro la escanea, el QR ya venció.
- Cada QR lleva una **firma** hecha con una clave secreta distinta para cada clase. La clave nunca sale del servidor: ni los alumnos ni la pantalla del profesor la conocen. Por eso nadie puede fabricar un QR válido ni adivinar el siguiente.
- La pantalla del profesor recibe del servidor el QR actual y el siguiente, y cambia sola en el segundo exacto.

### "¿Y si alguien se conecta por videollamada para ver el QR en vivo?"

Contra eso, el profesor puede activar dos medidas opcionales en la configuración del grupo:

- **Ubicación:** el profesor guarda dónde está el salón. Si el alumno se registra lejos de ahí, o no da permiso de ubicación, su asistencia **se registra pero queda marcada como sospechosa**, con el motivo y la distancia, para que el profesor decida. No se rechaza de golpe porque el GPS falla seguido dentro de los edificios.
- **Selfie:** al registrarse, el alumno se toma una foto con la cámara frontal, en ese momento. No puede elegir una foto de la galería. Solo el profesor del grupo puede ver las fotos, y se borran solas a los 30 días.

### "¿Y si llega tarde o quiere registrarse después?"

- La lista está abierta un tiempo fijo (5 minutos por defecto). Después de unos minutos (3 por defecto), el registro cuenta como **retardo**. Los dos tiempos se configuran por grupo.
- Al terminar el tiempo, la lista **se cierra sola**, aunque el profesor haya cerrado la pestaña. Los alumnos que no se registraron quedan con **falta**.
- Un registro después del cierre se rechaza: *"La lista ya se cerró"*.
- Cada alumno solo puede registrarse una vez por clase.

### "¿Y si un alumno está en clases de varios profesores?"

Cada alumno tiene **una sola cuenta** para todas sus clases.

- Para unirse a otra clase, el alumno lo pide **desde su celular, con la sesión que ya tiene abierta**. El servidor comprueba esa sesión: nadie puede "colgarse" de la cuenta de otro.
- No se juntan cuentas solo porque coincida el número de control: ese número lo escribe una persona y no prueba quién es.
- El profesor de la clase nueva aprueba la solicitud como siempre. La solicitud dice "Ya tiene cuenta en otra clase" y muestra el nombre con el que el alumno está registrado ahí, sin decir qué clase es ni de qué profesor. Así se nota si alguien intenta unirse con el celular de otra persona.
- Cada profesor sigue viendo **solo sus propias clases**.

### Privacidad: quién puede ver qué

- **Cada alumno solo puede ver su propia asistencia.** La base de datos se lo impide aunque intente pedir la de otros.
- **Cada profesor solo puede ver y modificar sus propios grupos.**
- Las **selfies** están en un almacenamiento privado. Solo el profesor del grupo las puede abrir, y con un enlace que caduca en una hora.
- Cuando el profesor corrige una asistencia a mano, la base de datos anota **quién** hizo el cambio y **cuándo**.
- Los alumnos no se registran solos: solo pueden activar una cuenta que el profesor ya dio de alta.
- Los códigos de activación sirven **una sola vez**. En la base de datos no se guarda el código, solo una "huella" de él: con la huella se puede comprobar un código, pero no recuperarlo. Ni viendo la base de datos se pueden leer.
- La "llave maestra" del servidor nunca está en la aplicación que se descarga. Solo existe dentro del servidor.

### Lo que el sistema NO puede evitar

Conviene saberlo para no confiar de más:

- Si un alumno **le presta su celular** a un compañero que sí está en el salón, el compañero puede registrarlo. La **selfie** es la medida para este caso.
- Si alguien sigue el QR **en vivo** por videollamada, el QR le llega a tiempo. Lo detectan la **ubicación** y la **selfie**, si están activadas.
- La ubicación del celular se puede falsificar con apps especiales. Por eso es una señal para que el profesor revise, no una prueba definitiva.

### ¿Cómo sabemos que funciona?

El proyecto incluye pruebas automáticas que intentan hacer trampa contra el servidor real y comprueban que se rechace (ver [Pruebas](#pruebas)). Entre ellas:

- un QR de hace más de 20 segundos se rechaza;
- el mismo celular no puede registrar a un segundo alumno;
- un alumno no puede registrarse dos veces;
- un registro después del cierre se rechaza;
- un alumno no puede pedir el QR ni leer la clave secreta;
- un alumno no puede leer las asistencias de otros.

---

## Instalación

*Para quien instale o mantenga el sistema.*

### Requisitos

- [Node.js](https://nodejs.org) 22 o más reciente (probado con Node 24).
- Una cuenta de [Supabase](https://supabase.com) (base de datos, cuentas, almacenamiento y funciones).
- Una cuenta de [Netlify](https://www.netlify.com) (publicación con HTTPS, obligatorio para usar la cámara).

Las herramientas de línea de comandos de Supabase y Netlify se usan con `npx`; no hace falta instalarlas aparte.

### 1. Descargar e instalar dependencias

```bash
git clone <url-del-repositorio>
cd ASISTENCIA-S5A
npm install
```

### 2. Crear el proyecto de Supabase y el archivo `.env`

1. Crea un proyecto nuevo en Supabase.
2. Copia `.env.example` como `.env` y llénalo con los datos de **Project Settings → API Keys**:

   ```env
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<llave publishable o anon>
   VITE_URL_PUBLICA=https://asistencia-s5a.netlify.app
   ```

> ⚠️ La llave **secreta** (`sb_secret_…` o `service_role`) **nunca** va en `.env` ni en ninguna variable `VITE_*`: todo lo que empieza con `VITE_` termina en el navegador. Esa llave solo la usan las Edge Functions, que la reciben automáticamente de Supabase.

### 3. Subir la base de datos

```bash
npx supabase login
npx supabase link --project-ref <ref>
npm run db:push
```

Esto aplica todas las migraciones de `supabase/migrations/` en orden: tablas, reglas de seguridad, funciones, cierre automático y Realtime. Las extensiones necesarias (`pgcrypto`, `pg_cron` y `pg_net`) las activan las propias migraciones.

### 4. Configurar las cuentas (Authentication)

En el panel de Supabase:

1. **Sign In / Providers:** desactiva **Allow new users to sign up**. Nadie debe poder crearse una cuenta por su cuenta: las de los alumnos las crea el sistema al activarlos.
2. **Users → Add user:** crea el usuario del profesor con su correo y contraseña, marcando **Auto Confirm User**. Su perfil de profesor se crea solo.
3. **URL Configuration:**
   - **Site URL:** `https://asistencia-s5a.netlify.app`
   - **Redirect URLs:** `https://asistencia-s5a.netlify.app/**` y `http://localhost:5173/**`. Las usa "¿Olvidaste tu contraseña?".
4. **Correo:** el servicio de correo incluido en Supabase tiene un límite bajo de envíos por hora y puede no entregar a direcciones fuera de tu organización. Si el correo para recuperar la contraseña no llega, configura un SMTP propio en **Authentication → Emails → SMTP Settings**.

**Datos de prueba (opcional):** `npm run db:push:seed` crea un grupo "PRUEBA" con 10 alumnos ficticios para el primer profesor registrado.

### 5. Publicar las Edge Functions

```bash
npm run fn:deploy
```

Publica `activar-alumno`, `activar-por-qr` y `limpiar-selfies`. Antes de publicar, el comando revisa que cada llamada a la base de datos use los nombres de parámetros correctos.

### 6. Activar el borrado automático de selfies

Una tarea programada borra cada madrugada las selfies con más de 30 días. Necesita dos secretos guardados en el **Vault** de Supabase. Se crean una sola vez desde el **SQL Editor**:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'url_proyecto');
select vault.create_secret('<llave sb_secret_...>', 'llave_secreta_limpieza');
```

La llave secreta está en **Project Settings → API Keys**. Mientras no existan estos secretos, la tarea no hace nada.

### 7. Publicar la aplicación en Netlify

```bash
npx netlify-cli login
npx netlify-cli link        # o "npx netlify-cli sites:create" la primera vez
npm run deploy
```

`npm run deploy` compila la app **en tu computadora, con tu `.env`**, y sube la carpeta `dist`. Al final debe decir `Deploy is live!`. La configuración de Netlify (rutas, encabezados de seguridad y caché) está en `netlify.toml`.

En el panel de Netlify, apaga el letrero **"Powered by Netlify"** en **Project configuration → General → Powered by Netlify badge**. Si no, tapa contenido en el celular.

### Desarrollo local

```bash
npm run dev          # http://localhost:5173 en la computadora
npm run dev:movil    # para probar la cámara desde un celular en la misma red
```

Los navegadores solo dejan usar la cámara con HTTPS. `dev:movil` usa un certificado propio, así que el celular muestra una advertencia la primera vez y hay que aceptarla.

---

## Pruebas

| Comando | Qué prueba | Contra qué |
|---|---|---|
| `npm run prueba:fase5` | Las reglas anti-trampa del pase de lista: QR vencido, celular ajeno, doble registro, retardo, cierre, permisos | Supabase real (tarda ~2.5 min) |
| `npm run prueba:fase6` | Activación por QR, aprobación del profesor, cambio de celular, unirse a otra clase con la misma cuenta | Supabase real |
| `npm run prueba:fase7` | Selfie y ubicación, permisos del almacenamiento de fotos | Supabase real |
| `npm run prueba:fase8` | Cálculo de porcentajes y el archivo de Excel | Sin conexión |
| `npm run revisar:llamadas` | Que cada llamada a la base de datos use los parámetros correctos | Sin conexión |

Las pruebas contra Supabase piden el correo y la contraseña del profesor; no se muestran ni se guardan. Crean un grupo temporal `PRUEBA-AUTO-…` y lo **borran al terminar**, aunque alguna prueba falle.

Quedan como rastro los usuarios de prueba (`…@alumnos.invalid`), que no tienen acceso a nada. Se pueden borrar en **Authentication → Users**.

---

## Estructura del proyecto

```
src/
  pages/profesor/     pantallas del profesor (inicio, grupo, pase de lista, estadísticas…)
  pages/alumno/       activar cuenta, escanear y "Mi asistencia"
  components/         piezas reutilizables (QR grande, cámaras, gráfica…)
  hooks/              lógica compartida (QR rotativo, ubicación, reloj…)
  lib/                cliente de Supabase, cálculos, Excel, PDF, fechas
supabase/
  migrations/         la base de datos completa, en orden (tablas, seguridad, funciones)
  functions/          Edge Functions: activar alumnos y limpiar selfies
  seed.sql            datos de prueba
scripts/              pruebas automáticas y utilidades
netlify.toml          rutas, encabezados de seguridad y caché
```

**Tecnologías:**

- Interfaz: React, Vite y Tailwind CSS.
- Servidor: Supabase (PostgreSQL, Auth, Realtime, Storage y Edge Functions).
- Librerías: `qr-scanner` (leer QR), `qrcode` (generar QR), `recharts` (gráficas), `exceljs` (Excel) y `jspdf` (tarjetas PDF).

La app se puede instalar en el celular como aplicación (PWA). Todas las fechas se muestran en hora de Hermosillo.

---

## Situaciones comunes

**Un alumno se inscribió a otra de tus materias (o a la de otro profesor).**
En su celular: "Mi asistencia" → **Unirme a otra clase**, y escanea el QR de "Activar alumnos" de esa clase. También funciona si escanea ese QR desde la pantalla de Escanear. Apruebas la solicitud como cualquier otra.

**Un alumno cambió de celular o borró los datos del navegador.**
Que vuelva a activar su cuenta con el QR de "Activar alumnos". Su solicitud llega marcada como cambio de celular; apruébala después de confirmar el número de verificación. Si está en clases de varios profesores, en las demás tendrá que pedir el cambio de celular también, y cada profesor lo aprueba en su clase.

**Un alumno dice que su QR "expiró".**
La app vuelve a intentar sola una vez. Si sigue fallando, casi siempre es la red del celular. Que escanee de nuevo; si no se puede, márcalo a mano en el detalle de la sesión.

**Un registro quedó marcado como sospechoso.**
En el detalle de la sesión se ve el motivo (distancia, sin ubicación) y la selfie si la hay. Puedes dejarlo, cambiarlo o marcarlo como revisado.

**El profesor olvidó su contraseña.**
En la pantalla de entrada: "¿Olvidaste tu contraseña?". Llega un enlace al correo que sirve una sola vez y dura una hora.

**Después de publicar, no se ve el cambio.**
La app se actualiza sola a los pocos segundos de abrirla. Si no, revisa que `npm run deploy` haya terminado con `Deploy is live!`.
