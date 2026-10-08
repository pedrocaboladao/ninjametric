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
  }
): Promise<TarefaAgenda> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO agenda_tarefas (titulo, descricao, intervalo_dias, data_inicio, atribuido_a_usuario_id, loja_id, criado_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      dados.titulo,
      dados.descricao ?? null,
      dados.intervaloDias,
      dados.dataInicio,
      dados.atribuidoAUsuarioId ?? null,
      dados.lojaId ?? null,
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
  if (dados.intervaloDias !== undefined) set("intervalo_dias", dados.intervaloDias);
  if (dados.dataInicio !== undefined) set("data_inicio", dados.dataInicio);
  if (dados.atribuidoAUsuarioId !== undefined) set("atribuido_a_usuario_id", dados.atribuidoAUsuarioId);
  if (dados.lojaId !== undefined) set("loja_id", dados.lojaId);
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
    data = await obterCampanhaAtivaDaLoja(lojaId, loja.ml_user_id);
  }
  cacheCampanhaPorLoja.set(lojaId, { data, expiraEm: Date.now() + CACHE_CAMPANHA_TTL_MS });
  return data;
}

export interface PromocaoDaLoja {
  lojaId: number;
  lojaNome: string;
  promocaoNome: string | null;
  diasRestantes: number | null;
}

// Resumo fixo pro topo da tela: pras 4 lojas do dono, qual campanha própria
// está valendo e quantos dias reais faltam pra vencer — sem precisar
// cadastrar nenhuma tarefa pra isso, calculado ao vivo (com cache) direto do
// Mercado Livre, igual ao antigo aviso por tarefa (ver histórico do módulo).
export async function listarPromocoesDasLojas(): Promise<PromocaoDaLoja[]> {
  const hoje = dataISOBR(new Date());
  const lojas = await listarLojasParaAgenda();
  return Promise.all(
    lojas.map(async (loja) => {
      const campanha = await obterCampanhaComCache(loja.id).catch((err) => {
        console.error(`Falha ao buscar campanha da loja ${loja.nome}:`, err);
        return null;
      });
      return {
        lojaId: loja.id,
        lojaNome: loja.nome,
        promocaoNome: campanha?.nome ?? null,
        diasRestantes: campanha ? diasEntre(hoje, dataISOBR(new Date(campanha.finishDate))) : null,
      };
    })
  );
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
  }>(
    `SELECT t.id, t.titulo, t.descricao, t.intervalo_dias, to_char(t.data_inicio, 'YYYY-MM-DD') AS data_inicio,
            t.atribuido_a_usuario_id, u.nome AS atribuido_a_nome,
            t.loja_id, loja.nome AS loja_nome
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

  const diasResp: DiaSemanaAgenda[] = dias.map((data) => ({
    data,
    ocorrencias: tarefas
      .filter((t) => ehOcorrencia(t.data_inicio, t.intervalo_dias, data))
      .map((t) => {
        const concluido = feitasSet.has(`${t.id}|${data}`);
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
  sku: string;
  link: string;
  texto: string | null;
  lojaId: number | null;
  lojaNome: string | null;
  usuarioId: number;
  usuarioNome: string;
  criadoEm: string;
}

interface LinhaRelatorio {
  id: number;
  sku: string;
  link: string;
  texto: string | null;
  loja_id: number | null;
  loja_nome: string | null;
  usuario_id: number;
  usuario_nome: string;
  criado_em: string;
}

function mapearRelatorio(r: LinhaRelatorio): RelatorioAgenda {
  return {
    id: r.id,
    sku: r.sku,
    link: r.link,
    texto: r.texto,
    lojaId: r.loja_id,
    lojaNome: r.loja_nome,
    usuarioId: r.usuario_id,
    usuarioNome: r.usuario_nome,
    criadoEm: r.criado_em,
  };
}

const SELECT_RELATORIO = `
  SELECT r.id, r.sku, r.link, r.texto, r.loja_id, loja.nome AS loja_nome, r.usuario_id, u.nome AS usuario_nome, r.criado_em
  FROM agenda_relatorios r
  JOIN usuarios u ON u.id = r.usuario_id
  LEFT JOIN lojas loja ON loja.id = r.loja_id
`;

// SKU + link do anúncio criado, com loja como tag opcional. Mais recente
// primeiro, sem paginação por enquanto (log de uso baixo, não é uma tabela
// de eventos).
export async function listarRelatorios(): Promise<RelatorioAgenda[]> {
  const { rows } = await pool.query<LinhaRelatorio>(`${SELECT_RELATORIO} ORDER BY r.criado_em DESC`);
  return rows.map(mapearRelatorio);
}

export async function criarRelatorio(
  usuarioId: number,
  dados: { sku: string; link: string; texto?: string | null; lojaId?: number | null }
): Promise<RelatorioAgenda> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO agenda_relatorios (sku, link, texto, loja_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [dados.sku, dados.link, dados.texto ?? null, dados.lojaId ?? null, usuarioId]
  );
  const { rows: criado } = await pool.query<LinhaRelatorio>(`${SELECT_RELATORIO} WHERE r.id = $1`, [rows[0].id]);
  return mapearRelatorio(criado[0]);
}

export async function excluirRelatorio(id: number): Promise<void> {
  await pool.query("DELETE FROM agenda_relatorios WHERE id = $1", [id]);
}

export interface AvisoAgenda {
  id: number;
  texto: string;
  usuarioNome: string;
  criadoEm: string;
  podeExcluir: boolean;
}

export async function listarAvisos(usuarioId: number): Promise<AvisoAgenda[]> {
  const { rows } = await pool.query<{ id: number; texto: string; usuario_id: number; usuario_nome: string; criado_em: string }>(
    `SELECT a.id, a.texto, a.usuario_id, u.nome AS usuario_nome, a.criado_em
     FROM agenda_avisos a JOIN usuarios u ON u.id = a.usuario_id
     ORDER BY a.criado_em DESC LIMIT 200`
  );
  return rows.map((r) => ({
    id: r.id,
    texto: r.texto,
    usuarioNome: r.usuario_nome,
    criadoEm: r.criado_em,
    podeExcluir: r.usuario_id === usuarioId,
  }));
}

export async function criarAviso(usuarioId: number, texto: string): Promise<void> {
  await pool.query("INSERT INTO agenda_avisos (texto, usuario_id) VALUES ($1, $2)", [texto, usuarioId]);
}

// Quantos avisos de OUTRO usuário chegaram desde a última vez que este
// usuário viu o mural — vira a bolinha "+N" na aba Mural de avisos. Sem
// linha em agenda_mural_visto (nunca abriu o mural), o COALESCE cai pra
// now(): nenhum aviso antigo é "novo", só os que chegarem daqui pra frente.
export async function contarAvisosNaoVistos(usuarioId: number): Promise<number> {
  const { rows } = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM agenda_avisos a
     WHERE a.usuario_id != $1
       AND a.criado_em > COALESCE((SELECT ultimo_visto FROM agenda_mural_visto WHERE usuario_id = $1), now())`,
    [usuarioId]
  );
  return rows[0].total;
}

// Chamado quando o usuário abre (ou já está) na aba Mural de avisos —
// zera a contagem de não vistos marcando "visto agora".
export async function marcarMuralVisto(usuarioId: number): Promise<void> {
  await pool.query(
    `INSERT INTO agenda_mural_visto (usuario_id, ultimo_visto) VALUES ($1, now())
     ON CONFLICT (usuario_id) DO UPDATE SET ultimo_visto = now()`,
    [usuarioId]
  );
}

// Só quem escreveu o aviso apaga — o mural é de recado, não de moderação.
export async function excluirAviso(id: number, usuarioId: number): Promise<void> {
  const { rowCount } = await pool.query("DELETE FROM agenda_avisos WHERE id = $1 AND usuario_id = $2", [id, usuarioId]);
  if (rowCount === 0) throw new Error("Aviso não encontrado ou não é seu.");
}
