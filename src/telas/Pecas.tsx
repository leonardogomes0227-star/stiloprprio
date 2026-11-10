import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../app'
import { lerValor, q, reais, reduzirFoto, semAcento, useCarrega, valorParaCampo } from '../lib'
import { Campo, Carregando, Filtros, Foto, Sheet, Vazio } from '../ui'
import type { Peca, StatusPeca } from '../types'

const COLS = 'id,codigo,descricao,tamanho,cor,preco,custo,fornecedor,foto_url,status,criado_em'
const ROTULO: Record<StatusPeca, string> = { estoque: 'No estoque', na_sacola: 'Na sacola', vendida: 'Vendida', baixada: 'Baixada' }
type Filtro = StatusPeca | 'todas'

export default function Pecas() {
  const { erro } = useApp()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('estoque')
  const [editando, setEditando] = useState<Peca | 'nova' | null>(null)
  const { dados, carregando, falhou, recarrega } = useCarrega(
    () => q(supabase.from('pecas').select(COLS).order('criado_em', { ascending: false }).limit(2000)) as Promise<Peca[]>, erro)

  const todas = dados ?? []
  const cont = (s: Filtro) => s === 'todas' ? todas.length : todas.filter(p => p.status === s).length
  const t = semAcento(busca)
  const lista = todas.filter(p => (filtro === 'todas' || p.status === filtro) &&
    (!t || [p.codigo, p.descricao, p.fornecedor ?? ''].some(x => semAcento(x).includes(t))))

  return (
    <section>
      <div className="barra">
        <input type="search" placeholder="Código, nome ou fornecedor" aria-label="Buscar peça" value={busca} onChange={e => setBusca(e.target.value)} />
        <button className="btn" onClick={() => setEditando('nova')}>+ Peça</button>
      </div>
      <Filtros valor={filtro} onChange={setFiltro} itens={[
        { id: 'estoque', nome: 'Estoque', n: cont('estoque') }, { id: 'na_sacola', nome: 'Na sacola', n: cont('na_sacola') },
        { id: 'vendida', nome: 'Vendidas', n: cont('vendida') }, { id: 'baixada', nome: 'Baixadas', n: cont('baixada') },
        { id: 'todas', nome: 'Todas', n: cont('todas') }]} />
      {carregando ? <Carregando /> : falhou && !dados ? <button className="btn" onClick={recarrega}>Tentar de novo</button>
        : lista.length === 0 ? <Vazio>{busca || todas.length ? 'Nenhuma peça aqui.' : 'Ainda não há peças. Toque em “+ Peça”.'}</Vazio>
        : <ul className="lista">
            {lista.map(p => (
              <li key={p.id} className="linha">
                <button className="linha-corpo com-foto" onClick={() => setEditando(p)}>
                  <Foto url={p.foto_url} />
                  <span className="col">
                    <span><strong>{p.codigo}</strong> · {p.descricao || 'sem descrição'}</span>
                    <span className="mudo">{[p.tamanho && `Tam. ${p.tamanho}`, p.cor, p.fornecedor && `Consignada: ${p.fornecedor}`].filter(Boolean).join(' · ') || ' '}</span>
                    <span><b>{reais(p.preco)}</b> <span className={'chip s-' + p.status}>{ROTULO[p.status]}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>}
      {editando && <FormPeca peca={editando === 'nova' ? null : editando} todas={todas}
        onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); recarrega() }} />}
    </section>
  )
}

function proximoCodigo(todas: Peca[]): string {
  const max = todas.reduce((m, p) => { const n = /^P(\d+)$/.exec(p.codigo); return n ? Math.max(m, Number(n[1])) : m }, 0)
  return 'P' + String(max + 1).padStart(4, '0')
}

function FormPeca({ peca, todas, onFechar, onSalvo }: { peca: Peca | null; todas: Peca[]; onFechar: () => void; onSalvo: () => void }) {
  const { me, tenta, aviso } = useApp()
  const dona = me.papel === 'dona'
  const [codigo, setCodigo] = useState(peca?.codigo ?? proximoCodigo(todas))
  const [preco, setPreco] = useState(peca ? valorParaCampo(peca.preco) : '')
  const [descricao, setDescricao] = useState(peca?.descricao ?? '')
  const [tamanho, setTamanho] = useState(peca?.tamanho ?? '')
  const [cor, setCor] = useState(peca?.cor ?? '')
  const [fornecedor, setFornecedor] = useState(peca?.fornecedor ?? '')
  const [custo, setCusto] = useState(peca?.custo != null ? valorParaCampo(peca.custo) : '')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState(peca?.foto_url ?? '')
  const [salvando, setSalvando] = useState(false)

  function escolheFoto(f: File | undefined) {
    if (!f) return
    setArquivo(f)
    setPrevia(URL.createObjectURL(f))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    const p = lerValor(preco)
    if (Number.isNaN(p)) return aviso('Informe o preço da peça.', 'erro')
    const c = custo.trim() ? lerValor(custo) : null
    if (c !== null && Number.isNaN(c)) return aviso('O custo não parece um valor válido.', 'erro')
    setSalvando(true)
    const ok = await tenta(async () => {
      let foto_url = peca?.foto_url ?? null
      if (arquivo) {
        const blob = await reduzirFoto(arquivo)
        const nome = `${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('pecas').upload(nome, blob, { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        foto_url = supabase.storage.from('pecas').getPublicUrl(nome).data.publicUrl
      }
      const campos: Record<string, unknown> = {
        codigo: codigo.trim().toUpperCase(), preco: p, descricao: descricao.trim(),
        tamanho: tamanho.trim() || null, cor: cor.trim() || null, fornecedor: fornecedor.trim() || null, foto_url,
      }
      if (dona) campos.custo = c       // funcionária nunca mexe no custo
      const t = supabase.from('pecas')
      await q(peca ? t.update(campos).eq('id', peca.id).select('id') : t.insert(campos).select('id'))
    }, 'Peça salva.')
    setSalvando(false)
    if (ok) onSalvo()
  }

  async function mudaStatus(status: StatusPeca, msg: string) {
    if (!peca) return
    if (status === 'baixada' && !confirm('Dar baixa nessa peça (perdida ou danificada)? Ela sai do estoque.')) return
    setSalvando(true)
    const ok = await tenta(async () => { await q(supabase.from('pecas').update({ status }).eq('id', peca.id).select('id')) }, msg)
    setSalvando(false)
    if (ok) onSalvo()
  }

  return (
    <Sheet titulo={peca ? `Peça ${peca.codigo}` : 'Nova peça'} onFechar={onFechar}>
      <form onSubmit={salvar}>
        <div className="foto-campo">
          {previa ? <img className="foto grande" src={previa} alt="Foto da peça" /> : <div className="foto vazia grande" aria-hidden="true">👗</div>}
          <label className="btn claro">
            {previa ? 'Trocar foto' : 'Tirar foto'}
            <input type="file" accept="image/*" capture="environment" className="so-leitor" onChange={e => escolheFoto(e.target.files?.[0])} />
          </label>
        </div>
        <div className="duas">
          <Campo rotulo="Código"><input required value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" /></Campo>
          <Campo rotulo="Preço (R$)"><input required inputMode="decimal" placeholder="89,90" value={preco} onChange={e => setPreco(e.target.value)} /></Campo>
        </div>
        <Campo rotulo="Descrição"><input value={descricao} placeholder="Vestido midi floral" onChange={e => setDescricao(e.target.value)} /></Campo>
        <div className="duas">
          <Campo rotulo="Tamanho"><input value={tamanho} placeholder="M" onChange={e => setTamanho(e.target.value)} /></Campo>
          <Campo rotulo="Cor"><input value={cor} placeholder="Azul" onChange={e => setCor(e.target.value)} /></Campo>
        </div>
        <Campo rotulo="Fornecedor (só se for consignada)"><input value={fornecedor} onChange={e => setFornecedor(e.target.value)} /></Campo>
        {dona && <Campo rotulo="Custo / repasse ao fornecedor (R$) — só a dona vê">
          <input inputMode="decimal" value={custo} onChange={e => setCusto(e.target.value)} /></Campo>}
        <button className="btn grande" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar peça'}</button>
        {peca?.status === 'estoque' && <button type="button" className="btn perigo" disabled={salvando}
          onClick={() => mudaStatus('baixada', 'Baixa registrada.')}>Dar baixa (perdida ou danificada)</button>}
        {peca?.status === 'baixada' && (dona
          ? <button type="button" className="btn claro" disabled={salvando} onClick={() => mudaStatus('estoque', 'Peça voltou ao estoque.')}>Devolver ao estoque</button>
          : <p className="mudo">Peça baixada. Só a dona pode devolver ao estoque.</p>)}
        {peca && (peca.status === 'na_sacola' || peca.status === 'vendida') &&
          <p className="mudo">Essa peça está {peca.status === 'vendida' ? 'vendida' : 'em uma sacola'}; o status muda pela sacola.</p>}
      </form>
    </Sheet>
  )
}
