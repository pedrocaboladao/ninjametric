import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaEmbalagens,
  criarFabricaEmbalagem,
  atualizarFabricaEmbalagem,
  excluirFabricaEmbalagem,
  fetchVinculosEmbalagem,
  ligarVinculoEmbalagem,
  vincularPorPeso,
} from "../api/fabricaEmbalagens";
import type { FabricaEmbalagem, FabricaEmbalagemEntrada, VinculoEmbalagem } from "../types/fabricaEmbalagens";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash } from "./icons";

const VAZIO: FabricaEmbalagemEntrada = {
  nome: "", pesoKg: 0, custoUnitario: 0, estoque: 0, estoqueMinimo: 0, ativo: true,
};

// aceita "8,47" e "8.47" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(",", ".")) || 0;
}

export function FabricaEmbalagens() {
  const [embalagens, setEmbalagens] = useState<FabricaEmbalagem[] | null>(null);
  const [vinculos, setVinculos] = useState<VinculoEmbalagem[]>([]);
  const [rascunho, setRascunho] = useState({ ...VAZIO, pesoKg: "", custoUnitario: "", estoque: "", estoqueMinimo: "" });
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarVinculos, setMostrarVinculos] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [es, vs] = await Promise.all([fetchFabricaEmbalagens(), fetchVinculosEmbalagem()]);
      setEmbalagens(es);
      setVinculos(vs);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setEmbalagens([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertas = useMemo(() => (embalagens ?? []).filter((e) => e.abaixoDoMinimo), [embalagens]);
  const semVinculo = useMemo(() => vinculos.filter((v) => v.fabricaEmbalagemId === null).length, [vinculos]);

  function editar(e: FabricaEmbalagem) {
    setEditandoId(e.id);
    setRascunho({
      nome: e.nome, ativo: e.ativo,
      pesoKg: String(e.pesoKg), custoUnitario: String(e.custoUnitario),
      estoque: String(e.estoque), estoqueMinimo: String(e.estoqueMinimo),
    } as never);
    setErro(null);
  }

  function cancelar() {
    setEditandoId(null);
    setRascunho({ ...VAZIO, pesoKg: "", custoUnitario: "", estoque: "", estoqueMinimo: "" } as never);
    setErro(null);
  }

  async function salvar() {
    const r = rascunho as unknown as Record<string, string> & { nome: string; ativo: boolean };
    const entrada: FabricaEmbalagemEntrada = {
      nome: r.nome.trim(),
      pesoKg: num(r.pesoKg),
      custoUnitario: num(r.custoUnitario),
      estoque: num(r.estoque),
      estoqueMinimo: num(r.estoqueMinimo),
      ativo: r.ativo !== false,
    };
    if (!entrada.nome) return setErro("Informe o nome da embalagem.");
    if (entrada.pesoKg <= 0) return setErro("Peso deve ser maior que zero.");
    setSalvando(true);
    try {
      if (editandoId) await atualizarFabricaEmbalagem(editandoId, entrada);
      else await criarFabricaEmbalagem(entrada);
      cancelar();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(e: FabricaEmbalagem) {
    const extra = e.formulasLigadas
      ? `\n\n${e.formulasLigadas} fórmula(s) estão ligadas a ela e voltarão a usar o custo digitado nelas.`
      : "";
    if (!confirm(`Excluir a embalagem "${e.nome}"?${extra}`)) return;
    try {
      await excluirFabricaEmbalagem(e.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  async function autoVincular() {
    try {
      const r = await vincularPorPeso();
      setAviso(
        `${r.ligadas} vínculo(s) feitos pelo peso.` +
          (r.ambiguas ? ` ${r.ambiguas} ficaram sem vínculo — peso repetido ou sem cadastro, escolha à mão.` : "")
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao vincular.");
    }
  }

  async function trocarVinculo(v: VinculoEmbalagem, valor: string) {
    try {
      await ligarVinculoEmbalagem(v.id, valor ? Number(valor) : null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ligar.");
    }
  }

  const r = rascunho as unknown as Record<string, string>;

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Embalagens</h1>
          <p className="financeiro-td-mudo">
            O balde, a bombona, o galão — com custo e estoque num lugar só. Defina o estoque
            mínimo para receber alerta de compra antes de faltar.
          </p>
        </div>
        {alertas.length > 0 && (
          <div>
            <div className="financeiro-stat-label">ABAIXO DO MÍNIMO</div>
            <div className="financeiro-stat-valor">{alertas.length}</div>
          </div>
        )}
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      <div className="financeiro-filtros">
        <input className="clonar-input" placeholder="Nome (ex: Balde 18kg)" value={r.nome ?? ""}
          onChange={(e) => setRascunho((v) => ({ ...v, nome: e.target.value }))} />
        <input className="clonar-input fabricacao-input-pequeno" placeholder="Peso (kg)" value={r.pesoKg ?? ""}
          onChange={(e) => setRascunho((v) => ({ ...v, pesoKg: e.target.value } as never))} />
        <input className="clonar-input fabricacao-input-pequeno" placeholder="Custo un. (R$)" value={r.custoUnitario ?? ""}
          onChange={(e) => setRascunho((v) => ({ ...v, custoUnitario: e.target.value } as never))} />
        <input className="clonar-input fabricacao-input-pequeno" placeholder="Estoque" value={r.estoque ?? ""}
          onChange={(e) => setRascunho((v) => ({ ...v, estoque: e.target.value } as never))} />
        <input className="clonar-input fabricacao-input-pequeno" placeholder="Mínimo" value={r.estoqueMinimo ?? ""}
          onChange={(e) => setRascunho((v) => ({ ...v, estoqueMinimo: e.target.value } as never))} />
        <button type="button" className="btn-responder" onClick={() => void salvar()} disabled={salvando}>
          <IconPlus size={14} /> {editandoId ? "Salvar" : "Adicionar"}
        </button>
        {editandoId && (
          <button type="button" className="btn-excluir" onClick={cancelar}>Cancelar</button>
        )}
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>EMBALAGEM</th>
              <th className="financeiro-th-numero">PESO</th>
              <th className="financeiro-th-numero">CUSTO UN.</th>
              <th className="financeiro-th-numero">ESTOQUE</th>
              <th className="financeiro-th-numero">MÍNIMO</th>
              <th>SITUAÇÃO</th>
              <th className="financeiro-th-numero">FÓRMULAS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {embalagens === null && <tr><td colSpan={8}>Carregando…</td></tr>}
            {embalagens !== null && !embalagens.length && (
              <tr><td colSpan={8}>Nenhuma embalagem cadastrada ainda.</td></tr>
            )}
            {(embalagens ?? []).map((e) => (
              <tr key={e.id} style={e.ativo ? undefined : { opacity: 0.5 }}>
                <td>
                  <button type="button" className="fabricacao-envase-nome-editavel" onClick={() => editar(e)}>
                    {e.nome}
                  </button>
                </td>
                <td className="financeiro-th-numero financeiro-td-mudo">{e.pesoKg}kg</td>
                <td className="financeiro-th-numero">{formatCurrency(e.custoUnitario)}</td>
                <td className="financeiro-th-numero">{e.estoque}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">{e.estoqueMinimo || "—"}</td>
                <td className={e.abaixoDoMinimo ? undefined : "financeiro-td-mudo"}>
                  {e.estoqueMinimo <= 0 ? "sem controle" : e.abaixoDoMinimo ? "COMPRAR" : "ok"}
                </td>
                <td className="financeiro-th-numero financeiro-td-mudo">{e.formulasLigadas || "—"}</td>
                <td>
                  <button type="button" className="btn-excluir" onClick={() => void excluir(e)} title="Excluir">
                    <IconTrash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="financeiro-topo">
        <div>
          <h2>Ligação com as fórmulas</h2>
          <p className="financeiro-td-mudo">
            Cada fórmula tem as embalagens digitadas nela. Ligar ao cadastro é o que permite
            saber quantos baldes cada produção consome. {semVinculo > 0 && `${semVinculo} ainda sem ligação.`}
          </p>
        </div>
        <div>
          <button type="button" className="btn-responder" onClick={() => void autoVincular()}>
            Ligar pelo peso
          </button>{" "}
          <button type="button" className="btn-excluir" onClick={() => setMostrarVinculos((v) => !v)}>
            {mostrarVinculos ? "Ocultar" : `Ver ${vinculos.length}`}
          </button>
        </div>
      </div>

      {mostrarVinculos && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>FÓRMULA</th>
                <th>EMBALAGEM NA FÓRMULA</th>
                <th className="financeiro-th-numero">PESO</th>
                <th className="financeiro-th-numero">CUSTO DIGITADO</th>
                <th>LIGADA A</th>
              </tr>
            </thead>
            <tbody>
              {vinculos.map((v) => (
                <tr key={v.id}>
                  <td className="financeiro-td-mudo">{v.formulaNome}</td>
                  <td>{v.nome}</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{v.pesoKg}kg</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{formatCurrency(v.custoDigitado)}</td>
                  <td>
                    <select
                      className="clonar-input fabricacao-input-pequeno"
                      value={v.fabricaEmbalagemId ?? ""}
                      onChange={(e) => void trocarVinculo(v, e.target.value)}
                    >
                      <option value="">— sem ligação —</option>
                      {(embalagens ?? []).map((e) => (
                        <option key={e.id} value={e.id}>{e.nome} ({e.pesoKg}kg)</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
