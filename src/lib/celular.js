// "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ... Safari/604.1"
//   → "iPhone · Safari"
// Solo es una ayuda para que el profesor reconozca el celular en las
// solicitudes; el navegador puede decir lo que quiera aquí, así que no se
// usa para ninguna decisión de seguridad.
export function describirCelular(userAgent = '') {
  const ua = userAgent ?? ''
  const sistema = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : 'Otro'
  const navegador = /EdgA?\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ''
  return navegador ? `${sistema} · ${navegador}` : sistema
}
