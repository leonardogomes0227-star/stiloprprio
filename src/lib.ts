import { useCallback, useEffect, useRef, useState } from 'react'

// ---------- dinheiro e datas ----------
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const reais = (n: number | null | undefined) => brl.format(Number(n ?? 0))

/** "89,90", "1.234,50" e "89.90" viram número; vazio/ruim vira NaN. */
export function lerValor(s: string): number {
  const t = s.replace(/[^\d.,]/g, '')
  const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return n === '' ? NaN : Math.round(Number(n) * 100) / 100
}
export const valorParaCampo = (n: number) => n.toFixed(2).replace('.', ',')

const pad = (n: number) => String(n).padStart(2, '0')
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hoje = () => isoLocal(new Date())
export const diaData = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const diasAtras = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
export const inicioDoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }
export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// ---------- WhatsApp ----------
export function linkWhats(telefone: string, texto?: string): string {
  let d = telefone.replace(/\D/g, '')
  if (d.length <= 11) d = '55' + d
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

// ---------- erros do banco em português ----------
export function msgErro(e: unknown): string {
  const x = e as { message?: string; code?: string } | null
  const m = x?.message ?? ''
  if (x?.code === '23505') return m.includes('codigo') ? 'Já existe uma peça com esse código.' : 'Esse registro já existe.'
  if (x?.code === '23503') return 'Não dá para apagar: isso já está sendo usado em outra parte.'
  if (x?.code === '23514') return 'Algum valor não é permitido. Confira os campos.'
  if (x?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Você não tem permissão para fazer isso.'
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sem conexão com a internet. Tente de novo.'
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.'
  return m || 'Algo deu errado. Tente de novo.'
}

/** Resolve a consulta do Supabase ou lança o erro. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

// ---------- hook de carregamento ----------
export function useCarrega<T>(fn: () => Promise<T>, onErro: (e: unknown) => void, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [falhou, setFalhou] = useState(false)
  const ref = useRef({ fn, onErro }); ref.current = { fn, onErro }
  const recarrega = useCallback(async () => {
    try { setDados(await ref.current.fn()); setFalhou(false) }
    catch (e) { setFalhou(true); ref.current.onErro(e) }
    finally { setCarregando(false) }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setCarregando(true); recarrega() }, [recarrega, ...deps])
  return { dados, carregando, falhou, recarrega }
}

export function useDebounce<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor)
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t) }, [valor, ms])
  return v
}

// ---------- foto: reduz para 900px, JPEG 0.8 ----------
export async function reduzirFoto(file: File): Promise<Blob> {
  const img = await createImageBitmap(file)
  const f = Math.min(1, 900 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * f); c.height = Math.round(img.height * f)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  img.close()
  return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('Não consegui preparar a foto.'))), 'image/jpeg', 0.8))
}

export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
