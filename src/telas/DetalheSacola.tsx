import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { nomeDe, useApp } from '../app'
import { dataHora, diaData, hoje, lerValor, linkWhats, plural, q, reais, useCarrega, useDebounce, valorParaCampo } from '../lib'
import { Carregando, Foto } from '../ui'
import type { Cliente, Evento, Forma, Item, Pagamento, Peca, Resultado } from '../types'

interface Sacola { id: string; cliente_id: string; status: 'aberta' | 'fechada'; prazo: string; criada_por: string | null; criada_em: string; fechada_por: string | null; fechada_em: string | null }
const FORMAS: { id: Forma; nome: string }[] = [{ id: 'pix', nome: 'Pix' }, { id: 'dinheiro', nome: 'Dinheiro' }, { id: 'cartao', nome: 'Cartão' }]
const nomeForma = (f: Forma) => FORMAS.find(x => x.id === f)!.nome

export default function DetalheSacola({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const { me, equipe, erro, tenta } = useApp()
  const [ocupado, setOcupado] = useState(false)
  const [adicionando, setAdicionando] = useState(false)
  const { dados, carregando, falhou, recarrega } = useCarrega(async () => {
    const [sacola, itens, pagamentos] = await Promise.all([
      q(supabase.from('sacolas').select('id,cliente_id,status,prazo,criada_por,criada_em,fechada_por,fechada_em').eq('id', id).single()) as Promise<Sacola>,
      q(supabase.from('sacola_itens').select('id,sacola_id,peca_id,preco_saida,resultado,resolvido_por,resolvido_em,pecas(codigo,descricao,tamanho,cor,foto_url)')
        .eq('sacola_id', id).order('criado_em')) as unknown as Promise<Item[]>,
      q(supabase.from('pagamentos').select('id,valor,forma,criado_por,criado_em').eq('sacola_id', id).order('criado_em')) as Promise<Pagamento[]>,
    ])
    const cliente = await q(supabase.from('clientes').select('id,nome,telefone,observacao').eq('id', sacola.cliente_id).single()) as Cliente
    return { sacola, itens, pagamentos, cliente }
  }, erro, [id])

  if (carregando) return <Carregando />
  if (!dados) return <div><button className="link" onClick={onVoltar}>← Voltar</button>{falhou && <button className="btn" onClick={recarrega}>Tentar de novo</button>}</div>

  const { sacola, itens, pagamentos, cliente } = dados
  const aberta = sacola.status === 'aberta'
  const pendentes = itens.filter(i => i.resultado === 'pendente')
  const ficou = itens.filter(i => i.resultado === 'ficou').reduce((s, i) => s + Number(i.preco_saida), 0)
  const pago = pagamentos.reduce((s, p) => s + Number(p.valor), 0)
  const falta = Math.max(0, Math.round((ficou - pago) * 100) / 100)

  /** roda uma alteração no banco e recarrega a tela */
  async function agir(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true)
    const deu = await tenta(fn, ok)
    await recarrega()
    setOcupado(false)
    return deu
  }
  const marca = (it: Item, r: Resultado) => agir(async () => {
    // tocar de novo no que já está marcado desfaz
    await q(supabase.from('sacola_itens').update({ resultado: it.resultado === r ? 'pendente' : r }).eq('id', it.id).select('id'))
  })
  const tira = (it: Item) => confirm(`Tirar ${it.pecas?.codigo ?? 'a peça'} da sacola?`) && agir(async () => {
    await q(supabase.from('sacola_itens').delete().eq('id', it.id).select('id'))
  })
  const mudaStatus = (status: 'aberta' | 'fechada') => agir(async () => {
    await q(supabase.from('sacolas').update({ status }).eq('id', sacola.id).select('id'))
  }, status === 'fechada' ? 'Sacola fechada.' : 'Sacola reaberta.')
  const mudaPrazo = (prazo: string) => prazo && agir(async () => {
    await q(supabase.from('sacolas').update({ prazo }).eq('id', sacola.id).select('id'))
  }, 'Prazo atualizado.')

  const msgWhats = () => {
    const primeiro = cliente.nome.split(' ')[0]
    if (pendentes.length) {
      const linhas = pendentes.map(i => `• ${i.pecas?.codigo} ${i.pecas?.descricao ?? ''}${i.pecas?.tamanho ? ` (${i.pecas.tamanho})` : ''} – ${reais(i.preco_saida)}`).join('\n')
      return `Oi, ${primeiro}! Tudo bem? Passando para falar da sua sacola do condicional (prazo até ${diaData(sacola.prazo)}).\n\nAinda estão com você:\n${linhas}\n\nMe avisa quais você vai ficar e quais vai devolver? 😊`
    }
    return `Oi, ${primeiro}! Tudo bem? Da sua sacola do condicional, ficou ${reais(ficou)}${pago > 0 ? `, você já pagou ${reais(pago)}` : ''} e falta ${reais(falta)}. Pode me mandar por Pix? Obrigada! 😊`
  }

  return (
    <section className="detalhe">
      <button className="link voltar" onClick={onVoltar}>← Voltar para as sacolas</button>
      <h1 className="titulo">{cliente.nome}</h1>
      <p className="mudo">Montada por <b>{nomeDe(equipe, sacola.criada_por)}</b> em {dataHora(sacola.criada_em)}</p>
      <div className="prazo-linha">
        <label htmlFor="prazo">Prazo</label>
        <input id="prazo" type="date" value={sacola.prazo} disabled={!aberta || ocupado} onChange={e => mudaPrazo(e.target.value)} />
        {aberta && sacola.prazo < hoje() && <span className="chip vermelho">Atrasada</span>}
        {!aberta && <span className="chip cinza">Fechada</span>}
      </div>

      <h2 className="secao">Peças ({itens.length})</h2>
      {itens.length === 0 && <p className="vazio">Nenhuma peça ainda. Toque em “+ Adicionar peça”.</p>}
      <ul className="lista">
        {itens.map(it => (
          <li key={it.id} className={'item r-' + it.resultado}>
            <div className="item-topo">
              <Foto url={it.pecas?.foto_url} />
              <div className="col">
                <span><strong>{it.pecas?.codigo}</strong> · {it.pecas?.descricao || 'sem descrição'}</span>
                <span className="mudo">{[it.pecas?.tamanho && `Tam. ${it.pecas.tamanho}`, it.pecas?.cor].filter(Boolean).join(' · ') || ' '}</span>
                <b>{reais(it.preco_saida)}</b>
              </div>
              {aberta && it.resultado === 'pendente' &&
                <button className="icone" disabled={ocupado} onClick={() => tira(it)} aria-label={`Tirar ${it.pecas?.codigo} da sacola`}>✕</button>}
            </div>
            {aberta ? (
              <div className="duplo">
                <button className={'btn ficou' + (it.resultado === 'ficou' ? ' on' : '')} aria-pressed={it.resultado === 'ficou'}
                  disabled={ocupado} onClick={() => marca(it, 'ficou')}>{it.resultado === 'ficou' ? '✓ Ficou' : 'Ficou'}</button>
                <button className={'btn devolveu' + (it.resultado === 'devolveu' ? ' on' : '')} aria-pressed={it.resultado === 'devolveu'}
                  disabled={ocupado} onClick={() => marca(it, 'devolveu')}>{it.resultado === 'devolveu' ? '✓ Devolveu' : 'Devolveu'}</button>
              </div>
            ) : <span className={'chip ' + (it.resultado === 'ficou' ? 'verde' : 'cinza')}>{it.resultado === 'ficou' ? 'Ficou' : 'Devolveu'}</span>}
            {it.resultado !== 'pendente' && <p className="mudo marcado">Marcado por {nomeDe(equipe, it.resolvido_por)} · {it.resolvido_em && dataHora(it.resolvido_em)}{aberta && ' · toque de novo para desfazer'}</p>}
          </li>
        ))}
      </ul>

      {aberta && (adicionando
        ? <AdicionaPeca sacolaId={sacola.id} onFechar={() => setAdicionando(false)} onAdicionou={recarrega} />
        : <button className="btn claro grande" onClick={() => setAdicionando(true)}>+ Adicionar peça</button>)}

      {ficou > 0 && <Pagamentos ficou={ficou} pago={pago} falta={falta} pagamentos={pagamentos} sacolaId={sacola.id} onMudou={recarrega} />}

      {cliente.telefone && (pendentes.length > 0 || falta > 0) &&
        <a className="btn whats-btn grande" href={linkWhats(cliente.telefone, msgWhats())} target="_blank" rel="noreferrer">Cobrar no WhatsApp</a>}

      {aberta
        ? <button className="btn grande fechar" disabled={pendentes.length > 0 || ocupado} onClick={() => mudaStatus('fechada')}>
            {pendentes.length > 0 ? `Falta marcar ${plural(pendentes.length, 'peça', 'peças')}` : 'Fechar sacola'}</button>
        : <div className="cartao">
            <p>Fechada por <b>{nomeDe(equipe, sacola.fechada_por)}</b>{sacola.fechada_em && ` em ${dataHora(sacola.fechada_em)}`}.</p>
            {me.papel === 'dona' && <button className="btn claro" disabled={ocupado} onClick={() => mudaStatus('aberta')}>Reabrir sacola</button>}
          </div>}

      <Historico sacolaId={sacola.id} versao={itens.map(i => i.resultado).join() + pagamentos.length + sacola.status + itens.length} />
    </section>
  )
}

function AdicionaPeca({ sacolaId, onFechar, onAdicionou }: { sacolaId: string; onFechar: () => void; onAdicionou: () => void }) {
  const { erro, tenta } = useApp()
  const [texto, setTexto] = useState('')
  const termo = useDebounce(texto.trim().replace(/[,()*%\\"]/g, ' '), 250)
  const [lista, setLista] = useState<Peca[]>([])
  const [buscando, setBuscando] = useState(true)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    setBuscando(true)
    let c = supabase.from('pecas').select('id,codigo,descricao,tamanho,cor,preco,foto_url').eq('status', 'estoque')
    if (termo) c = c.or(`codigo.ilike.*${termo}*,descricao.ilike.*${termo}*`)
    q(c.order('codigo').limit(8)).then(l => vivo && setLista(l as Peca[])).catch(e => vivo && erro(e)).finally(() => vivo && setBuscando(false))
    return () => { vivo = false }
  }, [termo, versao, erro])

  async function adiciona(p: Peca) {
    const ok = await tenta(async () => { await q(supabase.from('sacola_itens').insert({ sacola_id: sacolaId, peca_id: p.id }).select('id')) }, `${p.codigo} na sacola.`)
    if (ok) { setTexto(''); onAdicionou() }
    setVersao(v => v + 1)     // se alguém pegou a peça antes, ela some da lista
  }

  return (
    <div className="cartao">
      <div className="barra">
        <input type="search" autoFocus placeholder="Código ou nome da peça" aria-label="Buscar peça no estoque" value={texto} onChange={e => setTexto(e.target.value)} />
        <button className="btn claro" onClick={onFechar}>Fechar</button>
      </div>
      {buscando && lista.length === 0 ? <p className="mudo" role="status">Buscando…</p>
        : lista.length === 0 ? <p className="mudo">Nenhuma peça em estoque com esse código ou nome.</p>
        : <ul className="lista compacta">
            {lista.map(p => (
              <li key={p.id}>
                <button className="opcao com-foto" onClick={() => adiciona(p)}>
                  <Foto url={p.foto_url} tam={44} />
                  <span className="col"><span><strong>{p.codigo}</strong> · {p.descricao || 'sem descrição'}</span>
                    <span className="mudo">{[p.tamanho && `Tam. ${p.tamanho}`, p.cor].filter(Boolean).join(' · ')}</span></span>
                  <b>{reais(p.preco)}</b>
                </button>
              </li>
            ))}
          </ul>}
    </div>
  )
}

function Pagamentos({ ficou, pago, falta, pagamentos, sacolaId, onMudou }: {
  ficou: number; pago: number; falta: number; pagamentos: Pagamento[]; sacolaId: string; onMudou: () => void
}) {
  const { equipe, tenta, aviso } = useApp()
  const [valor, setValor] = useState(valorParaCampo(falta))
  const [forma, setForma] = useState<Forma>('pix')
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { setValor(falta > 0 ? valorParaCampo(falta) : '') }, [falta])

  async function registra() {
    const v = lerValor(valor)
    if (!(v > 0)) return aviso('Informe o valor do pagamento.', 'erro')
    if (v > falta && !confirm(`Esse valor (${reais(v)}) é maior do que falta (${reais(falta)}). Registrar mesmo assim?`)) return
    setSalvando(true)
    const ok = await tenta(async () => { await q(supabase.from('pagamentos').insert({ sacola_id: sacolaId, valor: v, forma }).select('id')) }, 'Pagamento registrado.')
    setSalvando(false)
    if (ok) onMudou()
  }

  return (
    <div className="cartao pagamento">
      <h2 className="secao">Pagamento</h2>
      <div className="trio">
        <div><span>Ficou</span><b>{reais(ficou)}</b></div>
        <div><span>Pago</span><b className="verde-t">{reais(pago)}</b></div>
        <div><span>Falta</span><b className={falta > 0 ? 'vermelho-t' : 'verde-t'}>{reais(falta)}</b></div>
      </div>
      {pagamentos.length > 0 && <ul className="lista compacta">
        {pagamentos.map(p => <li key={p.id} className="pgto"><b>{reais(p.valor)}</b> {nomeForma(p.forma)}
          <span className="mudo"> · {nomeDe(equipe, p.criado_por)}, {dataHora(p.criado_em)}</span></li>)}
      </ul>}
      <div className="duas">
        <label className="campo"><span>Valor (R$)</span><input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} /></label>
        <div className="campo"><span>Forma</span>
          <div className="formas" role="radiogroup" aria-label="Forma de pagamento">
            {FORMAS.map(f => <button key={f.id} type="button" role="radio" aria-checked={forma === f.id} className={'forma' + (forma === f.id ? ' on' : '')} onClick={() => setForma(f.id)}>{f.nome}</button>)}
          </div>
        </div>
      </div>
      <button className="btn grande" disabled={salvando} onClick={registra}>{salvando ? 'Registrando…' : 'Registrar pagamento'}</button>
    </div>
  )
}

function Historico({ sacolaId, versao }: { sacolaId: string; versao: string }) {
  const { equipe, erro } = useApp()
  const [aberto, setAberto] = useState(false)
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  useEffect(() => {
    if (!aberto) return
    let vivo = true
    q(supabase.from('historico').select('id,acao,usuario_id,criado_em,pecas(codigo,descricao)').eq('sacola_id', sacolaId).order('criado_em').order('id'))
      .then(l => vivo && setEventos(l as unknown as Evento[])).catch(e => vivo && erro(e))
    return () => { vivo = false }
  }, [aberto, sacolaId, versao, erro])

  return (
    <div className="historico">
      <button className="btn claro" aria-expanded={aberto} onClick={() => setAberto(a => !a)}>{aberto ? 'Esconder histórico' : 'Ver histórico (quem fez o quê)'}</button>
      {aberto && (eventos === null ? <Carregando /> : <ol className="eventos">
        {eventos.map(e => (
          <li key={e.id}><b>{nomeDe(equipe, e.usuario_id)}</b> {e.acao}{e.pecas && <> — <strong>{e.pecas.codigo}</strong> {e.pecas.descricao}</>}
            <span className="mudo">{dataHora(e.criado_em)}</span></li>
        ))}
      </ol>)}
    </div>
  )
}
