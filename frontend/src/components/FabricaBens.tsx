import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBens, criarBem, atualizarBem, excluirBem } from "../api/fabricaBens";
import type { Bem, BemEntrada } from "../types/fabricaBens";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";
import { Modal } from "./Modal";

// aceita "110.000" e "110000,50" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
}

function data(d: string): string {
  return d.split("-").reverse().join("/");
}

function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// O que a contabilidade costuma usar. Editável porque quem manda é o contador.
const VIDA_UTIL = [
  { anos: 5, rotulo: "5 anos — veículo" },
  { anos: 10, rotulo: "10 anos — máquina" },
  { anos: 25, rotulo: "25 anos — imóvel" },
];

const VAZIO = {
  nome: "",
  tipo: "movel" as "movel" | "imovel",
  valor: "",
  dataCompra: "",
  vidaUtilAnos: "10",
  observacao: "",
  ativo: true,
};

export function FabricaBens() {
  const [bens, setBens] = useState<Bem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...VAZIO });
  const [mostrarForm, setMostrarForm] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setBens(await fetchBens());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setBens([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totais = useMemo(() => {
    const lista = (bens ?? []).filter((b) => b.ativo);
    return {
      patrimonio: lista.reduce((s, b) => s + b.valor, 0),
      atual: lista.reduce((s, b) => s + b.valorAtual, 0),
      // só o que ainda deprecia: máquina no fim da vida útil não custa mais
      // nada no papel, mesmo continuando a rodar
      mensal: lista
        .filter((b) => !b.totalmenteDepreciado)
        .reduce((s, b) => s + b.depreciacaoMensal, 0),
    };
  }, [bens]);

  function novo() {
    setEditandoId(null);
    setForm({ ...VAZIO, dataCompra: hoje() });
    setMostrarForm(true);
    setErro(null);
  }

  function editar(b: Bem) {
    setEditandoId(b.id);
    setForm({
      nome: b.nome,
      tipo: b.tipo,
      valor: String(b.valor),
      dataCompra: b.dataCompra,
      vidaUtilAnos: String(b.vidaUtilAnos),
      observacao: b.observacao ?? "",
      ativo: b.ativo,
    });
    setMostrarForm(true);
    setErro(null);
  }

  async function salvar() {
    if (!form.nome.trim()) return setErro("Informe o nome do bem.");
    if (num(form.valor) <= 0) return setErro("Informe o valor de compra.");
    if (!form.dataCompra) return setErro("Informe a data da compra.");

    const entrada: BemEntrada = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      valor: num(form.valor),
      dataCompra: form.dataCompra,
      vidaUtilAnos: Number(form.vidaUtilAnos) || 10,
      observacao: form.observacao.trim() || null,
      ativo: form.ativo,
    };
    setSalvando(true);
    try {
      if (editandoId) await atualizarBem(editandoId, entrada);
      else await criarBem(entrada);
      setMostrarForm(false);
      setEditandoId(null);
      setForm({ ...VAZIO });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(b: Bem) {
    try {
      await excluirBem(b.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  return (
    <div>
      <p className="financeiro-td-mudo">
        O que a empresa comprou e continua tendo. Comprar não é gastar: saiu dinheiro e entrou um
        bem que vale o mesmo tanto. O que empobrece é o desgaste, e é ele que o DRE cobra, um pouco
        por mês. A parcela do financiamento continua no contas a pagar — você precisa saber que tem
        cheque pra pagar —, mas não abate o lucro duas vezes.
      </p>

      <div className="financeiro-filtros">
        <div>
          <div className="financeiro-stat-label">PATRIMÔNIO</div>
          <div className="financeiro-stat-valor">{formatCurrency(totais.patrimonio)}</div>
        </div>
        <div>
          <div className="financeiro-stat-label">VALE HOJE</div>
          <div className="financeiro-stat-valor">{formatCurrency(totais.atual)}</div>
        </div>
        <div>
          <div className="financeiro-stat-label">DESGASTE POR MÊS</div>
          <div className="financeiro-stat-valor">{formatCurrency(totais.mensal)}</div>
        </div>
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}

      <div className="financeiro-filtros">
        <button type="button" className="btn-responder" onClick={novo}>
          <IconPlus size={14} /> Novo bem
        </button>
      </div>

      {mostrarForm && (
        <Modal
          titulo={editandoId ? "Editar bem" : "Novo bem"}
          subtitulo="O valor é o de compra, cheio — não desconte o que já foi pago"
          onFechar={() => {
            setMostrarForm(false);
            setEditandoId(null);
          }}
          rodape={
            <>
              <button
                type="button"
                className="btn-responder"
                onClick={() => void salvar()}
                disabled={salvando}
              >
                {editandoId ? "Salvar" : "Cadastrar"}
              </button>
              <button
                type="button"
                className="btn-excluir"
                onClick={() => {
                  setMostrarForm(false);
                  setEditandoId(null);
                }}
              >
                Cancelar
              </button>
            </>
          }
        >
          <div className="financeiro-filtros contas-form">
            <input
              className="clonar-input"
              placeholder="Nome (ex: Caminhão Volvo, Dispersor 500L)"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.tipo}
              onChange={(e) =>
                setForm((f) => ({ ...f, tipo: e.target.value as "movel" | "imovel" }))
              }
            >
              <option value="movel">Móvel</option>
              <option value="imovel">Imóvel</option>
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Valor de compra"
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
              title="O valor cheio, sem descontar o que já foi pago"
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              type="date"
              value={form.dataCompra}
              onChange={(e) => setForm((f) => ({ ...f, dataCompra: e.target.value }))}
            />
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.vidaUtilAnos}
              onChange={(e) => setForm((f) => ({ ...f, vidaUtilAnos: e.target.value }))}
            >
              {VIDA_UTIL.map((v) => (
                <option key={v.anos} value={v.anos}>
                  {v.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div className="financeiro-filtros contas-form">
            <label className="financeiro-td-mudo">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              />{" "}
              ainda na empresa — desmarque o que foi vendido ou baixado
            </label>
            <input
              className="clonar-input"
              placeholder="Observação"
              value={form.observacao}
              onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
            />
          </div>

        </Modal>
      )}

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>BEM</th>
              <th>COMPRA</th>
              <th>VIDA ÚTIL</th>
              <th className="financeiro-th-numero">VALOR</th>
              <th className="financeiro-th-numero">DESGASTE/MÊS</th>
              <th className="financeiro-th-numero">VALE HOJE</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bens === null && (
              <tr>
                <td colSpan={7}>Carregando…</td>
              </tr>
            )}
            {bens !== null && !bens.length && (
              <tr>
                <td colSpan={7}>Nenhum bem cadastrado.</td>
              </tr>
            )}
            {(bens ?? []).map((b) => (
              <tr key={b.id} style={b.ativo ? undefined : { opacity: 0.5 }}>
                <td>
                  <button
                    type="button"
                    className="fabricacao-envase-nome-editavel"
                    onClick={() => editar(b)}
                  >
                    {b.nome}
                  </button>
                  {b.tipo === "imovel" && <span className="financeiro-td-mudo"> · imóvel</span>}
                </td>
                <td className="financeiro-td-mudo">{data(b.dataCompra)}</td>
                <td className="financeiro-td-mudo">
                  {b.vidaUtilAnos} anos · {b.mesesDepreciados}/{b.mesesTotais} meses
                  {b.totalmenteDepreciado && " · já depreciado"}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(b.valor)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {b.totalmenteDepreciado ? "—" : formatCurrency(b.depreciacaoMensal)}
                </td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {formatCurrency(b.valorAtual)}
                </td>
                <td>
                  <BotaoExcluir onConfirmar={() => void apagar(b)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
