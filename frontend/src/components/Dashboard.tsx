import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useTopVendidosPromocoes } from "../hooks/useTopVendidosPromocoes";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";
import { fetchLojas, type Loja } from "../api/lojas";
import {
  fetchRankingPrecificacao,
  fetchLojasVigilancia,
  fetchEstoqueBaixo,
  fetchVendasNegativas,
  fetchAnunciosNegativos,
  fetchExperienciaCompraRuim,
} from "../api/dashboard";
import type {
  RankingPrecificacao as RankingPrecificacaoTipo,
  ProdutoEstoqueBaixo,
  VendaNegativa,
  AnuncioNegativo,
  ExperienciaCompraRuim as ExperienciaCompraRuimTipo,
} from "../types/dashboard";
import { DashboardHeader } from "./DashboardHeader";
import { HeroFaturamento } from "./HeroFaturamento";
import { RankingLojas } from "./RankingLojas";
import { VendasChart } from "./VendasChart";
import { ProdutosRanking } from "./ProdutosRanking";
import { TopVendidosPromocoes } from "./TopVendidosPromocoes";
import { RankingPrecificacao } from "./RankingPrecificacao";
import { EstoqueBaixo } from "./EstoqueBaixo";
import { VendasNegativas } from "./VendasNegativas";
import { AnunciosNegativos } from "./AnunciosNegativos";
import { ExperienciaCompraRuim } from "./ExperienciaCompraRuim";
import { PainelEstudo } from "./PainelEstudo";
import type { Usuario } from "../types/usuarios";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diasAtrasISO(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

interface Props {
  usuario: Usuario;
}

export function Dashboard({ usuario }: Props) {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojasVigilancia, setLojasVigilancia] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroPromocoes, setLojaFiltroPromocoes] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroPrecificacao, setLojaFiltroPrecificacao] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroEstoque, setLojaFiltroEstoque] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroVendasNegativas, setLojaFiltroVendasNegativas] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroAnunciosNegativos, setLojaFiltroAnunciosNegativos] = useState<number | "todas" | "minhas">("todas");
  const [lojaFiltroExperienciaCompra, setLojaFiltroExperienciaCompra] = useState<number | "todas" | "minhas">("todas");
  const [modoDataPrecificacao, setModoDataPrecificacao] = useState<"hoje" | "7dias">("hoje");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => {});
    fetchLojasVigilancia()
      .then(setLojasVigilancia)
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

  const dataInicioPrecificacao = modoDataPrecificacao === "hoje" ? hojeISO() : diasAtrasISO(7);
  const dataFimPrecificacao = hojeISO();

  const buscarRankingPrecificacao = useCallback(
    () =>
      fetchRankingPrecificacao(
        lojaFiltroPrecificacao === "todas" ? undefined : lojaFiltroPrecificacao,
        dataInicioPrecificacao,
        dataFimPrecificacao
      ),
    [lojaFiltroPrecificacao, dataInicioPrecificacao, dataFimPrecificacao]
  );
  const { dados: rankingPrecificacao, erro: erroRankingPrecificacao } = useBuscaComCancelamento<RankingPrecificacaoTipo>(
    buscarRankingPrecificacao,
    true
  );

  const buscarEstoqueBaixo = useCallback(
    () => fetchEstoqueBaixo(lojaFiltroEstoque === "todas" ? undefined : lojaFiltroEstoque),
    [lojaFiltroEstoque]
  );
  const { dados: estoqueBaixo, erro: erroEstoqueBaixo } = useBuscaComCancelamento<ProdutoEstoqueBaixo[]>(
    buscarEstoqueBaixo,
    true
  );

  const buscarVendasNegativas = useCallback(
    () => fetchVendasNegativas(lojaFiltroVendasNegativas === "todas" ? undefined : lojaFiltroVendasNegativas),
    [lojaFiltroVendasNegativas]
  );
  const { dados: vendasNegativas, erro: erroVendasNegativas } = useBuscaComCancelamento<VendaNegativa[]>(
    buscarVendasNegativas,
    true
  );

  const buscarAnunciosNegativos = useCallback(
    () => fetchAnunciosNegativos(lojaFiltroAnunciosNegativos === "todas" ? undefined : lojaFiltroAnunciosNegativos),
    [lojaFiltroAnunciosNegativos]
  );
  const { dados: anunciosNegativos, erro: erroAnunciosNegativos } = useBuscaComCancelamento<AnuncioNegativo[]>(
    buscarAnunciosNegativos,
    true
  );

  const buscarExperienciaCompra = useCallback(
    () => fetchExperienciaCompraRuim(lojaFiltroExperienciaCompra === "todas" ? undefined : lojaFiltroExperienciaCompra),
    [lojaFiltroExperienciaCompra]
  );
  const { dados: experienciaCompraRuim, erro: erroExperienciaCompra } = useBuscaComCancelamento<
    ExperienciaCompraRuimTipo[]
  >(buscarExperienciaCompra, true);

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
            <div className="dashboard-coluna-esquerda">
              <RankingLojas lojas={data.rankingLojas} />
              <PainelEstudo podeGerenciarCanais={usuario.admin} />
            </div>
            <div className="dashboard-coluna-meio">
              <div className="painel painel-chart">
                <span className="painel-eyebrow">Evolução por hora</span>
                <h2>Vendas brutas por hora</h2>
                <p className="painel-sub">Hoje comparado a ontem</p>
                <VendasChart dados={data.vendasPorHora} />
              </div>

              {loadingTopVendidos && (
                <div className="state-message painel painel-top-vendidos">
                  Carregando diagnóstico de promoções (pode levar até 30s em "Todas as lojas")...
                </div>
              )}
              {errorTopVendidos && (
                <div className="state-message state-error painel painel-top-vendidos">
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

              {erroRankingPrecificacao && (
                <div className="state-message state-error painel painel-top-vendidos">
                  Erro ao carregar vigilância de preço e margem: {erroRankingPrecificacao}
                </div>
              )}
              {!erroRankingPrecificacao && !rankingPrecificacao && (
                <div className="state-message painel painel-top-vendidos">
                  Carregando vigilância de preço e margem...
                </div>
              )}
              {rankingPrecificacao && (
                <RankingPrecificacao
                  ranking={rankingPrecificacao}
                  lojas={lojasVigilancia}
                  lojaFiltro={lojaFiltroPrecificacao}
                  onChangeLojaFiltro={setLojaFiltroPrecificacao}
                  modoData={modoDataPrecificacao}
                  onChangeModoData={setModoDataPrecificacao}
                  dataInicio={dataInicioPrecificacao}
                  dataFim={dataFimPrecificacao}
                />
              )}

              {erroEstoqueBaixo && (
                <div className="state-message state-error painel painel-top-vendidos">
                  Erro ao carregar estoque baixo: {erroEstoqueBaixo}
                </div>
              )}
              {!erroEstoqueBaixo && !estoqueBaixo && (
                <div className="state-message painel painel-top-vendidos">Carregando estoque baixo...</div>
              )}
              {estoqueBaixo && (
                <EstoqueBaixo
                  produtos={estoqueBaixo}
                  lojas={lojas}
                  lojaFiltro={lojaFiltroEstoque}
                  onChangeLojaFiltro={setLojaFiltroEstoque}
                />
              )}

              {erroVendasNegativas && (
                <div className="state-message state-error painel painel-top-vendidos">
                  Erro ao carregar vendas negativas: {erroVendasNegativas}
                </div>
              )}
              {!erroVendasNegativas && !vendasNegativas && (
                <div className="state-message painel painel-top-vendidos">Carregando vendas negativas...</div>
              )}
              {vendasNegativas && (
                <VendasNegativas
                  vendas={vendasNegativas}
                  lojas={lojas}
                  lojaFiltro={lojaFiltroVendasNegativas}
                  onChangeLojaFiltro={setLojaFiltroVendasNegativas}
                />
              )}

              {erroAnunciosNegativos && (
                <div className="state-message state-error painel painel-top-vendidos">
                  Erro ao carregar anúncios com margem negativa: {erroAnunciosNegativos}
                </div>
              )}
              {!erroAnunciosNegativos && !anunciosNegativos && (
                <div className="state-message painel painel-top-vendidos">Carregando anúncios com margem negativa...</div>
              )}
              {anunciosNegativos && (
                <AnunciosNegativos
                  anuncios={anunciosNegativos}
                  lojas={lojas}
                  lojaFiltro={lojaFiltroAnunciosNegativos}
                  onChangeLojaFiltro={setLojaFiltroAnunciosNegativos}
                />
              )}

              {erroExperienciaCompra && (
                <div className="state-message state-error painel painel-top-vendidos">
                  Erro ao carregar experiência de compra: {erroExperienciaCompra}
                </div>
              )}
              {!erroExperienciaCompra && !experienciaCompraRuim && (
                <div className="state-message painel painel-top-vendidos">Carregando experiência de compra...</div>
              )}
              {experienciaCompraRuim && (
                <ExperienciaCompraRuim
                  anuncios={experienciaCompraRuim}
                  lojas={lojas}
                  lojaFiltro={lojaFiltroExperienciaCompra}
                  onChangeLojaFiltro={setLojaFiltroExperienciaCompra}
                />
              )}
            </div>
            <ProdutosRanking produtos={data.produtosMaisVendidos} />
          </div>
        </>
      )}
    </div>
  );
}
