// Genera los íconos PNG de la PWA a partir de public/favicon.svg.
// Solo hace falta correrlo (`npm run iconos`) si se cambia el diseño del ícono;
// los PNG resultantes se guardan en el repo.
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

const svg = await readFile('public/favicon.svg')
const FONDO = '#4f46e5'

// Íconos normales: el SVG tal cual (ya trae sus esquinas redondeadas).
await sharp(svg).resize(192, 192).png().toFile('public/pwa-192.png')
await sharp(svg).resize(512, 512).png().toFile('public/pwa-512.png')

// Ícono "maskable": Android lo recorta con la forma que quiera (círculo,
// gota, etc.), así que el dibujo debe quedar dentro del 80% central y el
// fondo debe llenar todo el cuadro, sin esquinas transparentes.
const interior = await sharp(svg).resize(410, 410).png().toBuffer()
await sharp({ create: { width: 512, height: 512, channels: 4, background: FONDO } })
  .composite([{ input: interior, gravity: 'center' }])
  .png()
  .toFile('public/pwa-maskable-512.png')

// iOS no usa el manifest; toma este ícono de 180 px y le pone sus propias
// esquinas redondeadas, por eso también va con fondo completo.
const interiorIos = await sharp(svg).resize(160, 160).png().toBuffer()
await sharp({ create: { width: 180, height: 180, channels: 4, background: FONDO } })
  .composite([{ input: interiorIos, gravity: 'center' }])
  .png()
  .toFile('public/apple-touch-icon.png')

console.log('Íconos generados en public/')
