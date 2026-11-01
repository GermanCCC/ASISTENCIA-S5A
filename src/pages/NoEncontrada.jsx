import { Link } from 'react-router'

export default function NoEncontrada() {
  return (
    <section className="pt-10 text-center">
      <h1 className="text-2xl font-bold">Página no encontrada</h1>
      <Link to="/" className="mt-4 inline-block font-semibold text-indigo-600 dark:text-indigo-400">
        Volver al inicio
      </Link>
    </section>
  )
}
