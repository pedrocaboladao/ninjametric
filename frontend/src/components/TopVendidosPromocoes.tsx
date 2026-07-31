import type { TopVendidoPromocao, PromocaoStatus } from "../types/dashboard";
import { formatCurrency, corDaLoja } from "../utils/format";

interface Props {
  produtos: TopVendidoPromocao[];
}

const BADGES: Record<PromocaoStatus, { texto: string; classe: string }> = {
  com_promocao: { texto: "Em promoção", classe: "promo-badge-ativa" },
  sem_promocao: { texto: "Sem promoção", classe: "promo-badge-alerta" },
  nao_verificado: { texto: "Não verificado", classe: "promo-badge-neutro" },
};

export function TopVendidosPromocoes({ produtos }: Props) {
  const semPromocao = produtos.filter((p) => p.promocao === "sem_promocao").length;

  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Diagnóstico de promoções</span>
          <h2>Top 20 mais vendidos (últimos 60 dias)</h2>
          <p className="painel-sub">Anúncios com maior saída e se estão com promoção ativa na Central de Promoções</p>
        </div>
        {semPromocao > 0 && (
          <span className="promo-badge promo-badge-alerta promo-resumo-alerta">
            {semPromocao} sem promoção
          </span>
        )}
      </div>

      <div className="top-vendidos-lista">
        {produtos.map((p, i) => {
          const badge = BADGES[p.promocao];
          return (
            <a
              key={`${p.lojaId}:${p.mlItemId}`}
              className={`top-vendido-item ${p.promocao === "sem_promocao" ? "top-vendido-alerta" : ""}`}
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
              <div className="top-vendido-info">
                <div className="produto-titulo" title={p.titulo}>
                  {p.titulo}
                </div>
                <div className="produto-mlb">{p.mlItemId}</div>
                <div className="produto-loja">
                  <i className="ranking-dot" style={{ background: corDaLoja(p.lojaId) }} />
                  {p.lojaNome}
                </div>
              </div>
              <div className="top-vendido-valores">
                <span className="produto-preco">{formatCurrency(p.precoTotal)}</span>
                <span className="produto-qtd">{p.quantidade} un.</span>
              </div>
              <span className={`promo-badge ${badge.classe}`}>{badge.texto}</span>
            </a>
          );
        })}
        {produtos.length === 0 && <div className="state-message">Sem vendas nos últimos 60 dias.</div>}
      </div>
    </div>
  );
}
