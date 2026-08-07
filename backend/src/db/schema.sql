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

-- Promoções: campanha do vendedor (SELLER_CAMPAIGN) no Mercado Livre tem
-- prazo máximo de 14 dias — não existe renovação automática nativa da
-- plataforma, e a API não tem endpoint pra "listar minhas campanhas" (só
-- consulta por id já conhecido). O painel precisa ser a própria fonte de
-- verdade de quais campanhas existem e quando vencem, senão não tem como
-- avisar/recriar. Só rastreia campanhas criadas a partir de daqui, pelo
-- próprio painel (v1 não importa histórico já existente no Mercado Livre).
CREATE TABLE IF NOT EXISTS promocoes_campanhas (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  promotion_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  percentual_desconto NUMERIC(5, 2) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  campanha_anterior_id INTEGER REFERENCES promocoes_campanhas(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promocoes_campanhas_loja ON promocoes_campanhas (loja_id);

-- deal_price é o preço final calculado (percentual sobre o preço do
-- produto NO MOMENTO da criação/renovação) — guardado aqui porque o
-- preço do produto pode mudar depois, e a renovação precisa recalcular
-- em cima do preço atual, não repetir esse valor congelado.
CREATE TABLE IF NOT EXISTS promocoes_itens (
  id SERIAL PRIMARY KEY,
  campanha_id INTEGER NOT NULL REFERENCES promocoes_campanhas(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  titulo TEXT,
  preco_original NUMERIC(12, 2) NOT NULL,
  deal_price NUMERIC(12, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promocoes_itens_campanha ON promocoes_itens (campanha_id);

-- Agente Analista de Ads: feed persistente das mesmas regras de "Insights"
-- que já existem na tela de Gestão de Ads (Ads.tsx), só que salvas aqui pra
-- parecer observação contínua (não recalculada do zero a cada carregamento
-- de tela) e pra dar pra marcar "resolvido". Chave (loja+campanha) garante
-- no máximo 1 observação PENDENTE por campanha por vez.
CREATE TABLE IF NOT EXISTS agente_ads_observacoes (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  campanha_id TEXT NOT NULL,
  campanha_nome TEXT NOT NULL,
  chave TEXT NOT NULL,
  tipo TEXT NOT NULL,
  contexto TEXT NOT NULL,
  acao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  resolvido_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolvido_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agente_ads_obs_status ON agente_ads_observacoes (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agente_ads_obs_chave_pendente ON agente_ads_observacoes (chave) WHERE status = 'pendente';
-- 'janela' distingue de qual verificação a observação veio ('7dias' ou
-- 'hoje') — mesma tabela/feed, mas cada janela fecha só as próprias
-- pendências (ver executarVerificacao em agenteAdsService.ts).
ALTER TABLE agente_ads_observacoes ADD COLUMN IF NOT EXISTS janela TEXT NOT NULL DEFAULT '7dias';

-- Raciocínio real da IA (Claude, "adaptive thinking") em cada verificação —
-- separado das observações porque é um registro por RODADA (o "diário" do
-- agente), não por campanha.
CREATE TABLE IF NOT EXISTS agente_ads_pensamentos (
  id SERIAL PRIMARY KEY,
  pensamento TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Perfis de marca salvos pro Agente de Imagens (Kit de fotos) — não é
-- aprendizado de IA, é só lembrar configurações que se repetem entre
-- produtos da mesma marca (cores, foto de referência de estilo, benefícios
-- e locais de aplicação comuns), pra não digitar tudo de novo a cada anúncio.
CREATE TABLE IF NOT EXISTS agente_imagens_perfis (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cores TEXT NOT NULL DEFAULT '',
  imagem_referencia_base64 TEXT,
  beneficios_padrao TEXT NOT NULL DEFAULT '',
  onde_aplicar_padrao TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de toda vez que o dono edita um campo que a IA sugeriu (a partir
-- de "buscar anúncio") antes de gerar o kit — mesma ideia de "memória" do
-- Analista de Ads: não é a IA aprendendo de verdade, é o sistema guardando
-- o padrão de correção e devolvendo como contexto extra na próxima sugestão.
CREATE TABLE IF NOT EXISTS agente_imagens_correcoes (
  id SERIAL PRIMARY KEY,
  campo TEXT NOT NULL,
  valor_sugerido TEXT NOT NULL,
  valor_final TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Galeria de referências visuais por perfil de marca — memória de estilo de
-- verdade: em vez de só UMA foto de referência fixa, o dono "favorita"
-- resultados que gostou e a IA passa a usar até 3 delas como exemplo real
-- de cor/composição/tipografia nas próximas gerações do mesmo perfil.
CREATE TABLE IF NOT EXISTS agente_imagens_perfil_referencias (
  id SERIAL PRIMARY KEY,
  perfil_id INTEGER NOT NULL REFERENCES agente_imagens_perfis(id) ON DELETE CASCADE,
  imagem_base64 TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Foto (snapshot) do estoque de todo anúncio ativo de cada loja, capturada
-- periodicamente em segundo plano (ver iniciarSnapshotEstoque) — escanear
-- ao vivo toda loja/todo item a cada carregamento do Dashboard seria lento
-- demais (até 1000 itens por loja, em lotes de 20 chamadas à API do ML).
-- Guarda o estoque de TODO item ativo (não só os com estoque baixo), pra
-- poder mudar o limite de alerta depois sem precisar re-escanear.
CREATE TABLE IF NOT EXISTS estoque_snapshot (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  item_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  estoque INTEGER NOT NULL,
  thumbnail TEXT,
  permalink TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loja_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_estoque_snapshot_estoque ON estoque_snapshot (estoque);

-- Agente de Oportunidades: SKUs que vendem bem no GRUPO INTEIRO (16 lojas)
-- mas têm pouca ou nenhuma representação nas 4 lojas pessoais do dono —
-- sinal de produto que ele poderia adicionar/dar mais destaque. Sem IA de
-- propósito (o número já conta a história sozinho, e o dono já pediu pra
-- evitar chamada de IA de alto volume) — recalculado do zero 1x por dia,
-- a tabela sempre reflete só a leitura mais recente.
CREATE TABLE IF NOT EXISTS agente_oportunidades (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  titulo TEXT NOT NULL,
  quantidade_grupo INTEGER NOT NULL,
  quantidade_minhas_lojas INTEGER NOT NULL,
  contexto TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
