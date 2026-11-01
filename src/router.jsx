import { createBrowserRouter } from 'react-router'
import Layout from './components/Layout.jsx'
import RutaProfesor from './components/RutaProfesor.jsx'
import Bienvenida from './pages/Bienvenida.jsx'
import NoEncontrada from './pages/NoEncontrada.jsx'
import Login from './pages/profesor/Login.jsx'
import OlvideContrasena from './pages/profesor/OlvideContrasena.jsx'
import RestablecerContrasena from './pages/profesor/RestablecerContrasena.jsx'
import InicioProfesor from './pages/profesor/Inicio.jsx'
import NuevoGrupo from './pages/profesor/NuevoGrupo.jsx'
import GrupoLayout from './pages/profesor/grupo/GrupoLayout.jsx'
import Alumnos from './pages/profesor/grupo/Alumnos.jsx'
import Importar from './pages/profesor/grupo/Importar.jsx'
import Configuracion from './pages/profesor/grupo/Configuracion.jsx'
import Tarjetas from './pages/profesor/grupo/Tarjetas.jsx'
import PaseDeLista from './pages/profesor/grupo/PaseDeLista.jsx'
import ActivarAlumnos from './pages/profesor/grupo/ActivarAlumnos.jsx'
import Sesiones from './pages/profesor/grupo/Sesiones.jsx'
import SesionDetalle from './pages/profesor/grupo/SesionDetalle.jsx'
import Estadisticas from './pages/profesor/grupo/Estadisticas.jsx'
import HistorialAlumno from './pages/profesor/grupo/HistorialAlumno.jsx'
import Activar from './pages/alumno/Activar.jsx'
import Escanear from './pages/alumno/Escanear.jsx'
import MiAsistencia from './pages/alumno/MiAsistencia.jsx'
import ConfiguracionLocal, { RecuperacionLocal } from './pages/profesor/ConfiguracionLocal.jsx'
import { modoLocal } from './lib/supabase.js'

// Mapa de todas las pantallas de la app.
// Las rutas del profesor van bajo /profesor y están protegidas por
// RutaProfesor; las del alumno quedan cortas (/activar, /escanear) porque
// el alumno llega a ellas desde un QR o un enlace.
export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Bienvenida /> },

      // Profesor
      { path: '/login', element: <Login /> },
      { path: '/olvide-contrasena', element: modoLocal ? <RecuperacionLocal /> : <OlvideContrasena /> },
      { path: '/restablecer-contrasena', element: <RestablecerContrasena /> },
      {
        path: '/profesor',
        element: <RutaProfesor />,
        children: [
          { index: true, element: <InicioProfesor /> },
          { path: 'conexion', element: <ConfiguracionLocal /> },
          { path: 'grupos/nuevo', element: <NuevoGrupo /> },
          {
            // GrupoLayout carga el grupo una vez y lo comparte con sus pestañas.
            path: 'grupos/:grupoId',
            element: <GrupoLayout />,
            children: [
              { index: true, element: <Alumnos /> },
              { path: 'lista', element: <PaseDeLista /> },
              { path: 'activar', element: <ActivarAlumnos /> },
              { path: 'sesiones', element: <Sesiones /> },
              { path: 'sesiones/:sesionId', element: <SesionDetalle /> },
              { path: 'estadisticas', element: <Estadisticas /> },
              { path: 'estadisticas/:alumnoId', element: <HistorialAlumno /> },
              { path: 'importar', element: <Importar /> },
              { path: 'tarjetas', element: <Tarjetas /> },
              { path: 'configuracion', element: <Configuracion /> },
            ],
          },
        ],
      },

      // Alumno
      { path: '/activar', element: <Activar /> },
      { path: '/escanear', element: <Escanear /> },
      { path: '/mi-asistencia', element: <MiAsistencia /> },

      { path: '*', element: <NoEncontrada /> },
    ],
  },
])
