import { app, BrowserWindow, dialog, Menu, powerSaveBlocker, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendFileSync, mkdirSync } from 'node:fs'
import { startLocalServer } from './server.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let runtime, startup, window, closing = false, blocker
if (!app.isPackaged && process.env.ASISTENCIA_DATA_DIR) {
  const browserData = path.join(path.resolve(process.env.ASISTENCIA_DATA_DIR), 'browser')
  mkdirSync(browserData, { recursive: true })
  app.setPath('userData', browserData)
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    app.setName('Asistencia Local')
    const dataDir = !app.isPackaged && process.env.ASISTENCIA_DATA_DIR ? path.resolve(process.env.ASISTENCIA_DATA_DIR) : path.join(app.getPath('appData'), 'AsistenciaLocal')
    mkdirSync(dataDir, { recursive: true })
    const log = value => appendFileSync(path.join(dataDir, 'asistencia.log'), `${new Date().toISOString()} ${String(value).replace(/\r?\n/g, ' ')}\n`)
    try {
      window = new BrowserWindow({ width: 1180, height: 820, minWidth: 760, minHeight: 600, title: 'Asistencia Local', icon: path.join(rootDir, 'dist', 'pwa-512.png'), backgroundColor: '#f8fafc', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="es"><meta charset="utf-8"><style>body{font:20px system-ui;background:#f8fafc;color:#172033;display:grid;place-items:center;height:90vh}main{max-width:480px;padding:30px}p{font-size:17px;line-height:1.7;color:#475569}</style><main><h1>Asistencia Local</h1><p>Preparando los datos y la conexión del salón…</p><p>La primera apertura puede tardar un momento. Después podrás trabajar sin internet.</p></main></html>'))
      const testPorts = !app.isPackaged && process.env.ASISTENCIA_TEST_PORTS ? JSON.parse(process.env.ASISTENCIA_TEST_PORTS) : {}
      startup = startLocalServer({ dataDir, rootDir, log, ...testPorts })
      runtime = await startup
      if (closing) return
      blocker = powerSaveBlocker.start('prevent-app-suspension')
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
        callback(contents.getURL().startsWith(runtime.url + '/') && ['media', 'geolocation', 'fullscreen', 'pointerLock'].includes(permission))
      })
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'Asistencia', submenu: [
          { label: 'Conectar teléfonos', click: () => window?.loadURL(runtime.url + '/profesor/conexion') },
          { label: 'Abrir carpeta de datos', click: async () => { const { shell } = await import('electron'); await shell.openPath(dataDir) } },
          { type: 'separator' }, { role: 'quit', label: 'Salir' },
        ] },
        { label: 'Editar', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' }] },
        { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'resetZoom', label: 'Tamaño normal' }, { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }] },
      ]))
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== runtime.url) event.preventDefault() })
      await window.loadURL(runtime.url)
    } catch (error) {
      log(error.stack ?? error.message)
      dialog.showErrorBox('No se pudo abrir Asistencia', `${error.message}\n\nEl registro de diagnóstico está en:\n${dataDir}\\asistencia.log`)
      app.quit()
    }
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (closing || !startup) return
    event.preventDefault(); closing = true
    startup.then(server => server.stop()).catch(() => {}).finally(() => { if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker); app.quit() })
  })
}
