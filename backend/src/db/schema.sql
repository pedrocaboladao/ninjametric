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

-- Custo de Fabricação: custo de produção das próprias fórmulas (a fábrica do
-- grupo, não revenda) — matéria-prima cadastrada uma vez (nome + custo/kg),
-- reaproveitada em várias fórmulas. Sem loja_id: a fábrica é única, atende
-- todas as lojas.
CREATE TABLE IF NOT EXISTS materias_primas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  custo_por_kg NUMERIC(12, 4) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de compras de cada matéria-prima — valor pago + frete já
-- embutido, dividido pela quantidade, dá o custo/kg real daquela compra.
-- Ao registrar uma compra, materias_primas.custo_por_kg é atualizado pra
-- esse valor (vira o custo "atual" usado no cálculo das fórmulas), mas a
-- edição manual do custo/kg continua existindo em paralelo pra ajustes
-- rápidos sem precisar lançar uma compra formal.
CREATE TABLE IF NOT EXISTS materia_prima_compras (
  id SERIAL PRIMARY KEY,
  materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade_kg NUMERIC(12, 3) NOT NULL,
  valor_pago NUMERIC(12, 2) NOT NULL,
  valor_frete NUMERIC(12, 2) NOT NULL DEFAULT 0,
  custo_por_kg NUMERIC(12, 4) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_materia_prima_compras_materia ON materia_prima_compras (materia_prima_id, data DESC);

-- Fórmula = receita em % (ver formula_itens) aplicada sobre peso_lote_kg —
-- desde a expansão pro "Custo de Fabricação", peso_lote_kg é o LOTE INTEIRO
-- fabricado (ex.: 1400kg), não mais o peso de uma unidade vendida. Uma
-- fórmula pode ser uma "Base" (matéria-prima pura, ex.: Base A) ou um
-- produto final que usa uma Base como ingrediente (ver sub_formula_id em
-- formula_itens) — não existe coluna de "tipo", isso é implícito por quem
-- referencia quem. sku/custo_embalagem antigos ficam sem uso (substituídos
-- por formula_embalagens, que suporta vários tamanhos de envase por
-- fórmula) — não removidos do banco pra evitar migração destrutiva.
CREATE TABLE IF NOT EXISTS formulas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  sku TEXT,
  peso_lote_kg NUMERIC(12, 3) NOT NULL DEFAULT 1,
  custo_embalagem NUMERIC(12, 2) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Item da fórmula: OU matéria-prima crua OU outra fórmula (sub-receita,
-- ex.: uma cor usando uma Base) — nunca os dois. O custo de uma fórmula que
-- referencia outra é calculado recursivamente em fabricacaoService.ts, com
-- proteção contra ciclo (A usar B que usa A) feita na validação de escrita,
-- não aqui no banco. CREATE primeiro (banco novo já nasce com o formato
-- certo), ALTER depois (banco existente, criado antes da sub_formula_id
-- existir, é atualizado por cima — os ALTER viram no-op num banco novo).
CREATE TABLE IF NOT EXISTS formula_itens (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  materia_prima_id INTEGER REFERENCES materias_primas(id) ON DELETE RESTRICT,
  sub_formula_id INTEGER REFERENCES formulas(id) ON DELETE RESTRICT,
  percentual NUMERIC(6, 3) NOT NULL,
  CONSTRAINT formula_itens_um_tipo CHECK (
    (materia_prima_id IS NOT NULL AND sub_formula_id IS NULL) OR
    (materia_prima_id IS NULL AND sub_formula_id IS NOT NULL)
  )
);
ALTER TABLE formula_itens ALTER COLUMN materia_prima_id DROP NOT NULL;
ALTER TABLE formula_itens ADD COLUMN IF NOT EXISTS sub_formula_id INTEGER REFERENCES formulas(id) ON DELETE RESTRICT;
-- Postgres não tem "ADD CONSTRAINT IF NOT EXISTS" — checa em pg_constraint antes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'formula_itens_um_tipo') THEN
    ALTER TABLE formula_itens ADD CONSTRAINT formula_itens_um_tipo CHECK (
      (materia_prima_id IS NOT NULL AND sub_formula_id IS NULL) OR
      (materia_prima_id IS NULL AND sub_formula_id IS NOT NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_formula_itens_formula ON formula_itens (formula_id);
CREATE INDEX IF NOT EXISTS idx_formula_itens_sub_formula ON formula_itens (sub_formula_id);

-- Tamanhos de envase de uma fórmula (Bombona 45kg, Balde 18kg...) — cada um
-- com seu próprio custo de embalagem e, opcionalmente, seu próprio SKU (cada
-- tamanho costuma ser um anúncio separado no Mercado Livre).
CREATE TABLE IF NOT EXISTS formula_embalagens (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  peso_kg NUMERIC(12, 3) NOT NULL,
  custo_embalagem NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sku TEXT,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_formula_embalagens_formula ON formula_embalagens (formula_id);

-- Histórico de lotes de produção real — cada vez que a fórmula é fabricada
-- de verdade, registra o peso real de saída pra comparar com o teórico da
-- fórmula (déficit/superávit calculado na leitura, não guardado aqui).
-- peso_real_kg é derivado da soma dos envases reais (ver formula_lote_envases)
-- — não é mais digitado direto, fica guardado aqui só pra não precisar somar
-- toda vez que listar.
CREATE TABLE IF NOT EXISTS formula_lotes (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  peso_previsto_kg NUMERIC(12, 3) NOT NULL,
  peso_real_kg NUMERIC(12, 3) NOT NULL,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE formula_lotes ADD COLUMN IF NOT EXISTS hora_inicio TIME;
ALTER TABLE formula_lotes ADD COLUMN IF NOT EXISTS hora_termino TIME;
CREATE INDEX IF NOT EXISTS idx_formula_lotes_formula ON formula_lotes (formula_id, data DESC);

-- Quantas unidades de cada tamanho de envase saíram de um lote específico
-- — um lote pode ser fracionado em mais de um tamanho (ex.: parte em
-- balde de 18kg, parte em galão de 4kg), e as sobras/faltas de cada
-- tamanho é o que soma pro peso_real_kg do lote. Guarda nome/peso/custo
-- de embalagem como SNAPSHOT (não FK pra formula_embalagens) porque
-- editar a fórmula recria as linhas de formula_embalagens do zero (ver
-- salvarEmbalagens em fabricacaoService.ts) — um FK quebraria o histórico
-- de lotes antigos toda vez que a fórmula fosse editada.
CREATE TABLE IF NOT EXISTS formula_lote_envases (
  id SERIAL PRIMARY KEY,
  lote_id INTEGER NOT NULL REFERENCES formula_lotes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  peso_kg NUMERIC(12, 3) NOT NULL,
  custo_embalagem NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantidade INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formula_lote_envases_lote ON formula_lote_envases (lote_id);

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

-- Oportunidades de promoções sugeridas pelo próprio Mercado Livre. Só tipo
-- SMART ("Impulsione suas vendas"/"Aumente suas vendas") entra aqui —
-- testado ao vivo em várias lojas do grupo: é o único tipo que revela
-- meli_percentual/seller_percentual (quanto o ML banca vs. quanto sai do
-- seu bolso), mesmo antes de aceitar ("candidate"). DEAL, PRICE_DISCOUNT e
-- SELLER_CAMPAIGN nunca trazem esses campos — ou seja, não têm ajuda real
-- do ML, só desconto seu mesmo, e o dono pediu pra não automatizar essas
-- (ver promocoesOportunidadesService).
CREATE TABLE IF NOT EXISTS promocoes_oportunidades (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  item_id TEXT NOT NULL,
  titulo TEXT,
  sku TEXT,
  promotion_id TEXT,
  tipo TEXT NOT NULL,
  nome TEXT,
  preco_original NUMERIC(12, 2) NOT NULL,
  preco_escolhido NUMERIC(12, 2) NOT NULL,
  custo_unitario NUMERIC(12, 2),
  taxa_ml NUMERIC(12, 2),
  margem NUMERIC(12, 2),
  elegivel BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  erro TEXT,
  descoberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em TIMESTAMPTZ,
  CONSTRAINT promocoes_oportunidades_unica UNIQUE (loja_id, item_id, tipo, promotion_id)
);
CREATE INDEX IF NOT EXISTS idx_promocoes_oportunidades_loja ON promocoes_oportunidades (loja_id, status);
ALTER TABLE promocoes_oportunidades ADD COLUMN IF NOT EXISTS meli_percentual NUMERIC(5, 2);
ALTER TABLE promocoes_oportunidades ADD COLUMN IF NOT EXISTS seller_percentual NUMERIC(5, 2);
ALTER TABLE promocoes_oportunidades ADD COLUMN IF NOT EXISTS permalink TEXT;
-- ref_id da resposta do Mercado Livre (só tipo SMART) — descoberto que a
-- API exige esse campo (como "offer_id") pra confirmar participação; sem
-- ele, aprovar dá 400 "Offer id is required".
ALTER TABLE promocoes_oportunidades ADD COLUMN IF NOT EXISTS offer_id TEXT;
-- Estimativa de frete grátis pré-venda (ver getFreteEstimadoPreVenda) —
-- descoberto comparando com o "Você recebe" real da tela do ML que a
-- margem sem contar isso ficava sistematicamente maior que o real.
ALTER TABLE promocoes_oportunidades ADD COLUMN IF NOT EXISTS frete_estimado NUMERIC(12, 2);
-- Tabela criada sem dado real em produção ainda (nenhuma varredura rodada
-- lá) quando a chave era só loja_id+item_id+tipo — trocada pra incluir
-- promotion_id porque um mesmo item pode ter VÁRIAS propostas SMART
-- simultâneas (nomes/preços diferentes), não 1 só por tipo. Par
-- DROP+ADD é seguro de rodar de novo (drop vira no-op depois da 1ª vez).
ALTER TABLE promocoes_oportunidades DROP CONSTRAINT IF EXISTS promocoes_oportunidades_loja_id_item_id_tipo_key;
ALTER TABLE promocoes_oportunidades DROP CONSTRAINT IF EXISTS promocoes_oportunidades_unica;
ALTER TABLE promocoes_oportunidades ADD CONSTRAINT promocoes_oportunidades_unica UNIQUE (loja_id, item_id, tipo, promotion_id);

-- Agente Analista de Ads: feed persistente das mesmas regras de "Insights"
-- que já existem na tela de Gestão de Ads (Ads.tsx), só que salvas aqui pra
-- parecer observação contínua (não recalculada do zero a cada carregamento
-- de tela) e pra dar pra marcar "resolvido". Chave (loja+campanha) garante
-- no máximo 1 observação PENDENTE por campanha por vez.
-- NÃO recebe mais registros novos — o Analista de Ads passou a reportar só
-- em texto corrido (ver agente_ads_pensamentos). Tabela mantida só pelo
-- histórico já gravado (idempotente, não custa nada deixar).
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
-- loja_id fica NULL nos registros antigos (de antes dessa coluna existir) —
-- eles só não aparecem quando o filtro por loja está ativo, continuam
-- normais em "todas as lojas".
ALTER TABLE agente_ads_pensamentos ADD COLUMN IF NOT EXISTS loja_id INTEGER REFERENCES lojas(id);
-- Mesma distinção 'janela' que existia nas observações ('7dias' ou 'hoje') —
-- registros antigos (de antes dessa coluna) caem no default '7dias'.
ALTER TABLE agente_ads_pensamentos ADD COLUMN IF NOT EXISTS janela TEXT NOT NULL DEFAULT '7dias';

-- Growth Hacker: agente separado do Analista de Ads acima — 1x/dia, olha as
-- 4 lojas pessoais como um negócio só (não por loja) e escreve um briefing
-- de negócio (não um registro por campanha). Sem loja_id/janela de propósito.
CREATE TABLE IF NOT EXISTS agente_growth_hacker_pensamentos (
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

-- Foto (snapshot) das vendas cuja margem real deu negativa (últimos 7 dias),
-- capturada periodicamente em segundo plano (ver iniciarSnapshotVendasNegativas)
-- — mesma ideia do estoque_snapshot: reaproveita o cálculo já pronto do
-- Financeiro (custo/taxa/frete reais, não estimados) só que roda 1x a cada
-- 4h em vez de recalcular ao vivo toda vez que alguém abre o Dashboard.
CREATE TABLE IF NOT EXISTS vendas_negativas_snapshot (
  id SERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  item_id TEXT NOT NULL,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  data_criacao TIMESTAMPTZ NOT NULL,
  titulo TEXT NOT NULL,
  sku TEXT,
  quantidade INTEGER NOT NULL,
  receita_total NUMERIC(12, 2) NOT NULL,
  custo_total NUMERIC(12, 2),
  taxa_ml_total NUMERIC(12, 2) NOT NULL,
  frete_vendedor_total NUMERIC(12, 2),
  imposto_total NUMERIC(12, 2) NOT NULL,
  margem_contribuicao NUMERIC(12, 2) NOT NULL,
  margem_percentual NUMERIC(6, 2),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_vendas_negativas_snapshot_loja ON vendas_negativas_snapshot (loja_id);

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
-- Chave pra diferenciar "oportunidade que já estava na lista" (upsert,
-- mantém o criado_em original) de "oportunidade nova" (insert, criado_em
-- novo) — sem isso toda rodada reescreveria a lista inteira com o mesmo
-- horário, e o feed nunca pareceria dinâmico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agente_oportunidades_sku ON agente_oportunidades (sku);

-- Agente de Catálogo: anúncios de catálogo (concorrência "Comprar") das 4
-- lojas pessoais que NÃO estão ganhando agora — guarda só os que valem
-- atenção (status != 'winning'), com o preço pra ganhar (price_to_win, API
-- do ML) e a margem real (custo cadastrado + taxa ML real pro preço
-- hipotético + imposto da loja) no preço atual vs no price_to_win. Fonte de
-- dados pro resumo em texto corrido montado por código (sem IA, ver
-- agente_catalogo_pensamentos) — não é mostrado direto pro usuário.
CREATE TABLE IF NOT EXISTS agente_catalogo_snapshot (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  item_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  thumbnail TEXT,
  permalink TEXT,
  status TEXT NOT NULL,
  preco_atual NUMERIC(12, 2) NOT NULL,
  price_to_win NUMERIC(12, 2),
  sku TEXT,
  custo_unitario NUMERIC(12, 2),
  margem_atual NUMERIC(12, 2),
  margem_no_price_to_win NUMERIC(12, 2),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loja_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_agente_catalogo_loja ON agente_catalogo_snapshot (loja_id);

-- Agente de Conversão: análise em texto corrido (mesmo padrão do Analista
-- de Ads) comparando taxa de conversão (visitas x vendas) de cada anúncio
-- com a média da própria loja — separa quem tem muita visita e converte mal
-- (photo/preço/copy) de quem converte bem mas tem pouca visita (vale
-- empurrar tráfego). 1 registro por rodada por loja, não por anúncio.
CREATE TABLE IF NOT EXISTS agente_conversao_pensamentos (
  id SERIAL PRIMARY KEY,
  pensamento TEXT NOT NULL,
  loja_id INTEGER REFERENCES lojas(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agente_conversao_pensamentos_loja ON agente_conversao_pensamentos (loja_id);

-- Resumo em texto corrido do Agente de Catálogo (mesmo padrão visual dos
-- outros agentes) — montado por código puro a partir do snapshot
-- (agente_catalogo_snapshot), sem IA (número já diz se vale baixar ou não,
-- não tem julgamento a fazer). O dono pediu formato único em texto corrido
-- pra todos os agentes, sem card colorido por item.
CREATE TABLE IF NOT EXISTS agente_catalogo_pensamentos (
  id SERIAL PRIMARY KEY,
  pensamento TEXT NOT NULL,
  loja_id INTEGER REFERENCES lojas(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agente_catalogo_pensamentos_loja ON agente_catalogo_pensamentos (loja_id);

-- Agente de Plano do Dia: 1x/dia, lê o que os outros 4 agentes (Ads,
-- Conversão, Catálogo, Oportunidades) escreveram/encontraram nas últimas 24h
-- — já são resumos por loja, não dado bruto — e cruza tudo num plano do dia
-- só, priorizado entre as 4 lojas juntas. Não tem loja_id de propósito: ao
-- contrário dos outros agentes, esse é deliberadamente cross-loja (o dono
-- vê as 4 lojas juntas, não uma por vez) — é o único jeito de comparar
-- "vale mais resolver isso na loja X ou aquilo na loja Y hoje".
CREATE TABLE IF NOT EXISTS agente_plano_diario (
  id SERIAL PRIMARY KEY,
  pensamento TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Itens marcáveis do plano do dia (checklist) — só o plano gerado às 10h
-- (o "de verdade") tem itens; a cobrança das 18h é só texto, reaproveita os
-- mesmos itens em aberto em vez de duplicar. Marcar como concluído é ação
-- do próprio dono (não tem "resolvido pelo sistema" aqui, diferente dos
-- outros agentes — ninguém além do dono sabe se ele realmente fez ou não).
CREATE TABLE IF NOT EXISTS agente_plano_diario_itens (
  id SERIAL PRIMARY KEY,
  plano_id INTEGER NOT NULL REFERENCES agente_plano_diario(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT false,
  concluido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anúncios ATIVOS (não vendas passadas, ver vendas_negativas_snapshot) cujo
-- preço efetivo (considerando promoção ativa, se tiver) já nasce abaixo do
-- custo+taxa ML+imposto — ou seja, "estruturalmente" no prejuízo: a próxima
-- venda desse jeito vai dar negativo, não é um acaso pontual. Não entra
-- frete no cálculo (não existe frete real sem um pedido pra basear —
-- mesma limitação que agente_catalogo_snapshot já aceita pro price_to_win),
-- então a margem real de uma venda pode ser ainda pior que a estimada aqui.
CREATE TABLE IF NOT EXISTS anuncios_negativos_snapshot (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  item_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  thumbnail TEXT,
  permalink TEXT,
  sku TEXT,
  preco_efetivo NUMERIC(12, 2) NOT NULL,
  em_promocao BOOLEAN NOT NULL DEFAULT false,
  custo_unitario NUMERIC(12, 2) NOT NULL,
  taxa_ml NUMERIC(12, 2) NOT NULL,
  margem_estimada NUMERIC(12, 2) NOT NULL,
  margem_percentual NUMERIC(6, 2) NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loja_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_anuncios_negativos_snapshot_loja ON anuncios_negativos_snapshot (loja_id);
CREATE INDEX IF NOT EXISTS idx_agente_plano_diario_itens_plano ON agente_plano_diario_itens (plano_id);

-- Histórico do chat manual do Growth Hacker — pedido do dono pra continuar
-- a conversa mesmo depois de atualizar a página ou trocar de computador
-- (antes só vivia na memória da aba do navegador). Mantida sempre com no
-- máximo LIMITE_HISTORICO_CHAT linhas (20 = 10 perguntas + 10 respostas,
-- ver growthHackerService.ts) — a limpeza acontece a cada mensagem nova,
-- não precisa de índice (tabela sempre pequena de propósito).
CREATE TABLE IF NOT EXISTS growth_hacker_mensagens (
  id SERIAL PRIMARY KEY,
  papel TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pesquisa_categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pesquisa_mercado (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES pesquisa_categorias(id) ON DELETE CASCADE,
  mes DATE NOT NULL,
  vendedor TEXT NOT NULL,
  qtde INTEGER NOT NULL,
  total_reais NUMERIC(14, 2) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (categoria_id, mes, vendedor)
);

CREATE INDEX IF NOT EXISTS idx_pesquisa_mercado_categoria_mes ON pesquisa_mercado (categoria_id, mes DESC);

CREATE TABLE IF NOT EXISTS pesquisa_anuncios (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES pesquisa_categorias(id) ON DELETE CASCADE,
  data_snapshot DATE NOT NULL,
  vendedor TEXT NOT NULL,
  produto TEXT NOT NULL,
  marca TEXT,
  frete_gratis BOOLEAN NOT NULL DEFAULT false,
  qtde INTEGER NOT NULL,
  preco_unitario NUMERIC(12, 2) NOT NULL,
  modo_entrega TEXT,
  total NUMERIC(14, 2) NOT NULL,
  catalogo BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pesquisa_anuncios_categoria_data ON pesquisa_anuncios (categoria_id, data_snapshot DESC);
CREATE INDEX IF NOT EXISTS idx_pesquisa_anuncios_vendedor ON pesquisa_anuncios (vendedor);

-- ==========================================================================
-- FÁBRICA DISTRIBUIDORA
-- Operação própria: produz tinta e vende para as 20 lojas do grupo. Fica
-- separada das tabelas das lojas de propósito — nada aqui é lido ou escrito
-- pelos módulos do Mercado Livre. Prefixo fabrica_ em tudo.
-- ==========================================================================

-- Produto acabado da fábrica. O custo NÃO fica guardado aqui: sai da fórmula
-- ligada (custo/kg × peso da embalagem + custo da embalagem), então acompanha
-- sozinho qualquer mudança de preço de matéria-prima. O único valor digitado
-- é preco_venda; markup, margem e % de lucro são derivados na leitura.
CREATE TABLE IF NOT EXISTS fabrica_produtos (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  formula_id INTEGER REFERENCES formulas(id) ON DELETE SET NULL,
  embalagem_id INTEGER REFERENCES formula_embalagens(id) ON DELETE SET NULL,
  preco_venda NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_produtos_formula ON fabrica_produtos (formula_id);

-- Cliente da Fábrica Distribuidora: as lojas do grupo e clientes de fora.
-- Só nome e tipo são obrigatórios — os campos fiscais e de endereço já
-- existem porque a fábrica pretende emitir NFe, e é mais barato ter a
-- coluna vazia agora do que migrar depois com os cadastros em uso.
CREATE TABLE IF NOT EXISTS fabrica_clientes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'LOJA',   -- LOJA | EXTERNO
  cnpj TEXT,
  inscricao_estadual TEXT,
  email TEXT,
  telefone TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_clientes_tipo ON fabrica_clientes (tipo, nome);

-- Cadastro de embalagem da Fábrica Distribuidora: o balde, a bombona, o galão.
-- Antes disso o custo da embalagem era um número digitado dentro de cada
-- fórmula — o mesmo balde de 18 kg tinha o preço repetido em 23 lugares, e
-- não existia entidade "balde" pra ter saldo, mínimo ou alerta de compra.
CREATE TABLE IF NOT EXISTS fabrica_embalagens (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  peso_kg NUMERIC(12, 3) NOT NULL,
  custo_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estoque NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estoque_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ligação opcional: enquanto a embalagem de uma fórmula não estiver ligada a
-- um cadastro, ela segue usando o custo digitado nela. Assim a migração pode
-- ser feita fórmula a fórmula, sem nada parar de funcionar no meio.
ALTER TABLE formula_embalagens
  ADD COLUMN IF NOT EXISTS fabrica_embalagem_id INTEGER
  REFERENCES fabrica_embalagens(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_formula_embalagens_fabrica
  ON formula_embalagens (fabrica_embalagem_id);

-- Estoque mínimo por matéria-prima. Zero significa "não controlo essa",
-- não "está sempre em falta" — o alerta só dispara com mínimo definido.
ALTER TABLE materias_primas
  ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- Ajuste de estoque de matéria-prima: inventário, perda, quebra, correção.
-- Positivo entra, negativo sai. O saldo nunca é guardado — sai sempre de
-- comprado (materia_prima_compras) menos consumido (explodindo a receita de
-- cada lote até a MP crua) mais estes ajustes. Guardar saldo daria
-- divergência silenciosa: um lote lançado com atraso deixaria o número
-- parado sem ninguém perceber.
CREATE TABLE IF NOT EXISTS fabrica_estoque_ajustes (
  id SERIAL PRIMARY KEY,
  materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade_kg NUMERIC(12, 3) NOT NULL,
  motivo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_estoque_ajustes_mp
  ON fabrica_estoque_ajustes (materia_prima_id, data DESC);

-- Estoque de embalagem: mesmo princípio do estoque de matéria-prima — o saldo
-- não é digitado, sai de comprado − consumido + ajustes. A coluna "estoque"
-- que existia guardava um número solto que ninguém atualizava depois da
-- primeira digitação; sai daqui.
ALTER TABLE fabrica_embalagens DROP COLUMN IF EXISTS estoque;

-- Balde de 18, 16 e 15 kg são o MESMO balde físico — muda só quanto se põe
-- dentro. Sem isso o sistema acharia que tem três estoques separados e nunca
-- avisaria pra comprar. Nulo significa "sou o balde raiz".
ALTER TABLE fabrica_embalagens
  ADD COLUMN IF NOT EXISTS equivale_a_id INTEGER REFERENCES fabrica_embalagens(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS fabrica_embalagem_compras (
  id SERIAL PRIMARY KEY,
  embalagem_id INTEGER NOT NULL REFERENCES fabrica_embalagens(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade INTEGER NOT NULL,
  custo_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_embalagem_compras_emb ON fabrica_embalagem_compras (embalagem_id);

CREATE TABLE IF NOT EXISTS fabrica_embalagem_ajustes (
  id SERIAL PRIMARY KEY,
  embalagem_id INTEGER NOT NULL REFERENCES fabrica_embalagens(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade INTEGER NOT NULL,
  motivo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_embalagem_ajustes_emb ON fabrica_embalagem_ajustes (embalagem_id);

-- Pedido de venda da Fábrica Distribuidora: a fábrica vendendo para as 20
-- lojas do grupo e para clientes de fora. Nada a ver com as vendas do Mercado
-- Livre que o Financeiro já acompanha — ali é a loja vendendo pro consumidor.
CREATE TABLE IF NOT EXISTS fabrica_pedidos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES fabrica_clientes(id) ON DELETE RESTRICT,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  -- ABERTO: separado, ainda não saiu. ENTREGUE: a loja levou.
  -- CANCELADO: não aconteceu — é o único que não baixa estoque.
  status TEXT NOT NULL DEFAULT 'ABERTO',
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_pedidos_cliente ON fabrica_pedidos (cliente_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_fabrica_pedidos_data ON fabrica_pedidos (data DESC);

-- preco_unitario e custo_unitario são gravados no item, não calculados depois.
-- É a exceção deliberada à regra de "nada derivável é guardado": uma venda que
-- aconteceu é um fato. Recalcular a margem de um pedido de março com o preço
-- da resina de hoje reescreveria a história.
CREATE TABLE IF NOT EXISTS fabrica_pedido_itens (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES fabrica_pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES fabrica_produtos(id) ON DELETE RESTRICT,
  quantidade NUMERIC(12, 3) NOT NULL,
  preco_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12, 4) NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fabrica_pedido_itens_pedido ON fabrica_pedido_itens (pedido_id);
CREATE INDEX IF NOT EXISTS idx_fabrica_pedido_itens_produto ON fabrica_pedido_itens (produto_id);

-- Estoque de produto acabado: entra pelo envase do lote, sai pelo pedido.
-- Este ajuste cobre o resto — inventário, quebra, amostra, devolução.
CREATE TABLE IF NOT EXISTS fabrica_produto_ajustes (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES fabrica_produtos(id) ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade NUMERIC(12, 3) NOT NULL,
  motivo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_produto_ajustes_produto ON fabrica_produto_ajustes (produto_id);

ALTER TABLE fabrica_produtos ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0;

-- Nem toda materia-prima e comprada. Agua sai da torneira e e 30 a 39% de
-- cada receita: sem esta marca ela vira o gargalo de TODAS as formulas, com
-- saldo zero, e a tela "Da pra fabricar" responde zero pra tudo. Insumo nao
-- controlado sai do calculo de gargalo, do alerta de minimo e do valor em
-- estoque — mas continua no custo, porque custar ele custa.
ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS controla_estoque BOOLEAN NOT NULL DEFAULT TRUE;


-- Contas a pagar e receber da FABRICA — o barracao da fabricacao, que paga
-- aluguel, agua e luz proprios.
--
-- Deliberadamente separado de contas_lancamentos, que e das lojas. Aquela
-- tabela exige loja_id NOT NULL: lancar a agua do barracao ali obrigaria a
-- escolher uma das 20 lojas, e a despesa da fabrica entraria no resultado
-- daquela loja. Nao existe "loja fabrica" — a loja chamada Fabrica de Tintas e
-- outra coisa, uma loja que compra da fabrica e vende no Mercado Livre.
--
-- custo_fixo separa o que o DRE precisa somar de aluguel e salario do que
-- varia com a producao.
--
-- A agua entra aqui como conta comum (categoria AGUA). O preco por quilo dela
-- fica fixo em R$ 0,01 no cadastro da materia-prima e e ajustado a mao quando
-- precisa: o custo da agua no produto e estavel e pequeno, e amarrar ele na
-- conta do mes faria o custo de todo produto oscilar por causa de uma variacao
-- de consumo que nao tem nada a ver com a receita.
CREATE TABLE IF NOT EXISTS fabrica_contas (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL DEFAULT 'pagar' CHECK (tipo IN ('pagar', 'receber')),
  descricao TEXT NOT NULL,
  categoria TEXT,
  contraparte TEXT,
  valor NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  vencimento DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  data_pagamento DATE,
  custo_fixo BOOLEAN NOT NULL DEFAULT TRUE,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_contas_venc ON fabrica_contas (vencimento DESC);
CREATE INDEX IF NOT EXISTS idx_fabrica_contas_status ON fabrica_contas (status, tipo);

DROP TABLE IF EXISTS fabrica_contas_insumo;
ALTER TABLE fabrica_contas DROP COLUMN IF EXISTS materia_prima_id;
ALTER TABLE fabrica_contas DROP COLUMN IF EXISTS percentual_producao;

-- Recebimento das lojas. Uma forma so: PIX no fechamento de terca.
--
-- Nao existe tabela de "conta a receber": o que a loja deve sai de pedidos
-- menos pagamentos, recalculado. Gerar um recebivel por pedido criaria dois
-- lugares dizendo a mesma coisa, e o pagamento parcial — que e a regra aqui,
-- nao a excecao — obrigaria a decidir qual pedido foi quitado primeiro. Com
-- conta corrente, pagar 90 de 100 simplesmente deixa 10 rolando pra semana
-- seguinte, que e como a fabrica ja funciona.
CREATE TABLE IF NOT EXISTS fabrica_pagamentos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES fabrica_clientes(id) ON DELETE RESTRICT,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  valor NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_pagamentos_cliente
  ON fabrica_pagamentos (cliente_id, data DESC);

-- Aliquota de imposto sobre a venda da fabrica, por mes.
--
-- Por mes e nao um numero so porque a aliquota muda, e um valor global faria
-- o resultado de marco mudar sozinho quando a de agosto fosse ajustada. Mes
-- sem aliquota herda a do mes anterior mais recente — assim nao precisa
-- digitar todo mes, mas o historico fica preso ao que valia na epoca.
--
-- E provisao, nao caixa: a fabrica vende e o imposto vem depois. O DRE do mes
-- da venda ja mostra a mordida; quando a guia chegar, ela e lancada no contas
-- a pagar e o DRE a joga no bloco "fora do resultado", senao o mesmo imposto
-- apareceria duas vezes em dois meses diferentes.
CREATE TABLE IF NOT EXISTS fabrica_impostos (
  competencia DATE PRIMARY KEY,
  percentual NUMERIC(6, 3) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devolucao: o caminho de volta da mercadoria.
--
-- Fabrica > vende > loja > cliente final. O cliente nao quis, nao estava em
-- casa ou o pedido extraviou, e o produto volta pra loja e da loja pra ca.
-- Acontece com todas as 21, toda semana.
--
-- Tres finais possiveis, e eles nao sao a mesma coisa nem no estoque nem no
-- dinheiro:
--
--   BOM        produto inteiro. Volta pro estoque de produto acabado e a loja
--              ganha credito, abatido no fechamento de terca.
--   ESTOURADO  vazou. Embalagem descartada, produto perdido. A loja pede
--              ressarcimento ao Mercado Livre e recebe direto na conta dela,
--              entao NAO ganha credito da fabrica — senao receberia duas vezes.
--   QUEBRADO   trincado mas com tinta. A tinta vai pros tambores pra
--              reprocesso, a embalagem e descartada. Tambem sem credito, pela
--              mesma razao do estourado.
--
-- credito fica editavel em vez de calculado: a regra acima e o padrao, mas
-- caso a caso muda, e uma regra rigida obrigaria a mentir a condicao pra
-- conseguir o valor certo.
--
-- custo_unitario e copiado do cadastro no lancamento, igual ao item do pedido.
-- Uma devolucao que aconteceu e um fato: recalcular com o custo de hoje mudaria
-- o resultado de um mes ja fechado.
CREATE TABLE IF NOT EXISTS fabrica_devolucoes (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES fabrica_clientes(id) ON DELETE RESTRICT,
  produto_id INTEGER NOT NULL REFERENCES fabrica_produtos(id) ON DELETE RESTRICT,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade NUMERIC(12, 3) NOT NULL CHECK (quantidade > 0),
  condicao TEXT NOT NULL DEFAULT 'BOM' CHECK (condicao IN ('BOM', 'ESTOURADO', 'QUEBRADO')),
  credito NUMERIC(12, 2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12, 4) NOT NULL DEFAULT 0,
  -- a fabrica emite nota em 100% das vendas, entao TODA devolucao deixa uma
  -- nota pra cancelar. Fica como pendencia visivel ate alguem marcar: esquecer
  -- de cancelar significa pagar imposto sobre uma venda que foi desfeita.
  nota_fiscal TEXT,
  nota_cancelada BOOLEAN NOT NULL DEFAULT FALSE,
  recebido_por TEXT,
  observacao TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_devolucoes_nota
  ON fabrica_devolucoes (nota_cancelada, data DESC);
CREATE INDEX IF NOT EXISTS idx_fabrica_devolucoes_cliente
  ON fabrica_devolucoes (cliente_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_fabrica_devolucoes_produto
  ON fabrica_devolucoes (produto_id, data DESC);

-- Ressarcimento do Mercado Livre pela avaria.
--
-- O funcionario que recebe a devolucao manda foto pro ML e pede ressarcimento.
-- O dinheiro cai na conta da LOJA, nao da fabrica — a venda no ML era dela.
-- Entao isso nao e receita da fabrica: e o controle de quanto a loja foi
-- coberta, que e o que decide se ela ainda merece credito.
--
-- ML pagou o valor cheio? A loja esta inteira, credito zero. Pagou parcial ou
-- negou? A diferenca ficou no colo da loja, e ai o credito entra pra cobrir.
-- Sem isso o funcionario teria que fazer essa conta de cabeca, balde a balde.
ALTER TABLE fabrica_devolucoes
  ADD COLUMN IF NOT EXISTS ressarcimento_status TEXT NOT NULL DEFAULT 'NAO_PEDIDO'
    CHECK (ressarcimento_status IN ('NAO_PEDIDO', 'PEDIDO', 'RECEBIDO', 'NEGADO'));
ALTER TABLE fabrica_devolucoes
  ADD COLUMN IF NOT EXISTS ressarcimento_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE fabrica_devolucoes ADD COLUMN IF NOT EXISTS ressarcimento_data DATE;
ALTER TABLE fabrica_devolucoes ADD COLUMN IF NOT EXISTS ressarcimento_protocolo TEXT;
CREATE INDEX IF NOT EXISTS idx_fabrica_devolucoes_ressarcimento
  ON fabrica_devolucoes (ressarcimento_status, data DESC);

-- Roteiro de producao: a ordem exata de fazer, com os tempos de espera.
--
-- Fica em tabela propria e NAO em formula_itens de proposito. O Custo de
-- Fabricacao salva a formula com DELETE + INSERT dos itens (salvarItens em
-- fabricacaoService), entao qualquer coluna de ordem ou instrucao que morasse
-- la seria apagada na primeira edicao da formula — sem erro, sem aviso, so
-- sumiria.
--
-- O roteiro guarda o proprio percentual em vez de apontar pro item da formula.
-- Os ids de formula_itens sao recriados a cada save, entao nao ha o que
-- apontar. Guardando o percentual, o roteiro imprime sozinho e ainda da pra
-- comparar com a formula e avisar quando os dois discordam.
--
-- Duas naturezas de passo na mesma tabela:
--   materia_prima_id ou sub_formula_id preenchido -> passo de ADICAO
--   os dois nulos                                 -> passo de INSTRUCAO
--     ("deixar em dispersao de 40 min a 1 hora ate abrir a fineza")
--
-- E por isso que a agua pode aparecer duas vezes: sao dois momentos
-- diferentes de adicao, que e justamente o que a folha impressa precisa dizer.
CREATE TABLE IF NOT EXISTS fabrica_roteiro_passos (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  materia_prima_id INTEGER REFERENCES materias_primas(id) ON DELETE RESTRICT,
  sub_formula_id INTEGER REFERENCES formulas(id) ON DELETE RESTRICT,
  percentual NUMERIC(6, 3),
  codigo TEXT,
  etapa TEXT,
  instrucao TEXT
);
CREATE INDEX IF NOT EXISTS idx_fabrica_roteiro_passos_formula
  ON fabrica_roteiro_passos (formula_id, ordem);

-- Controle de qualidade que vai no rodape da folha, pro operador preencher.
CREATE TABLE IF NOT EXISTS fabrica_roteiro_qc (
  id SERIAL PRIMARY KEY,
  formula_id INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  teste TEXT NOT NULL,
  especificacao TEXT
);
CREATE INDEX IF NOT EXISTS idx_fabrica_roteiro_qc_formula
  ON fabrica_roteiro_qc (formula_id, ordem);

-- Forma de pagamento da conta da Fábrica. A planilha do financeiro separa
-- Boleto, Cheque e Pix, e não é enfeite: são 62 cheques em aberto de uma vez,
-- e cheque tem data de compensação própria. Sem esse campo, "quanto tem de
-- cheque a compensar essa semana" não tem resposta.
--
-- Texto livre em vez de CHECK: o banco de hoje é o SICOOB, mas a forma nova
-- que aparecer amanhã não pode derrubar o INSERT.
ALTER TABLE fabrica_contas ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;

-- Nº do documento: a planilha traz "352340-1", "NFE 7616", "700235" (o número
-- do cheque). É por ele que a conciliação bancária vai casar o movimento do
-- extrato com a conta lançada.
ALTER TABLE fabrica_contas ADD COLUMN IF NOT EXISTS documento TEXT;
CREATE INDEX IF NOT EXISTS idx_fabrica_contas_documento
  ON fabrica_contas (documento) WHERE documento IS NOT NULL;

-- Bens da Fábrica: maquinário, veículos, o que a empresa comprou e continua
-- tendo. Comprar não é gastar — o dinheiro virou um bem que segue valendo.
-- O que empobrece é o desgaste, e ele acontece um pouco por mês.
--
-- É daqui que sai a linha de depreciação do DRE. A parcela do financiamento
-- continua no contas a pagar (tem cheque pra pagar dia 17), mas não abate o
-- lucro: quem abate é o desgaste, senão o mês em que a última parcela cai
-- pareceria muito melhor que o anterior sem nada ter mudado no negócio.
--
-- valor é sempre o de compra, cheio. Não desconta o que já foi pago: o
-- caminhão vale o que vale, quitado ou não.
CREATE TABLE IF NOT EXISTS fabrica_bens (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'movel' CHECK (tipo IN ('movel', 'imovel')),
  valor NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  data_compra DATE NOT NULL,
  -- 10 anos pra máquina, 5 pra veículo: o padrão que a contabilidade usa.
  -- Imóvel costuma ser 25. Editável porque quem manda é o contador.
  vida_util_anos NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (vida_util_anos > 0),
  observacao TEXT,
  -- bem vendido ou baixado para de depreciar, mas não some do histórico
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_bens_data ON fabrica_bens (data_compra DESC);

-- Fornecedor da Fábrica Distribuidora.
--
-- O nome do fornecedor era texto digitado em cada conta, e o resultado
-- apareceu sozinho na primeira carga: "METALLOG" e "MATALLOG BRASIL" são a
-- mesma empresa, "ATACADAO DO EPI" e "ATACADAO DO EPI0" também. Cada erro de
-- digitação vira um fornecedor novo no relatório, e o total por fornecedor
-- deixa de fechar.
--
-- A conta continua guardando o nome em `contraparte` (texto): as 271 já
-- lançadas seguem valendo, e o cadastro entra como a fonte da busca, para o
-- nome sair sempre igual.
CREATE TABLE IF NOT EXISTS fabrica_fornecedores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  email TEXT,
  telefone TEXT,
  cidade TEXT,
  uf TEXT,
  -- o que ele fornece: REVENDA, MATÉRIA-PRIMA, EMBALAGEM… sugere a categoria
  -- da conta na hora de lançar
  categoria_padrao TEXT,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_fornecedores_nome ON fabrica_fornecedores (nome);

-- Endereço e inscrição do fornecedor: os mesmos campos que o cliente já tem.
-- A fábrica vai emitir NFe e precisa dos dados do fornecedor tanto quanto dos
-- do cliente — e é mais barato ter a coluna vazia do que migrar depois.
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT;
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS logradouro TEXT;
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS numero TEXT;
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS complemento TEXT;
ALTER TABLE fabrica_fornecedores ADD COLUMN IF NOT EXISTS bairro TEXT;

-- Produto de revenda na Fábrica Distribuidora.
--
-- Hoje a fábrica vende dois tipos de coisa para as lojas: o que ela fabrica
-- (sai de uma fórmula, e o custo se recalcula quando a resina muda de preço) e
-- o que ela compra pronto e revende (o custo é o que se pagou ao fornecedor).
-- São regras de custo diferentes, e é `origem` que separa as duas.
--
-- `custo_compra` só existe para a revenda: no produto de fábrica o custo vem da
-- fórmula, e ter um número digitado ao lado dele criaria duas verdades.
ALTER TABLE fabrica_produtos
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'FABRICA';
ALTER TABLE fabrica_produtos
  ADD COLUMN IF NOT EXISTS custo_compra NUMERIC(12, 2);
ALTER TABLE fabrica_produtos ADD COLUMN IF NOT EXISTS ean TEXT;
-- família do catálogo (Resiflex, Selaturbo…): a planilha agrupa por ela, e é
-- o que dá pra filtrar quando são 5 mil SKUs
ALTER TABLE fabrica_produtos ADD COLUMN IF NOT EXISTS familia TEXT;

CREATE INDEX IF NOT EXISTS idx_fabrica_produtos_origem
  ON fabrica_produtos (origem, familia);
CREATE INDEX IF NOT EXISTS idx_fabrica_produtos_ean
  ON fabrica_produtos (ean) WHERE ean IS NOT NULL;

-- Liga o cliente da Fábrica à loja do Mercado Livre.
--
-- As lojas trabalham com estoque zero: só pegam o que venderam, e a expedição
-- fica no mesmo galpão. Então a venda no ML É a retirada do estoque da fábrica
-- — não é aproximação, é o mesmo evento visto de outro lado.
--
-- Casar por nome funcionaria hoje (20 de 21 batem), mas quebra em silêncio no
-- dia em que alguém renomear a loja. O id fica gravado.
ALTER TABLE fabrica_clientes
  ADD COLUMN IF NOT EXISTS loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fabrica_clientes_loja ON fabrica_clientes (loja_id);

-- Venda do ML que já virou pedido da fábrica.
--
-- O ciclo do Hudson é de 7 dias, mas o dia 8 já gera compra nova, e sobra do
-- dia 7 que ficou fora do fechamento. Sem marcar o que já entrou, a mesma
-- venda entraria em dois pedidos e ele faturaria duas vezes a mesma coisa.
--
-- A chave é o item da ordem no ML (order_id + item_id): uma ordem pode ter
-- vários itens, e cada um vira uma linha do pedido.
CREATE TABLE IF NOT EXISTS fabrica_ml_importado (
  order_id BIGINT NOT NULL,
  item_id TEXT NOT NULL,
  pedido_id INTEGER REFERENCES fabrica_pedidos(id) ON DELETE CASCADE,
  loja_id INTEGER,
  sku TEXT,
  quantidade NUMERIC(12, 3) NOT NULL DEFAULT 0,
  data_venda DATE,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_fabrica_ml_importado_pedido
  ON fabrica_ml_importado (pedido_id);

-- Venda que não vem da API do Mercado Livre: Shopee e venda direta.
--
-- A API só enxerga o que passou pelo ML — medido num período de 7 dias, isso é
-- 65% do que a fábrica realmente vendeu. O resto sai da Shopee e da venda
-- direta, e hoje o funcionário digita tudo à mão.
--
-- Guarda a origem e a linha crua do que foi colado: se o mesmo arquivo for
-- importado duas vezes, dá pra ver o que já entrou em vez de duplicar o
-- faturamento.
CREATE TABLE IF NOT EXISTS fabrica_venda_importada (
  id SERIAL PRIMARY KEY,
  origem TEXT NOT NULL,
  -- identificador do pedido no canal de origem, quando existe
  documento TEXT,
  cliente_id INTEGER REFERENCES fabrica_clientes(id) ON DELETE SET NULL,
  pedido_id INTEGER REFERENCES fabrica_pedidos(id) ON DELETE CASCADE,
  data_venda DATE NOT NULL,
  sku TEXT,
  quantidade NUMERIC(12, 3) NOT NULL DEFAULT 0,
  valor NUMERIC(12, 2) NOT NULL DEFAULT 0,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrica_venda_importada_pedido
  ON fabrica_venda_importada (pedido_id);
-- a mesma venda não entra duas vezes: canal + documento + sku é a identidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_fabrica_venda_importada_unica
  ON fabrica_venda_importada (origem, documento, sku)
  WHERE documento IS NOT NULL;

-- Conta pai do cliente.
--
-- Vinte e duas lojas vendem, mas quem paga são dez contas. Cores Certas,
-- Hangar, Inga Collors e Perpétua vendem no próprio nome e a cobrança inteira
-- vai para a Catedral Impermeabilizantes; Palazzo e Rosário caem na Pinta e
-- Constrói. É assim desde sempre, e é por isso que o fechamento tem 15 linhas
-- para 22 lojas.
--
-- Sem esse vínculo, ou se perde de vista quanto cada loja gira (agrupando tudo
-- no pai, como a planilha faz hoje) ou se cobra de quem não paga. Com ele, o
-- pedido fica na loja que vendeu e a cobrança vai para o pai — as duas
-- leituras, sem escolher uma.
--
-- Pai nulo significa que a própria loja paga: é o caso da CASG, da Lux Collor
-- e das outras que fecham em nome próprio.
ALTER TABLE fabrica_clientes
  ADD COLUMN IF NOT EXISTS cliente_pai_id INTEGER REFERENCES fabrica_clientes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fabrica_clientes_pai ON fabrica_clientes (cliente_pai_id);
