import { useEffect, useRef, useState } from "react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useTopVendidosPromocoes } from "../hooks/useTopVendidosPromocoes";
import { fetchLojas, type Loja } from "../api/lojas";
import { DashboardHeader } from "./DashboardHeader";
import { HeroFaturamento } from "./HeroFaturamento";
import { RankingLojas } from "./RankingLojas";
import { VendasChart } from "./VendasChart";
import { ProdutosRanking } from "./ProdutosRanking";
import { TopVendidosPromocoes } from "./TopVendidosPromocoes";

export function Dashboard() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroPromocoes, setLojaFiltroPromocoes] = useState<number | "todas" | "minhas">("todas");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => {});
  }, []);

  const { data, error, loading, atualizando, atualizadoEm } = useDashboardData(
    lojaFiltro === "todas" ? undefined : lojaFiltro
  );
  const {
    produtos: topVendidos,
    loading: loadingTopVendidos,
    error: errorTopVendidos,
  } = useTopVendidosPromocoes(lojaFiltroPromocoes === "todas" ? undefined : lojaFiltroPromocoes);

  function handleExpandir() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }

  const nomeLojaFiltro =
    lojaFiltro === "todas"
      ? "Todas as lojas"
      : lojaFiltro === "minhas"
      ? "Minhas lojas"
      : lojas.find((l) => l.id === lojaFiltro)?.nome ?? "Todas as lojas";

  return (
    <div className="dashboard" ref={containerRef}>
      <section className="hero-secao">
        <DashboardHeader
          lojas={lojas}
          lojaFiltro={lojaFiltro}
          onChangeLojaFiltro={setLojaFiltro}
          atualizadoEm={atualizadoEm}
          atualizando={atualizando}
          onExpandir={handleExpandir}
        />

        {data && (
          <HeroFaturamento
            faturamentoHoje={data.faturamentoHoje}
            faturamentoOntemMesmoHorario={data.faturamentoOntemMesmoHorario}
            variacaoPercentual={data.variacaoPercentual}
            ultimaVendaEm={data.ultimaVendaEm}
            nomeLoja={nomeLojaFiltro}
          />
        )}
      </section>

      {loading && <div className="state-message">Carregando dashboard...</div>}
      {error && <div className="state-message state-error">Erro ao carregar dashboard: {error}</div>}

      {data && (
        <>
          <div className="dashboard-grid">
            <RankingLojas lojas={data.rankingLojas} />
            <div className="painel painel-chart">
              <span className="painel-eyebrow">Evolução por hora</span>
              <h2>Vendas brutas por hora</h2>
              <p className="painel-sub">Hoje comparado a ontem</p>
              <VendasChart dados={data.vendasPorHora} />
            </div>
            <ProdutosRanking produtos={data.produtosMaisVendidos} />
          </div>

          {loadingTopVendidos && (
            <div className="state-message painel-top-vendidos">
              Carregando diagnóstico de promoções (pode levar até 30s em "Todas as lojas")...
            </div>
          )}
          {errorTopVendidos && (
            <div className="state-message state-error painel-top-vendidos">
              Erro ao carregar diagnóstico de promoções: {errorTopVendidos}
            </div>
          )}
          {!loadingTopVendidos && topVendidos && (
            <TopVendidosPromocoes
              produtos={topVendidos}
              lojas={lojas}
              lojaFiltro={lojaFiltroPromocoes}
              onChangeLojaFiltro={setLojaFiltroPromocoes}
            />
          )}
        </>
      )}
    </div>
  );
}
