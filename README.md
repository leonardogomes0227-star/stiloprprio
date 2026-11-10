# Condicional

Sistema para a loja controlar as sacolas de **condicional**: quais peças estão com quem, o que foi devolvido, o que foi vendido, **quem anotou cada coisa** e quanto falta receber.

React + Vite + TypeScript, Supabase (Auth, Postgres com RLS e Storage), deploy na Vercel.

## Modo teste (sem Supabase)
O app escolhe sozinho onde guardar os dados:

- **Sem** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`: abre em **MODO TESTE**. A tela de entrada tem os botões *Entrar com dados de exemplo* e *Entrar vazio*, e uma faixa avisa "dados só neste aparelho". Tudo fica no `localStorage` do navegador (sobrevive a recarregar a página, mas não vai para outro aparelho). Entra como dona.
- **Com** as duas variáveis preenchidas: usa o Supabase de verdade (login com e-mail e senha), sem nenhuma mudança de código.

```bash
npm install
npm run dev
```

## Como colocar no ar

### 1. Criar o projeto no Supabase
1. Entre em [supabase.com](https://supabase.com), crie uma conta e clique em **New project** (guarde a senha do banco).
2. Quando o projeto terminar de criar, abra **Project Settings → API** e deixe essa tela aberta: você vai precisar da **Project URL** e da chave **anon public**.

### 2. Rodar o banco
1. No menu, abra **SQL Editor → New query**.
2. Copie **todo** o conteúdo de `supabase/schema.sql`, cole e clique em **Run**. Rode **uma vez só**.
3. Deve terminar com "Success". Isso cria as tabelas, as regras automáticas, as permissões e o bucket `pecas` das fotos.

### 3. Desligar o cadastro aberto
Em **Authentication → Sign In / Providers** (ou *Providers → Email*), desligue **Allow new users to sign up**. Assim só quem você criar consegue entrar.

### 4. Criar os usuários
Em **Authentication → Users → Add user → Create new user**, informe e-mail e senha e marque **Auto Confirm User**.

- **O primeiro usuário criado vira "dona"**; os demais viram "funcionária". Crie a dona primeiro.
- O nome que aparece no sistema (quem montou, quem marcou) começa como a parte do e-mail antes do `@`. Para trocar, abra **Table Editor → profiles** e edite a coluna `nome` (ex.: "Maria").
- Para desativar alguém, em `profiles` desmarque `ativo`. Não apague o usuário: o histórico fica ligado a ele.

### 5. Preencher o .env (para rodar no seu computador)
```bash
cp .env.example .env
```
Edite o `.env` com a Project URL e a chave **anon public**. **Nunca** use a chave `service_role` aqui.

```bash
npm install
npm run dev
```

### 6. Publicar na Vercel
1. Suba o projeto para o GitHub e, na [Vercel](https://vercel.com), **Add New → Project** e escolha o repositório (a Vercel detecta Vite sozinha).
2. Em **Environment Variables**, crie as duas variáveis:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Clique em **Deploy**. No celular, abra o endereço e use "Adicionar à tela inicial".

Se mudar as variáveis depois, é preciso fazer um novo deploy.

## Regras que o banco garante (mesmo se o app errar)
- Uma peça só entra em uma sacola por vez (e só se estiver no estoque).
- Não fecha sacola com peça pendente.
- *Ficou* marca a peça como vendida; *devolveu* devolve ao estoque; desfazer volta para a sacola.
- Tudo fica no histórico com o usuário que fez. O histórico não pode ser editado nem apagado pelo app.
- Apagar peça, cliente e sacola: só a dona (e só se não estiverem em uso). Só a dona reabre sacola fechada ou devolve ao estoque uma peça baixada.

## Testes
```bash
npm run test:db   # roda schema.sql num Postgres em memória e prova as regras acima
npm run build     # tsc + vite
```

## Limites conhecidos
- O campo **custo** só aparece para a dona na tela, mas o banco entrega a coluna a qualquer usuária logada (quem abrir o console do navegador consegue ler). Se isso importar, o custo precisa ir para uma tabela separada, só da dona.
- Não há botão para apagar peça, cliente ou sacola (as permissões já existem no banco; dá para apagar pelo Table Editor).

<!-- deploy de produção: 2026-11-10T14:21Z -->
