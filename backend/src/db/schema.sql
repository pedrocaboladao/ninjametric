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

-- Módulo Tarefas (quadro estilo Trello)
CREATE TABLE IF NOT EXISTS tarefas_colunas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  especial TEXT, -- 'concluidos' marca a coluna fixa; NULL para colunas normais
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tarefas_colunas ADD COLUMN IF NOT EXISTS cor TEXT;

CREATE TABLE IF NOT EXISTS tarefas_cartoes (
  id SERIAL PRIMARY KEY,
  coluna_id INTEGER NOT NULL REFERENCES tarefas_colunas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT false,
  arquivado BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tarefas_cartoes_coluna ON tarefas_cartoes (coluna_id, ordem);

-- Módulo Funcionários (ranking gamificado de empacotadores)
CREATE TABLE IF NOT EXISTS empacotadores (
  id SERIAL PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empacotadores_pacotes (
  id SERIAL PRIMARY KEY,
  empacotador_id INTEGER NOT NULL REFERENCES empacotadores(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  pacotes INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empacotador_id, data)
);

CREATE INDEX IF NOT EXISTS idx_empacotadores_pacotes_data ON empacotadores_pacotes (data);

-- Meta diária e bonificação por pacote excedente
ALTER TABLE empacotadores ADD COLUMN IF NOT EXISTS meta_diaria INTEGER;

CREATE TABLE IF NOT EXISTS empacotadores_bonus_fechamentos (
  id SERIAL PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empacotadores_bonus_pagamentos (
  id SERIAL PRIMARY KEY,
  empacotador_id INTEGER NOT NULL REFERENCES empacotadores(id) ON DELETE CASCADE,
  valor NUMERIC(10, 2) NOT NULL,
  origem TEXT NOT NULL, -- 'fechamento' ou 'avulso'
  fechamento_id INTEGER REFERENCES empacotadores_bonus_fechamentos(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_empacotadores_bonus_pagamentos_empacotador
  ON empacotadores_bonus_pagamentos (empacotador_id);

-- Usuários e permissões por módulo
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  admin BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS todas_lojas BOOLEAN NOT NULL DEFAULT false;

-- Permite liberar o Clonar Anúncio para todas as lojas independentemente da
-- lista de "lojas com acesso" (usada pelo Dashboard/Perguntas/Tarefas).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clonar_todas_lojas BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS usuarios_permissoes (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  PRIMARY KEY (usuario_id, modulo)
);

CREATE TABLE IF NOT EXISTS usuarios_lojas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, loja_id)
);

-- Torna o quadro de Tarefas exclusivo por usuário (cada login tem seu próprio
-- quadro). As colunas já existentes (do usuário admin original) são migradas
-- para a conta admin.
ALTER TABLE tarefas_colunas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE;
UPDATE tarefas_colunas SET usuario_id = (SELECT id FROM usuarios WHERE admin = true ORDER BY id LIMIT 1)
  WHERE usuario_id IS NULL;
ALTER TABLE tarefas_colunas ALTER COLUMN usuario_id SET NOT NULL;
DROP INDEX IF EXISTS idx_tarefas_colunas_especial;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tarefas_colunas_usuario_especial
  ON tarefas_colunas (usuario_id, especial) WHERE especial IS NOT NULL;

-- Painel de estudo: canais do YouTube acompanhados no Painel ao vivo
CREATE TABLE IF NOT EXISTS canais_youtube (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Financeiro: alíquota de imposto usada no cálculo de margem, editável por
-- loja (cada empresa/CNPJ pode ter um regime tributário diferente).
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS imposto_percentual NUMERIC(5, 2) NOT NULL DEFAULT 7.00;

-- Financeiro: custo fixo mensal (aluguel, salários etc.) — por loja, cada
-- uma é um negócio próprio. O ponto de equilíbrio de "todas"/"minhas lojas"
-- soma o custo fixo das lojas incluídas no filtro.
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS custo_fixo_mensal NUMERIC(12, 2) NOT NULL DEFAULT 0;
DROP TABLE IF EXISTS financeiro_config;

-- Ads: snapshot do gasto diário por campanha, capturado periodicamente (a
-- cada 4h) enquanto a campanha ainda existe. O Mercado Livre "esquece" o
-- gasto de campanhas excluídas na API de campanhas — guardando aqui antes
-- disso acontecer, o histórico sobrevive mesmo depois da campanha sumir.
CREATE TABLE IF NOT EXISTS ads_gasto_diario (
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  campanha_id BIGINT NOT NULL,
  data DATE NOT NULL,
  nome TEXT NOT NULL,
  custo NUMERIC(12, 2) NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (loja_id, campanha_id, data)
);
CREATE INDEX IF NOT EXISTS idx_ads_gasto_diario_loja_data ON ads_gasto_diario (loja_id, data);
-- ACOS Meta capturado junto no mesmo snapshot — a API do Mercado Livre só
-- devolve a meta ATUAL configurada, sem histórico; guardando aqui a cada
-- captura dá pra comparar "meta de então" com "meta de agora" num período
-- passado (ver acosMetaAnterior em listarCampanhasAds).
ALTER TABLE ads_gasto_diario ADD COLUMN IF NOT EXISTS acos_meta NUMERIC(6, 2);

-- Contas a pagar e receber: lançamentos manuais de despesas/receitas que não
-- vêm de pedidos do Mercado Livre (essas já são rastreadas automaticamente
-- no Financeiro) — fornecedores, aluguel, salários, impostos etc. Por loja,
-- igual ao resto do sistema. "Atrasado" não é armazenado: é derivado em
-- tempo de leitura (status = 'pendente' E vencimento < hoje) — não precisa
-- de cron pra manter em dia.
CREATE TABLE IF NOT EXISTS contas_lancamentos (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('pagar', 'receber')),
  descricao TEXT NOT NULL,
  categoria TEXT,
  valor NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  vencimento DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  data_pagamento DATE,
  observacao TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contas_lancamentos_loja_status ON contas_lancamentos (loja_id, status);
CREATE INDEX IF NOT EXISTS idx_contas_lancamentos_vencimento ON contas_lancamentos (vencimento);

-- Contas a pagar e receber (fase 1.5): cadastro central de fornecedores e
-- clientes (uma tabela só, discriminada por `tipo` — a estrutura é idêntica
-- pros dois, então duas tabelas gêmeas seriam duplicação). Global, não por
-- loja: um fornecedor normalmente atende mais de uma loja.
CREATE TABLE IF NOT EXISTS contas_contatos (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('fornecedor', 'cliente')),
  nome TEXT NOT NULL,
  documento TEXT,
  dados_bancarios TEXT,
  contato TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contas_contatos_tipo ON contas_contatos (tipo);

-- Liga um lançamento a um fornecedor/cliente cadastrado (opcional — lançamento
-- avulso sem cadastro continua funcionando, só com a descrição). Parcelamento:
-- sem tabela de grupo separada — a primeira parcela criada é a "âncora"
-- (grupo_parcelamento_id de todas, incluindo ela mesma, aponta pro id dela).
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS contato_id INTEGER REFERENCES contas_contatos(id) ON DELETE SET NULL;
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS grupo_parcelamento_id INTEGER REFERENCES contas_lancamentos(id) ON DELETE SET NULL;
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS parcela_numero INTEGER;
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS parcela_total INTEGER;
CREATE INDEX IF NOT EXISTS idx_contas_lancamentos_grupo_parcelamento ON contas_lancamentos (grupo_parcelamento_id);

-- Rateio de custo compartilhado entre lojas escolhidas, em partes iguais.
-- Mesma ideia do grupo_parcelamento_id: a primeira linha criada é a âncora
-- do grupo (grupo_rateio_id aponta pro id dela, inclusive nela mesma). Sem
-- coluna de "posição" — rateio não tem ordem, só as N lojas participantes.
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS grupo_rateio_id INTEGER REFERENCES contas_lancamentos(id) ON DELETE SET NULL;
ALTER TABLE contas_lancamentos ADD COLUMN IF NOT EXISTS rateio_total INTEGER;
CREATE INDEX IF NOT EXISTS idx_contas_lancamentos_grupo_rateio ON contas_lancamentos (grupo_rateio_id);

-- Fabricação: custo de produção das próprias fórmulas (a fábrica do grupo,
-- não revenda) — matéria-prima cadastrada uma vez (nome + custo/kg),
-- reaproveitada em várias fórmulas. Sem loja_id: a fábrica é única, atende
-- todas as lojas.
CREATE TABLE IF NOT EXISTS materias_primas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  custo_por_kg NUMERIC(12, 4) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fórmula = receita fixa de matérias-primas em % (ver formula_itens),
-- aplicada sobre peso_lote_kg (peso da unidade vendida, ex.: 18 pro balde
-- de 18L) + custo_embalagem (balde/rótulo, por unidade). sku vincula à
-- venda real no Mercado Livre (mesmo SKU do Financeiro/Produtos/
-- Correções) pra puxar preço/frete/tarifa reais — nullable, dá pra
-- cadastrar a fórmula antes de ter o vínculo.
CREATE TABLE IF NOT EXISTS formulas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  sku TEXT,
  peso_lote_kg NUMERIC(12, 3) NOT NULL DEFAULT 1,
  custo_embalagem NUMERIC(12, 2) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formula_itens (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id) ON DELETE RESTRICT,
  percentual NUMERIC(6, 3) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formula_itens_formula ON formula_itens (formula_id);
