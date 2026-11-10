// MODO TESTE: banco de mentira guardado no localStorage, usado quando não há .env.
// Imita só o que o app usa do Supabase, incluindo as regras dos triggers.
import { isoLocal } from './lib'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Err = { message: string; code?: string }
const falha = (message: string, code = 'P0001'): never => { throw { message, code } as Err }
const id = () => crypto.randomUUID()
const agora = () => new Date().toISOString()
const dia = (n: number) => isoLocal(new Date(Date.now() + n * 864e5))
const brl = (v: number) => v.toFixed(2).replace('.', ',')

const db: Record<string, Row[]> = { profiles: [], clientes: [], pecas: [], sacolas: [], sacola_itens: [], pagamentos: [], historico: [] }
let eu = 'd1'
let sessao: { user: { id: string } } | null = null
const CHAVE = 'condicional-modo-teste'
const salva = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ db, eu, sessao })) } catch { /* sem espaço: segue sem salvar */ } }
const carrega = (): boolean => {
  try {
    const x = JSON.parse(localStorage.getItem(CHAVE) || 'null')
    if (!x?.db?.profiles) return false
    Object.assign(db, x.db); eu = x.eu; sessao = x.sessao; return true
  } catch { return false }
}
const souDona = () => db.profiles.find(p => p.id === eu)?.papel === 'dona'
const log = (sacola_id: string | null, peca_id: string | null, acao: string) =>
  db.historico.push({ id: id(), sacola_id, peca_id, acao, usuario_id: eu, criado_em: agora() })
const peca = (pid: string) => db.pecas.find(p => p.id === pid)!
const sacola = (sid: string) => db.sacolas.find(s => s.id === sid)

function resumo(): Row[] {
  return db.sacolas.map(s => {
    const it = db.sacola_itens.filter(i => i.sacola_id === s.id)
    const soma = (l: Row[], k: string) => l.reduce((t, x) => t + Number(x[k]), 0)
    return { ...s, total_itens: it.length, itens_pendentes: it.filter(i => i.resultado === 'pendente').length,
      valor_total: soma(it, 'preco_saida'), valor_ficou: soma(it.filter(i => i.resultado === 'ficou'), 'preco_saida'),
      valor_pago: soma(db.pagamentos.filter(p => p.sacola_id === s.id), 'valor'), atrasada: s.status === 'aberta' && s.prazo < dia(0) }
  })
}

// ---------- escrita (com as regras dos triggers) ----------
function inserir(t: string, p: Row): Row {
  const base = { id: id(), criado_em: agora() }
  if (t === 'clientes') { const r = { ...base, criado_por: eu, ...p }; db.clientes.push(r); return r }
  if (t === 'pecas') {
    const codigo = String(p.codigo).trim().toUpperCase()
    if (db.pecas.some(x => x.codigo === codigo)) falha('duplicate key value violates unique constraint "pecas_codigo_key"', '23505')
    const r = { ...base, criado_por: eu, custo: null, ...p, codigo, status: 'estoque' }; db.pecas.push(r); return r
  }
  if (t === 'sacolas') {
    const r = { ...base, status: 'aberta', prazo: dia(3), criada_em: agora(), criada_por: eu, fechada_por: null, fechada_em: null, ...p }
    db.sacolas.push(r); log(r.id, null, 'criou a sacola'); return r
  }
  if (t === 'sacola_itens') {
    if (sacola(p.sacola_id)?.status !== 'aberta') falha('Essa sacola está fechada. Peça para a dona reabrir.')
    const pc = peca(p.peca_id)
    if (pc?.status !== 'estoque') falha('Essa peça não está disponível no estoque')
    pc.status = 'na_sacola'
    const r = { ...base, sacola_id: p.sacola_id, peca_id: p.peca_id, preco_saida: pc.preco, resultado: 'pendente', resolvido_por: null, resolvido_em: null }
    db.sacola_itens.push(r); log(r.sacola_id, r.peca_id, 'colocou a peça na sacola'); return r
  }
  if (t === 'pagamentos') {
    if (!(p.valor > 0)) falha('new row violates check constraint', '23514')
    const r: Row = { ...base, criado_por: eu, ...p }; db.pagamentos.push(r)
    log(r.sacola_id, null, `registrou pagamento de R$ ${brl(r.valor)} (${r.forma})`); return r
  }
  return falha('permission denied for table ' + t, '42501')
}

function atualizar(t: string, r: Row, p: Row) {
  if (t === 'clientes') return void Object.assign(r, p)
  if (t === 'pecas') {
    const { status, ...resto } = p
    if (resto.codigo) {
      resto.codigo = String(resto.codigo).trim().toUpperCase()
      if (db.pecas.some(x => x.id !== r.id && x.codigo === resto.codigo)) falha('duplicate key value violates unique constraint "pecas_codigo_key"', '23505')
    }
    if (status && status !== r.status) {
      if (r.status === 'estoque' && status === 'baixada') log(null, r.id, 'deu baixa na peça (perdida/danificada)')
      else if (r.status === 'baixada' && status === 'estoque') {
        if (!souDona()) falha('Só a dona pode devolver uma peça baixada ao estoque.')
        log(null, r.id, 'devolveu a peça baixada ao estoque')
      } else falha('O status da peça muda pela sacola. Aqui só dá para dar baixa.')
      r.status = status
    }
    return void Object.assign(r, resto)
  }
  if (t === 'sacolas') {
    const { status, ...resto } = p
    if (status === 'fechada' && r.status === 'aberta') {
      if (db.sacola_itens.some(i => i.sacola_id === r.id && i.resultado === 'pendente'))
        falha('Ainda tem peça pendente nessa sacola. Marque ficou ou devolveu em todas.')
      Object.assign(r, { status, fechada_por: eu, fechada_em: agora() }); log(r.id, null, 'fechou a sacola')
    } else if (status === 'aberta' && r.status === 'fechada') {
      if (!souDona()) falha('Só a dona pode reabrir uma sacola.')
      Object.assign(r, { status, fechada_por: null, fechada_em: null }); log(r.id, null, 'reabriu a sacola')
    }
    return void Object.assign(r, resto)
  }
  if (t === 'sacola_itens' && p.resultado && p.resultado !== r.resultado) {
    if (sacola(r.sacola_id)?.status !== 'aberta') falha('Essa sacola está fechada. Peça para a dona reabrir.')
    const pc = peca(r.peca_id)
    const esperado = { pendente: 'na_sacola', ficou: 'vendida', devolveu: 'estoque' }[r.resultado as string]
    if (pc.status !== esperado) falha('A situação dessa peça mudou (talvez já esteja em outra sacola). Atualize a tela.')
    pc.status = { ficou: 'vendida', devolveu: 'estoque', pendente: 'na_sacola' }[p.resultado as string]!
    const pend = p.resultado === 'pendente'
    Object.assign(r, { resultado: p.resultado, resolvido_por: pend ? null : eu, resolvido_em: pend ? null : agora() })
    return log(r.sacola_id, r.peca_id, { ficou: 'marcou: ficou (vendida)', devolveu: 'marcou: devolveu', pendente: 'desfez a marcação' }[p.resultado as string]!)
  }
  if (t === 'sacola_itens') return
  falha('permission denied for table ' + t, '42501')
}

function apagar(t: string, r: Row) {
  if (t !== 'sacola_itens') falha('permission denied for table ' + t, '42501')
  if (sacola(r.sacola_id)?.status === 'fechada' || r.resultado !== 'pendente')
    falha('Só dá para tirar da sacola uma peça que ainda está pendente.')
  peca(r.peca_id).status = 'estoque'
  db.sacola_itens.splice(db.sacola_itens.indexOf(r), 1)
  log(r.sacola_id, r.peca_id, 'tirou a peça da sacola')
}

// ---------- consulta (imita o encadeamento do supabase-js) ----------
class Consulta implements PromiseLike<{ data: unknown; error: Err | null }> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row = {}
  private filtros: ((r: Row) => boolean)[] = []
  private ordem: [string, boolean][] = []
  private max = Infinity
  private um = false
  constructor(private t: string) {}
  select() { return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: unknown) { this.filtros.push(r => r[c] === v); return this }
  gte(c: string, v: string) { this.filtros.push(r => r[c] != null && r[c] >= v); return this }
  or(expr: string) {
    const regras = expr.split(',').map(x => { const [c, , ...t] = x.split('.'); return { c, t: t.join('.').replace(/\*/g, '').toLowerCase() } })
    this.filtros.push(r => regras.some(g => String(r[g.c] ?? '').toLowerCase().includes(g.t)))
    return this
  }
  order(c: string, o?: { ascending?: boolean }) { this.ordem.push([c, o?.ascending !== false]); return this }
  limit(n: number) { this.max = n; return this }
  single() { this.um = true; return this }
  then<A = { data: unknown; error: Err | null }, B = never>(
    ok?: ((v: { data: unknown; error: Err | null }) => A | PromiseLike<A>) | null,
    no?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => this.rodar()).then(ok, no)
  }
  private rodar(): { data: unknown; error: Err | null } {
    try {
      const fonte = this.t === 'sacolas_resumo' ? resumo() : db[this.t]
      if (!fonte) falha('tabela desconhecida', '42P01')
      let linhas: Row[]
      if (this.op === 'insert') linhas = [inserir(this.t, this.payload)]
      else {
        linhas = fonte.filter(r => this.filtros.every(f => f(r)))
        if (this.op === 'update') linhas.forEach(r => atualizar(this.t, r, this.payload))
        if (this.op === 'delete') linhas.forEach(r => apagar(this.t, r))
      }
      if (this.op !== 'select') salva()
      linhas = linhas.map(r => this.t === 'sacola_itens' ? { ...r, pecas: peca(r.peca_id) }
        : this.t === 'historico' ? { ...r, pecas: r.peca_id ? peca(r.peca_id) : null } : { ...r })
      for (const [c, asc] of [...this.ordem].reverse())
        linhas.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1))
      linhas = linhas.slice(0, this.max)
      if (this.um) return linhas[0] ? { data: linhas[0], error: null } : { data: null, error: { message: 'Registro não encontrado.', code: 'PGRST116' } }
      return { data: linhas, error: null }
    } catch (e) { return { data: null, error: e as Err } }
  }
}

// ---------- dados de exemplo (criados pelas mesmas regras) ----------
const PERFIS = [{ id: 'd1', nome: 'Dona Rosa', papel: 'dona', ativo: true }, { id: 'f1', nome: 'Ana', papel: 'funcionaria', ativo: true },
  { id: 'f2', nome: 'Bia', papel: 'funcionaria', ativo: true }]

function zera(comExemplo: boolean) {
  for (const k of Object.keys(db)) db[k] = []
  db.profiles.push(...PERFIS.map(p => ({ ...p })))
  eu = 'f1'
  if (comExemplo) semear()
  eu = 'd1'
}

function semear() {
  const cli = (nome: string, telefone: string | null, observacao: string | null = null) => inserir('clientes', { nome, telefone, observacao }).id as string
  const maria = cli('Maria Souza', '11999990000', 'Gosta de vestidos midi'), joana = cli('Joana Pereira', '11988887777'), carla = cli('Carla Lima', null)
  const mk = (n: number, d: string, tam: string, cor: string, preco: number, forn: string | null = null, custo: number | null = null) => {
    const r = inserir('pecas', { codigo: 'P' + String(n).padStart(4, '0'), descricao: d, tamanho: tam, cor, preco, fornecedor: forn, custo, foto_url: null })
    r.criado_em = new Date(Date.now() - (n > 8 ? 45 : 5) * 864e5).toISOString(); return r.id as string
  }
  const p = [mk(1, 'Vestido midi floral', 'M', 'Azul', 129.9), mk(2, 'Blusa de seda', 'P', 'Off-white', 89.9, 'Ateliê Flor', 40), mk(3, 'Calça alfaiataria', '38', 'Preta', 159),
    mk(4, 'Saia plissada', 'M', 'Vinho', 99.9), mk(5, 'Cardigan tricô', 'G', 'Bege', 139, 'Ateliê Flor', 70), mk(6, 'Vestido longo', 'M', 'Verde', 219),
    mk(7, 'Blazer linho', 'M', 'Areia', 189), mk(8, 'Camisa listrada', 'P', 'Azul', 79.9), mk(9, 'Short jeans', '40', 'Jeans', 69.9), mk(10, 'Bolsa palha', 'U', 'Natural', 119)]
  const monta = (cliente: string, pecas: string[]) => {
    const s = inserir('sacolas', { cliente_id: cliente }).id as string
    return { s, itens: pecas.map(x => inserir('sacola_itens', { sacola_id: s, peca_id: x }).id as string) }
  }
  const marca = (item: string, resultado: string) => atualizar('sacola_itens', db.sacola_itens.find(i => i.id === item)!, { resultado })
  eu = 'f2'
  const a = monta(maria, [p[0], p[1], p[2]]); marca(a.itens[0], 'ficou'); marca(a.itens[2], 'devolveu')
  atualizar('sacolas', sacola(a.s)!, { prazo: dia(2) }); inserir('pagamentos', { sacola_id: a.s, valor: 50, forma: 'pix' })
  eu = 'f1'
  const b = monta(joana, [p[3], p[6]]); marca(b.itens[0], 'ficou'); atualizar('sacolas', sacola(b.s)!, { prazo: dia(-2) })
  const c = monta(carla, [p[4], p[5]]); marca(c.itens[0], 'ficou'); marca(c.itens[1], 'devolveu')
  atualizar('sacolas', sacola(c.s)!, { status: 'fechada' }); inserir('pagamentos', { sacola_id: c.s, valor: 100, forma: 'dinheiro' })
}

// ---------- cliente de mentira, com a mesma cara do supabase-js ----------
export function criaDemo() {
  if (!carrega()) zera(false)
  const ouvintes = new Set<(e: string, s: typeof sessao) => void>()
  const avisa = (e: string) => ouvintes.forEach(f => f(e, sessao))
  return {
    from: (t: string) => new Consulta(t),
    auth: {
      getSession: async () => ({ data: { session: sessao } }),
      onAuthStateChange: (f: (e: string, s: typeof sessao) => void) => { ouvintes.add(f); return { data: { subscription: { unsubscribe: () => ouvintes.delete(f) } } } },
      signOut: async () => { sessao = null; salva(); avisa('SIGNED_OUT'); return { error: null } },
    },
    // fotos viram texto (data URL) para ficarem guardadas no aparelho
    storage: { from: () => ({
      upload: async (nome: string, blob: Blob) => {
        const url = await new Promise<string>(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob) })
        try { localStorage.setItem(CHAVE + ':foto:' + nome, url) } catch { /* sem espaço */ }
        return { error: null }
      },
      getPublicUrl: (nome: string) => ({ data: { publicUrl: localStorage.getItem(CHAVE + ':foto:' + nome) ?? '' } }),
    }) },
    /** Botões da tela de entrada do modo teste. */
    entrarTeste(modo: 'exemplo' | 'vazio' | 'continuar') {
      if (modo !== 'continuar') zera(modo === 'exemplo')
      eu = 'd1'; sessao = { user: { id: eu } }; salva(); avisa('SIGNED_IN')
    },
    temDados: () => db.pecas.length + db.clientes.length + db.sacolas.length > 0,
  }
}
