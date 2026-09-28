import { pool } from "../db/pool";
import { dataISOBR } from "./dateUtils";
import { ehOcorrencia, semanaDe, diasEntre } from "./agendaOcorrencias";
import { listLojas } from "./tokenStore";
import { obterCampanhaAtivaDaLoja } from "./mercadoLivreApi";

export interface TarefaAgenda {
  id: number;
  titulo: string;
  descricao: string | null;
  intervaloDias: number;
  dataInicio: string;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  expiraComPromocao: boolean;
  criadoPorUsuarioId: number;
  criadoPorNome: string;
  ativo: boolean;
}

interface LinhaTarefa {
  id: number;
  titulo: string;
  descricao: string | null;
  intervalo_dias: number;
  data_inicio: string;
  atribuido_a_usuario_id: number | null;
  atribuido_a_nome: string | null;
  loja_id: number | null;
  loja_nome: string | null;
  expira_com_promocao: boolean;
  criado_por_usuario_id: number;
  criado_por_nome: string;
  ativo: boolean;
}

function mapearTarefa(l: LinhaTarefa): TarefaAgenda {
  return {
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    intervaloDias: l.intervalo_dias,
    dataInicio: l.data_inicio,
    atribuidoAUsuarioId: l.atribuido_a_usuario_id,
    atribuidoANome: l.atribuido_a_nome,
    lojaId: l.loja_id,
    lojaNome: l.loja_nome,
    expiraComPromocao: l.expira_com_promocao,
    criadoPorUsuarioId: l.criado_por_usuario_id,
    criadoPorNome: l.criado_por_nome,
    ativo: l.ativo,
  };
}

const SELECT_TAREFA = `
  SELECT
    t.id, t.titulo, t.descricao, t.intervalo_dias,
    to_char(t.data_inicio, 'YYYY-MM-DD') AS data_inicio,
    t.atribuido_a_usuario_id, atribuido.nome AS atribuido_a_nome,
    t.loja_id, loja.nome AS loja_nome,
    t.expira_com_promocao,
    t.criado_por_usuario_id, criador.nome AS criado_por_nome,
    t.ativo
  FROM agenda_tarefas t
  LEFT JOIN usuarios atribuido ON atribuido.id = t.atribuido_a_usuario_id
  LEFT JOIN lojas loja ON loja.id = t.loja_id
  JOIN usuarios criador ON criador.id = t.criado_por_usuario_id
`;

export async function listarTarefas(): Promise<TarefaAgenda[]> {
  const { rows } = await pool.query<LinhaTarefa>(`${SELECT_TAREFA} ORDER BY t.ativo DESC, t.titulo`);
  return rows.map(mapearTarefa);
}

export async function criarTarefa(
  criadoPorUsuarioId: number,
  dados: {
    titulo: string;
    descricao?: string | null;
    intervaloDias: number;
    dataInicio: string;
    atribuidoAUsuarioId?: number | null;
    lojaId?: number | null;
    expiraComPromocao?: boolean;
  }
): Promise<TarefaAgenda> {
  // Aviso de expiração é sempre diário — a urgência (cor) já muda sozinha
  // conforme o prazo real encolhe, não faz sentido "pular dias" nesse tipo.
  const intervaloDias = dados.expiraComPromocao ? 1 : dados.intervaloDias;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO agenda_tarefas (titulo, descricao, intervalo_dias, data_inicio, atribuido_a_usuario_id, loja_id, expira_com_promocao, criado_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      dados.titulo,
      dados.descricao ?? null,
      intervaloDias,
      dados.dataInicio,
      dados.atribuidoAUsuarioId ?? null,
      dados.lojaId ?? null,
      dados.expiraComPromocao ?? false,
      criadoPorUsuarioId,
    ]
  );
  const { rows: criada } = await pool.query<LinhaTarefa>(`${SELECT_TAREFA} WHERE t.id = $1`, [rows[0].id]);
  return mapearTarefa(criada[0]);
}

export async function atualizarTarefa(
  id: number,
  dados: Partial<{
    titulo: string;
    descricao: string | null;
    intervaloDias: number;
    dataInicio: string;
    atribuidoAUsuarioId: number | null;
    lojaId: number | null;
    expiraComPromocao: boolean;
    ativo: boolean;
  }>
): Promise<void> {
  // Sem checagem de dono — os dois usuários da Agenda podem editar qualquer
  // tarefa (decisão explícita, diferente do compartilhamento do Tarefas).
  const campos: string[] = [];
  const valores: unknown[] = [];
  function set(coluna: string, valor: unknown) {
    valores.push(valor);
    campos.push(`${coluna} = $${valores.length}`);
  }
  if (dados.titulo !== undefined) set("titulo", dados.titulo);
  if (dados.descricao !== undefined) set("descricao", dados.descricao);
  // Igual em criarTarefa: aviso de expiração é sempre diário.
  if (dados.intervaloDias !== undefined) set("intervalo_dias", dados.expiraComPromocao ? 1 : dados.intervaloDias);
  if (dados.dataInicio !== undefined) set("data_inicio", dados.dataInicio);
  if (dados.atribuidoAUsuarioId !== undefined) set("atribuido_a_usuario_id", dados.atribuidoAUsuarioId);
  if (dados.lojaId !== undefined) set("loja_id", dados.lojaId);
  if (dados.expiraComPromocao !== undefined) {
    set("expira_com_promocao", dados.expiraComPromocao);
    if (dados.expiraComPromocao && dados.intervaloDias === undefined) set("intervalo_dias", 1);
  }
  if (dados.ativo !== undefined) set("ativo", dados.ativo);
  if (campos.length === 0) return;
  campos.push("atualizado_em = now()");
  valores.push(id);
  await pool.query(`UPDATE agenda_tarefas SET ${campos.join(", ")} WHERE id = $${valores.length}`, valores);
}

export async function excluirTarefa(id: number): Promise<void> {
  await pool.query("DELETE FROM agenda_tarefas WHERE id = $1", [id]);
}

export interface OcorrenciaDia {
  tarefaId: number;
  titulo: string;
  descricao: string | null;
  atribuidoAUsuarioId: number | null;
  atribuidoANome: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  concluido: boolean;
  atrasado: boolean;
  expiraComPromocao: boolean;
  // Só fazem sentido quando expiraComPromocao é true — nome da campanha
  // própria em vigor na loja e quantos dias faltam pra vencer.
  // promocaoDiasRestantes null (com expiraComPromocao true) = não achou
  // nenhuma campanha própria ativa — o front trata isso como o caso MAIS
  // urgente, não como "sem info".
  promocaoNome: string | null;
  promocaoDiasRestantes: number | null;
}

// Cache do lookup "qual campanha própria está valendo nessa loja" — bate na
// API do Mercado Livre de verdade (amostra de itens), não é algo pra
// refazer a cada carregamento da tela. Atualiza sozinho a cada 6h.
const CACHE_CAMPANHA_TTL_MS = 6 * 60 * 60 * 1000;
const cacheCampanhaPorLoja = new Map<number, { data: { nome: string; finishDate: string } | null; expiraEm: number }>();

async function obterCampanhaComCache(lojaId: number): Promise<{ nome: string; finishDate: string } | null> {
  const emCache = cacheCampanhaPorLoja.get(lojaId);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.data;

  const loja = (await listLojas()).find((l) => l.id === lojaId);
  let data: { nome: string; finishDate: string } | null = null;
  if (loja?.ml_user_id) {
    data = await obterCampanhaAtivaDaLoja(lojaId, loja.ml_user_id).catch(() => null);
  }
  cacheCampanhaPorLoja.set(lojaId, { data, expiraEm: Date.now() + CACHE_CAMPANHA_TTL_MS });
  return data;
}

export interface DiaSemanaAgenda {
  data: string;
  ocorrencias: OcorrenciaDia[];
}

export interface SemanaAgenda {
  hoje: string;
  inicioSemana: string;
  fimSemana: string;
  dias: DiaSemanaAgenda[];
}

export async function obterSemanaAtual(): Promise<SemanaAgenda> {
  const hoje = dataISOBR(new Date());
  const { inicioSemana, fimSemana, dias } = semanaDe(hoje);

  const { rows: tarefas } = await pool.query<{
    id: number;
    titulo: string;
    descricao: string | null;
    intervalo_dias: number;
    data_inicio: string;
    atribuido_a_usuario_id: number | null;
    atribuido_a_nome: string | null;
    loja_id: number | null;
    loja_nome: string | null;
    expira_com_promocao: boolean;
  }>(
    `SELECT t.id, t.titulo, t.descricao, t.intervalo_dias, to_char(t.data_inicio, 'YYYY-MM-DD') AS data_inicio,
            t.atribuido_a_usuario_id, u.nome AS atribuido_a_nome,
            t.loja_id, loja.nome AS loja_nome, t.expira_com_promocao
     FROM agenda_tarefas t
     LEFT JOIN usuarios u ON u.id = t.atribuido_a_usuario_id
     LEFT JOIN lojas loja ON loja.id = t.loja_id
     WHERE t.ativo = true`
  );

  const { rows: feitas } = await pool.query<{ tarefa_id: number; data_ocorrencia: string }>(
    `SELECT tarefa_id, to_char(data_ocorrencia, 'YYYY-MM-DD') AS data_ocorrencia
     FROM agenda_ocorrencias
     WHERE data_ocorrencia BETWEEN $1 AND $2`,
    [inicioSemana, fimSemana]
  );
  const feitasSet = new Set(feitas.map((f) => `${f.tarefa_id}|${f.data_ocorrencia}`));

  // Uma consulta de campanha por LOJA (não por tarefa) — o cache já garante
  // isso, mas resolver aqui antes do map evita await dentro de callback.
  const infoPromocaoPorTarefa = new Map<number, { promocaoNome: string | null; promocaoDiasRestantes: number | null }>();
  for (const t of tarefas) {
    if (!t.expira_com_promocao || t.loja_id === null) continue;
    const campanha = await obterCampanhaComCache(t.loja_id);
    infoPromocaoPorTarefa.set(t.id, {
      promocaoNome: campanha?.nome ?? null,
      promocaoDiasRestantes: campanha ? diasEntre(hoje, campanha.finishDate.slice(0, 10)) : null,
    });
  }

  const diasResp: DiaSemanaAgenda[] = dias.map((data) => ({
    data,
    ocorrencias: tarefas
      .filter((t) => ehOcorrencia(t.data_inicio, t.intervalo_dias, data))
      .map((t) => {
        const concluido = feitasSet.has(`${t.id}|${data}`);
        const infoPromocao = infoPromocaoPorTarefa.get(t.id);
        return {
          tarefaId: t.id,
          titulo: t.titulo,
          descricao: t.descricao,
          atribuidoAUsuarioId: t.atribuido_a_usuario_id,
          atribuidoANome: t.atribuido_a_nome,
          lojaId: t.loja_id,
          lojaNome: t.loja_nome,
          concluido,
          atrasado: !concluido && data < hoje,
          expiraComPromocao: t.expira_com_promocao,
          promocaoNome: infoPromocao?.promocaoNome ?? null,
          promocaoDiasRestantes: infoPromocao?.promocaoDiasRestantes ?? null,
        };
      }),
  }));

  return { hoje, inicioSemana, fimSemana, dias: diasResp };
}

export async function marcarOcorrenciaFeita(tarefaId: number, data: string, usuarioId: number): Promise<void> {
  const { rows } = await pool.query<{ data_inicio: string; intervalo_dias: number }>(
    "SELECT to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, intervalo_dias FROM agenda_tarefas WHERE id = $1",
    [tarefaId]
  );
  if (!rows[0]) throw new Error("Tarefa não encontrada.");
  if (!ehOcorrencia(rows[0].data_inicio, rows[0].intervalo_dias, data)) {
    throw new Error("Essa data não corresponde a uma ocorrência dessa tarefa.");
  }
  await pool.query(
    `INSERT INTO agenda_ocorrencias (tarefa_id, data_ocorrencia, concluido_por_usuario_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (tarefa_id, data_ocorrencia) DO UPDATE SET concluido_em = now(), concluido_por_usuario_id = $3`,
    [tarefaId, data, usuarioId]
  );
}

export async function desmarcarOcorrencia(tarefaId: number, data: string): Promise<void> {
  await pool.query("DELETE FROM agenda_ocorrencias WHERE tarefa_id = $1 AND data_ocorrencia = $2", [tarefaId, data]);
}

// Contagem pro badge/notificação: ocorrências de hoje-ou-atrasadas, ainda
// não feitas, atribuídas a `usuarioId` OU sem atribuição (= "qualquer um").
export async function contarPendentes(usuarioId: number): Promise<number> {
  const { dias } = await obterSemanaAtual();
  const hoje = dataISOBR(new Date());
  let total = 0;
  for (const dia of dias) {
    if (dia.data > hoje) continue;
    for (const oc of dia.ocorrencias) {
      if (oc.concluido) continue;
      if (oc.atribuidoAUsuarioId === null || oc.atribuidoAUsuarioId === usuarioId) total++;
    }
  }
  return total;
}

// Decisão explícita do dono: a Agenda é só pra ele e pro Brunão, e o campo
// "responsável" só precisa oferecer o Brunão (não a lista inteira de logins
// do painel, que inclui gente de outras áreas sem nada a ver com isso).
// Comparação sem acento/maiúscula pra não depender de exatamente como
// "Brunão" foi digitado no cadastro do usuário.
export async function listarUsuariosParaAtribuir(): Promise<{ id: number; nome: string }[]> {
  const { rows } = await pool.query(
    `SELECT id, nome FROM usuarios
     WHERE lower(translate(nome, 'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) LIKE '%brunao%'
     ORDER BY nome`
  );
  return rows;
}

// As 4 lojas originais do dono (Hangar, Catedral, Inga Collors, Perpétua) —
// diferente das outras 12+ lojas que o painel também gerencia hoje, que não
// têm nada a ver com as tarefas físicas do Brunão. Ids fixos porque foram as
// primeiras inseridas pelo seed e nunca mudam.
const LOJAS_DO_DONO = [1, 2, 3, 4];

export async function listarLojasParaAgenda(): Promise<{ id: number; nome: string }[]> {
  const { rows } = await pool.query("SELECT id, nome FROM lojas WHERE id = ANY($1) ORDER BY id", [LOJAS_DO_DONO]);
  return rows;
}

export interface RelatorioAgenda {
  id: number;
  texto: string;
  usuarioId: number;
  usuarioNome: string;
  criadoEm: string;
}

interface LinhaRelatorio {
  id: number;
  texto: string;
  usuario_id: number;
  usuario_nome: string;
  criado_em: string;
}

function mapearRelatorio(r: LinhaRelatorio): RelatorioAgenda {
  return { id: r.id, texto: r.texto, usuarioId: r.usuario_id, usuarioNome: r.usuario_nome, criadoEm: r.criado_em };
}

const SELECT_RELATORIO = `
  SELECT r.id, r.texto, r.usuario_id, u.nome AS usuario_nome, r.criado_em
  FROM agenda_relatorios r
  JOIN usuarios u ON u.id = r.usuario_id
`;

// Feed livre — texto sem estrutura, quem lê é que interpreta ("SKUs
// criados: <link>", um MLB solto, etc.). Mais recente primeiro, sem
// paginação por enquanto (log de uso baixo, não é uma tabela de eventos).
export async function listarRelatorios(): Promise<RelatorioAgenda[]> {
  const { rows } = await pool.query<LinhaRelatorio>(`${SELECT_RELATORIO} ORDER BY r.criado_em DESC`);
  return rows.map(mapearRelatorio);
}

export async function criarRelatorio(usuarioId: number, texto: string): Promise<RelatorioAgenda> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO agenda_relatorios (texto, usuario_id) VALUES ($1, $2) RETURNING id",
    [texto, usuarioId]
  );
  const { rows: criado } = await pool.query<LinhaRelatorio>(`${SELECT_RELATORIO} WHERE r.id = $1`, [rows[0].id]);
  return mapearRelatorio(criado[0]);
}

export async function excluirRelatorio(id: number): Promise<void> {
  await pool.query("DELETE FROM agenda_relatorios WHERE id = $1", [id]);
}
