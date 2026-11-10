import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { criaDemo } from './demo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)
/** Sem .env o app roda em modo demonstração, com dados de mentira na memória. */
export const demo = !configurado
export const supabase: SupabaseClient = configurado ? createClient(url!, key!) : (criaDemo() as unknown as SupabaseClient)
