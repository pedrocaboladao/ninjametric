import { useEffect, useMemo, useState } from "react";
import { fetchProdutos } from "../api/produtos";
import type { Produto } from "../types/produtos";
import { formatCurrency } from "../utils/format";

const LIMITE_RESULTADOS = 100;

export function Produtos() {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetchProdutos()
      .then(setProdutos)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar produtos."));
  }, []);

  const buscaNormalizada = busca.trim().toLowerCase();
  const resultados = useMemo(() => {
    if (!produtos || !buscaNormalizada) return [];
    return produtos
      .filter((p) => p.sku.toLowerCase().includes(buscaNormalizada) || p.ean.includes(buscaNormalizada))
      .slice(0, LIMITE_RESULTADOS);
  }, [produtos, buscaNormalizada]);

  return (
    <div className="produtos-page">
      <div className="produtos-topo">
        <span className="painel-eyebrow">Catálogo</span>
        <h1>Produtos</h1>
        <p className="painel-sub">Consulte custo e preços de referência pelo SKU ou código de barras (EAN).</p>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && produtos === null && <div className="state-message">Carregando planilha de produtos...</div>}

      {produtos !== null && (
        <>
          <input
            className="clonar-input produtos-busca"
            placeholder="Buscar por SKU ou EAN..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            autoFocus
          />

          {!buscaNormalizada && (
            <div className="state-message">
              {produtos.length} produtos na planilha — digite pra buscar por SKU ou EAN.
            </div>
          )}
          {buscaNormalizada && resultados.length === 0 && (
            <div className="state-message">Nenhum produto encontrado para "{busca}".</div>
          )}
          {buscaNormalizada && resultados.length === LIMITE_RESULTADOS && (
            <div className="state-message">Mostrando os primeiros {LIMITE_RESULTADOS} resultados — refine a busca.</div>
          )}

          {resultados.length > 0 && (
            <div className="produtos-tabela">
              <div className="produtos-tabela-linha produtos-tabela-header">
                <span>SKU</span>
                <span>Custo</span>
                <span>Clássico</span>
                <span>Premium</span>
                <span>Shopee</span>
                <span>EAN</span>
              </div>
              {resultados.map((p) => (
                <div key={p.sku} className="produtos-tabela-linha">
                  <span className="produtos-sku" title={p.sku}>
                    {p.sku}
                  </span>
                  <span>{formatCurrency(p.custo)}</span>
                  <span>{formatCurrency(p.precoClassico)}</span>
                  <span>{formatCurrency(p.precoPremium)}</span>
                  <span>{formatCurrency(p.precoShopee)}</span>
                  <span className="produtos-ean">{p.ean}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
