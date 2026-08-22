import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCampanhas,
  criarCampanha,
  recriarCampanha,
  registrarCampanhasExistentes,
  iniciarDescoberta,
  fetchProgressoDescoberta,
  excluirCampanha,
  limparCampanhas,
  iniciarBuscaOportunidades,
  fetchProgressoBuscaOportunidades,
  fetchOportunidades,
  aprovarOportunidade,
  aprovarVariasOportunidades,
  rejeitarOportunidade,
  limparOportunidades,
  compararComVendaReal,
} from "../api/promocoes";
import { fetchLojas, type Loja } from "../api/lojas";
import type {
  Campanha,
  ResultadoCriarCampanha,
  RegistroExistenteEntrada,
  ResultadoRegistroLinha,
  ProgressoDescoberta,
  Oportunidade,
  ProgressoBuscaOportunidades,
  ComparacaoOportunidade,
  ResultadoAprovacaoLote,
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

function LinhaCampanha({
  campanha,
  onRecriada,
  onExcluida,
}: {
  campanha: Campanha;
  onRecriada: () => void;
  onExcluida: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
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

  async function excluir() {
    setExcluindo(true);
    setErro(null);
    try {
      await excluirCampanha(campanha.id);
      onExcluida();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir campanha.");
      setExcluindo(false);
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
        {!confirmando && !confirmandoExclusao && (
          <>
            <button type="button" className="btn-responder" onClick={() => setConfirmando(true)}>
              Recriar
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmandoExclusao(true)}>
              Excluir
            </button>
          </>
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

      {confirmandoExclusao && (
        <div className="promocoes-confirmacao">
          <p>
            Remove só o rastreamento dessa campanha no painel (não mexe em nada no Mercado Livre — se ela estiver
            ativa de verdade lá, continua ativa).
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-excluir" disabled={excluindo} onClick={excluir}>
              {excluindo ? "Excluindo..." : "Confirmar exclusão"}
            </button>
            <button type="button" className="btn-responder" onClick={() => setConfirmandoExclusao(false)}>
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

// Diagnóstico temporário: lista (não só o último) a contagem por status de
// cada campanha processada na varredura — remover quando resolvido.
function DiagnosticosLista({ diagnosticos }: { diagnosticos: string[] }) {
  if (diagnosticos.length === 0) return null;
  return (
    <div className="financeiro-td-mudo">
      Diagnóstico ({diagnosticos.length} campanha{diagnosticos.length !== 1 ? "s" : ""}):
      {diagnosticos.map((d, i) => (
        <div key={i}>{d}</div>
      ))}
    </div>
  );
}

function DescobertaAutomatica({
  lojaFiltro,
  onEncontradas,
}: {
  lojaFiltro: number | "todas" | "minhas";
  onEncontradas: () => void;
}) {
  const [progresso, setProgresso] = useState<ProgressoDescoberta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function pararPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function comecarPolling() {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(async () => {
      const p = await fetchProgressoDescoberta();
      setProgresso(p);
      if (!p.emAndamento) {
        pararPolling();
        onEncontradas();
      }
    }, 3000);
  }

  // Ao abrir/recarregar a tela, checa se já tinha uma descoberta rodando
  // de um clique anterior (o scan continua no servidor mesmo se a página
  // for fechada) — sem isso, só descobria isso ao clicar de novo e tomar
  // o erro "Já tem uma descoberta em andamento".
  useEffect(() => {
    (async () => {
      const p = await fetchProgressoDescoberta();
      setProgresso(p);
      if (p.emAndamento) comecarPolling();
    })();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function iniciar() {
    setErro(null);
    try {
      await iniciarDescoberta(lojaFiltro);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao iniciar.");
      return;
    }
    comecarPolling();
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
          <DiagnosticosLista diagnosticos={progresso.diagnosticos} />
        </div>
      )}
      {progresso && !emAndamento && (progresso.campanhasEncontradas > 0 || progresso.campanhasCompletadas > 0) && (
        <div className="financeiro-margem-positiva">
          Descoberta concluída:{" "}
          {progresso.campanhasEncontradas > 0 &&
            `${progresso.campanhasEncontradas} campanha${progresso.campanhasEncontradas !== 1 ? "s" : ""} nova${
              progresso.campanhasEncontradas !== 1 ? "s" : ""
            } encontrada${progresso.campanhasEncontradas !== 1 ? "s" : ""}. `}
          {progresso.campanhasCompletadas > 0 &&
            `${progresso.campanhasCompletadas} campanha${progresso.campanhasCompletadas !== 1 ? "s" : ""} já rastreada${
              progresso.campanhasCompletadas !== 1 ? "s" : ""
            } teve${progresso.campanhasCompletadas !== 1 ? "ram" : ""} os itens completados.`}
        </div>
      )}
      {progresso && !emAndamento && progresso.campanhasEncontradas === 0 && progresso.campanhasCompletadas === 0 && (
        <div className="financeiro-td-mudo">
          Descoberta concluída: nenhuma campanha do vendedor (SELLER_CAMPAIGN) encontrada.{" "}
          {progresso.itensComErro > 0 &&
            `${progresso.itensComErro} de ${progresso.totalItens} anúncios deram erro na consulta — pode ser permissão da conta, não falta de campanha. `}
          {progresso.candidatosDescartados > 0 &&
            `${progresso.candidatosDescartados} candidato(s) foram descartados por não ser campanha do vendedor (provavelmente outro tipo de promoção do ML). `}
          <DiagnosticosLista diagnosticos={progresso.diagnosticos} />
        </div>
      )}
      {progresso && !emAndamento && (progresso.campanhasEncontradas > 0 || progresso.campanhasCompletadas > 0) && (
        <DiagnosticosLista diagnosticos={progresso.diagnosticos} />
      )}
      {progresso?.erro && <div className="state-message state-error">{progresso.erro}</div>}
      {erro && <div className="state-message state-error">{erro}</div>}
    </div>
  );
}

function LinhaOportunidade({
  oportunidade,
  onDecidida,
  selecionavel,
  selecionado,
  onToggleSelecao,
}: {
  oportunidade: Oportunidade;
  onDecidida: () => void;
  selecionavel: boolean;
  selecionado: boolean;
  onToggleSelecao: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [comparacao, setComparacao] = useState<ComparacaoOportunidade | null>(null);
  const [comparando, setComparando] = useState(false);
  const o = oportunidade;

  async function comparar() {
    setComparando(true);
    setErro(null);
    try {
      setComparacao(await compararComVendaReal(o.id));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao comparar.");
    } finally {
      setComparando(false);
    }
  }

  async function aprovar() {
    setEnviando(true);
    setErro(null);
    try {
      await aprovarOportunidade(o.id);
      setConfirmando(false);
      onDecidida();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao aprovar.");
    } finally {
      setEnviando(false);
    }
  }

  async function rejeitar() {
    setEnviando(true);
    setErro(null);
    try {
      await rejeitarOportunidade(o.id);
      onDecidida();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao rejeitar.");
      setEnviando(false);
    }
  }

  const semIdentificador = !o.promotionId;

  return (
    <div className="promocoes-linha">
      <div className="promocoes-linha-topo">
        {selecionavel && (
          <input
            type="checkbox"
            checked={selecionado}
            onChange={onToggleSelecao}
            disabled={enviando || semIdentificador}
            title={semIdentificador ? "Essa modalidade não tem identificador pra confirmar via API." : undefined}
          />
        )}
        {o.permalink ? (
          <a href={o.permalink} target="_blank" rel="noreferrer" className="financeiro-td-titulo promocoes-link-anuncio">
            {o.titulo ?? o.itemId}
          </a>
        ) : (
          <span className="financeiro-td-titulo">{o.titulo ?? o.itemId}</span>
        )}
        <span className="financeiro-td-mudo">{o.lojaNome}</span>
        <span className="financeiro-td-mudo">{o.nome ?? o.tipo}</span>
        <span className="financeiro-td-mudo">
          {formatCurrency(o.precoOriginal)} → {formatCurrency(o.precoEscolhido)}
        </span>
        {o.sellerPercentual !== null && (
          <span className="financeiro-td-mudo">
            ML banca {o.meliPercentual}% · você banca {o.sellerPercentual}%
          </span>
        )}
        <span
          className={o.elegivel ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}
          title={o.freteEstimado !== null ? `Já descontando frete grátis estimado de ${formatCurrency(o.freteEstimado)}` : undefined}
        >
          {o.margem === null
            ? "Sem dados de custo/taxa pra calcular"
            : `Margem: ${formatCurrency(o.margem)} (${o.percentualMargem?.toFixed(1)}%)`}
        </span>
        {(o.status === "pendente" || o.status === "erro") && !confirmando && (
          <>
            <button
              type="button"
              className="btn-responder"
              disabled={enviando || semIdentificador}
              title={semIdentificador ? "Essa modalidade não tem identificador pra confirmar via API — participe direto no Mercado Livre." : undefined}
              onClick={() => setConfirmando(true)}
            >
              {o.status === "erro" ? "Tentar de novo" : "Aprovar"}
            </button>
            <button type="button" className="btn-excluir" disabled={enviando} onClick={rejeitar}>
              Rejeitar
            </button>
          </>
        )}
        {o.status === "aprovada" && <span className="financeiro-td-mudo">Aprovada</span>}
        {o.status === "rejeitada" && <span className="financeiro-td-mudo">Rejeitada</span>}
        {o.status === "erro" && !confirmando && <span className="financeiro-margem-negativa">Erro: {o.erro}</span>}
        {o.status === "aprovada" && (
          <button type="button" className="btn-excluir" disabled={comparando} onClick={comparar}>
            {comparando ? "Comparando..." : "Comparar com venda real"}
          </button>
        )}
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      {comparacao && (
        <div className="promocoes-comparacao">
          {!comparacao.encontrada && (
            <div className="financeiro-td-mudo">
              Ainda não teve nenhuma venda desse item registrada no Financeiro desde que você aprovou. Tenta de novo
              depois que vender.
            </div>
          )}
          {comparacao.encontrada && (
            <table className="financeiro-tabela promocoes-comparacao-tabela">
              <thead>
                <tr>
                  <th></th>
                  <th>Previsto (na aprovação)</th>
                  <th>Real (venda #{comparacao.vendaOrderId})</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Preço</td>
                  <td>{formatCurrency(comparacao.precoPrevisto)}</td>
                  <td>{formatCurrency(comparacao.precoRealUnitario ?? 0)}</td>
                </tr>
                <tr>
                  <td>Taxa do ML</td>
                  <td>{o.taxaMl !== null ? formatCurrency(o.taxaMl) : "—"}</td>
                  <td>{comparacao.taxaMlReal !== null ? formatCurrency(comparacao.taxaMlReal) : "—"}</td>
                </tr>
                <tr>
                  <td>Margem</td>
                  <td>
                    {formatCurrency(comparacao.margemPrevista ?? 0)} ({comparacao.percentualMargemPrevista?.toFixed(1)}%)
                  </td>
                  <td
                    className={
                      comparacao.margemRealUnitaria !== null && comparacao.margemPrevista !== null
                        ? comparacao.margemRealUnitaria >= comparacao.margemPrevista
                          ? "financeiro-margem-positiva"
                          : "financeiro-margem-negativa"
                        : undefined
                    }
                  >
                    {formatCurrency(comparacao.margemRealUnitaria ?? 0)} ({comparacao.percentualMargemReal?.toFixed(1)}%)
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Confirma entrar na promoção <b>{o.nome ?? o.tipo}</b> desse item? O cliente vai ver o preço{" "}
            <b>{formatCurrency(o.precoEscolhido)}</b> (era {formatCurrency(o.precoOriginal)}), mas o Mercado Livre banca{" "}
            <b>{o.meliPercentual}%</b> desse desconto — sua margem real (já descontando frete grátis estimado de{" "}
            {formatCurrency(o.freteEstimado ?? 0)}) fica em{" "}
            <b>
              {formatCurrency(o.margem ?? 0)} ({o.percentualMargem?.toFixed(1)}%)
            </b>
            . O frete é estimado antes da venda — tende a sair um pouco melhor na prática, não pior. Isso muda o
            preço/participação de verdade no Mercado Livre agora.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={aprovar}>
              {enviando ? "Confirmando..." : "Confirmar e entrar"}
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

function BuscaOportunidades({
  lojaFiltro,
  onEncontradas,
}: {
  lojaFiltro: number | "todas" | "minhas";
  onEncontradas: () => void;
}) {
  const [progresso, setProgresso] = useState<ProgressoBuscaOportunidades | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function pararPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function comecarPolling() {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(async () => {
      const p = await fetchProgressoBuscaOportunidades();
      setProgresso(p);
      if (!p.emAndamento) {
        pararPolling();
        onEncontradas();
      }
    }, 3000);
  }

  useEffect(() => {
    (async () => {
      const p = await fetchProgressoBuscaOportunidades();
      setProgresso(p);
      if (p.emAndamento) comecarPolling();
    })();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function iniciar() {
    setErro(null);
    try {
      await iniciarBuscaOportunidades(lojaFiltro);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao iniciar.");
      return;
    }
    comecarPolling();
  }

  const emAndamento = progresso?.emAndamento ?? false;

  return (
    <div className="promocoes-descoberta">
      {!emAndamento && (
        <button type="button" className="btn-responder" onClick={iniciar}>
          Buscar oportunidades
        </button>
      )}
      {emAndamento && progresso && (
        <div className="financeiro-td-mudo">
          Verificando {progresso.lojaAtual}... {progresso.itensVerificados}/{progresso.totalItens} anúncios —{" "}
          {progresso.candidatasEncontradas} oportunidade{progresso.candidatasEncontradas !== 1 ? "s" : ""} encontrada
          {progresso.candidatasEncontradas !== 1 ? "s" : ""} até agora. Pode levar alguns minutos.
          {progresso.itensComErro > 0 && ` (${progresso.itensComErro} item(ns) com erro na consulta.)`}
        </div>
      )}
      {progresso?.erro && <div className="state-message state-error">{progresso.erro}</div>}
      {erro && <div className="state-message state-error">{erro}</div>}
    </div>
  );
}

const SEM_SKU = "__sem_sku__";

function GrupoSku({
  sku,
  itens,
  selecionados,
  onToggle,
  onToggleGrupo,
  onDecidida,
}: {
  sku: string;
  itens: Oportunidade[];
  selecionados: Set<number>;
  onToggle: (id: number) => void;
  onToggleGrupo: (ids: number[], marcar: boolean) => void;
  onDecidida: () => void;
}) {
  const idsSelecionaveis = itens.filter((o) => o.promotionId).map((o) => o.id);
  const todosSelecionados = idsSelecionaveis.length > 0 && idsSelecionaveis.every((id) => selecionados.has(id));

  return (
    <div className="promocoes-grupo-sku">
      <div className="promocoes-grupo-sku-cabecalho">
        {idsSelecionaveis.length > 0 && (
          <input
            type="checkbox"
            checked={todosSelecionados}
            onChange={() => onToggleGrupo(idsSelecionaveis, !todosSelecionados)}
            title="Selecionar todos desse SKU"
          />
        )}
        <span className="financeiro-td-mudo">
          {sku === SEM_SKU ? "Sem SKU" : sku} — {itens.length} variação{itens.length !== 1 ? "ões" : ""}
        </span>
      </div>
      {itens.map((o) => (
        <LinhaOportunidade
          key={o.id}
          oportunidade={o}
          onDecidida={onDecidida}
          selecionavel={!!o.promotionId}
          selecionado={selecionados.has(o.id)}
          onToggleSelecao={() => onToggle(o.id)}
        />
      ))}
    </div>
  );
}

function AprovarSelecionadosBarra({
  selecionados,
  onDecidido,
}: {
  selecionados: Set<number>;
  onDecidido: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoAprovacaoLote[] | null>(null);

  async function confirmar() {
    setEnviando(true);
    setResultados(null);
    try {
      const res = await aprovarVariasOportunidades(Array.from(selecionados));
      setResultados(res);
      setConfirmando(false);
      onDecidido();
    } finally {
      setEnviando(false);
    }
  }

  if (selecionados.size === 0 && !resultados) return null;

  return (
    <div className="promocoes-barra-selecionados">
      {selecionados.size > 0 && !confirmando && (
        <button type="button" className="btn-responder" onClick={() => setConfirmando(true)}>
          Aprovar {selecionados.size} selecionado{selecionados.size !== 1 ? "s" : ""}
        </button>
      )}
      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Confirma entrar em <b>{selecionados.size}</b> promoções de uma vez? Isso muda preço/participação de
            verdade em cada um desses anúncios no Mercado Livre agora — cada um é aprovado um de cada vez, e um erro
            pontual num item não trava os outros.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={confirmar}>
              {enviando ? "Aprovando..." : "Confirmar e entrar em todos"}
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {resultados && (
        <div className="promocoes-resultado-falhas">
          {resultados.map((r) => (
            <div key={r.id} className={r.ok ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}>
              #{r.id}: {r.ok ? "entrou na promoção" : r.erro}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OportunidadesSecao({ lojaFiltro }: { lojaFiltro: number | "todas" | "minhas" }) {
  const buscar = useCallback(() => fetchOportunidades(lojaFiltro), [lojaFiltro]);
  const { dados, erro, atualizarAgora } = useBuscaComCancelamento<Oportunidade[]>(buscar, true);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  const acionaveis = dados?.filter((o) => o.status === "pendente" || o.status === "erro") ?? [];
  const decididas = dados?.filter((o) => o.status === "aprovada" || o.status === "rejeitada") ?? [];

  const grupos = new Map<string, Oportunidade[]>();
  for (const o of acionaveis) {
    const chave = o.sku ?? SEM_SKU;
    const lista = grupos.get(chave) ?? [];
    lista.push(o);
    grupos.set(chave, lista);
  }

  function toggle(id: number) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function toggleGrupo(ids: number[], marcar: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) {
        if (marcar) novo.add(id);
        else novo.delete(id);
      }
      return novo;
    });
  }

  function atualizarELimparSelecao() {
    setSelecionados(new Set());
    atualizarAgora();
  }

  return (
    <div className="promocoes-oportunidades-secao">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Semi-automático</span>
          <h2>Oportunidades com ajuda do Mercado Livre</h2>
          <p className="painel-sub">
            Só "Impulsione suas vendas"/"Aumente suas vendas" (tipo SMART) — o único tipo de promoção onde o próprio
            Mercado Livre banca parte do desconto de verdade (confirmado ao vivo, com dado real). Outras propostas do
            ML (ofertas relâmpago, descontos por conta própria) não têm ajuda nenhuma, então ficam de fora daqui — são
            desconto seu mesmo, sem diferença de fazer manual. A margem mostrada já desconta só a parte que sai do seu
            bolso e o frete grátis estimado. Agrupado por SKU — dá pra selecionar e aprovar várias variações de uma
            vez.
          </p>
        </div>
      </div>

      <div className="promocoes-acoes-topo">
        <BuscaOportunidades lojaFiltro={lojaFiltro} onEncontradas={atualizarAgora} />
        {dados !== null && dados.length > 0 && <LimparOportunidades lojaFiltro={lojaFiltro} onLimpo={atualizarAgora} />}
      </div>

      <AprovarSelecionadosBarra selecionados={selecionados} onDecidido={atualizarELimparSelecao} />

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && dados === null && <div className="state-message">Carregando...</div>}
      {dados?.length === 0 && (
        <div className="state-message">Nenhuma oportunidade encontrada ainda — clique em "Buscar oportunidades".</div>
      )}

      {Array.from(grupos.entries()).map(([sku, itens]) => (
        <GrupoSku
          key={sku}
          sku={sku}
          itens={itens}
          selecionados={selecionados}
          onToggle={toggle}
          onToggleGrupo={toggleGrupo}
          onDecidida={atualizarELimparSelecao}
        />
      ))}
      {decididas.map((o) => (
        <LinhaOportunidade
          key={o.id}
          oportunidade={o}
          onDecidida={atualizarAgora}
          selecionavel={false}
          selecionado={false}
          onToggleSelecao={() => {}}
        />
      ))}
    </div>
  );
}

export function Promocoes() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscar = useCallback(() => fetchCampanhas(lojaFiltro), [lojaFiltro]);
  const { dados, erro, atualizarAgora } = useBuscaComCancelamento<Campanha[]>(buscar, true);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Promoções</span>
          <h1>Campanhas do vendedor</h1>
          <p className="painel-sub">
            Toda campanha de desconto do Mercado Livre vence em no máximo 14 dias — não existe renovação automática
            nativa da plataforma. Aqui você vê as campanhas numa lista só, as mais urgentes primeiro, e recria com um
            clique quando vencer.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select
            className="dashboard-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              setLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
            }}
          >
            <option value="todas">Todas as lojas</option>
            <option value="minhas">Minhas lojas</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <button type="button" className="btn-responder financeiro-btn-hoje" onClick={atualizarAgora}>
            Atualizar
          </button>
        </div>
      </div>

      <div className="promocoes-acoes-topo">
        <NovaCampanhaForm lojas={lojas} onCriada={atualizarAgora} />
        <RegistrarExistentesForm lojas={lojas} onRegistradas={atualizarAgora} />
        <DescobertaAutomatica lojaFiltro={lojaFiltro} onEncontradas={atualizarAgora} />
        {dados !== null && dados.length > 0 && <LimparTudo lojaFiltro={lojaFiltro} onLimpo={atualizarAgora} />}
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && dados === null && <div className="state-message">Carregando...</div>}
      {dados?.length === 0 && <div className="state-message">Nenhuma campanha criada pelo painel ainda.</div>}

      {dados?.map((c) => (
        <LinhaCampanha key={c.id} campanha={c} onRecriada={atualizarAgora} onExcluida={atualizarAgora} />
      ))}

      <OportunidadesSecao lojaFiltro={lojaFiltro} />
    </div>
  );
}

function LimparTudo({
  lojaFiltro,
  onLimpo,
}: {
  lojaFiltro: number | "todas" | "minhas";
  onLimpo: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function limpar() {
    setEnviando(true);
    setErro(null);
    try {
      await limparCampanhas(lojaFiltro);
      setConfirmando(false);
      onLimpo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao limpar.");
    } finally {
      setEnviando(false);
    }
  }

  const escopo = lojaFiltro === "todas" ? "todas as lojas" : lojaFiltro === "minhas" ? "minhas lojas" : "essa loja";

  if (!confirmando) {
    return (
      <button type="button" className="btn-excluir" onClick={() => setConfirmando(true)}>
        Limpar {lojaFiltro === "todas" ? "tudo" : "dessa loja"}
      </button>
    );
  }

  return (
    <div className="promocoes-confirmacao">
      <p>
        Apaga o rastreamento de <b>todas</b> as campanhas de <b>{escopo}</b> no painel — não mexe em nada real no
        Mercado Livre. Não dá pra desfazer.
      </p>
      <div className="fabricacao-editor-acoes">
        <button type="button" className="btn-excluir" disabled={enviando} onClick={limpar}>
          {enviando ? "Limpando..." : "Confirmar limpeza total"}
        </button>
        <button type="button" className="btn-responder" onClick={() => setConfirmando(false)}>
          Voltar
        </button>
      </div>
      {erro && <div className="state-message state-error">{erro}</div>}
    </div>
  );
}

function LimparOportunidades({
  lojaFiltro,
  onLimpo,
}: {
  lojaFiltro: number | "todas" | "minhas";
  onLimpo: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function limpar() {
    setEnviando(true);
    setErro(null);
    try {
      await limparOportunidades(lojaFiltro);
      setConfirmando(false);
      onLimpo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao limpar.");
    } finally {
      setEnviando(false);
    }
  }

  const escopo = lojaFiltro === "todas" ? "todas as lojas" : lojaFiltro === "minhas" ? "minhas lojas" : "essa loja";

  if (!confirmando) {
    return (
      <button type="button" className="btn-excluir" onClick={() => setConfirmando(true)}>
        Limpar {lojaFiltro === "todas" ? "tudo" : "dessa loja"}
      </button>
    );
  }

  return (
    <div className="promocoes-confirmacao">
      <p>
        Apaga o rastreamento de <b>todas</b> as oportunidades de <b>{escopo}</b> no painel (pendentes, aprovadas e
        rejeitadas) — não mexe em nada real no Mercado Livre. Não dá pra desfazer.
      </p>
      <div className="fabricacao-editor-acoes">
        <button type="button" className="btn-excluir" disabled={enviando} onClick={limpar}>
          {enviando ? "Limpando..." : "Confirmar limpeza total"}
        </button>
        <button type="button" className="btn-responder" onClick={() => setConfirmando(false)}>
          Voltar
        </button>
      </div>
      {erro && <div className="state-message state-error">{erro}</div>}
    </div>
  );
}
