import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../app'
import { linkWhats, q, semAcento, useCarrega } from '../lib'
import { Campo, Carregando, Sheet, Vazio } from '../ui'
import type { Cliente } from '../types'

export default function Clientes() {
  const { erro } = useApp()
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Cliente | 'novo' | null>(null)
  const { dados, carregando, falhou, recarrega } = useCarrega(
    () => q(supabase.from('clientes').select('id,nome,telefone,observacao').order('nome')) as Promise<Cliente[]>, erro)

  const t = semAcento(busca)
  const lista = (dados ?? []).filter(c => !t || semAcento(c.nome).includes(t) || (c.telefone ?? '').includes(t))

  return (
    <section>
      <div className="barra">
        <input type="search" placeholder="Buscar cliente" aria-label="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        <button className="btn" onClick={() => setEditando('novo')}>+ Cliente</button>
      </div>
      {carregando ? <Carregando /> : falhou && !dados ? <button className="btn" onClick={recarrega}>Tentar de novo</button>
        : lista.length === 0 ? <Vazio>{busca ? 'Nenhuma cliente com esse nome.' : 'Ainda não há clientes. Toque em “+ Cliente”.'}</Vazio>
        : <ul className="lista">
            {lista.map(c => (
              <li key={c.id} className="linha">
                <button className="linha-corpo" onClick={() => setEditando(c)}>
                  <strong className="nome">{c.nome}</strong>
                  <span className="mudo">{c.telefone || 'sem WhatsApp'}</span>
                  {c.observacao && <span className="mudo obs">{c.observacao}</span>}
                </button>
                {c.telefone && <a className="whats" href={linkWhats(c.telefone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${c.nome}`}>WhatsApp</a>}
              </li>
            ))}
          </ul>}
      {editando && <FormCliente cliente={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)}
        onSalvo={() => { setEditando(null); recarrega() }} />}
    </section>
  )
}

export function FormCliente({ cliente, nomeInicial = '', onFechar, onSalvo }: {
  cliente: Cliente | null; nomeInicial?: string; onFechar: () => void; onSalvo: (c: Cliente) => void
}) {
  const { tenta } = useApp()
  const [nome, setNome] = useState(cliente?.nome ?? nomeInicial)
  const [tel, setTel] = useState(cliente?.telefone ?? '')
  const [obs, setObs] = useState(cliente?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const campos = { nome: nome.trim(), telefone: tel.trim() || null, observacao: obs.trim() || null }
    let salvo: Cliente | null = null
    const ok = await tenta(async () => {
      const t = supabase.from('clientes')
      salvo = await q((cliente ? t.update(campos).eq('id', cliente.id) : t.insert(campos))
        .select('id,nome,telefone,observacao').single()) as Cliente
    }, 'Cliente salva.')
    setSalvando(false)
    if (ok && salvo) onSalvo(salvo)
  }

  return (
    <Sheet titulo={cliente ? 'Editar cliente' : 'Nova cliente'} onFechar={onFechar}>
      <form onSubmit={salvar}>
        <Campo rotulo="Nome"><input required value={nome} onChange={e => setNome(e.target.value)} autoComplete="off" /></Campo>
        <Campo rotulo="WhatsApp (com DDD)">
          <input type="tel" inputMode="tel" placeholder="(11) 99999-0000" value={tel} onChange={e => setTel(e.target.value)} />
        </Campo>
        <Campo rotulo="Observação"><textarea rows={3} value={obs} onChange={e => setObs(e.target.value)} /></Campo>
        <button className="btn grande" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </form>
    </Sheet>
  )
}
