// Utilidades para pedir datos en la terminal (scripts de prueba).
import readline from 'node:readline/promises'

export async function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const respuesta = await rl.question(texto)
  rl.close()
  return respuesta.trim()
}

// Pide una contraseña sin mostrarla. Pone la terminal en modo "raw": cada
// tecla llega aquí directamente y la terminal no la imprime; solo se
// muestra un * por carácter.
export function preguntarOculto(texto) {
  const entrada = process.stdin
  // Sin terminal (por ejemplo, con la entrada redirigida) no hay nada que ocultar.
  if (!entrada.isTTY) return preguntar(texto)

  return new Promise((resolve) => {
    let valor = ''
    process.stdout.write(texto)
    entrada.setRawMode(true)
    entrada.setEncoding('utf8')
    entrada.resume()

    function terminar() {
      entrada.setRawMode(false)
      entrada.pause()
      entrada.removeListener('data', alTeclear)
      process.stdout.write('\n')
    }

    function alTeclear(teclas) {
      // Al pegar, llegan varias teclas juntas.
      for (const tecla of teclas) {
        if (tecla === '\r' || tecla === '\n') {
          terminar()
          resolve(valor.trim())
          return
        }
        if (tecla === '\u0003') {
          // Ctrl+C: en modo raw no cierra el programa solo.
          terminar()
          process.exit(130)
        }
        if (tecla === '\u007f' || tecla === '\b') {
          if (valor.length > 0) {
            valor = valor.slice(0, -1)
            process.stdout.write('\b \b')
          }
          continue
        }
        if (tecla < ' ') continue // ignora otras teclas de control
        valor += tecla
        process.stdout.write('*')
      }
    }

    entrada.on('data', alTeclear)
  })
}
