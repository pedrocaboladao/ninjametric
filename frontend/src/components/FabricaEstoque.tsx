import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchEstoque,
  fetchCapacidade,
  fetchAjustes,
  definirEstoqueMinimo,
  definirControlaEstoque,
  registrarAjuste,
  excluirAjuste,
} from "../api/fabricaEstoque";
import type {
  EstoqueMateriaPrima,
  AjusteEstoque,
  CapacidadeFormula,
} from "../types/fabricaEstoque";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";
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
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<"estoque" | "capacidade" | "ajustes">("estoque");

  const [mpId, setMpId] = useState("");
  const [tipo, setTipo] = useState<"inventario" | "ajuste">("inventario");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [e, c, a] = await Promise.all([fetchEstoque(), fetchCapacidade(), fetchAjustes()]);
      setEstoque(e);
      setCapacidade(c);
      setAjustes(a);
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

  async function apagar(a: AjusteEstoque) {
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
        {(["estoque", "capacidade", "ajustes"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => setAba(a)}
          >
            {a === "estoque" ? "Saldo" : a === "capacidade" ? "Dá pra fabricar" : "Ajustes"}
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
                      <BotaoExcluir onConfirmar={() => void apagar(a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
