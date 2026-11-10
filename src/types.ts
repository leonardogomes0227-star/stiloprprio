export type Papel = 'dona' | 'funcionaria'
export type StatusPeca = 'estoque' | 'na_sacola' | 'vendida' | 'baixada'
export type Resultado = 'pendente' | 'ficou' | 'devolveu'
export type Forma = 'pix' | 'dinheiro' | 'cartao'

export interface Profile { id: string; nome: string; papel: Papel; ativo: boolean }
export interface Cliente { id: string; nome: string; telefone: string | null; observacao: string | null }
export interface Peca {
  id: string; codigo: string; descricao: string; tamanho: string | null; cor: string | null
  preco: number; custo: number | null; fornecedor: string | null; foto_url: string | null
  status: StatusPeca; criado_em: string
}
export interface Resumo {
  id: string; cliente_id: string; status: 'aberta' | 'fechada'; prazo: string
  criada_por: string | null; criada_em: string; fechada_em: string | null
  total_itens: number; itens_pendentes: number
  valor_total: number; valor_ficou: number; valor_pago: number; atrasada: boolean
}
export type PecaResumo = Pick<Peca, 'codigo' | 'descricao' | 'tamanho' | 'cor' | 'foto_url'>
export interface Item {
  id: string; sacola_id: string; peca_id: string; preco_saida: number; resultado: Resultado
  resolvido_por: string | null; resolvido_em: string | null; pecas: PecaResumo | null
}
export interface Pagamento { id: string; valor: number; forma: Forma; criado_por: string | null; criado_em: string }
export interface Evento {
  id: string; acao: string; usuario_id: string | null; criado_em: string
  pecas: { codigo: string; descricao: string } | null
}
