CREATE TABLE IF NOT EXISTS keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_collected_at TIMESTAMPTZ
);

-- Cada linha é UM resultado de busca, numa posição, num instante — nunca
-- sobrescreve, só acumula. É o que permite reconstruir histórico de posição
-- e preço ao longo do tempo (ver CLAUDE.md do projeto: "nunca sobrescrever,
-- manter histórico").
CREATE TABLE IF NOT EXISTS search_snapshots (
  id BIGSERIAL PRIMARY KEY,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  seller_id TEXT,
  seller_name TEXT,
  price NUMERIC,
  original_price NUMERIC,
  rating NUMERIC,
  review_count INTEGER,
  sold_quantity TEXT,
  shipping_type TEXT,
  is_full BOOLEAN,
  official_store BOOLEAN,
  is_catalog BOOLEAN,
  sponsored BOOLEAN,
  brand TEXT,
  url TEXT,
  provider TEXT NOT NULL,
  is_own_listing BOOLEAN NOT NULL DEFAULT false,
  own_store_name TEXT,
  category_id TEXT,
  domain_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_snapshots_keyword ON search_snapshots(keyword_id, collected_at DESC);

-- Tabela já existia em produção antes desses dois campos — coleta anterior
-- fica com NULL neles (dado que a GeckoAPI de fato não retornava antes de
-- eu passar a capturar, não é lacuna nossa).
ALTER TABLE search_snapshots ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE search_snapshots ADD COLUMN IF NOT EXISTS domain_id TEXT;
CREATE INDEX IF NOT EXISTS idx_search_snapshots_category ON search_snapshots(keyword_id, collected_at DESC, category_id);

-- Log de toda chamada paga ao provider — base do controle de custo
-- (MARKET_MAX_REQUESTS_DAY em searchService.ts).
CREATE TABLE IF NOT EXISTS provider_requests (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  keyword TEXT,
  credits_used INTEGER,
  ok BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_requests_created_at ON provider_requests(created_at DESC);
