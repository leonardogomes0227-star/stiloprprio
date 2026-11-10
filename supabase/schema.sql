-- =====================================================================
-- CONDICIONAL — schema do banco (Supabase / Postgres)
-- Cole tudo no SQL Editor do Supabase e rode UMA vez.
-- =====================================================================

-- ---------- Tabelas --------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  papel text not null default 'funcionaria' check (papel in ('dona','funcionaria')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  telefone text,
  observacao text,
  criado_por uuid default auth.uid() references profiles(id),
  criado_em timestamptz not null default now()
);

create table pecas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descricao text not null default '',
  tamanho text,
  cor text,
  preco numeric(10,2) not null check (preco >= 0),
  custo numeric(10,2) check (custo >= 0),
  fornecedor text,                       -- vazio = peça da loja; preenchido = consignada
  foto_url text,
  status text not null default 'estoque' check (status in ('estoque','na_sacola','vendida','baixada')),
  criado_por uuid default auth.uid() references profiles(id),
  criado_em timestamptz not null default now()
);

create table sacolas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  status text not null default 'aberta' check (status in ('aberta','fechada')),
  -- "hoje" no horário de Brasília, não no do servidor
  prazo date not null default (((now() at time zone 'America/Sao_Paulo')::date) + 3),
  observacao text,
  criada_por uuid default auth.uid() references profiles(id),
  criada_em timestamptz not null default now(),
  fechada_por uuid references profiles(id),
  fechada_em timestamptz
);

create table sacola_itens (
  id uuid primary key default gen_random_uuid(),
  sacola_id uuid not null references sacolas(id) on delete cascade,
  peca_id uuid not null references pecas(id),
  preco_saida numeric(10,2) not null check (preco_saida >= 0),
  resultado text not null default 'pendente' check (resultado in ('pendente','ficou','devolveu')),
  resolvido_por uuid references profiles(id),
  resolvido_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (sacola_id, peca_id)
);

create table pagamentos (
  id uuid primary key default gen_random_uuid(),
  sacola_id uuid not null references sacolas(id),
  valor numeric(10,2) not null check (valor > 0),
  forma text not null check (forma in ('pix','dinheiro','cartao')),
  criado_por uuid default auth.uid() references profiles(id),
  criado_em timestamptz not null default now()
);

create table historico (
  id uuid primary key default gen_random_uuid(),
  sacola_id uuid references sacolas(id) on delete set null,
  peca_id uuid references pecas(id) on delete set null,
  acao text not null,
  usuario_id uuid default auth.uid() references profiles(id),
  criado_em timestamptz not null default now()
);

create index on sacolas (cliente_id);
create index on sacolas (status, prazo);
create index on sacola_itens (sacola_id);
create index on sacola_itens (peca_id);
create index on sacola_itens (resultado, resolvido_em);
create index on pagamentos (sacola_id);
create index on historico (sacola_id, criado_em);
create index on pecas (status);

-- ---------- Funções de permissão ------------------------------------

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and ativo)
$$;

create function is_dona() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and ativo and papel = 'dona')
$$;

-- ---------- Perfil automático (o primeiro usuário vira dona) --------

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nome, papel)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from profiles) then 'funcionaria' else 'dona' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Regras: peças -------------------------------------------

create function fn_peca() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.codigo := upper(trim(new.codigo));
  if tg_op = 'INSERT' then
    new.status := 'estoque';
    return new;
  end if;
  -- Mudança de status feita direto pelo app (não por outro trigger):
  -- só vale dar baixa (estoque -> baixada) e a dona devolver ao estoque.
  if new.status is distinct from old.status and pg_trigger_depth() = 1 then
    if old.status = 'estoque' and new.status = 'baixada' then
      insert into historico (peca_id, acao) values (new.id, 'deu baixa na peça (perdida/danificada)');
    elsif old.status = 'baixada' and new.status = 'estoque' then
      if not is_dona() then
        raise exception 'Só a dona pode devolver uma peça baixada ao estoque.';
      end if;
      insert into historico (peca_id, acao) values (new.id, 'devolveu a peça baixada ao estoque');
    else
      raise exception 'O status da peça muda pela sacola. Aqui só dá para dar baixa.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_peca before insert or update on pecas
  for each row execute function fn_peca();

-- ---------- Regras: sacolas -----------------------------------------

-- 5 e 6: o check de fechamento roda ANTES do log (ordem alfabética dos nomes)
create function fn_checa_fechamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'fechada' and old.status = 'aberta'
     and exists (select 1 from sacola_itens where sacola_id = new.id and resultado = 'pendente') then
    raise exception 'Ainda tem peça pendente nessa sacola. Marque ficou ou devolveu em todas.';
  end if;
  return new;
end $$;

create trigger trg_checa_fechamento before update on sacolas
  for each row execute function fn_checa_fechamento();

create function fn_sacola_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'fechada' and old.status = 'aberta' then
    new.fechada_por := auth.uid();
    new.fechada_em := now();
    insert into historico (sacola_id, acao) values (new.id, 'fechou a sacola');
  elsif new.status = 'aberta' and old.status = 'fechada' then
    if not is_dona() then
      raise exception 'Só a dona pode reabrir uma sacola.';
    end if;
    new.fechada_por := null;
    new.fechada_em := null;
    insert into historico (sacola_id, acao) values (new.id, 'reabriu a sacola');
  end if;
  return new;
end $$;

create trigger trg_sacola_upd before update on sacolas
  for each row execute function fn_sacola_upd();

create function fn_sacola_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historico (sacola_id, acao) values (new.id, 'criou a sacola');
  return new;
end $$;

create trigger trg_sacola_ins after insert on sacolas
  for each row execute function fn_sacola_ins();

create function fn_sacola_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historico (acao)
  values ('apagou a sacola de ' || coalesce((select nome from clientes where id = old.cliente_id), '?'));
  return old;
end $$;

create trigger trg_sacola_del before delete on sacolas
  for each row execute function fn_sacola_del();

-- ---------- Regras: itens da sacola ---------------------------------

-- 1. inserir item: só peça em estoque; vira 'na_sacola'
create function fn_item_ins() returns trigger
language plpgsql security definer set search_path = public as $$
declare p pecas%rowtype; st text;
begin
  select status into st from sacolas where id = new.sacola_id;
  if st is distinct from 'aberta' then
    raise exception 'Essa sacola está fechada. Peça para a dona reabrir.';
  end if;
  select * into p from pecas where id = new.peca_id for update;   -- trava: duas pessoas ao mesmo tempo
  if p.status is distinct from 'estoque' then
    raise exception 'Essa peça não está disponível no estoque';
  end if;
  update pecas set status = 'na_sacola' where id = p.id;
  new.preco_saida := coalesce(new.preco_saida, p.preco);
  new.resultado := 'pendente';
  new.resolvido_por := null;
  new.resolvido_em := null;
  insert into historico (sacola_id, peca_id, acao) values (new.sacola_id, new.peca_id, 'colocou a peça na sacola');
  return new;
end $$;

create trigger trg_item_ins before insert on sacola_itens
  for each row execute function fn_item_ins();

-- 2. apagar item pendente: peça volta ao estoque
create function fn_item_del() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from sacolas where id = old.sacola_id;
  if st is null then            -- a sacola inteira está sendo apagada (só a dona consegue)
    update pecas set status = 'estoque' where id = old.peca_id and status = 'na_sacola';
    return old;
  end if;
  if st = 'fechada' or old.resultado <> 'pendente' then
    raise exception 'Só dá para tirar da sacola uma peça que ainda está pendente.';
  end if;
  update pecas set status = 'estoque' where id = old.peca_id and status = 'na_sacola';
  insert into historico (sacola_id, peca_id, acao) values (old.sacola_id, old.peca_id, 'tirou a peça da sacola');
  return old;
end $$;

create trigger trg_item_del before delete on sacola_itens
  for each row execute function fn_item_del();

-- 3. mudar resultado: ficou => vendida, devolveu => estoque, pendente => na_sacola
create function fn_item_upd() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; pst text; esperado text;
begin
  if new.sacola_id <> old.sacola_id or new.peca_id <> old.peca_id then
    raise exception 'Não dá para trocar a peça de sacola.';
  end if;
  if new.resultado = old.resultado then
    new.resolvido_por := old.resolvido_por;
    new.resolvido_em := old.resolvido_em;
    return new;
  end if;
  select status into st from sacolas where id = new.sacola_id;
  if st is distinct from 'aberta' then
    raise exception 'Essa sacola está fechada. Peça para a dona reabrir.';
  end if;
  select status into pst from pecas where id = new.peca_id for update;
  esperado := case old.resultado when 'pendente' then 'na_sacola' when 'ficou' then 'vendida' else 'estoque' end;
  if pst is distinct from esperado then
    raise exception 'A situação dessa peça mudou (talvez já esteja em outra sacola). Atualize a tela.';
  end if;
  update pecas set status = case new.resultado
      when 'ficou' then 'vendida' when 'devolveu' then 'estoque' else 'na_sacola' end
    where id = new.peca_id;
  if new.resultado = 'pendente' then
    new.resolvido_por := null;
    new.resolvido_em := null;
  else
    new.resolvido_por := auth.uid();
    new.resolvido_em := now();
  end if;
  insert into historico (sacola_id, peca_id, acao) values (new.sacola_id, new.peca_id,
    case new.resultado when 'ficou' then 'marcou: ficou (vendida)'
                       when 'devolveu' then 'marcou: devolveu'
                       else 'desfez a marcação' end);
  return new;
end $$;

create trigger trg_item_upd before update on sacola_itens
  for each row execute function fn_item_upd();

-- ---------- Regras: pagamentos --------------------------------------

create function fn_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; v_old text;
begin
  v := replace(to_char(new.valor, 'FM999999990.00'), '.', ',');
  if tg_op = 'INSERT' then
    insert into historico (sacola_id, acao)
    values (new.sacola_id, 'registrou pagamento de R$ ' || v || ' (' || new.forma || ')');
  elsif new.valor <> old.valor or new.forma <> old.forma then
    v_old := replace(to_char(old.valor, 'FM999999990.00'), '.', ',');
    insert into historico (sacola_id, acao)
    values (new.sacola_id, 'corrigiu pagamento de R$ ' || v_old || ' (' || old.forma || ') para R$ ' || v || ' (' || new.forma || ')');
  end if;
  return new;
end $$;

create trigger trg_pagamento after insert or update on pagamentos
  for each row execute function fn_pagamento();

-- ---------- Resumo por sacola ---------------------------------------

create view sacolas_resumo with (security_invoker = true) as
select
  s.id, s.cliente_id, s.status, s.prazo, s.criada_por, s.criada_em, s.fechada_em,
  (select count(*) from sacola_itens i where i.sacola_id = s.id)::int as total_itens,
  (select count(*) from sacola_itens i where i.sacola_id = s.id and i.resultado = 'pendente')::int as itens_pendentes,
  coalesce((select sum(i.preco_saida) from sacola_itens i where i.sacola_id = s.id), 0)::numeric(10,2) as valor_total,
  coalesce((select sum(i.preco_saida) from sacola_itens i where i.sacola_id = s.id and i.resultado = 'ficou'), 0)::numeric(10,2) as valor_ficou,
  coalesce((select sum(p.valor) from pagamentos p where p.sacola_id = s.id), 0)::numeric(10,2) as valor_pago,
  (s.status = 'aberta' and s.prazo < (now() at time zone 'America/Sao_Paulo')::date) as atrasada
from sacolas s;

-- ---------- RLS ------------------------------------------------------

alter table profiles     enable row level security;
alter table clientes     enable row level security;
alter table pecas        enable row level security;
alter table sacolas      enable row level security;
alter table sacola_itens enable row level security;
alter table pagamentos   enable row level security;
alter table historico    enable row level security;

-- perfis: equipe lê, só dona altera (criação é só pelo trigger)
create policy profiles_sel on profiles for select to authenticated using (is_staff());
create policy profiles_upd on profiles for update to authenticated using (is_dona()) with check (is_dona());

-- clientes
create policy clientes_sel on clientes for select to authenticated using (is_staff());
create policy clientes_ins on clientes for insert to authenticated with check (is_staff());
create policy clientes_upd on clientes for update to authenticated using (is_staff()) with check (is_staff());
create policy clientes_del on clientes for delete to authenticated using (is_dona());

-- peças
create policy pecas_sel on pecas for select to authenticated using (is_staff());
create policy pecas_ins on pecas for insert to authenticated with check (is_staff());
create policy pecas_upd on pecas for update to authenticated using (is_staff()) with check (is_staff());
create policy pecas_del on pecas for delete to authenticated using (is_dona());

-- sacolas
create policy sacolas_sel on sacolas for select to authenticated using (is_staff());
create policy sacolas_ins on sacolas for insert to authenticated with check (is_staff());
create policy sacolas_upd on sacolas for update to authenticated using (is_staff()) with check (is_staff());
create policy sacolas_del on sacolas for delete to authenticated using (is_dona());

-- itens (funcionária também pode tirar peça antes de a cliente sair)
create policy itens_sel on sacola_itens for select to authenticated using (is_staff());
create policy itens_ins on sacola_itens for insert to authenticated with check (is_staff());
create policy itens_upd on sacola_itens for update to authenticated using (is_staff()) with check (is_staff());
create policy itens_del on sacola_itens for delete to authenticated using (is_staff());

-- pagamentos (não se apaga; se errou, corrige o valor e fica no histórico)
create policy pagamentos_sel on pagamentos for select to authenticated using (is_staff());
create policy pagamentos_ins on pagamentos for insert to authenticated with check (is_staff());
create policy pagamentos_upd on pagamentos for update to authenticated using (is_staff()) with check (is_staff());

-- histórico: só leitura (quem escreve são os triggers)
create policy historico_sel on historico for select to authenticated using (is_staff());

-- Privilégios: ninguém anônimo; histórico sem escrita para o app
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on historico from authenticated;

-- ---------- Storage: fotos das peças --------------------------------

insert into storage.buckets (id, name, public) values ('pecas', 'pecas', true)
on conflict (id) do update set public = true;

create policy pecas_fotos_leitura on storage.objects for select using (bucket_id = 'pecas');
create policy pecas_fotos_envio on storage.objects for insert to authenticated
  with check (bucket_id = 'pecas' and is_staff());

-- ---------- Usuários que já existiam antes de rodar este script -----

insert into profiles (id, nome, papel)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'nome', ''), split_part(u.email, '@', 1)),
       case when row_number() over (order by u.created_at) = 1 and not exists (select 1 from profiles)
            then 'dona' else 'funcionaria' end
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);
