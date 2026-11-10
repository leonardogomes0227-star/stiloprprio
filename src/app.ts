import { createContext, useContext } from 'react'
import type { Profile } from './types'

export interface Ctx {
  me: Profile
  equipe: Record<string, Profile>
  aviso: (texto: string, tipo?: 'erro' | 'ok') => void
  /** Roda uma ação mostrando erro em português; devolve true se deu certo. */
  tenta: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>
  erro: (e: unknown) => void
  abreSacola: (id: string) => void
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(AppCtx)
export const nomeDe = (equipe: Record<string, Profile>, id: string | null) => (id && equipe[id]?.nome) || 'alguém'
