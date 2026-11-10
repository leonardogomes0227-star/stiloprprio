// Roda supabase/schema.sql num Postgres em memória (PGlite) com stubs do Supabase
// (roles anon/authenticated, auth.users, auth.uid(), storage) e prova as regras.
//   npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant all on all tables in schema storage to anon, authenticated;
`)

// usuários criados ANTES do schema: testa o backfill (o mais antigo vira dona)
await db.exec(`insert into auth.users (id,email,created_at) values
  ('00000000-0000-0000-0000-00000000000a','dona@loja.com', now() - interval '2 day'),
  ('00000000-0000-0000-0000-00000000000b','ana@loja.com',  now() - interval '1 day')`)

await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))

// usuário criado DEPOIS do schema: testa o trigger em auth.users
await db.exec(`insert into auth.users (id,email,raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c','bia@loja.com','{"nome":"Bia"}')`)

const DONA = '00000000-0000-0000-0000-00000000000a'
const ANA = '00000000-0000-0000-0000-00000000000b'
const BIA = '00000000-0000-0000-0000-00000000000c'

// executa como um usuário logado (role authenticated) ou anônimo
async function como(uid, sql, params = []) {
  await db.exec(uid ? `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`
                    : `set role anon; select set_config('request.jwt.claim.sub','',false)`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}
async function erro(uid, sql, params, trecho) {
  try { await como(uid, sql, params) } catch (e) {
    assert.ok(e.message.includes(trecho), `esperava "${trecho}" mas veio "${e.message}"`)
    return
  }
  assert.fail(`deveria ter dado erro com "${trecho}": ${sql}`)
}
const raiz = async (sql, p) => (await db.query(sql, p)).rows
const um = async (uid, sql, p) => (await como(uid, sql, p))[0]
const statusPeca = async (id) => (await raiz('select status from pecas where id=$1', [id]))[0].status

let n = 0
const t = async (nome, fn) => { await fn(); console.log(`  ok ${++n}. ${nome}`) }

console.log('Testando schema.sql ...')

await t('papéis: primeiro (mais antigo) = dona, os outros = funcionária; trigger de novo usuário', async () => {
  const p = Object.fromEntries((await raiz('select id,nome,papel from profiles')).map(r => [r.id, r]))
  assert.equal(p[DONA].papel, 'dona')
  assert.equal(p[ANA].papel, 'funcionaria')
  assert.equal(p[BIA].papel, 'funcionaria')
  assert.equal(p[BIA].nome, 'Bia')
  assert.equal(p[ANA].nome, 'ana')
})

await t('anônimo não lê nada (tabelas e view)', async () => {
  await erro(null, 'select * from pecas', [], 'permission denied')
  await erro(null, 'select * from sacolas_resumo', [], 'permission denied')
})

// ---- dados base
const cli = (await como(ANA, `insert into clientes (nome, telefone) values ('Maria Souza','11999990000') returning id`))[0].id
const mk = async (cod, preco, forn = null, custo = null) =>
  (await como(ANA, `insert into pecas (codigo, descricao, preco, fornecedor, custo, status) values ($1,'Vestido',$2,$3,$4,'vendida') returning id, codigo, status`,
    [cod, preco, forn, custo]))[0]

let p1, p2, p3
await t('peça nasce em estoque (mesmo que o app mande outro status) e código vira maiúsculo', async () => {
  p1 = await mk('p0001', 100)
  assert.equal(p1.codigo, 'P0001'); assert.equal(p1.status, 'estoque')
  p2 = await mk('P0002', 50.5, 'Fornecedora X', 20)
  p3 = await mk('P0003', 70)
})
await t('código duplicado é bloqueado (sem diferenciar maiúscula)', async () => {
  await erro(ANA, `insert into pecas (codigo, preco) values ('p0001', 1)`, [], 'duplicate key')
})

let s1, s2
await t('criar sacola registra no histórico com o usuário certo', async () => {
  s1 = (await como(ANA, 'insert into sacolas (cliente_id) values ($1) returning id, prazo, status', [cli]))[0]
  s2 = (await como(BIA, 'insert into sacolas (cliente_id) values ($1) returning id', [cli]))[0]
  const h = await raiz(`select usuario_id, acao from historico where sacola_id=$1`, [s1.id])
  assert.deepEqual(h.map(x => [x.usuario_id, x.acao]), [[ANA, 'criou a sacola']])
  const esperado = (await raiz(`select ((now() at time zone 'America/Sao_Paulo')::date + 3)::text d`))[0].d
  assert.equal(String(s1.prazo.toISOString?.().slice(0, 10) ?? s1.prazo), esperado)
})

let i1
await t('peça entra na sacola => na_sacola; preço de saída vem da peça', async () => {
  i1 = (await como(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2) returning *', [s1.id, p1.id]))[0]
  assert.equal(await statusPeca(p1.id), 'na_sacola')
  assert.equal(Number(i1.preco_saida), 100)
  assert.equal(i1.resultado, 'pendente')
})
await t('a mesma peça NÃO entra em duas sacolas', async () => {
  await erro(BIA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2)', [s2.id, p1.id], 'Essa peça não está disponível no estoque')
  await erro(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2)', [s1.id, p1.id], 'Essa peça não está disponível no estoque')
})
await t('tirar item pendente devolve a peça ao estoque e registra', async () => {
  await como(ANA, 'delete from sacola_itens where id=$1', [i1.id])
  assert.equal(await statusPeca(p1.id), 'estoque')
  const h = await raiz(`select acao from historico where sacola_id=$1 and peca_id=$2 order by criado_em, id`, [s1.id, p1.id])
  assert.deepEqual(h.map(x => x.acao), ['colocou a peça na sacola', 'tirou a peça da sacola'])
})

let a, b
await t('monta sacola com 2 peças', async () => {
  a = (await como(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2) returning id', [s1.id, p1.id]))[0].id
  b = (await como(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2) returning id', [s1.id, p2.id]))[0].id
})
await t('NÃO fecha sacola com item pendente', async () => {
  await erro(ANA, `update sacolas set status='fechada' where id=$1`, [s1.id], 'Ainda tem peça pendente nessa sacola. Marque ficou ou devolveu em todas.')
  assert.equal((await raiz('select status from sacolas where id=$1', [s1.id]))[0].status, 'aberta')
})
await t('trg_checa_fechamento dispara antes de trg_sacola_upd', async () => {
  const r = await raiz(`select tgname from pg_trigger where tgrelid='sacolas'::regclass and not tgisinternal
                        and (tgtype & 2) = 2 and (tgtype & 16) = 16 order by tgname`)
  assert.deepEqual(r.map(x => x.tgname), ['trg_checa_fechamento', 'trg_sacola_upd'])
})
await t('ficou => peça vendida, com quem marcou (outra pessoa) e quando', async () => {
  const r = await um(BIA, `update sacola_itens set resultado='ficou' where id=$1 returning resolvido_por, resolvido_em`, [a])
  assert.equal(r.resolvido_por, BIA); assert.ok(r.resolvido_em)
  assert.equal(await statusPeca(p1.id), 'vendida')
})
await t('devolveu => peça volta ao estoque', async () => {
  await como(ANA, `update sacola_itens set resultado='devolveu' where id=$1`, [b])
  assert.equal(await statusPeca(p2.id), 'estoque')
})
await t('desfazer (pendente) => na_sacola e limpa resolvido_por/em', async () => {
  const r = await um(ANA, `update sacola_itens set resultado='pendente' where id=$1 returning resolvido_por, resolvido_em`, [b])
  assert.equal(r.resolvido_por, null); assert.equal(r.resolvido_em, null)
  assert.equal(await statusPeca(p2.id), 'na_sacola')
})
await t('desfazer "devolveu" não vale se a peça já foi para outra sacola', async () => {
  await como(ANA, `update sacola_itens set resultado='devolveu' where id=$1`, [b])
  await como(BIA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2)', [s2.id, p2.id])
  await erro(ANA, `update sacola_itens set resultado='pendente' where id=$1`, [b], 'A situação dessa peça mudou')
  // limpa: tira da sacola 2 e volta o estado
  await como(BIA, `delete from sacola_itens where sacola_id=$1 and peca_id=$2`, [s2.id, p2.id])
  await como(ANA, `update sacola_itens set resultado='pendente' where id=$1`, [b])
  await como(ANA, `update sacola_itens set resultado='devolveu' where id=$1`, [b])
})
await t('item resolvido não pode ser apagado; não troca de sacola', async () => {
  await erro(ANA, 'delete from sacola_itens where id=$1', [a], 'Só dá para tirar da sacola uma peça que ainda está pendente')
  await erro(ANA, 'update sacola_itens set sacola_id=$2 where id=$1', [a, s2.id], 'Não dá para trocar a peça de sacola')
})
await t('fecha sacola quando tudo resolvido; guarda quem fechou', async () => {
  const r = await um(BIA, `update sacolas set status='fechada' where id=$1 returning fechada_por, fechada_em`, [s1.id])
  assert.equal(r.fechada_por, BIA); assert.ok(r.fechada_em)
})
await t('sacola fechada não aceita peça nem mudança de resultado', async () => {
  await erro(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2)', [s1.id, p3.id], 'sacola está fechada')
  await erro(ANA, `update sacola_itens set resultado='devolveu' where id=$1`, [a], 'sacola está fechada')
})
await t('funcionária NÃO reabre sacola; dona reabre', async () => {
  await erro(ANA, `update sacolas set status='aberta' where id=$1`, [s1.id], 'Só a dona pode reabrir')
  const r = await um(DONA, `update sacolas set status='aberta' where id=$1 returning fechada_por`, [s1.id])
  assert.equal(r.fechada_por, null)
  await como(DONA, `update sacolas set status='fechada' where id=$1`, [s1.id])
})

await t('pagamento: valor > 0, histórico com usuário, view soma tudo', async () => {
  await erro(ANA, `insert into pagamentos (sacola_id, valor, forma) values ($1, 0, 'pix')`, [s1.id], 'check constraint')
  await erro(ANA, `insert into pagamentos (sacola_id, valor, forma) values ($1, 10, 'fiado')`, [s1.id], 'check constraint')
  await como(BIA, `insert into pagamentos (sacola_id, valor, forma) values ($1, 40.25, 'pix')`, [s1.id])
  const r = await um(ANA, 'select * from sacolas_resumo where id=$1', [s1.id])
  assert.equal(r.total_itens, 2); assert.equal(r.itens_pendentes, 0)
  assert.equal(Number(r.valor_total), 150.5); assert.equal(Number(r.valor_ficou), 100)
  assert.equal(Number(r.valor_pago), 40.25); assert.equal(r.atrasada, false) // fechada nunca é atrasada
  const h = (await raiz(`select usuario_id, acao from historico where sacola_id=$1 and acao like 'registrou%'`, [s1.id]))[0]
  assert.deepEqual([h.usuario_id, h.acao], [BIA, 'registrou pagamento de R$ 40,25 (pix)'])
})
await t('atrasada: aberta com prazo no passado', async () => {
  await como(ANA, `update sacolas set prazo = (now() at time zone 'America/Sao_Paulo')::date - 1 where id=$1`, [s2.id])
  assert.equal((await um(ANA, 'select atrasada, itens_pendentes from sacolas_resumo where id=$1', [s2.id])).atrasada, true)
})

await t('histórico: só leitura (nem inserir, nem editar, nem apagar pelo app)', async () => {
  await erro(ANA, `insert into historico (acao) values ('x')`, [], 'permission denied')
  await erro(DONA, `update historico set acao='x'`, [], 'permission denied')
  await erro(DONA, `delete from historico`, [], 'permission denied')
})
await t('histórico guarda o usuário certo em cada ação', async () => {
  const h = await raiz(`select u.nome, h.acao from historico h join profiles u on u.id=h.usuario_id
                        where h.sacola_id=$1 order by h.criado_em, h.id`, [s1.id])
  const acoes = Object.fromEntries(h.map(x => [x.acao, x.nome]))
  assert.equal(acoes['criou a sacola'], 'ana')
  assert.equal(acoes['marcou: ficou (vendida)'], 'Bia')   // Bia marcou
  assert.equal(acoes['marcou: devolveu'], 'ana')
  const fechos = h.filter(x => x.acao === 'fechou a sacola').map(x => x.nome)
  assert.deepEqual(fechos, ['Bia', 'dona'])   // Bia fechou; a dona reabriu e fechou de novo
  assert.equal(acoes['reabriu a sacola'], 'dona')
})

await t('status da peça não é editável direto; baixa e retorno à estoque', async () => {
  await erro(ANA, `update pecas set status='vendida' where id=$1`, [p3.id], 'O status da peça muda pela sacola')
  await como(ANA, `update pecas set status='baixada' where id=$1`, [p3.id])
  assert.equal(await statusPeca(p3.id), 'baixada')
  await erro(ANA, `update pecas set status='estoque' where id=$1`, [p3.id], 'Só a dona pode devolver')
  await como(DONA, `update pecas set status='estoque' where id=$1`, [p3.id])
  assert.equal(await statusPeca(p3.id), 'estoque')
  await erro(ANA, `update pecas set status='baixada' where id=$1`, [p1.id], 'O status da peça muda pela sacola') // p1 está vendida
})

await t('apagar peça/cliente/sacola: só a dona (RLS) — e só se não estiver em uso', async () => {
  const p4 = await mk('P0004', 10)
  assert.equal((await como(ANA, 'delete from pecas where id=$1 returning id', [p4.id])).length, 0)
  assert.equal((await como(DONA, 'delete from pecas where id=$1 returning id', [p4.id])).length, 1)
  assert.equal((await como(ANA, 'delete from clientes where id=$1 returning id', [cli])).length, 0)
  await erro(DONA, 'delete from clientes where id=$1', [cli], 'violates foreign key')
  await erro(DONA, 'delete from pecas where id=$1', [p1.id], 'violates foreign key')
  assert.equal((await como(BIA, 'delete from sacolas where id=$1 returning id', [s2.id])).length, 0)
  await erro(DONA, 'delete from sacolas where id=$1', [s1.id], 'violates foreign key') // tem pagamento
})
await t('dona apaga sacola sem pagamento: peças pendentes voltam ao estoque', async () => {
  const s3 = (await como(ANA, 'insert into sacolas (cliente_id) values ($1) returning id', [cli]))[0].id
  await como(ANA, 'insert into sacola_itens (sacola_id, peca_id) values ($1,$2)', [s3, p3.id])
  assert.equal(await statusPeca(p3.id), 'na_sacola')
  await como(DONA, 'delete from sacolas where id=$1', [s3])
  assert.equal(await statusPeca(p3.id), 'estoque')
  assert.equal((await raiz(`select count(*)::int c from historico where acao like 'apagou a sacola de Maria%'`))[0].c, 1)
})

await t('usuário desativado perde o acesso', async () => {
  await db.exec(`update profiles set ativo=false where id='${BIA}'`)
  assert.equal((await como(BIA, 'select * from pecas')).length, 0)
  await erro(BIA, `insert into clientes (nome) values ('x')`, [], 'row-level security')
  await db.exec(`update profiles set ativo=true where id='${BIA}'`)
})
await t('perfis: equipe lê, só a dona altera', async () => {
  assert.equal((await como(ANA, 'select * from profiles')).length, 3)
  assert.equal((await como(ANA, `update profiles set papel='dona' where id=$1 returning id`, [ANA])).length, 0)
  assert.equal((await como(DONA, `update profiles set nome='Ana Paula' where id=$1 returning id`, [ANA])).length, 1)
})
await t('storage: só equipe envia foto; leitura pública', async () => {
  await como(ANA, `insert into storage.objects (bucket_id, name) values ('pecas','a.jpg')`)
  await erro(null, `insert into storage.objects (bucket_id, name) values ('pecas','b.jpg')`, [], 'row-level security')
  await erro(ANA, `insert into storage.objects (bucket_id, name) values ('outro','b.jpg')`, [], 'row-level security')
  assert.equal((await como(null, `select * from storage.objects where bucket_id='pecas'`)).length, 1)
})

console.log(`\nTudo certo: ${n} verificações passaram.`)
await db.close()
