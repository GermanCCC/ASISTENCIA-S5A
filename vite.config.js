import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export default defineConfig(({ mode }) => ({
  // En public hay herramientas ajenas a la aplicación (p. ej. un JDK).
  // Sólo estos recursos se distribuyen a los alumnos o en el instalador.
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'recursos-publicos',
      generateBundle() {
        for (const name of ['favicon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png']) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(path.join('public', name)) })
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const name = req.url?.slice(1)
          if (['favicon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'].includes(name)) {
            res.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : 'image/png')
            return res.end(readFileSync(path.join('public', name)))
          }
          next()
        })
      },
    },

    // Los navegadores solo permiten usar la cámara en HTTPS (o en localhost).
    // Para probar el escaneo desde el celular por la red local corremos
    // `npm run dev:movil`, que activa este certificado autofirmado.
    // En modo normal no se usa para no tener advertencias de certificado en la PC.
    mode === 'movil' && basicSsl(),

    VitePWA({
      // El service worker se actualiza solo cuando hay una versión nueva,
      // así los alumnos siempre tienen la última versión sin hacer nada.
      registerType: 'autoUpdate',
      // Se registra en src/main.jsx (con recarga automática), no con el
      // script que el plugin agregaría por su cuenta.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pase de Lista',
        short_name: 'Asistencia',
        description: 'Pase de lista con QR para el salón de clases',
        lang: 'es-MX',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Solo se guardan en caché los archivos de la app (JS, CSS, íconos).
      // Las llamadas a Supabase van a otro dominio y el service worker no las
      // toca, así la asistencia siempre se consulta en vivo contra el servidor.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        // exceljs (~900 KB) y jspdf con sus complementos solo los usa el
        // profesor al importar/exportar o al hacer tarjetas. Sin esto, cada
        // alumno los descargaría al instalar la app.
        globIgnores: [
          '**/node_modules/**/*',
          '**/exceljs*.js',
          '**/jspdf*.js',
          '**/html2canvas*.js', // complemento de jspdf
          '**/purify*.js', // complemento de jspdf (dompurify)
          '**/index.es*.js', // complemento de jspdf (canvg)
          '**/GraficaAsistencia*.js', // recharts: solo la pestaña Estadísticas del profesor
        ],
      },
    }),
  ],
}))
