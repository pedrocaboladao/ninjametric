import { useCallback, useEffect, useState } from "react";
import type { Dre } from "../types/fabricaDre";
import { formatCurrency } from "../utils/format";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function fetchDre(de: string, ate: string): Promise<Dre> {
  const q = new URLSearchParams();
  if (de) q.set("de", de);
  if (ate) q.set("ate", ate);
  const res = await fetch(`${API_BASE}/api/fabrica-contas/dre?${q}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return (await res.json()).dre as Dre;
}

async function salvarAliquota(competencia: string, percentual: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/fabrica-contas/dre/imposto`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ competencia, percentual }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
}

// aceita "7,3" e "7.3"
function num(v: string): number {
  return Number(String(v).replace(",", ".")) || 0;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// "hoje" pelo fuso de São Paulo: às 22h o UTC já virou o dia seguinte
function mesAtual(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

function limitesDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${ultimoDia}` };
}

export function FabricaDre() {
  const [mes, setMes] = useState(mesAtual());
  const [dre, setDre] = useState<Dre | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aliquota, setAliquota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { de, ate } = limitesDoMes(mes);
    try {
      const r = await fetchDre(de, ate);
      setDre(r);
      setAliquota(String(r.percentualImposto));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao montar o DRE.");
    }
  }, [mes]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function reprocessar() {
    setSalvando(true);
    try {
      await salvarAliquota(mes, num(aliquota));
      // o DRE e calculado na leitura, entao recarregar ja refaz o mes inteiro
      await carregar();
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar a aliquota.");
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <p className="financeiro-td-mudo">{erro}</p>;
  if (!dre) return <p className="financeiro-td-mudo">Carregando…</p>;

  const negativo = dre.resultado < 0;

  return (
    <>
      <div className="financeiro-filtros">
        <input
          className="clonar-input fabricacao-input-pequeno"
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
        />
        <span className="financeiro-td-mudo">
          {dre.pedidos} pedido{dre.pedidos === 1 ? "" : "s"} · {dre.clientes} loja
          {dre.clientes === 1 ? "" : "s"}
        </span>
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="% imposto"
          value={aliquota}
          onChange={(e) => setAliquota(e.target.value)}
          title="Alíquota estimada sobre a venda deste mês"
        />
        <button
          type="button"
          className="btn-responder"
          onClick={() => void reprocessar()}
          disabled={salvando}
        >
          Aplicar e reprocessar
        </button>
        {dre.impostoHerdadoDe && (
          <span className="financeiro-td-mudo">
            alíquota herdada de {dre.impostoHerdadoDe.split("-").reverse().join("/")}
          </span>
        )}
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <tbody>
            <tr>
              <td>RECEITA — o que as lojas compraram</td>
              <td className="financeiro-th-numero">{formatCurrency(dre.receita)}</td>
              <td className="financeiro-th-numero financeiro-td-mudo">100%</td>
            </tr>
            <tr>
              <td className="financeiro-td-mudo">
                (−) Imposto sobre a venda ({dre.percentualImposto}%)
              </td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {formatCurrency(dre.imposto)}
              </td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {dre.percentualImposto}%
              </td>
            </tr>
            <tr>
              <td>= RECEITA LÍQUIDA</td>
              <td className="financeiro-th-numero">{formatCurrency(dre.receitaLiquida)}</td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {dre.receita > 0 ? pct(dre.receitaLiquida / dre.receita) : "—"}
              </td>
            </tr>
            <tr>
              <td className="financeiro-td-mudo">(−) Custo dos produtos vendidos</td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {formatCurrency(dre.custoProdutos)}
              </td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {dre.receita > 0 ? pct(dre.custoProdutos / dre.receita) : "—"}
              </td>
            </tr>
            <tr>
              <td>
                <strong>= MARGEM DE CONTRIBUIÇÃO</strong>
              </td>
              <td className="financeiro-th-numero">
                <strong>{formatCurrency(dre.margemContribuicao)}</strong>
              </td>
              <td className="financeiro-th-numero">{pct(dre.percentualMargem)}</td>
            </tr>
            <tr>
              <td className="financeiro-td-mudo">(−) Despesa fixa</td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {formatCurrency(dre.despesaFixa)}
              </td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {dre.receita > 0 ? pct(dre.despesaFixa / dre.receita) : "—"}
              </td>
            </tr>
            <tr>
              <td className="financeiro-td-mudo">(−) Despesa variável</td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {formatCurrency(dre.despesaVariavel)}
              </td>
              <td className="financeiro-th-numero financeiro-td-mudo">
                {dre.receita > 0 ? pct(dre.despesaVariavel / dre.receita) : "—"}
              </td>
            </tr>
            <tr>
              <td>
                <strong>= RESULTADO {negativo ? "(PREJUÍZO)" : ""}</strong>
              </td>
              <td className="financeiro-th-numero">
                <strong>{formatCurrency(dre.resultado)}</strong>
              </td>
              <td className="financeiro-th-numero">{pct(dre.percentualResultado)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="financeiro-td-mudo">
        O imposto é <strong>provisão</strong>, não guia paga: a fábrica vende agora e o imposto vem
        depois, então o mês da venda já mostra a mordida. Coloque uma alíquota segura e, quando a
        guia real chegar, corrija a % e clique em <strong>Aplicar e reprocessar</strong> — o mês
        inteiro é recalculado na hora, sem refazer lançamento nenhum.
        {dre.impostoLancado > 0 && (
          <>
            {" "}
            A guia lançada no Contas a pagar deste mês é de {formatCurrency(dre.impostoLancado)} e a
            provisão está em {formatCurrency(dre.imposto)} —{" "}
            {Math.abs(dre.impostoLancado - dre.imposto) < 0.005
              ? "bateu."
              : dre.imposto > dre.impostoLancado
                ? `provisionou ${formatCurrency(dre.imposto - dre.impostoLancado)} a mais.`
                : `provisionou ${formatCurrency(dre.impostoLancado - dre.imposto)} a menos.`}{" "}
            A guia fica fora do resultado pra não contar o mesmo imposto duas vezes.
          </>
        )}
      </p>

      <div className="financeiro-filtros">
        <div>
          <div className="financeiro-stat-label">PONTO DE EQUILÍBRIO</div>
          <div className="financeiro-stat-valor">{formatCurrency(dre.pontoEquilibrio)}</div>
        </div>
        <p className="financeiro-td-mudo">
          É quanto precisa vender no mês pra pagar a despesa fixa. Com margem de{" "}
          {pct(dre.percentualMargem)} sobre a receita líquida, cada real que sobra depois do
          imposto deixa {formatCurrency(dre.percentualMargem)} pra cobrir aluguel e salário.
        </p>
      </div>

      {dre.porCategoria.length > 0 && (
        <>
          <h2>Despesas por categoria</h2>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>CATEGORIA</th>
                  <th className="financeiro-th-numero">VALOR</th>
                  <th className="financeiro-th-numero">% DA RECEITA</th>
                </tr>
              </thead>
              <tbody>
                {dre.porCategoria.map((c) => (
                  <tr key={c.categoria}>
                    <td>{c.categoria}</td>
                    <td className="financeiro-th-numero">{formatCurrency(c.valor)}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {dre.receita > 0 ? pct(c.valor / dre.receita) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dre.jaNoCusto.length > 0 && (
        <>
          <h2>Compras de insumo — fora do resultado</h2>
          <p className="financeiro-td-mudo">
            {formatCurrency(dre.jaNoCustoTotal)} em matéria-prima, embalagem e água lançados no
            Contas a pagar deste mês. <strong>Não entram no resultado acima</strong> porque já estão
            dentro do custo dos produtos vendidos — somar aqui contaria o mesmo dinheiro duas vezes.
            Ficam visíveis porque o dinheiro saiu do caixa, e sumir do relatório seria pior que
            aparecer no lugar errado.
          </p>
          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <tbody>
                {dre.jaNoCusto.map((c) => (
                  <tr key={c.categoria}>
                    <td className="financeiro-td-mudo">{c.categoria}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {formatCurrency(c.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Resultado por produto</h2>
      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>PRODUTO</th>
              <th className="financeiro-th-numero">QUANTIDADE</th>
              <th className="financeiro-th-numero">RECEITA</th>
              <th className="financeiro-th-numero">CUSTO</th>
              <th className="financeiro-th-numero">MARGEM</th>
              <th className="financeiro-th-numero">%</th>
            </tr>
          </thead>
          <tbody>
            {!dre.porProduto.length && (
              <tr>
                <td colSpan={6}>Nenhuma venda neste mês.</td>
              </tr>
            )}
            {dre.porProduto.map((p) => (
              <tr key={p.produtoId}>
                <td>{p.nome}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">{p.quantidade}</td>
                <td className="financeiro-th-numero">{formatCurrency(p.receita)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {formatCurrency(p.custo)}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(p.margem)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {pct(p.percentualMargem)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="financeiro-td-mudo">
        Competência, não caixa: o pedido entra na data do pedido, não na data em que a loja pagou. E
        a conta entra no vencimento, não no pagamento. Um mês em que a loja atrasou o PIX não pode
        parecer um mês ruim de venda.
      </p>
    </>
  );
}
