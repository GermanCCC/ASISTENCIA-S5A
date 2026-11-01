import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase.js'
import { mensajeDeError } from './errores.js'

// Llama a una Edge Function y siempre devuelve un objeto con `codigo`:
//   - éxito: lo que respondió la función (codigo: 'ok', ...)
//   - error de la función (400): su { codigo, mensaje } para el alumno
//   - sin conexión u otro problema: { codigo: 'error', mensaje }
export async function llamarFuncion(nombre, cuerpo) {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo })
  if (!error) return data

  if (error instanceof FunctionsHttpError) {
    const respuesta = await error.context.json().catch(() => null)
    if (respuesta?.mensaje) return respuesta
  }
  return { codigo: 'error', mensaje: mensajeDeError(error) }
}
