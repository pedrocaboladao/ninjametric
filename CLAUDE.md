# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal multi-store management panel ("Ninja Metrics" / "Impetrus Vision") for a group of paint/hardware stores that sell on Mercado Livre. Originally built for 4 stores, now managing 16+. Modules: Dashboard, Perguntas, Clonar Anúncio, Produtos, Financeiro, Gestão de Ads, Contas a pagar/receber, Tarefas, Funcionários, Usuários.

## Commands

Backend (`backend/`):
```bash
npm run dev       # tsx watch src/index.ts — dev server on :4000
npm run build     # tsc -p tsconfig.json + copies schema.sql into dist/db/
npm run migrate   # tsx src/db/migrate.ts — applies schema.sql (idempotent, safe to rerun)
npm run seed      # tsx src/db/seed.ts — inserts default lojas if missing
npm run start     # node dist/index.js — prod
```

Frontend (`frontend/`):
```bash
npm run dev       # vite dev server on :5173
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```

There is no test suite in this repo (no `test` script in either `package.json`) and no lint script in the backend. Always run `npx tsc --noEmit` in both `backend/` and `frontend/` after changes, and `npm run build` in `frontend/` before committing — this is the actual verification loop used in this project, not a test runner.

Local dev needs a Postgres instance reachable via `DATABASE_URL` in `backend/.env` (copy from `.env.example`). `npm run migrate` creates/updates tables; `npm run seed` inserts the `LOJAS` array from `backend/src/db/seed.ts` (`ON CONFLICT DO NOTHING`, safe to rerun anytime, including in prod on every deploy).

## Deploy

Push to `master` → GitHub Actions (`.github/workflows/deploy.yml`) SSHes into the VPS, runs `git pull` + `docker compose up -d --build`, then automatically runs `migrate` and `seed` inside the backend container. No manual VPS step needed for schema changes — migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and just get reapplied wholesale every deploy.

The "Conectar no VPS e atualizar" step fails intermittently (SSH flake, not code-related) — when it does, click "Re-run all jobs" on the failed run; it always passes on retry.

Stack in prod: Docker Compose (Postgres + backend + frontend/Nginx), with a host-level Nginx doing HTTPS + reverse proxy. See `DEPLOY.md` for full VPS setup steps (only needed once, or if the workflow itself needs rebuilding).

## Architecture

### Module pattern (backend)

Every module follows the same shape: `routes/<modulo>.ts` (Express router, thin — validates input, calls service, formats response) + `services/<modulo>Service.ts` (SQL via `pool` from `db/pool.ts`, no ORM). Routers are mounted in `index.ts` with `app.use("/api/x", requireAuth, requirePermissao("x"), xRouter)`.

Adding a new permission-gated module touches **all** of these (none of it is automatic):
1. `backend/src/services/usuariosService.ts` — add the key to `MODULOS_VALIDOS` (documentation-only; not actually enforced at insert time)
2. `backend/src/index.ts` — mount the router with `requirePermissao("chave")`
3. `frontend/src/constants/modulos.ts` — add `{ chave, label }` to `MODULOS` (this is what makes it show up as a checkbox in the Usuários admin screen — separate list from the backend one, must be kept in sync manually)
4. `frontend/src/components/Sidebar.tsx` — add to the `View` union, a `temPermissao(usuario, "chave")` check, and a nav button
5. `frontend/src/App.tsx` — import the page, add to `primeiraViewPermitida()`, add the conditional render line

### Loja (store) scoping

Almost every route accepts `?lojaId=` as a specific numeric id, `"todas"`, or `"minhas"`. Each route file duplicates its own `resolverLojaFiltro(req, res)` helper (this is the deliberate convention here — no shared cross-file abstraction) built on `temAcessoLoja` / `lojasEfetivas` from `usuariosService.ts`:
- Admins and users with `todasLojas=true` bypass restriction everywhere (`lojasEfetivas` returns `undefined`, meaning no filter).
- `"minhas"` is special-cased to use the user's raw `usuario.lojas` array directly, **not** `lojasEfetivas` — so an admin selecting "Minhas lojas" gets their own (often empty) assigned-lojas list, not an automatic "all lojas" bypass. This is consistent across the codebase (dashboard/financeiro/ads/contas all do it the same way), not a one-off bug.
- **Exception**: the "Vigilância de preço e margem" panel (`/api/dashboard/precificacao*`) deliberately ignores loja permissions entirely — any user with Dashboard access sees pricing/margin data for all stores, by design, so the whole group can flag undercutting on each other's listings. This is the one intentional hole in an otherwise strict per-loja permission model — see `resolverLojaFiltroVigilancia` in `routes/dashboard.ts`.

### Mercado Livre API integration (`mercadoLivreApi.ts`)

The Product Ads endpoints require a path the public docs don't show correctly: `/marketplace/advertising/MLB/advertisers/{id}/product_ads/campaigns/search` (docs omit `/marketplace`, which 404s without it). Found by systematic trial — don't trust the public docs blindly if an Ads call 404s.

ML's Ads API does **not** expose spend from deleted/excluded campaigns through any known mechanism — the live API "forgets" a campaign's history once it's deleted. This is why `ads_gasto_diario` exists: a snapshot table populated every 4h (`capturarGastoAdsDoDia`, scheduled via `iniciarSnapshotAds` in `adsService.ts`) that preserves cost before a deletion can erase it. `obterGastoAdsHistorico` merges snapshot (for closed/past days — immune to deletion) with a live fetch (always for "today", since today's snapshot can be stale by design; uses `max(live, snapshot)` per loja to avoid losing same-day-deleted-campaign history).

### Financeiro vs Contas a pagar/receber

These are deliberately separate and non-overlapping:
- **Financeiro** (`financeiroService.ts`) is 100% automatic — it re-derives revenue/cost/margin from live Mercado Livre order data on every request (with a 15-min cache), never manually entered.
- **Contas a pagar/receber** (`contasService.ts`) is a manual ledger for money that does *not* flow through ML — supplier bills, rent, salaries. It intentionally does **not** auto-create entries from ML sales (that would double-count against Financeiro). Supports parcelamento (installments) and rateio (splitting one shared cost like rent across a chosen subset of lojas in equal parts) — both use the same "first row is the anchor" grouping pattern (`grupo_parcelamento_id` / `grupo_rateio_id` self-referencing the first inserted row's own id) rather than a separate group table.

### Caching

No single caching strategy — each service picks a TTL matching how "live" that data needs to feel:
- `dashboardService.ts` main endpoint: 60s in-memory cache (many concurrent viewers, external API latency is the bottleneck, not staleness tolerance).
- `financeiroService.ts` / `precificacaoService.ts`: 15-min cache (feed of recent activity, not truly live).
- `dashboardService.ts` top-vendidos ("diagnóstico de promoções"): very expensive (60 days × all lojas × per-item promo/ads checks, can take 20-30s), so it's cached per anchor-hour-window (8h/15h) rather than TTL, and proactively **prewarmed** in the background (`promoPrewarm.ts`, `iniciarPrewarmPromocoes`) for "todas as lojas" and every unique per-user "minhas lojas" subset — so no live user ever pays the 20-30s cost cold. Warming resets on every deploy (process restart), so a deploy briefly reintroduces the cold-start window until the prewarm job catches up.

### Known gotcha: day-boundary timezone

Several `atrasado`/`diasParaVencer`-style "is this late / how many days until due" computations (see `contasService.ts`) derive "hoje" from `new Date().toISOString().slice(0,10)`, which is a **UTC** calendar day, not `America/Sao_Paulo`. This can be off by a day depending on time of day. Known, not yet fixed — be aware of it if you touch date-boundary logic anywhere in `contasService.ts` or similar derived-field calculations.

### Frontend data-fetching

`frontend/src/hooks/useBuscaComCancelamento.ts` is the standard hook for any filter-driven fetch (loja/período/status changes). It tags each call with a sequential id and discards responses that arrive after a newer call has already started, preventing the classic "changed the filter twice quickly, UI shows data from the stale request" race condition. Use it instead of a raw `useEffect` + `fetch` for anything filterable.

Permission checks on the frontend go through `temPermissao(usuario, "chave")` from `frontend/src/constants/modulos.ts`, checking against the `permissoes` array the backend returns at login (`/api/session/me`) — mirrors (but is a separate list from) the backend's `MODULOS_VALIDOS`.
