import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { criaDemo } from './demo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)
/** Sem as chaves do Supabase o app abre em MODO TESTE (dados só neste aparelho). Com as chaves, usa o Supabase de verdade. */
export const modoTeste = !configurado
const falso = modoTeste ? criaDemo() : null
export const supabase: SupabaseClient = falso ? (falso as unknown as SupabaseClient) : createClient(url!, key!)
export const entrarTeste = (modo: 'exemplo' | 'vazio' | 'continuar') => falso!.entrarTeste(modo)
export const temDadosTeste = () => falso?.temDados() ?? false
