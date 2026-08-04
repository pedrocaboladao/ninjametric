import { useCallback, useEffect, useState } from "react";
import { fetchDre } from "../api/dre";
import { fetchLojas, type Loja } from "../api/lojas";
import type { Dre as DreTipo, DreMes } from "../types/dre";
import { formatCurrency } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function anoAtual(): number {
  return new Date().getFullYear();
}

function custoOperacionalTotal(m: DreMes): number {
  return m.freteVendedor + m.custoProdutos + m.taxaMl + m.imposto + m.cancelamentos;
}

function classes(...c: (string | undefined | false)[]): string {
  return c.filter(Boolean).join(" ");
}

// Uma linha de valores em R$: rótulo + 12 meses + total, todas colunas
// alinhadas com o cabeçalho da tabela. corPorSinal pinta cada valor de
// branco (positivo) ou vermelho (negativo) — usado só no Lucro Líquido.
function LinhaValores({
  label,
  meses,
  total,
  valor,
  classe,
  corPorSinal,
  mesDestaque,
}: {
  label: string;
  meses: DreMes[];
  total: number;
  valor: (m: DreMes) => number;
  classe?: string;
  corPorSinal?: boolean;
  mesDestaque?: number;
}) {
  return (
    <tr className={classe}>
      <td>{label}</td>
      {meses.map((m) => {
        const v = valor(m);
        return (
          <td
            key={m.mes}
            className={classes(
              "financeiro-th-numero",
              m.mes === mesDestaque && "dre-coluna-atual",
              corPorSinal && (v < 0 ? "dre-valor-negativo" : "dre-valor-positivo")
            )}
          >
            {v !== 0 ? formatCurrency(v) : "—"}
          </td>
        );
      })}
      <td
        className={classes(
          "financeiro-th-numero",
          corPorSinal && (total < 0 ? "dre-valor-negativo" : "dre-valor-positivo")
        )}
      >
        {formatCurrency(total)}
      </td>
    </tr>
  );
}

// Uma linha de custo fixo detalhado: rótulo (descrição do lançamento) + valor
// por mês (array de 12 posições, índice 0 = janeiro, sem DreMes por trás).
function LinhaCustoFixoDetalhe({
  descricao,
  porMes,
  total,
  mesDestaque,
}: {
  descricao: string;
  porMes: number[];
  total: number;
  mesDestaque?: number;
}) {
  return (
    <tr className="dre-linha-detalhe">
      <td>{descricao}</td>
      {porMes.map((v, i) => (
        <td key={i} className={classes("financeiro-th-numero", i + 1 === mesDestaque && "dre-coluna-atual")}>
          {v !== 0 ? formatCurrency(v) : "—"}
        </td>
      ))}
      <td className="financeiro-th-numero">{formatCurrency(total)}</td>
    </tr>
  );
}

function LinhaPercentual({
  label,
  meses,
  valor,
  mesDestaque,
}: {
  label: string;
  meses: DreMes[];
  valor: (m: DreMes) => number | null;
  mesDestaque?: number;
}) {
  return (
    <tr className="dre-linha-percentual">
      <td>{label}</td>
      {meses.map((m) => {
        const v = valor(m);
        return (
          <td key={m.mes} className={classes("financeiro-th-numero", m.mes === mesDestaque && "dre-coluna-atual")}>
            {v !== null ? `${v.toFixed(1)}%` : "—"}
          </td>
        );
      })}
      <td />
    </tr>
  );
}

export function Dre() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [ano, setAno] = useState(anoAtual());

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscar = useCallback(() => fetchDre(ano, lojaFiltro), [ano, lojaFiltro]);
  const { dados, erro } = useBuscaComCancelamento<DreTipo>(buscar, true);

  const anosDisponiveis = Array.from({ length: 5 }, (_, i) => anoAtual() - i);
  const hoje = new Date();
  const mesDestaque = ano === hoje.getFullYear() ? hoje.getMonth() + 1 : undefined;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">DRE</span>
          <h1>Demonstração do Resultado do Exercício</h1>
          <p className="painel-sub">
            Faturamento, custo operacional, margem de contribuição, custo fixo e lucro líquido por mês. O DRE
            acompanha os meses a partir de agosto/2026 pra frente — não recalcula meses anteriores.
          </p>
        </div>
        <div className="financeiro-filtros">
          <select className="dashboard-select" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anosDisponiveis.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
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
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && !dados && <div className="state-message">Carregando DRE...</div>}

      {dados && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela dre-tabela">
            <thead>
              <tr>
                <th></th>
                {MESES_LABEL.map((m, i) => (
                  <th key={m} className={classes("financeiro-th-numero", i + 1 === mesDestaque && "dre-coluna-atual")}>
                    {m}
                  </th>
                ))}
                <th className="financeiro-th-numero">Total</th>
              </tr>
            </thead>
            <tbody>
              <LinhaValores
                label="(+) Faturamento ML"
                meses={dados.meses}
                total={dados.totais.faturamento}
                valor={(m) => m.faturamento}
                classe="dre-linha-entrada"
                mesDestaque={mesDestaque}
              />

              <LinhaValores
                label="(-) Custo Operacional"
                meses={dados.meses}
                total={custoOperacionalTotal(dados.totais)}
                valor={custoOperacionalTotal}
                classe="dre-linha-custo-total"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Frete Vendedor"
                meses={dados.meses}
                total={dados.totais.freteVendedor}
                valor={(m) => m.freteVendedor}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Custo dos Produtos"
                meses={dados.meses}
                total={dados.totais.custoProdutos}
                valor={(m) => m.custoProdutos}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Tarifa de Venda ML"
                meses={dados.meses}
                total={dados.totais.taxaMl}
                valor={(m) => m.taxaMl}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Imposto"
                meses={dados.meses}
                total={dados.totais.imposto}
                valor={(m) => m.imposto}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Vendas Canceladas"
                meses={dados.meses}
                total={dados.totais.cancelamentos}
                valor={(m) => m.cancelamentos}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />

              <LinhaValores
                label="(=) Margem de Contribuição"
                meses={dados.meses}
                total={dados.totais.margemContribuicao}
                valor={(m) => m.margemContribuicao}
                classe="dre-linha-resultado"
                mesDestaque={mesDestaque}
              />
              <LinhaPercentual
                label="% sobre faturamento"
                meses={dados.meses}
                valor={(m) => m.margemPercentual}
                mesDestaque={mesDestaque}
              />

              <LinhaValores
                label="(-) Custo Fixo"
                meses={dados.meses}
                total={dados.totais.custoFixoTotal}
                valor={(m) => m.custoFixoTotal}
                classe="dre-linha-custo-total"
                mesDestaque={mesDestaque}
              />
              <LinhaValores
                label="Campanhas Ads ML"
                meses={dados.meses}
                total={dados.totais.gastoAds}
                valor={(m) => m.gastoAds}
                classe="dre-linha-detalhe"
                mesDestaque={mesDestaque}
              />
              {dados.custoFixoDetalhado.map((linha) => (
                <LinhaCustoFixoDetalhe
                  key={linha.descricao}
                  descricao={linha.descricao}
                  porMes={linha.porMes}
                  total={linha.total}
                  mesDestaque={mesDestaque}
                />
              ))}

              <LinhaValores
                label="(=) Lucro Líquido"
                meses={dados.meses}
                total={dados.totais.lucroLiquido}
                valor={(m) => m.lucroLiquido}
                classe="dre-linha-lucro"
                corPorSinal
                mesDestaque={mesDestaque}
              />
              <LinhaPercentual
                label="% sobre faturamento"
                meses={dados.meses}
                valor={(m) => m.lucroPercentual}
                mesDestaque={mesDestaque}
              />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
