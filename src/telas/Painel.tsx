import { supabase } from '../supabase'
import { useApp } from '../app'
import { diasAtras, inicioDoMes, plural, q, reais, useCarrega } from '../lib'
import { Carregando } from '../ui'
import type { Resumo } from '../types'

interface Venda { preco_saida: number; pecas: { fornecedor: string | null; custo?: number | null } | null }

export default function Painel() {
  const { me, erro } = useApp()
  const dona = me.papel === 'dona'
  const { dados, carregando, falhou, recarrega } = useCarrega(async () => {
    const [rua, sacolas, vendas, estoque] = await Promise.all([
      q(supabase.from('sacola_itens').select('preco_saida').eq('resultado', 'pendente')) as Promise<{ preco_saida: number }[]>,
      q(supabase.from('sacolas_resumo').select('atrasada,valor_ficou,valor_pago')) as Promise<Pick<Resumo, 'atrasada' | 'valor_ficou' | 'valor_pago'>[]>,
      q(supabase.from('sacola_itens').select(`preco_saida,pecas(fornecedor${dona ? ',custo' : ''})`)
        .eq('resultado', 'ficou').gte('resolvido_em', inicioDoMes())) as unknown as Promise<Venda[]>,
      q(supabase.from('pecas').select('criado_em').eq('status', 'estoque')) as Promise<{ criado_em: string }[]>,
    ])
    return { rua, sacolas, vendas, estoque }
  }, erro)

  if (carregando) return <Carregando />
  if (!dados) return <button className="btn" onClick={recarrega}>{falhou ? 'Tentar de novo' : 'Atualizar'}</button>
  const { rua, sacolas, vendas, estoque } = dados

  const soma = (l: { preco_saida: number }[]) => l.reduce((s, x) => s + Number(x.preco_saida), 0)
  const aReceber = sacolas.reduce((s, x) => s + Math.max(0, Number(x.valor_ficou) - Number(x.valor_pago)), 0)
  const paradas = estoque.filter(p => diasAtras(p.criado_em) > 30).length

  const porFornecedor = new Map<string, { n: number; vendido: number; repasse: number }>()
  for (const v of vendas) {
    const f = v.pecas?.fornecedor?.trim()
    if (!f) continue
    const x = porFornecedor.get(f) ?? { n: 0, vendido: 0, repasse: 0 }
    x.n++; x.vendido += Number(v.preco_saida); x.repasse += Number(v.pecas?.custo ?? 0)
    porFornecedor.set(f, x)
  }

  return (
    <section>
      <h1 className="titulo">Painel</h1>
      <div className="cards">
        <Card rotulo="Peças na rua" valor={String(rua.length)} nota={`${reais(soma(rua))} em jogo`} />
        <Card rotulo="Sacolas atrasadas" valor={String(sacolas.filter(s => s.atrasada).length)} ruim={sacolas.some(s => s.atrasada)} />
        <Card rotulo="A receber" valor={reais(aReceber)} nota="ficou e ainda não foi pago" ruim={aReceber > 0} />
        <Card rotulo="Vendido no mês" valor={reais(soma(vendas))} nota={plural(vendas.length, 'peça', 'peças')} />
        <Card rotulo="No estoque" valor={String(estoque.length)} nota={`${plural(paradas, 'parada', 'paradas')} há mais de 30 dias`} />
      </div>
      {dona && <>
        <h2 className="secao">Consignadas no mês (por fornecedor)</h2>
        {porFornecedor.size === 0 ? <p className="vazio">Nenhuma peça de fornecedor vendida neste mês.</p> :
          <ul className="lista">
            {[...porFornecedor].sort((a, b) => b[1].vendido - a[1].vendido).map(([nome, x]) => (
              <li key={nome} className="linha forn">
                <strong>{nome}</strong>
                <span className="mudo">{plural(x.n, 'peça vendida', 'peças vendidas')} · vendido {reais(x.vendido)}</span>
                <span>Repasse: <b>{reais(x.repasse)}</b></span>
              </li>))}
          </ul>}
      </>}
    </section>
  )
}

function Card({ rotulo, valor, nota, ruim }: { rotulo: string; valor: string; nota?: string; ruim?: boolean }) {
  return <div className="card"><span className="mudo">{rotulo}</span><b className={ruim ? 'vermelho-t' : ''}>{valor}</b>{nota && <span className="mudo">{nota}</span>}</div>
}
