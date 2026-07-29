-- Esquema base do Painel de Vendas (4 lojas Mercado Livre)

CREATE TABLE IF NOT EXISTS lojas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ml_user_id BIGINT UNIQUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tokens OAuth2 do Mercado Livre, um registro por loja
CREATE TABLE IF NOT EXISTS contas_ml (
  loja_id INTEGER PRIMARY KEY REFERENCES lojas(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  ml_order_id BIGINT NOT NULL,
  data_criacao TIMESTAMPTZ NOT NULL,
  valor_total NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL,
  comprador TEXT,
  raw JSONB,
  UNIQUE (loja_id, ml_order_id)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_loja_data ON pedidos (loja_id, data_criacao);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  sku TEXT,
  titulo TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_unitario NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_itens_pedido_pedido ON itens_pedido (pedido_id);

CREATE TABLE IF NOT EXISTS perguntas (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  ml_question_id BIGINT NOT NULL,
  ml_item_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  respondida BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL,
  raw JSONB,
  UNIQUE (loja_id, ml_question_id)
);

CREATE TABLE IF NOT EXISTS anuncios (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  ml_item_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  raw JSONB,
  UNIQUE (loja_id, ml_item_id)
);
