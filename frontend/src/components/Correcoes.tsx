import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSkusSemCusto } from "../api/correcoes";
import { fetchLojas, type Loja } from "../api/lojas";
import type { SkuSemCusto } from "../types/correcoes";
import { formatCurrency } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

// Mesma planilha que o backend lê (ver produtosService.ts) — link direto
// pra edição, já que a "correção" acontece lá, não dentro do painel.
const PLANILHA_URL =
  "https://docs.google.com/spreadsheets/d/1TlsFJkh_3Aq-1e52sjxok7IJXjvLKzbffXegZw0991U/edit";

function formatDataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function Correcoes() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscar = useCallback((forcar: boolean) => fetchSkusSemCusto(lojaFiltro, forcar), [lojaFiltro]);
  const { dados, erro, atualizando, atualizarAgora } = useBuscaComCancelamento<SkuSemCusto[]>(buscar, true);

  const porLoja = useMemo(() => {
    if (!dados) return [];
    const mapa = new Map<number, { lojaNome: string; itens: SkuSemCusto[] }>();
    for (const item of dados) {
      if (!mapa.has(item.lojaId)) mapa.set(item.lojaId, { lojaNome: item.lojaNome, itens: [] });
      mapa.get(item.lojaId)!.itens.push(item);
    }
    return Array.from(mapa.values()).sort((a, b) => b.itens.length - a.itens.length);
  }, [dados]);

  const totalItens = dados?.length ?? 0;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Correções</span>
          <h1>SKUs sem custo cadastrado</h1>
          <p className="painel-sub">
            Anúncios que venderam no mês vigente mas cujo SKU não tem custo na planilha — sem custo cadastrado, a
            margem dessas vendas não entra no Financeiro nem no DRE. Corrija direto na planilha; o item some daqui
            sozinho na próxima atualização.
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
          <button type="button" className="btn-responder financeiro-btn-hoje" onClick={atualizarAgora} disabled={atualizando}>
            {atualizando ? "Atualizando..." : "Atualizar"}
          </button>
          <a href={PLANILHA_URL} target="_blank" rel="noopener noreferrer" className="btn-responder financeiro-btn-hoje">
            Abrir planilha
          </a>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && dados === null && <div className="state-message">Carregando...</div>}

      {dados !== null && totalItens === 0 && (
        <div className="state-message">Nenhuma pendência — tudo cadastrado no mês vigente.</div>
      )}

      {porLoja.map(({ lojaNome, itens }) => (
        <div key={lojaNome} className="correcoes-loja-bloco">
          <div className="correcoes-loja-titulo">
            {lojaNome} <span className="financeiro-td-mudo">— {itens.length} pendente{itens.length > 1 ? "s" : ""}</span>
          </div>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>Anúncio</th>
                <th>SKU</th>
                <th>Possível motivo</th>
                <th className="financeiro-th-numero">Vendas afetadas</th>
                <th className="financeiro-th-numero">Receita afetada</th>
                <th>Desde</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={`${item.lojaId}-${item.sku ?? item.itemId}`}>
                  <td className="financeiro-td-titulo" title={item.titulo}>
                    {item.titulo}
                  </td>
                  <td className="financeiro-td-sku">
                    {item.sku ?? (
                      <span className="correcoes-sem-sku" title="Esse anúncio não tem nenhum SKU cadastrado no Mercado Livre — precisa cadastrar o SKU no anúncio antes de conseguir registrar o custo na planilha.">
                        Sem SKU no anúncio
                      </span>
                    )}
                  </td>
                  <td className={item.motivo.startsWith("Possível") ? "correcoes-motivo-alerta" : "financeiro-td-mudo"}>
                    {item.motivo}
                  </td>
                  <td className="financeiro-th-numero">{item.ocorrencias}</td>
                  <td className="financeiro-th-numero">{formatCurrency(item.receitaAfetada)}</td>
                  <td>{formatDataCurta(item.primeiraOcorrencia)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
