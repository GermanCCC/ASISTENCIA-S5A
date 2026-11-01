# Asistencia local para Windows y teléfonos

La computadora es el servidor del salón. Guarda la base de datos y las fotos en Windows. Los teléfonos se conectan a ella por wifi; el router no necesita internet. No se necesitan cuentas de Netlify o Supabase para el funcionamiento local, ni publicar aplicaciones en tiendas.

## Primera vez en Windows

1. Ejecuta el instalador `Asistencia-Local-0.1.0-Windows.exe` de la carpeta `release`.
2. Abre **Asistencia Local** desde el escritorio.
3. Crea tu cuenta de profesor. El correo sólo identifica tu cuenta: no se envían correos.
4. Guarda el código de recuperación en una memoria USB o en otro lugar privado. Sirve para recuperar la contraseña sin internet.
5. Antes de crear grupos, puedes importar tu historial desde **Teléfonos → Importar datos**. La importación requiere una instalación sin grupos para evitar mezclar registros.
6. Conecta la computadora al router del salón, por cable o wifi. En Windows, marca la red del salón como **privada**. Si Windows pregunta si permites la comunicación de Asistencia, permite las redes privadas.
7. Entra a **Teléfonos** y muestra el QR de primera conexión.

Windows puede mostrar una advertencia de editor desconocido: el instalador no lleva un certificado comercial de firma de aplicaciones. Esto es independiente del certificado local que usan los teléfonos.

## Primera vez en cada teléfono

1. Conéctalo al mismo wifi que la computadora. Si indica «sin internet», conserva esa conexión.
2. Escanea el QR de **Teléfonos** con la cámara normal del teléfono. Si el teléfono intenta usar datos móviles para esta red, desactiva ese cambio automático mientras usas Asistencia.
3. La página explica cómo descargar e instalar el certificado del salón. Comprueba su huella con la que muestra el profesor en Windows. Se instala una sola vez por teléfono.
4. **iPhone:** abre la página en Safari. Instala el perfil en Ajustes → General → VPN y gestión de dispositivos. Después activa su confianza en Ajustes → General → Información → Ajustes de confianza de certificados.
5. **Android:** instala el archivo como **certificado de CA** desde los ajustes de Seguridad / Cifrado y credenciales. Puedes buscar «certificado de CA» en Ajustes. Los nombres dependen del fabricante.
6. Toca **Abrir Asistencia**. La dirección comienza con `https://`. Si aparece un error de certificado, comprueba que instalaste el de este salón y que su confianza esté activada.
7. Agrega el icono a la pantalla de inicio: en Safari, Compartir → Añadir a pantalla de inicio; en Chrome, menú → Añadir a pantalla de inicio o Instalar aplicación.
8. Abre el icono, permite la cámara y escanea el QR de activación del grupo. El profesor aprueba la solicitud como antes.

El certificado del salón permite validar la conexión local que necesita la cámara. No contiene la llave privada del servidor. Un teléfono administrado por una escuela o empresa puede impedir instalar certificados; en ese caso se necesita la ayuda de su administrador.

## Cada clase

1. Enciende el router y la computadora. Mantén abierta Asistencia Local y la computadora conectada a la corriente. No cierres la tapa ni suspendas Windows.
2. Los alumnos se conectan al wifi y abren el icono de Asistencia.
3. Abre la lista y muestra el QR. Se conserva la rotación cada cinco segundos, la firma del servidor, la vinculación del teléfono, el rechazo de duplicados, los retardos y las faltas automáticas.
4. Si usas selfies, quedan guardadas en la computadora y se eliminan después de 30 días. Si usas ubicación, el GPS puede tardar más sin internet; una ubicación ausente se marca para revisión como en el sistema anterior.
5. Al terminar, descarga un respaldo desde **Teléfonos** y guárdalo también fuera de esta computadora.

## El teléfono dice «El profesor ya cerró la activación»

Comprueba primero qué aplicación abriste. El acceso anterior de Netlify consulta la base de datos en la nube y no puede ver el QR generado por Windows. Conecta el teléfono al router del salón, abre **Teléfonos** en Windows y escanea su QR de primera conexión con la cámara normal. Instala el certificado y abre el enlace local `https://…:8787`. Después abre **Activar alumnos** en Windows y escanea ese segundo QR desde la aplicación local del teléfono. Si ya usas la dirección local y se terminaron los diez minutos, toca **Abrir activación** o **Reiniciar 10 min** en Windows.

## Conservar la dirección de los teléfonos

Reserva una dirección para la computadora en la configuración DHCP del router. Si cambia la dirección, los iconos y los datos de identificación del navegador quedan asociados a la dirección anterior. Lo mejor es recuperar la dirección original; si no se puede, hay que compartir el enlace nuevo y reactivar los teléfonos. Reinicia Asistencia después de cambiar la red para que incluya la nueva dirección en su certificado.

Si la computadora tiene varias conexiones, elige en **Teléfonos** la dirección de la red del salón. El router debe permitir comunicación entre sus dispositivos: evita una red de invitados con aislamiento de clientes.

## Datos y recuperación

Los datos están en `%APPDATA%\AsistenciaLocal`. La actualización o desinstalación de la aplicación no los borra. No compartas esa carpeta: contiene datos de alumnos y llaves privadas. Para una copia completa de la instalación, cierra la aplicación antes de copiarla.

Los respaldos descargados incluyen grupos, alumnos, sesiones, asistencias y fotos. Al importar en una instalación sin grupos, esos registros pertenecen al profesor local y los alumnos deben activar de nuevo sus teléfonos. No se importan contraseñas ni sesiones antiguas. Las listas que estaban abiertas pasan a cerradas.

Para cambiar una contraseña olvidada, abre **¿Olvidaste tu contraseña?** desde la aplicación de Windows y usa tu código de recuperación. Al cambiarla se genera un código nuevo; guarda el reemplazo. El sistema local no envía correos de recuperación.

## Migrar el historial de Supabase

Se incluye una herramienta de sólo lectura para exportar los datos visibles para tu cuenta de profesor. Requiere internet únicamente durante la exportación:

```powershell
npm run exportar:supabase
```

Pide la URL de Supabase, la llave **pública** (anon o publishable), el correo y la contraseña del profesor. La contraseña no se muestra ni se guarda. Si tienes un `.env`, puedes ejecutar `node --env-file=.env desktop/export-cloud.mjs` para tomar la URL y la llave pública de ese archivo.

La herramienta crea un archivo `*.local-backup.json`. Impórtalo desde la aplicación de Windows antes de crear grupos. Conserva alumnos e historial; las fotos de Supabase no se descargan con esta herramienta y los teléfonos deben activarse de nuevo. No borres el proyecto de Supabase hasta revisar el resultado.

## Desarrollo y verificación

Requiere Windows de 64 bits y Node.js 22.12 o posterior. Para preparar el instalador se necesita internet para descargar las herramientas; el instalador incluye los componentes necesarios y luego funciona sin internet.

```powershell
npm install
npm run local
npm run prueba:local
node desktop/tests/ui-smoke.mjs
npm run dist:windows
```

El servidor de aplicación usa `127.0.0.1:8785` para la ventana de Windows, el puerto `8786` para las instrucciones y el certificado del teléfono, y HTTPS en el puerto `8787` para los teléfonos. PostgreSQL usa un puerto disponible que sólo escucha en `127.0.0.1`. El cierre automático se ejecuta cada cinco segundos y al iniciar; las comprobaciones del QR siempre revisan la hora exacta.

Las reglas SQL existentes se reutilizan en PostgreSQL incluido en el instalador. Sólo se sustituyen los programadores de tareas de Supabase por tareas locales. El cliente local usa sesiones verificadas por el servidor y las consultas conservan las políticas RLS. Las actualizaciones de asistencia se consultan cada dos segundos dentro de la red del salón.

Las pruebas automatizadas cubren activación y aprobación por QR, duplicados, permisos, consultas de historial, fotos privadas, certificado HTTPS, respaldo, importación y persistencia tras reiniciar. La cámara y la instalación del certificado deben comprobarse en un Android y un iPhone reales antes de usarlo con el grupo completo.
