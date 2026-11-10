import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && key)
// Se faltar o .env o app mostra um aviso de configuração em vez de quebrar.
export const supabase = createClient(url || 'http://localhost', key || 'sem-chave')
