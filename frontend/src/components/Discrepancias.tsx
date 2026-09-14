import { useCallback, useEffect, useState } from "react";
import {
  fetchDiscrepancias,
  criarDiscrepancia,
  excluirDiscrepancia,
  fetchRankingDiscrepancias,
  fetchMargemUltimaVenda,
  salvarRespostaDiscrepancia,
} from "../api/discrepancias";
import type { Discrepancia, RankingDiscrepancias, RankingUsuarioDiscrepancias } from "../types/discrepancias";
import type { Usuario } from "../types/usuarios";
import { corDaLoja, formatDataHora } from "../utils/format";
import { IconTrash, IconExternalLink, IconCrown, IconWreath } from "./icons";

function CaixaMargem({ lojaId, mlb }: { lojaId: number | null; mlb: string }) {
  const [margem, setMargem] = useState<{ margemPercentual: number | null; dataVenda: string } | null | undefined>(
    undefined
  );
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (lojaId === null) return;
    fetchMargemUltimaVenda(lojaId, mlb)
      .then(setMargem)
      .catch(() => setErro(true));
  }, [lojaId, mlb]);

  return (
    <div className="financeiro-stat-card">
      <span className="financeiro-stat-label">Margem da última venda</span>
      {lojaId === null ? (
        <span className="financeiro-stat-sub">Loja não identificada</span>
      ) : erro ? (
        <span className="financeiro-stat-sub">Erro ao buscar</span>
      ) : margem === undefined ? (
        <span className="financeiro-stat-sub">Carregando...</span>
      ) : margem === null ? (
        <span className="financeiro-stat-sub">Sem venda registrada nos últimos 90 dias</span>
      ) : margem.margemPercentual === null ? (
        <span className="financeiro-stat-sub">Vendido em {formatDataHora(margem.dataVenda)} — sem custo cadastrado</span>
      ) : (
        <>
          <span className="financeiro-stat-valor">{margem.margemPercentual.toFixed(1)}%</span>
          <span className="financeiro-stat-sub">última venda em {formatDataHora(margem.dataVenda)}</span>
        </>
      )}
    </div>
  );
}

function CaixaResposta({ discrepancia, onSalvo }: { discrepancia: Discrepancia; onSalvo: (resposta: string) => void }) {
  const [texto, setTexto] = useState(discrepancia.resposta ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await salvarRespostaDiscrepancia(discrepancia.id, texto.trim());
      onSalvo(texto.trim());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="financeiro-stat-card">
      <span className="financeiro-stat-label">Resposta da loja</span>
      <textarea
        className="pergunta-textarea"
        placeholder="Escreva uma justificativa..."
        rows={2}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {erro && <span className="financeiro-stat-sub">{erro}</span>}
      <button type="button" className="btn-responder" disabled={salvando} onClick={salvar}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}

interface Props {
  usuario: Usuario;
}

function ListaDiscrepancias({ usuario }: Props) {
  const [itens, setItens] = useState<Discrepancia[] | null>(null);
  const [link, setLink] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setItens(await fetchDiscrepancias());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar a lista.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleCadastrar(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await criarDiscrepancia(link.trim());
      setLink("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao cadastrar.");
    } finally {
      setEnviando(false);
    }
  }

  async function handleExcluir(id: number) {
    try {
      await excluirDiscrepancia(id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  return (
    <>
      <form className="pergunta-resposta" onSubmit={handleCadastrar}>
        <input
          className="clonar-input"
          placeholder="Cole o link do anúncio com preço discrepante"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="btn-responder" disabled={!link.trim() || enviando}>
          {enviando ? "Cadastrando..." : "Cadastrar"}
        </button>
      </form>

      {erro && <div className="state-message state-error">{erro}</div>}

      {itens === null && <div className="state-message">Carregando...</div>}
      {itens !== null && itens.length === 0 && (
        <div className="state-message">Nenhuma discrepância cadastrada ainda.</div>
      )}

      {itens?.map((d) => (
        <div key={d.id} className="pergunta-item">
          <div className="pergunta-meta">
            {d.lojaId !== null && <i className="ranking-dot" style={{ background: corDaLoja(d.lojaId) }} />}{" "}
            <b>{d.lojaNome ?? "Loja desconhecida"}</b> — cadastrado por {d.usuarioNome ?? "alguém"} em{" "}
            {new Date(d.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
          </div>
          <p className="pergunta-texto">
            {d.titulo ?? "Anúncio"} {d.preco !== null && <b>— R$ {d.preco.toFixed(2)}</b>}
          </p>
          <div className="pergunta-meta">
            MLB: {d.mlb} {d.sku && <>· SKU: {d.sku}</>}
          </div>
          <div className="financeiro-cards-secundarios">
            <CaixaMargem lojaId={d.lojaId} mlb={d.mlb} />
            <CaixaResposta
              discrepancia={d}
              onSalvo={(resposta) =>
                setItens((atual) => atual?.map((it) => (it.id === d.id ? { ...it, resposta } : it)) ?? null)
              }
            />
          </div>
          <div className="pergunta-acoes">
            <a className="btn-secundario" href={d.link} target="_blank" rel="noreferrer">
              <IconExternalLink /> Ver anúncio
            </a>
            {(usuario.admin || d.usuarioId === usuario.id) && (
              <button type="button" className="btn-excluir" onClick={() => handleExcluir(d.id)}>
                <IconTrash /> Excluir
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function PodioUsuario({ item, posicao }: { item: RankingUsuarioDiscrepancias; posicao: 1 | 2 | 3 }) {
  return (
    <div className={`func-podio-card func-podio-card-${posicao}`}>
      <div className="func-podio-medalha">
        {posicao === 1 && (
          <div className="func-podio-coroa">
            <IconCrown size={22} />
          </div>
        )}
        <IconWreath size={posicao === 1 ? 74 : 60} dourado={posicao === 1} />
        <span className="func-podio-numero">{posicao}</span>
      </div>
      <div className="func-podio-nome">{item.nome.toUpperCase()}</div>
      <div className="func-podio-valor">{item.quantidade}</div>
      <div className="func-podio-label">discrepâncias indicadas</div>
    </div>
  );
}

function RankingDiscrepanciasView() {
  const [ranking, setRanking] = useState<RankingDiscrepancias | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchRankingDiscrepancias()
      .then(setRanking)
      .catch((err) => setErro(err instanceof Error ? err.message : "Erro ao carregar o ranking."));
  }, []);

  if (erro) return <div className="state-message state-error">{erro}</div>;
  if (!ranking) return <div className="state-message">Carregando ranking...</div>;

  const [primeiro, segundo, terceiro] = ranking.usuarios;

  return (
    <>
      <span className="painel-eyebrow func-secao-titulo">Top 3 — quem mais indicou discrepâncias</span>
      {ranking.usuarios.length === 0 ? (
        <div className="state-message">Ninguém cadastrou uma discrepância ainda.</div>
      ) : (
        <div className="func-podio">
          {segundo && <PodioUsuario item={segundo} posicao={2} />}
          {primeiro && <PodioUsuario item={primeiro} posicao={1} />}
          {terceiro && <PodioUsuario item={terceiro} posicao={3} />}
        </div>
      )}

      <span className="painel-eyebrow func-secao-titulo">O mais discrepante</span>
      {ranking.lojaMaisDiscrepante ? (
        <div className="func-podio-card func-podio-card-1">
          <div className="func-podio-nome">{ranking.lojaMaisDiscrepante.nome.toUpperCase()}</div>
          <div className="func-podio-valor">{ranking.lojaMaisDiscrepante.quantidade}</div>
          <div className="func-podio-label">vezes citada</div>
        </div>
      ) : (
        <div className="state-message">Nenhuma loja citada ainda.</div>
      )}
    </>
  );
}

export function Discrepancias({ usuario }: Props) {
  const [aba, setAba] = useState<"lista" | "ranking">("lista");

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <h1>Discrepâncias</h1>
          <p className="painel-sub">
            Achou um anúncio de alguma loja do grupo com preço fora do combinado? Cole o link aqui — a loja é
            identificada sozinha a partir do anúncio.
          </p>
        </div>
      </div>

      <div className="agente-tabs">
        <button
          type="button"
          className={`agente-tab ${aba === "lista" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAba("lista")}
        >
          Lista
        </button>
        <button
          type="button"
          className={`agente-tab ${aba === "ranking" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAba("ranking")}
        >
          Ranking
        </button>
      </div>

      {aba === "lista" && <ListaDiscrepancias usuario={usuario} />}
      {aba === "ranking" && <RankingDiscrepanciasView />}
    </div>
  );
}
