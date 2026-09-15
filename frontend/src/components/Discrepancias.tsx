import { useCallback, useEffect, useState } from "react";
import {
  fetchDiscrepancias,
  criarDiscrepancia,
  excluirDiscrepancia,
  fetchRankingDiscrepancias,
  fetchUltimasVendas,
  salvarRespostaDiscrepancia,
  fetchDiscrepanciasCorrigidas,
} from "../api/discrepancias";
import type {
  Discrepancia,
  RankingDiscrepancias,
  RankingUsuarioDiscrepancias,
  VendaRecente,
  PrecoOficial,
  DiscrepanciaCorrigida,
} from "../types/discrepancias";
import type { Usuario } from "../types/usuarios";
import { corDaLoja, formatDataHora, formatCurrency } from "../utils/format";
import { IconTrash, IconExternalLink, IconCrown, IconWreath } from "./icons";

// Limiares do termômetro — julgamento própio, ajustável: abaixo de 5% de
// desvio do preço oficial (SKU master) conta como discrepância baixa, até
// 15% como moderada, acima disso como alta.
function classificarDiscrepancia(desvioPercentual: number): { label: string; cor: string; classe: string } {
  const abs = Math.abs(desvioPercentual);
  if (abs < 5) return { label: "Baixa discrepância", cor: "var(--good-text)", classe: "financeiro-margem-positiva" };
  if (abs < 15) return { label: "Discrepância moderada", cor: "#fbbf24", classe: "financeiro-margem-alerta" };
  return { label: "Alta discrepância", cor: "var(--critical-text)", classe: "financeiro-margem-negativa" };
}

// Compara o preço REAL pago pelo cliente na venda mais recente (já com
// qualquer desconto/campanha ativa) contra o preço oficial — não o preço de
// tabela do anúncio (`item.price`), que nunca reflete promoção ativa (achado
// real: o campo `price` da API do ML é sempre o valor cheio, mesmo com
// campanha rodando; o preço com desconto só aparece na venda de verdade).
function Termometro({ vendas, precoOficial }: { vendas: VendaRecente[] | undefined; precoOficial: PrecoOficial | null }) {
  if (!precoOficial) {
    return <span className="financeiro-stat-sub">SKU sem preço oficial cadastrado</span>;
  }
  if (vendas === undefined) {
    return <span className="financeiro-stat-sub">Carregando...</span>;
  }
  const precoReal = vendas[0]?.valorUnitario ?? null;
  if (precoReal === null || precoOficial.classico <= 0) {
    return <span className="financeiro-stat-sub">Sem venda recente pra comparar o preço real pago</span>;
  }

  const desvio = ((precoReal - precoOficial.classico) / precoOficial.classico) * 100;
  const { label, cor, classe } = classificarDiscrepancia(desvio);
  const larguraBarra = Math.min(Math.abs(desvio), 50) * 2; // 50%+ de desvio já enche a barra

  return (
    <div className="discrepancia-termometro">
      <div className="discrepancia-termometro-topo">
        <span>
          Pago na última venda: <b>{formatCurrency(precoReal)}</b> · Preço oficial: <b>{formatCurrency(precoOficial.classico)}</b>
        </span>
        <span className={classe}>
          {desvio > 0 ? "+" : ""}
          {desvio.toFixed(1)}% · {label}
        </span>
      </div>
      <div className="financeiro-equilibrio-barra">
        <div className="financeiro-equilibrio-barra-preenchida" style={{ width: `${larguraBarra}%`, background: cor }} />
      </div>
    </div>
  );
}

function CaixaVendas({
  vendas,
  totalUltimos30Dias,
  carregando,
}: {
  vendas: VendaRecente[] | undefined;
  totalUltimos30Dias: number | undefined;
  carregando: boolean;
}) {
  return (
    <div className="financeiro-stat-card">
      <span className="financeiro-stat-label">
        Últimas vendas
        {totalUltimos30Dias !== undefined && (
          <span className="financeiro-td-mudo"> · {totalUltimos30Dias} nos últimos 30 dias</span>
        )}
      </span>
      {carregando ? (
        <span className="financeiro-stat-sub">Carregando...</span>
      ) : !vendas || vendas.length === 0 ? (
        <span className="financeiro-stat-sub">Sem venda registrada nos últimos 90 dias</span>
      ) : (
        vendas.map((v, i) => (
          <div key={i} className="financeiro-stat-sub">
            {formatDataHora(v.dataVenda)} —{" "}
            {v.margemPercentual !== null ? <b>{v.margemPercentual.toFixed(1)}% de margem</b> : "sem custo cadastrado"}
          </div>
        ))
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

// Uma busca só por card (vendas + preço oficial vêm juntos do mesmo
// endpoint) — evita duas chamadas separadas pra informação que aparece
// junta na tela.
function DetalhesDiscrepancia({
  discrepancia,
  onSalvo,
}: {
  discrepancia: Discrepancia;
  onSalvo: (resposta: string) => void;
}) {
  const [vendas, setVendas] = useState<VendaRecente[] | undefined>(undefined);
  const [precoOficial, setPrecoOficial] = useState<PrecoOficial | null>(null);
  const [totalUltimos30Dias, setTotalUltimos30Dias] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (discrepancia.lojaId === null) return;
    fetchUltimasVendas(discrepancia.lojaId, discrepancia.mlb, discrepancia.sku)
      .then((r) => {
        setVendas(r.vendas);
        setPrecoOficial(r.precoOficial);
        setTotalUltimos30Dias(r.totalUltimos30Dias);
      })
      .catch(() => setVendas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discrepancia.lojaId, discrepancia.mlb, discrepancia.sku]);

  return (
    <>
      <Termometro vendas={vendas} precoOficial={precoOficial} />
      <div className="financeiro-cards-secundarios">
        <CaixaVendas vendas={vendas} totalUltimos30Dias={totalUltimos30Dias} carregando={vendas === undefined} />
        <CaixaResposta discrepancia={discrepancia} onSalvo={onSalvo} />
      </div>
    </>
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
          <DetalhesDiscrepancia
            discrepancia={d}
            onSalvo={(resposta) =>
              setItens((atual) => atual?.map((it) => (it.id === d.id ? { ...it, resposta } : it)) ?? null)
            }
          />
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

function CorrigidasView() {
  const [corrigidas, setCorrigidas] = useState<DiscrepanciaCorrigida[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchDiscrepanciasCorrigidas()
      .then(setCorrigidas)
      .catch((err) => setErro(err instanceof Error ? err.message : "Erro ao carregar o histórico."));
  }, []);

  if (erro) return <div className="state-message state-error">{erro}</div>;
  if (!corrigidas) return <div className="state-message">Carregando...</div>;
  if (corrigidas.length === 0) {
    return <div className="state-message">Nenhum MLB corrigido ainda — exclua uma discrepância na aba Lista assim que corrigir o preço.</div>;
  }

  return (
    <>
      <span className="painel-eyebrow func-secao-titulo">MLBs já corrigidos ({corrigidas.length})</span>
      {corrigidas.map((c) => (
        <div key={c.id} className="pergunta-item">
          <a href={c.link} target="_blank" rel="noreferrer" className="financeiro-td-titulo">
            {c.mlb}
            <IconExternalLink />
          </a>
          <span className="financeiro-td-mudo">{c.titulo ?? "—"}</span>
          {c.lojaNome && (
            <span className="financeiro-td-mudo" style={{ color: c.lojaId !== null ? corDaLoja(c.lojaId) : undefined }}>
              {c.lojaNome}
            </span>
          )}
          {c.preco !== null && <span className="financeiro-td-mudo">{formatCurrency(c.preco)}</span>}
          <span className="financeiro-td-mudo">
            Corrigido por {c.usuarioNome ?? "—"} em {formatDataHora(c.corrigidoEm)}
          </span>
        </div>
      ))}
    </>
  );
}

export function Discrepancias({ usuario }: Props) {
  const [aba, setAba] = useState<"lista" | "ranking" | "corrigidas">("lista");

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
        <button
          type="button"
          className={`agente-tab ${aba === "corrigidas" ? "agente-tab-ativa" : ""}`}
          onClick={() => setAba("corrigidas")}
        >
          Corrigidos
        </button>
      </div>

      {aba === "lista" && <ListaDiscrepancias usuario={usuario} />}
      {aba === "ranking" && <RankingDiscrepanciasView />}
      {aba === "corrigidas" && <CorrigidasView />}
    </div>
  );
}
