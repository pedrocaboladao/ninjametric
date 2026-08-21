import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchEstoque,
  fetchCapacidade,
  fetchAjustes,
  definirEstoqueMinimo,
  definirControlaEstoque,
  fetchContasInsumo,
  registrarContaInsumo,
  excluirContaInsumo,
  registrarAjuste,
  excluirAjuste,
} from "../api/fabricaEstoque";
import type {
  EstoqueMateriaPrima,
  AjusteEstoque,
  CapacidadeFormula,
  ContaInsumo,
} from "../types/fabricaEstoque";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash } from "./icons";
import { BuscaSelecao } from "./BuscaSelecao";
import type { ItemBusca } from "./BuscaSelecao";

function kg(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
}

// aceita "1.234,5" e "1234.5" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
}

export function FabricaEstoque() {
  const [estoque, setEstoque] = useState<EstoqueMateriaPrima[] | null>(null);
  const [capacidade, setCapacidade] = useState<CapacidadeFormula[]>([]);
  const [ajustes, setAjustes] = useState<AjusteEstoque[]>([]);
  const [contas, setContas] = useState<ContaInsumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<"estoque" | "capacidade" | "ajustes" | "contas">("estoque");

  // conta de consumo (agua)
  const [contaMpId, setContaMpId] = useState("");
  const [contaMes, setContaMes] = useState("");
  const [contaValor, setContaValor] = useState("");
  const [contaPct, setContaPct] = useState("100");
  const [contaObs, setContaObs] = useState("");

  const [mpId, setMpId] = useState("");
  const [tipo, setTipo] = useState<"inventario" | "ajuste">("inventario");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [e, c, a, ct] = await Promise.all([
        fetchEstoque(),
        fetchCapacidade(),
        fetchAjustes(),
        fetchContasInsumo(),
      ]);
      setEstoque(e);
      setCapacidade(c);
      setAjustes(a);
      setContas(ct);
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar.");
      setEstoque([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertas = useMemo(() => (estoque ?? []).filter((e) => e.abaixoDoMinimo), [estoque]);
  const itensMp: ItemBusca[] = useMemo(
    () =>
      (estoque ?? []).map((e) => ({
        id: e.materiaPrimaId,
        titulo: e.nome,
        detalhe: `saldo ${kg(e.saldo)}`,
      })),
    [estoque]
  );
  const valorTotal = useMemo(
    () => (estoque ?? []).reduce((s, e) => s + Math.max(0, e.valorEmEstoque), 0),
    [estoque]
  );

  async function alternarControle(e: EstoqueMateriaPrima) {
    try {
      await definirControlaEstoque(e.materiaPrimaId, !e.controlaEstoque);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao mudar o controle.");
    }
  }

  async function salvarMinimo(e: EstoqueMateriaPrima, valor: string) {
    try {
      await definirEstoqueMinimo(e.materiaPrimaId, num(valor));
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar mínimo.");
    }
  }

  async function lancar() {
    const id = Number(mpId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a matéria-prima.");
    const v = num(quantidade);
    if (tipo === "ajuste" && v === 0) return setErro("Informe a quantidade (positiva entra, negativa sai).");
    try {
      const r = await registrarAjuste({
        materiaPrimaId: id,
        tipo,
        quantidadeKg: tipo === "ajuste" ? v : undefined,
        contadoKg: tipo === "inventario" ? v : undefined,
        motivo: motivo.trim() || null,
      });
      setAviso(
        tipo === "inventario" && r.diferenca !== undefined
          ? `Inventário registrado. Diferença de ${kg(r.diferenca)} em relação ao que o sistema tinha.`
          : "Ajuste registrado."
      );
      setQuantidade("");
      setMotivo("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar.");
    }
  }

  async function lancarConta() {
    const id = Number(contaMpId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha o insumo.");
    if (!/^\d{4}-\d{2}/.test(contaMes)) return setErro("Informe o mes da conta.");
    const valor = num(contaValor);
    if (valor <= 0) return setErro("Informe o valor da conta.");
    try {
      const r = await registrarContaInsumo({
        materiaPrimaId: id,
        competencia: contaMes,
        valor,
        percentualProducao: num(contaPct) || 100,
        observacao: contaObs.trim() || null,
      });
      setAviso(
        r.aplicado
          ? `Conta lancada. ${kg(r.kgConsumidos)} usados no mes, entao o quilo saiu a R$ ${r.custoPorKg.toFixed(4)} — ja aplicado na formula.`
          : "Conta guardada, mas nao houve lote nesse mes: sem quilos pra dividir, o preco nao foi mexido."
      );
      setContaValor("");
      setContaObs("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lancar a conta.");
    }
  }

  async function apagarConta(c: ContaInsumo) {
    if (!confirm(`Excluir a conta de ${c.materiaPrimaNome} de ${c.competencia}?`)) return;
    try {
      await excluirContaInsumo(c.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  async function apagar(a: AjusteEstoque) {
    if (!confirm(`Excluir o ajuste de ${kg(a.quantidadeKg)} em ${a.materiaPrimaNome}?`)) return;
    try {
      await excluirAjuste(a.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Estoque de matéria-prima</h1>
          <p className="financeiro-td-mudo">
            O saldo não é digitado: sai do que foi comprado menos o que os lotes consumiram, mais
            os ajustes. Um lote de cor consome a matéria-prima crua — a base é passagem, não insumo.
            Desmarque CONTROLA no que não se compra: a água sai da torneira e é 30% de cada receita,
            então sem isso ela vira o gargalo de todas as fórmulas.
          </p>
        </div>
        <div>
          <div className="financeiro-stat-label">
            {alertas.length ? `${alertas.length} ABAIXO DO MÍNIMO` : "VALOR EM ESTOQUE"}
          </div>
          <div className="financeiro-stat-valor">
            {alertas.length ? alertas.length : formatCurrency(valorTotal)}
          </div>
        </div>
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      <div className="financeiro-filtros">
        {(["estoque", "capacidade", "ajustes", "contas"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => setAba(a)}
          >
            {a === "estoque"
              ? "Saldo"
              : a === "capacidade"
                ? "Dá pra fabricar"
                : a === "ajustes"
                  ? "Ajustes"
                  : "Conta de água"}
          </button>
        ))}
      </div>

      {aba === "estoque" && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>MATÉRIA-PRIMA</th>
                <th className="financeiro-th-numero">COMPRADO</th>
                <th className="financeiro-th-numero">CONSUMIDO</th>
                <th className="financeiro-th-numero">AJUSTES</th>
                <th className="financeiro-th-numero">SALDO</th>
                <th className="financeiro-th-numero">MÍNIMO</th>
                <th>CONTROLA</th>
                <th>SITUAÇÃO</th>
                <th className="financeiro-th-numero">VALOR</th>
              </tr>
            </thead>
            <tbody>
              {estoque === null && <tr><td colSpan={9}>Carregando…</td></tr>}
              {(estoque ?? []).map((e) => (
                <tr key={e.materiaPrimaId}>
                  <td>{e.nome}</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{kg(e.comprado)}</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{kg(e.consumido)}</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{e.ajustes ? kg(e.ajustes) : "—"}</td>
                  <td className="financeiro-th-numero">{kg(e.saldo)}</td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      defaultValue={e.estoqueMinimo || ""}
                      placeholder="—"
                      onBlur={(ev) => {
                        if (num(ev.target.value) !== e.estoqueMinimo) void salvarMinimo(e, ev.target.value);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={e.controlaEstoque}
                      onChange={() => void alternarControle(e)}
                      title="Desmarque o que não se compra — água sai da torneira"
                    />
                  </td>
                  <td className={e.abaixoDoMinimo ? undefined : "financeiro-td-mudo"}>
                    {!e.controlaEstoque
                      ? "não controlada"
                      : e.estoqueMinimo <= 0
                        ? "sem mínimo"
                        : e.abaixoDoMinimo
                          ? "COMPRAR"
                          : "ok"}
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{formatCurrency(e.valorEmEstoque)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "capacidade" && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>FÓRMULA</th>
                <th className="financeiro-th-numero">DÁ PRA FABRICAR</th>
                <th>TRAVADO POR</th>
                <th className="financeiro-th-numero">SALDO DO GARGALO</th>
                <th className="financeiro-th-numero">A RECEITA PEDE</th>
              </tr>
            </thead>
            <tbody>
              {!capacidade.length && <tr><td colSpan={5}>Sem dados.</td></tr>}
              {capacidade
                .slice()
                // quem não tem limite conhecido vai pro fim: o que aperta primeiro
                // é o que precisa aparecer primeiro
                .sort((a, b) => (a.maximoKg ?? Infinity) - (b.maximoKg ?? Infinity))
                .map((c) => (
                  <tr key={c.formulaId}>
                    <td>{c.formulaNome}</td>
                    <td className="financeiro-th-numero">
                      {c.maximoKg === null ? "sem limite" : kg(c.maximoKg)}
                    </td>
                    <td className="financeiro-td-mudo">{c.gargaloNome ?? "—"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{kg(c.gargaloSaldo)}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {c.gargaloFracao ? `${(c.gargaloFracao * 100).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "ajustes" && (
        <>
          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensMp}
              valor={mpId ? Number(mpId) : null}
              placeholder="Buscar matéria-prima"
              onEscolher={(id) => setMpId(id ? String(id) : "")}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "inventario" | "ajuste")}
            >
              <option value="inventario">Inventário (contei)</option>
              <option value="ajuste">Ajuste (entra/sai)</option>
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={tipo === "inventario" ? "Quanto tem (kg)" : "± kg"}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Motivo (opcional)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancar()}>
              <IconPlus size={14} /> Registrar
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>MATÉRIA-PRIMA</th>
                  <th className="financeiro-th-numero">QUANTIDADE</th>
                  <th>MOTIVO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!ajustes.length && <tr><td colSpan={5}>Nenhum ajuste registrado.</td></tr>}
                {ajustes.map((a) => (
                  <tr key={a.id}>
                    <td className="financeiro-td-mudo">{a.data.split("-").reverse().join("/")}</td>
                    <td>{a.materiaPrimaNome}</td>
                    <td className="financeiro-th-numero">
                      {a.quantidadeKg > 0 ? "+" : ""}{kg(a.quantidadeKg)}
                    </td>
                    <td className="financeiro-td-mudo">{a.motivo ?? "—"}</td>
                    <td>
                      <button type="button" className="btn-excluir" onClick={() => void apagar(a)} title="Excluir">
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {aba === "contas" && (
        <>
          <p className="financeiro-td-mudo">
            Água não se compra em quilo — vem uma conta no fim do mês. Lançando o valor aqui, o
            sistema divide pelos quilos de água que os lotes daquele mês usaram e acerta o preço do
            quilo na fórmula: se a produção pedia R$ 1.000 de água e a conta veio R$ 900, o quilo
            baixa; se veio mais, sobe. E rateia sozinho entre os lotes, porque quem levou mais água
            multiplica mais.
          </p>

          <div className="financeiro-filtros">
            <BuscaSelecao
              itens={itensMp}
              valor={contaMpId ? Number(contaMpId) : null}
              placeholder="Insumo (ex: Água)"
              onEscolher={(id) => setContaMpId(id ? String(id) : "")}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="month"
              value={contaMes}
              onChange={(e) => setContaMes(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Valor da conta"
              value={contaValor}
              onChange={(e) => setContaValor(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="% pra tinta"
              value={contaPct}
              onChange={(e) => setContaPct(e.target.value)}
              title="Quanto da conta virou tinta — o resto é banheiro, limpeza, lavagem de tanque"
            />
            <input
              className="clonar-input"
              placeholder="Observação (opcional)"
              value={contaObs}
              onChange={(e) => setContaObs(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancarConta()}>
              <IconPlus size={14} /> Lançar conta
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>MÊS</th>
                  <th>INSUMO</th>
                  <th className="financeiro-th-numero">CONTA</th>
                  <th className="financeiro-th-numero">% PRA TINTA</th>
                  <th className="financeiro-th-numero">USADO NO MÊS</th>
                  <th className="financeiro-th-numero">CUSTO POR KG</th>
                  <th>SITUAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!contas.length && (
                  <tr>
                    <td colSpan={8}>Nenhuma conta lançada.</td>
                  </tr>
                )}
                {contas.map((c) => {
                  // diferença de centésimo de centavo é arredondamento, não desatualização
                  const desatualizada =
                    c.kgConsumidos > 0 && Math.abs(c.custoPorKg - c.custoAplicado) > 0.0001;
                  return (
                    <tr key={c.id}>
                      <td className="financeiro-td-mudo">
                        {c.competencia.split("-").reverse().join("/")}
                      </td>
                      <td>{c.materiaPrimaNome}</td>
                      <td className="financeiro-th-numero">{formatCurrency(c.valor)}</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.percentualProducao}%
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {c.kgConsumidos > 0 ? kg(c.kgConsumidos) : "sem lote"}
                      </td>
                      <td className="financeiro-th-numero">
                        {c.kgConsumidos > 0 ? `R$ ${c.custoPorKg.toFixed(4)}` : "—"}
                      </td>
                      <td className={desatualizada ? undefined : "financeiro-td-mudo"}>
                        {c.kgConsumidos <= 0
                          ? "sem lote no mês"
                          : desatualizada
                            ? `fórmula está com R$ ${c.custoAplicado.toFixed(4)} — relance pra acertar`
                            : "aplicado na fórmula"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-excluir"
                          onClick={() => void apagarConta(c)}
                          title="Excluir"
                        >
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
