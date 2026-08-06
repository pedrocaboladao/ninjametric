import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCampanhas,
  criarCampanha,
  recriarCampanha,
  registrarCampanhasExistentes,
  iniciarDescoberta,
  fetchProgressoDescoberta,
} from "../api/promocoes";
import { fetchLojas, type Loja } from "../api/lojas";
import type {
  Campanha,
  ResultadoCriarCampanha,
  RegistroExistenteEntrada,
  ResultadoRegistroLinha,
  ProgressoDescoberta,
} from "../types/promocoes";
import { formatCurrency } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

function diasAte(dataISO: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataISO}T00:00:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
}

function statusInfo(c: Campanha): { texto: string; classe: string } {
  if (c.status === "finished") return { texto: "Vencida", classe: "financeiro-margem-negativa" };
  const dias = diasAte(c.dataFim);
  if (dias <= 0) return { texto: "Vencida", classe: "financeiro-margem-negativa" };
  if (dias <= 2) return { texto: `Vence em ${dias} dia${dias > 1 ? "s" : ""}`, classe: "financeiro-margem-alerta" };
  if (c.status === "pending") return { texto: "Aguardando início", classe: "financeiro-td-mudo" };
  return { texto: `Ativa — vence em ${dias} dias`, classe: "financeiro-margem-positiva" };
}

function ResultadoCriacao({ resultado }: { resultado: ResultadoCriarCampanha }) {
  const sucesso = resultado.itens.filter((i) => i.ok);
  const falha = resultado.itens.filter((i) => !i.ok);
  return (
    <div className="promocoes-resultado">
      <div className="financeiro-margem-positiva">
        {sucesso.length} de {resultado.itens.length} itens entraram na campanha "{resultado.nome}".
      </div>
      {sucesso.length > 0 && (
        <div className="promocoes-resultado-falhas">
          {sucesso.map((s) => (
            <div key={s.itemId} className="financeiro-td-mudo">
              {s.itemId}: {formatCurrency(s.precoOriginal ?? 0)} → {formatCurrency(s.dealPrice ?? 0)}
            </div>
          ))}
        </div>
      )}
      {falha.length > 0 && (
        <div className="promocoes-resultado-falhas">
          <span className="financeiro-margem-negativa">Não entraram:</span>
          {falha.map((f) => (
            <div key={f.itemId} className="financeiro-td-mudo">
              {f.itemId}: {f.erro}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NovaCampanhaForm({ lojas, onCriada }: { lojas: Loja[]; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [lojaId, setLojaId] = useState<number | "">("");
  const [nome, setNome] = useState("");
  const [percentual, setPercentual] = useState("20");
  const [itensTexto, setItensTexto] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCriarCampanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const itemIds = itensTexto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function pedirConfirmacao() {
    setErro(null);
    setResultado(null);
    if (!lojaId) {
      setErro("Escolha a loja.");
      return;
    }
    if (!nome.trim()) {
      setErro("Informe o nome da campanha.");
      return;
    }
    const p = Number(percentual);
    if (!Number.isFinite(p) || p < 10 || p > 70) {
      setErro("Percentual precisa ficar entre 10% e 70% (regra do Mercado Livre).");
      return;
    }
    if (itemIds.length === 0) {
      setErro("Cole ao menos um MLB, um por linha.");
      return;
    }
    setConfirmando(true);
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await criarCampanha(Number(lojaId), nome.trim(), Number(percentual), itemIds);
      setResultado(res);
      setConfirmando(false);
      onCriada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar campanha.");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn-responder" onClick={() => setAberto(true)}>
        Nova campanha
      </button>
    );
  }

  return (
    <div className="promocoes-form">
      {erro && <div className="state-message state-error">{erro}</div>}
      {resultado && <ResultadoCriacao resultado={resultado} />}

      {!confirmando && (
        <>
          <div className="fabricacao-editor-topo">
            <select className="dashboard-select" value={lojaId} onChange={(e) => setLojaId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Loja...</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <input className="clonar-input" placeholder="Nome da campanha" value={nome} onChange={(e) => setNome(e.target.value)} />
            <input
              className="clonar-input"
              placeholder="% de desconto (10-70)"
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
            />
          </div>
          <textarea
            className="clonar-input promocoes-textarea"
            placeholder="Cole os MLBs dos produtos, um por linha"
            value={itensTexto}
            onChange={(e) => setItensTexto(e.target.value)}
            rows={5}
          />
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" onClick={pedirConfirmacao}>
              Criar campanha
            </button>
            <button type="button" className="btn-excluir" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Confirma criar a campanha <b>"{nome}"</b> na loja <b>{lojas.find((l) => l.id === lojaId)?.nome}</b>, com{" "}
            <b>{percentual}%</b> de desconto em <b>{itemIds.length}</b> item{itemIds.length > 1 ? "ns" : ""}? Isso cria a
            promoção de verdade no Mercado Livre agora.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={confirmar}>
              {enviando ? "Criando..." : "Confirmar e criar"}
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaCampanha({ campanha, onRecriada }: { campanha: Campanha; onRecriada: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCriarCampanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const status = statusInfo(campanha);

  async function recriar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await recriarCampanha(campanha.id);
      setResultado(res);
      setConfirmando(false);
      onRecriada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao recriar campanha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="promocoes-linha">
      <div className="promocoes-linha-topo">
        <span className="financeiro-td-titulo">{campanha.nome}</span>
        <span className="financeiro-td-mudo">{campanha.lojaNome}</span>
        <span className="financeiro-td-mudo">{campanha.percentualDesconto}% off</span>
        <span className="financeiro-td-mudo">{campanha.itens.length} itens</span>
        <span className={status.classe}>{status.texto}</span>
        {!confirmando && (
          <button type="button" className="btn-responder" onClick={() => setConfirmando(true)}>
            Recriar
          </button>
        )}
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {resultado && <ResultadoCriacao resultado={resultado} />}

      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Recria com o mesmo nome (+ data), <b>{campanha.percentualDesconto}%</b> de desconto e os mesmos{" "}
            <b>{campanha.itens.length}</b> itens — mas com o preço recalculado em cima do preço ATUAL de cada produto,
            não o preço antigo. Cria uma promoção nova de verdade no Mercado Livre agora.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={recriar}>
              {enviando ? "Recriando..." : "Confirmar e recriar"}
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Data "DD/MM/AAAA" ou "DD/MM/AA" -> "AAAA-MM-DD" (formato que a API espera).
function converterData(txt: string): string | null {
  const m = txt.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mes, a] = m;
  const ano = a.length === 2 ? `20${a}` : a;
  return `${ano}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Formato: Loja <TAB> Nome da campanha <TAB> % <TAB> DD/MM/AAAA <TAB> MLB1,MLB2 —
// mesmo padrão de "colar lista" já usado em Contas a pagar/receber (linhas
// coladas direto de uma planilha, separadas por tab).
function parseLinhaRegistro(linha: string, lojas: Loja[]): RegistroExistenteEntrada | { erro: string } {
  const partes = linha.split("\t").map((p) => p.trim());
  if (partes.length < 5) return { erro: "Faltam colunas (esperado: Loja, Nome, %, Data, MLBs)." };
  const [lojaTxt, nome, percentualTxt, dataTxt, itensTxt] = partes;

  const loja = lojas.find((l) => l.nome.toLowerCase() === lojaTxt.toLowerCase());
  if (!loja) return { erro: `Loja "${lojaTxt}" não encontrada.` };

  const percentual = Number(percentualTxt.replace(",", ".").replace("%", ""));
  if (!Number.isFinite(percentual)) return { erro: "Percentual inválido." };

  const dataFim = converterData(dataTxt);
  if (!dataFim) return { erro: "Data inválida (use DD/MM/AAAA)." };

  const itemIds = itensTxt
    .split(",")
    .map((i) => i.trim())
    .filter(Boolean);
  if (itemIds.length === 0) return { erro: "Nenhum MLB informado." };

  return { lojaId: loja.id, nome, percentual, dataFim, itemIds };
}

function RegistrarExistentesForm({ lojas, onRegistradas }: { lojas: Loja[]; onRegistradas: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoRegistroLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setErro(null);
    setResultados(null);
    const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
    if (linhas.length === 0) {
      setErro("Cole ao menos uma linha.");
      return;
    }
    const parseados = linhas.map((l) => parseLinhaRegistro(l, lojas));
    const invalida = parseados.findIndex((p) => "erro" in p);
    if (invalida !== -1) {
      setErro(`Linha ${invalida + 1}: ${(parseados[invalida] as { erro: string }).erro}`);
      return;
    }
    setEnviando(true);
    try {
      const res = await registrarCampanhasExistentes(parseados as RegistroExistenteEntrada[]);
      setResultados(res);
      onRegistradas();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar.");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn-excluir" onClick={() => setAberto(true)}>
        Registrar campanhas que já existem
      </button>
    );
  }

  return (
    <div className="promocoes-form">
      <p className="painel-sub">
        Uma campanha por linha, colunas separadas por TAB (cole direto de uma planilha): <b>Loja</b>, <b>Nome</b>,{" "}
        <b>%</b>, <b>Data de vencimento (DD/MM/AAAA)</b>, <b>MLBs separados por vírgula</b>. Isso só ensina o painel
        sobre a campanha — não cria nem muda nada no Mercado Livre.
      </p>
      {erro && <div className="state-message state-error">{erro}</div>}
      {resultados && (
        <div className="promocoes-resultado-falhas">
          {resultados.map((r) => (
            <div key={r.linha} className={r.ok ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}>
              Linha {r.linha}: {r.ok ? `registrada (${r.resultado?.itens.filter((i) => i.ok).length} itens)` : r.erro}
            </div>
          ))}
        </div>
      )}
      <textarea
        className="clonar-input promocoes-textarea"
        placeholder={"Hangar\tTrava Pedra Julho\t20\t20/08/2026\tMLB123,MLB456"}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={6}
      />
      <div className="fabricacao-editor-acoes">
        <button type="button" className="btn-responder" disabled={enviando} onClick={enviar}>
          {enviando ? "Registrando..." : "Registrar"}
        </button>
        <button type="button" className="btn-excluir" onClick={() => setAberto(false)}>
          Fechar
        </button>
      </div>
    </div>
  );
}

function DescobertaAutomatica({ onEncontradas }: { onEncontradas: () => void }) {
  const [progresso, setProgresso] = useState<ProgressoDescoberta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function pararPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function iniciar() {
    setErro(null);
    try {
      await iniciarDescoberta("todas");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao iniciar.");
      return;
    }
    intervalRef.current = setInterval(async () => {
      const p = await fetchProgressoDescoberta();
      setProgresso(p);
      if (!p.emAndamento) {
        pararPolling();
        onEncontradas();
      }
    }, 3000);
  }

  const emAndamento = progresso?.emAndamento ?? false;

  return (
    <div className="promocoes-descoberta">
      {!emAndamento && (
        <button type="button" className="btn-responder" onClick={iniciar}>
          Descobrir campanhas automaticamente
        </button>
      )}
      {emAndamento && progresso && (
        <div className="financeiro-td-mudo">
          Verificando {progresso.lojaAtual}... {progresso.itensVerificados}/{progresso.totalItens} anúncios —{" "}
          {progresso.campanhasEncontradas} campanha{progresso.campanhasEncontradas !== 1 ? "s" : ""} encontrada
          {progresso.campanhasEncontradas !== 1 ? "s" : ""} até agora. Pode levar alguns minutos, vá fazendo outra
          coisa enquanto isso.
          {(progresso.itensComErro > 0 || progresso.candidatosDescartados > 0) && (
            <>
              {" "}
              ({progresso.itensComErro} item{progresso.itensComErro !== 1 ? "ns" : ""} com erro na consulta,{" "}
              {progresso.candidatosDescartados} candidato{progresso.candidatosDescartados !== 1 ? "s" : ""} descartado
              {progresso.candidatosDescartados !== 1 ? "s" : ""} por não ser campanha do vendedor.)
            </>
          )}
        </div>
      )}
      {progresso && !emAndamento && progresso.campanhasEncontradas > 0 && (
        <div className="financeiro-margem-positiva">
          Descoberta concluída: {progresso.campanhasEncontradas} campanha
          {progresso.campanhasEncontradas !== 1 ? "s" : ""} encontrada
          {progresso.campanhasEncontradas !== 1 ? "s" : ""}.
        </div>
      )}
      {progresso && !emAndamento && progresso.campanhasEncontradas === 0 && (
        <div className="financeiro-td-mudo">
          Descoberta concluída: nenhuma campanha do vendedor (SELLER_CAMPAIGN) encontrada.{" "}
          {progresso.itensComErro > 0 &&
            `${progresso.itensComErro} de ${progresso.totalItens} anúncios deram erro na consulta — pode ser permissão da conta, não falta de campanha. `}
          {progresso.candidatosDescartados > 0 &&
            `${progresso.candidatosDescartados} candidato(s) foram descartados por não ser campanha do vendedor (provavelmente outro tipo de promoção do ML). `}
          {progresso.amostraErro && <>Exemplo de erro: {progresso.amostraErro}</>}
        </div>
      )}
      {progresso?.erro && <div className="state-message state-error">{progresso.erro}</div>}
      {erro && <div className="state-message state-error">{erro}</div>}
    </div>
  );
}

export function Promocoes() {
  const [lojas, setLojas] = useState<Loja[]>([]);

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscar = useCallback(() => fetchCampanhas("todas"), []);
  const { dados, erro, atualizarAgora } = useBuscaComCancelamento<Campanha[]>(buscar, true);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Promoções</span>
          <h1>Campanhas do vendedor — todas as lojas</h1>
          <p className="painel-sub">
            Toda campanha de desconto do Mercado Livre vence em no máximo 14 dias — não existe renovação automática
            nativa da plataforma. Aqui você vê todas as campanhas das 16 lojas numa lista só, as mais urgentes
            primeiro, e recria com um clique quando vencer.
          </p>
        </div>
        <div className="financeiro-filtros">
          <button type="button" className="btn-responder financeiro-btn-hoje" onClick={atualizarAgora}>
            Atualizar
          </button>
        </div>
      </div>

      <div className="promocoes-acoes-topo">
        <NovaCampanhaForm lojas={lojas} onCriada={atualizarAgora} />
        <RegistrarExistentesForm lojas={lojas} onRegistradas={atualizarAgora} />
        <DescobertaAutomatica onEncontradas={atualizarAgora} />
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && dados === null && <div className="state-message">Carregando...</div>}
      {dados?.length === 0 && <div className="state-message">Nenhuma campanha criada pelo painel ainda.</div>}

      {dados?.map((c) => (
        <LinhaCampanha key={c.id} campanha={c} onRecriada={atualizarAgora} />
      ))}
    </div>
  );
}
