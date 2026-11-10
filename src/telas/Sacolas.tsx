import { useState } from 'react'
import { supabase } from '../supabase'
import { nomeDe, useApp } from '../app'
import { dataHora, diaData, isoLocal, plural, q, reais, semAcento, useCarrega } from '../lib'
import { Carregando, Filtros, Sheet, Vazio } from '../ui'
import { FormCliente } from './Clientes'
import type { Cliente, Resumo } from '../types'

type Filtro = 'rua' | 'atrasadas' | 'devendo' | 'fechadas'
const falta = (s: Resumo) => Math.max(0, s.valor_ficou - s.valor_pago)

export function ListaSacolas() {
  const { equipe, erro, abreSacola } = useApp()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('rua')
  const [nova, setNova] = useState(false)
  const { dados, carregando, falhou, recarrega } = useCarrega(async () => {
    const [sacolas, clientes] = await Promise.all([
      q(supabase.from('sacolas_resumo').select('*').order('criada_em', { ascending: false }).limit(500)) as Promise<Resumo[]>,
      q(supabase.from('clientes').select('id,nome,telefone,observacao')) as Promise<Cliente[]>,
    ])
    return { sacolas, clientes: Object.fromEntries(clientes.map(c => [c.id, c])) }
  }, erro)

  const sacolas = dados?.sacolas ?? []
  const nome = (s: Resumo) => dados?.clientes[s.cliente_id]?.nome ?? 'Cliente'
  const passa: Record<Filtro, (s: Resumo) => boolean> = {
    rua: s => s.status === 'aberta', atrasadas: s => s.atrasada,
    devendo: s => falta(s) > 0, fechadas: s => s.status === 'fechada',
  }
  const t = semAcento(busca)
  const lista = sacolas.filter(s => passa[filtro](s) && (!t || semAcento(nome(s)).includes(t)))
  if (filtro === 'rua' || filtro === 'atrasadas') lista.sort((a, b) => a.prazo.localeCompare(b.prazo))

  return (
    <section>
      <div className="barra">
        <input type="search" placeholder="Buscar pela cliente" aria-label="Buscar sacola pela cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        <button className="btn" onClick={() => setNova(true)}>+ Sacola</button>
      </div>
      <Filtros valor={filtro} onChange={setFiltro} itens={[
        { id: 'rua', nome: 'Na rua', n: sacolas.filter(passa.rua).length },
        { id: 'atrasadas', nome: 'Atrasadas', n: sacolas.filter(passa.atrasadas).length },
        { id: 'devendo', nome: 'Devendo', n: sacolas.filter(passa.devendo).length },
        { id: 'fechadas', nome: 'Fechadas', n: sacolas.filter(passa.fechadas).length }]} />
      {carregando ? <Carregando /> : falhou && !dados ? <button className="btn" onClick={recarrega}>Tentar de novo</button>
        : lista.length === 0 ? <Vazio>{busca ? 'Nenhuma sacola dessa cliente aqui.' : 'Nenhuma sacola nesse filtro.'}</Vazio>
        : <ul className="lista">
            {lista.map(s => (
              <li key={s.id} className="linha">
                <button className="linha-corpo" onClick={() => abreSacola(s.id)}>
                  <span className="topo-linha">
                    <strong className="nome">{nome(s)}</strong>
                    {s.status === 'fechada'
                      ? falta(s) > 0 ? <span className="chip vermelho">deve {reais(falta(s))}</span> : <span className="chip cinza">Fechada</span>
                      : s.atrasada ? <span className="chip vermelho">Atrasada · {diaData(s.prazo)}</span> : <span className="chip">Prazo {diaData(s.prazo)}</span>}
                  </span>
                  <span className="mudo">{plural(s.total_itens, 'peça', 'peças')} · montada por {nomeDe(equipe, s.criada_por)}, {dataHora(s.criada_em)}</span>
                  {s.status === 'aberta' && s.itens_pendentes > 0 &&
                    <span className="pend">{plural(s.itens_pendentes, 'peça pendente', 'peças pendentes')}</span>}
                </button>
              </li>
            ))}
          </ul>}
      {nova && <NovaSacola clientes={Object.values(dados?.clientes ?? {})} onFechar={() => setNova(false)}
        onCriada={id => { setNova(false); abreSacola(id) }} />}
    </section>
  )
}

function NovaSacola({ clientes, onFechar, onCriada }: { clientes: Cliente[]; onFechar: () => void; onCriada: (id: string) => void }) {
  const { tenta } = useApp()
  const [busca, setBusca] = useState('')
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [dias, setDias] = useState(3)
  const [cadastrando, setCadastrando] = useState(false)
  const [criando, setCriando] = useState(false)
  const t = semAcento(busca)
  const achadas = clientes.filter(c => !t || semAcento(c.nome).includes(t)).sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 6)

  async function criar() {
    if (!cliente) return
    setCriando(true)
    const prazo = new Date(); prazo.setDate(prazo.getDate() + dias)
    let id = ''
    const ok = await tenta(async () => {
      id = (await q(supabase.from('sacolas').insert({ cliente_id: cliente.id, prazo: isoLocal(prazo) }).select('id').single()) as { id: string }).id
    })
    setCriando(false)
    if (ok) onCriada(id)
  }

  if (cadastrando) return <FormCliente cliente={null} nomeInicial={busca} onFechar={() => setCadastrando(false)}
    onSalvo={c => { setCliente(c); setCadastrando(false) }} />

  return (
    <Sheet titulo="Nova sacola" onFechar={onFechar}>
      <h3 className="passo">1. Quem é a cliente?</h3>
      {cliente ? (
        <div className="escolhida"><strong>{cliente.nome}</strong><button className="link" onClick={() => setCliente(null)}>trocar</button></div>
      ) : (<>
        <input type="search" placeholder="Buscar pelo nome" aria-label="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        <ul className="lista compacta">
          {achadas.map(c => <li key={c.id}><button className="opcao" onClick={() => setCliente(c)}>{c.nome}<span className="mudo">{c.telefone}</span></button></li>)}
        </ul>
        <button className="btn claro" onClick={() => setCadastrando(true)}>+ Cadastrar cliente nova{busca ? ` “${busca}”` : ''}</button>
      </>)}
      <h3 className="passo">2. Quantos dias de prazo?</h3>
      <div className="dias" role="radiogroup" aria-label="Prazo em dias">
        {[1, 2, 3, 5, 7].map(d => (
          <button key={d} role="radio" aria-checked={dias === d} className={'dia' + (dias === d ? ' on' : '')} onClick={() => setDias(d)}>{d}</button>
        ))}
      </div>
      <p className="mudo">Devolve até {diaData(isoLocal(new Date(Date.now() + dias * 86400000)))}.</p>
      <button className="btn grande" disabled={!cliente || criando} onClick={criar}>{criando ? 'Criando…' : 'Criar sacola'}</button>
    </Sheet>
  )
}
