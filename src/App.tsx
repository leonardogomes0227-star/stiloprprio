import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { AppCtx, type Ctx } from './app'
import { msgErro, q } from './lib'
import type { Profile } from './types'
import Login from './telas/Login'
import Clientes from './telas/Clientes'
import Pecas from './telas/Pecas'
import { ListaSacolas } from './telas/Sacolas'
import DetalheSacola from './telas/DetalheSacola'
import Painel from './telas/Painel'

type Aba = 'sacolas' | 'pecas' | 'clientes' | 'painel'
const ABAS: { id: Aba; nome: string; icone: string }[] = [
  { id: 'sacolas', nome: 'Sacolas', icone: 'M6 8h12l1 12H5L6 8zm3 0V6a3 3 0 016 0v2' },
  { id: 'pecas', nome: 'Peças', icone: 'M12 5a2 2 0 11 2 2c0 1-2 1.5-2 3m0 0L3 17h18l-9-7' },
  { id: 'clientes', nome: 'Clientes', icone: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 8c0-4 4-6 8-6s8 2 8 6' },
  { id: 'painel', nome: 'Painel', icone: 'M5 20V10m7 10V4m7 16v-7' },
]

export default function App() {
  return <ComSessao />
}

function ComSessao() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session)).catch(() => setSessao(null))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (sessao === undefined) return <p className="vazio" role="status">Carregando…</p>
  if (!sessao) return <Login />
  return <Logado userId={sessao.user.id} />
}

function Logado({ userId }: { userId: string }) {
  const [equipe, setEquipe] = useState<Record<string, Profile> | null>(null)
  const [falha, setFalha] = useState('')
  const [aba, setAba] = useState<Aba>('sacolas')
  const [sacolaId, setSacolaId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ texto: string; tipo: 'erro' | 'ok'; n: number } | null>(null)
  const timer = useRef<number>()

  const aviso = useCallback((texto: string, tipo: 'erro' | 'ok' = 'ok') => {
    window.clearTimeout(timer.current)
    setToast({ texto, tipo, n: Date.now() })
    timer.current = window.setTimeout(() => setToast(null), tipo === 'erro' ? 7000 : 3000)
  }, [])
  const erro = useCallback((e: unknown) => aviso(msgErro(e), 'erro'), [aviso])
  const tenta = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) aviso(ok); return true } catch (e) { erro(e); return false }
  }, [aviso, erro])

  useEffect(() => {
    q(supabase.from('profiles').select('id,nome,papel,ativo'))
      .then(l => {
        const m = Object.fromEntries((l as Profile[]).map(p => [p.id, p]))
        if (!m[userId]) setFalha('Sua conta ainda não tem perfil na loja. Peça para quem cuida do sistema.')
        else if (!m[userId].ativo) setFalha('Sua conta foi desativada. Fale com a dona da loja.')
        setEquipe(m)
      })
      .catch(e => setFalha(msgErro(e)))
  }, [userId])

  const ctx = useMemo<Ctx | null>(() => equipe && equipe[userId] ? {
    me: equipe[userId], equipe, aviso, tenta, erro,
    abreSacola: (id) => { setAba('sacolas'); setSacolaId(id) },
  } : null, [equipe, userId, aviso, tenta, erro])

  const sair = () => supabase.auth.signOut()

  if (falha) return (
    <main className="tela-login">
      <h1>Condicional</h1>
      <div className="cartao" role="alert"><p>{falha}</p><button className="btn" onClick={sair}>Sair</button></div>
    </main>
  )
  if (!ctx) return <p className="vazio" role="status">Carregando…</p>

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <header className="topo">
          <span className="marca">Condicional</span>
          <span className="quem">{ctx.me.nome}{ctx.me.papel === 'dona' ? ' · dona' : ''}</span>
          <button className="link" onClick={sair}>Sair</button>
        </header>
        <main className="conteudo">
          {aba === 'sacolas' && (sacolaId
            ? <DetalheSacola id={sacolaId} onVoltar={() => setSacolaId(null)} />
            : <ListaSacolas />)}
          {aba === 'pecas' && <Pecas />}
          {aba === 'clientes' && <Clientes />}
          {aba === 'painel' && <Painel />}
        </main>
        <nav className="menu" aria-label="Menu principal">
          {ABAS.map(a => (
            <button key={a.id} className={aba === a.id ? 'on' : ''} aria-current={aba === a.id ? 'page' : undefined}
              onClick={() => { setAba(a.id); setSacolaId(null) }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={a.icone} /></svg>
              {a.nome}
            </button>
          ))}
        </nav>
        {toast && <div key={toast.n} className={'toast ' + toast.tipo} role={toast.tipo === 'erro' ? 'alert' : 'status'}>{toast.texto}</div>}
      </div>
    </AppCtx.Provider>
  )
}
