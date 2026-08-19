import { useCallback, useState, type CSSProperties } from "react";
import {
  listarKeywords,
  criarKeyword,
  definirKeywordAtiva,
  buscarKeywordAgora,
  historicoKeyword,
  type Keyword,
  type HistoricoKeyword,
} from "../api/marketIntelligence";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";
import { formatCurrency } from "../utils/format";

export function MarketIntelligence() {
  const buscarKeywords = useCallback(() => listarKeywords(), []);
  const { dados: keywords, erro, carregando, atualizarAgora } = useBuscaComCancelamento(buscarKeywords, true);

  const [novaKeyword, setNovaKeyword] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [selecionada, setSelecionada] = useState<Keyword | null>(null);
  const [resultado, setResultado] = useState<HistoricoKeyword | null>(null);
  const [buscandoAgora, setBuscandoAgora] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  async function adicionar() {
    if (!novaKeyword.trim()) return;
    setSalvando(true);
    try {
      await criarKeyword(novaKeyword.trim());
      setNovaKeyword("");
      atualizarAgora();
    } catch (err) {
      setErroBusca(err instanceof Error ? err.message : "Falha ao criar palavra-chave.");
    } finally {
      setSalvando(false);
    }
  }

  async function abrir(kw: Keyword) {
    setSelecionada(kw);
    setResultado(null);
    setErroBusca(null);
    try {
      const dados = await historicoKeyword(kw.id);
      setResultado(dados);
    } catch (err) {
      setErroBusca(err instanceof Error ? err.message : "Falha ao carregar histórico.");
    }
  }

  async function buscarAgora(kw: Keyword) {
    setBuscandoAgora(true);
    setErroBusca(null);
    try {
      const dados = await buscarKeywordAgora(kw.id);
      setResultado(dados);
      atualizarAgora();
    } catch (err) {
      setErroBusca(err instanceof Error ? err.message : "Falha ao buscar agora.");
    } finally {
      setBuscandoAgora(false);
    }
  }

  async function alternarAtiva(kw: Keyword) {
    await definirKeywordAtiva(kw.id, !kw.active);
    atualizarAgora();
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ margin: 0 }}>Inteligência de Mercado</h2>
        <p style={{ opacity: 0.7, marginTop: 4 }}>
          Prova de conceito (Fase 1) — dados de busca do Mercado Livre via provider externo, sem tocar nas contas
          conectadas.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={novaKeyword}
          onChange={(e) => setNovaKeyword(e.target.value)}
          placeholder="Nova palavra-chave (ex: manta líquida 18kg)"
          style={{ flex: 1, padding: "8px 12px" }}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
        />
        <button onClick={adicionar} disabled={salvando}>
          {salvando ? "Adicionando..." : "Adicionar"}
        </button>
      </div>

      {erro && <p style={{ color: "#e55" }}>{erro}</p>}
      {carregando && !keywords && <p>Carregando...</p>}

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 320 }}>
          <thead>
            <tr>
              <th style={celulaHeader}>Palavra-chave</th>
              <th style={celulaHeader}>Ativa</th>
              <th style={celulaHeader}>Última coleta</th>
            </tr>
          </thead>
          <tbody>
            {(keywords ?? []).map((kw) => (
              <tr
                key={kw.id}
                onClick={() => abrir(kw)}
                style={{
                  cursor: "pointer",
                  background: selecionada?.id === kw.id ? "rgba(255,255,255,0.06)" : undefined,
                }}
              >
                <td style={celula}>{kw.keyword}</td>
                <td style={celula}>
                  <input
                    type="checkbox"
                    checked={kw.active}
                    onChange={(e) => {
                      e.stopPropagation();
                      alternarAtiva(kw);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td style={celula}>
                  {kw.lastCollectedAt ? new Date(kw.lastCollectedAt).toLocaleString("pt-BR") : "nunca"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {selecionada && (
          <div style={{ flex: 1, minWidth: 320 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{selecionada.keyword}</h3>
              <button onClick={() => buscarAgora(selecionada)} disabled={buscandoAgora}>
                {buscandoAgora ? "Buscando..." : "Buscar agora"}
              </button>
            </div>

            {erroBusca && <p style={{ color: "#e55" }}>{erroBusca}</p>}

            {resultado && (
              <>
                <div style={{ display: "flex", gap: 24, marginBottom: 16, opacity: 0.85 }}>
                  <span>
                    Preço médio (última coleta):{" "}
                    {resultado.metricas.precoMedioAtual !== null
                      ? formatCurrency(resultado.metricas.precoMedioAtual)
                      : "—"}
                  </span>
                  <span>
                    Melhor posição própria:{" "}
                    {resultado.metricas.melhorPosicaoPropria !== null ? resultado.metricas.melhorPosicaoPropria : "—"}
                  </span>
                </div>

                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={celulaHeader}>Pos.</th>
                      <th style={celulaHeader}>Anúncio</th>
                      <th style={celulaHeader}>Seller</th>
                      <th style={celulaHeader}>Preço</th>
                      <th style={celulaHeader}>Coletado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.historico.map((s, i) => (
                      <tr key={i} style={{ background: s.isOwnListing ? "rgba(80,200,120,0.12)" : undefined }}>
                        <td style={celula}>{s.position}</td>
                        <td style={celula}>
                          {s.title ?? s.itemId}
                          {s.isOwnListing && <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.8 }}>(sua loja{s.ownStoreName ? ` — ${s.ownStoreName}` : ""})</span>}
                        </td>
                        <td style={celula}>{s.sellerName ?? "—"}</td>
                        <td style={celula}>{s.price !== null ? formatCurrency(s.price) : "—"}</td>
                        <td style={celula}>{new Date(s.collectedAt).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))}
                    {resultado.historico.length === 0 && (
                      <tr>
                        <td style={celula} colSpan={5}>
                          Sem coleta ainda — clique em "Buscar agora".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const celula: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" };
const celulaHeader: CSSProperties = { ...celula, textAlign: "left", opacity: 0.7, fontWeight: 600 };
