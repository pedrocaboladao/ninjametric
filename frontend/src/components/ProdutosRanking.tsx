import type { ProdutoMaisVendido } from "../types/dashboard";
import { formatCurrency, corDaLoja } from "../utils/format";

interface Props {
  produtos: ProdutoMaisVendido[];
}

export function ProdutosRanking({ produtos }: Props) {
  return (
    <div className="painel">
      <span className="painel-eyebrow">Ranking ao vivo</span>
      <h2>Produtos mais vendidos</h2>

      <div className="produtos-lista">
        {produtos.slice(0, 8).map((p, i, arr) => (
          <a
            key={`${p.lojaId}:${p.mlItemId}`}
            className={`produto-item ${i < arr.length - 1 ? "produto-item-separado" : ""}`}
            href={p.linkMl ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span className="produto-rank">{i + 1}</span>
            {p.foto ? (
              <img className="produto-foto" src={p.foto} alt="" loading="lazy" />
            ) : (
              <div className="produto-foto produto-foto-vazia" />
            )}
            <div className="produto-info">
              <div className="produto-titulo" title={p.titulo}>
                {p.titulo}
              </div>
              <div className="produto-mlb">{p.mlItemId}</div>
              <div className="produto-loja">
                <i className="ranking-dot" style={{ background: corDaLoja(p.lojaId) }} />
                {p.lojaNome}
              </div>
              <div className="produto-valores">
                <span className="produto-preco">{formatCurrency(p.precoTotal)}</span>
                <span className="produto-qtd">{p.quantidade} un.</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
