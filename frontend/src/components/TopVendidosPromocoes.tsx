import type { TopVendidoPromocao, PromocaoStatus } from "../types/dashboard";
import type { Loja } from "../api/lojas";

interface Props {
  produtos: TopVendidoPromocao[];
  lojas: Loja[];
  lojaFiltro: number | "todas" | "minhas";
  onChangeLojaFiltro: (valor: number | "todas" | "minhas") => void;
}

const BADGES: Record<PromocaoStatus, { texto: string; classe: string }> = {
  com_promocao: { texto: "Em promoção", classe: "promo-badge-ativa" },
  sem_promocao: { texto: "Sem promoção", classe: "promo-badge-alerta" },
  anuncio_pausado: { texto: "Anúncio pausado", classe: "promo-badge-neutro" },
  nao_verificado: { texto: "Não verificado", classe: "promo-badge-neutro" },
};

export function TopVendidosPromocoes({ produtos, lojas, lojaFiltro, onChangeLojaFiltro }: Props) {
  const semPromocao = produtos.filter((p) => p.promocao === "sem_promocao").length;

  return (
    <div className="painel painel-top-vendidos">
      <div className="top-vendidos-header">
        <div>
          <span className="painel-eyebrow">Diagnóstico de promoções</span>
          <h2>Top 20 mais vendidos (60 dias)</h2>
        </div>
        <div className="top-vendidos-header-direita">
          {semPromocao > 0 && (
            <span className="promo-badge promo-badge-alerta promo-resumo-alerta">{semPromocao} sem promoção</span>
          )}
          <select
            className="dashboard-select top-vendidos-select"
            value={lojaFiltro}
            onChange={(e) => {
              const valor = e.target.value;
              onChangeLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
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
        </div>
      </div>

      <div className="top-vendidos-lista">
        {produtos.map((p) => {
          const badge = BADGES[p.promocao];
          return (
            <a
              key={`${p.lojaId}:${p.mlItemId}`}
              className={`top-vendido-item ${p.promocao === "sem_promocao" ? "top-vendido-alerta" : ""}`}
              href={p.linkMl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
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
              </div>
              <div className="top-vendido-badges">
                <span className={`promo-badge ${badge.classe}`}>{badge.texto}</span>
                {p.ads === "ads_ativo" && <span className="promo-badge promo-badge-ads">Ads ativo</span>}
              </div>
            </a>
          );
        })}
        {produtos.length === 0 && <div className="state-message">Sem vendas nos últimos 60 dias.</div>}
      </div>
    </div>
  );
}
