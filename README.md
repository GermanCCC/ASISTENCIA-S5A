# Asistencia S5A — versión local

Aplicación de escritorio para **Windows de 64 bits**, con asistencia mediante **QR rotativo** y acceso desde **Android y iPhone** en el mismo router.

**Funciona sin internet durante las clases.** La computadora guarda la base de datos y las fotografías; los teléfonos se conectan a ella por wifi. Esta versión no necesita Netlify ni Supabase en la nube.

## Uso e instalación

Consulta [USAR-EN-WINDOWS.md](USAR-EN-WINDOWS.md) para instalar, conectar los teléfonos, preparar el certificado y hacer respaldos.

- La computadora debe permanecer encendida y con Asistencia Local abierta.
- Los teléfonos y la computadora deben estar conectados al mismo router, que puede no tener internet.
- En Windows, abre **Teléfonos** para ver el enlace y el QR de primera conexión.
- Instala el certificado del salón una vez en cada teléfono para permitir la cámara.
- Usa el enlace local del salón; el acceso anterior de Netlify corresponde a otra instalación.

## Ejecutar desde el código

Necesitas Windows de 64 bits y Node.js 22.12 o posterior. La preparación inicial y la descarga de herramientas requieren internet; el uso posterior del instalador es local.

```powershell
git clone https://github.com/GermanCCC/ASISTENCIA-S5A.git
cd ASISTENCIA-S5A
npm install
npm run local
```

Para generar el instalador:

```powershell
npm run dist:windows
```

El archivo se genera en la carpeta `release`. Descargar el ZIP de este repositorio descarga el código fuente; no instala la aplicación.

## Funciones

- Activación de alumnos por QR con aprobación del profesor.
- QR de asistencia que cambia cada cinco segundos.
- Vinculación del teléfono, rechazo de duplicados y aprobación de cambios de dispositivo.
- Presencias, retardos, faltas y correcciones del profesor.
- Grupos, alumnos, estadísticas y exportación a Excel.
- Selfie y ubicación opcionales.
- Respaldos locales e importación del historial.

## Pruebas

```powershell
npm run prueba:local
npm run prueba:fase8
npm run revisar:llamadas
```

## Organización

- `desktop/`: ventana de Windows, servidor local, cuentas, certificados y almacenamiento.
- `src/`: interfaz del profesor y de los alumnos.
- `supabase/migrations/`: reglas SQL reutilizadas por PostgreSQL local. El nombre de la carpeta no implica una conexión a la nube.
- `public/`: iconos de la aplicación.
- `scripts/`: utilidades y pruebas.

Los datos reales se guardan fuera del repositorio, en `%APPDATA%\AsistenciaLocal`. Este repositorio no incluye cuentas, contraseñas, bases de datos, fotografías ni certificados privados del salón.

## Versión web anterior

Se conservan archivos de compatibilidad y herramientas para migrar los datos de la versión web. Sus instrucciones están en [README-WEB-ORIGINAL.md](README-WEB-ORIGINAL.md).

Basado en el [proyecto web original ASISTENCIA-S5A](https://github.com/alexislugoo/ASISTENCIA-S5A).
