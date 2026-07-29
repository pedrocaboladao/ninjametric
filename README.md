# Painel de Vendas — 4 lojas Mercado Livre

Reconstrução do painel interno de gestão das lojas Hangar, Catedral Impermeabilizantes,
Inga Collors e Perpétua. V1 cobre apenas o módulo **Dashboard de vendas** (ver
`spec-painel-vendas.md` para o escopo completo dos 3 módulos).

## Estrutura

- `backend/` — Node.js + TypeScript + Express, fala com a API do Mercado Livre e o Postgres
- `frontend/` — React + Vite, painel único com os módulos como seções

## Pré-requisitos

- Node.js (já instalado nesta máquina)
- PostgreSQL rodando localmente
- 1 aplicação registrada em https://developers.mercadolivre.com.br/ (Client ID e Secret)

## Passo a passo

### 1. Banco de dados

Crie o banco `painel_vendas` no Postgres local (via pgAdmin ou `psql`):

```sql
CREATE DATABASE painel_vendas;
```

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Edite `.env` preenchendo `DATABASE_URL` (usuário/senha do seu Postgres),
`ML_CLIENT_ID` e `ML_CLIENT_SECRET` do app registrado no Mercado Livre.

```bash
npm install
npm run migrate   # cria as tabelas
npm run seed      # insere as 4 lojas (Hangar, Catedral, Inga Collors, Perpétua)
npm run dev       # sobe o backend em http://localhost:4000
```

### 3. Autorizar as 4 contas do Mercado Livre

Para cada loja, abra no navegador (troque `:lojaId` pelo id da loja — 1 a 4, na
ordem em que foram inseridas pelo seed):

```
http://localhost:4000/auth/1/authorize
http://localhost:4000/auth/2/authorize
http://localhost:4000/auth/3/authorize
http://localhost:4000/auth/4/authorize
```

Faça login com a conta do Mercado Livre correspondente e autorize o app. O
callback salva `access_token`/`refresh_token` no banco automaticamente.

### 4. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Acesse o endereço que o Vite mostrar no terminal (por padrão `http://localhost:5173`).

## Status atual

- ✅ Módulo 1 — Dashboard de vendas (faturamento do dia, ranking por loja,
  vendas por hora, produtos mais vendidos, filtro por loja)
- ✅ Módulo 2 — Perguntas (listar, responder e excluir, agrupado por loja)
- ✅ Módulo 3 — Clonar Anúncio (wizard de 3 passos: link, título, confirmação)

O dashboard e as perguntas buscam os dados diretamente da API do Mercado Livre
a cada requisição (sem persistir em `pedidos`/`itens_pedido`/`perguntas`) — o
frontend faz polling a cada 2 minutos.

## Deploy em produção

Ver [DEPLOY.md](DEPLOY.md) para colocar o sistema no ar num VPS com Docker
(Postgres + backend + frontend) e Nginx/HTTPS.
