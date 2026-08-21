import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaProdutos,
  criarFabricaProduto,
  atualizarFabricaProduto,
  excluirFabricaProduto,
} from "../api/fabricaProdutos";
import { fetchFormulas, fetchFormula } from "../api/fabricacao";
import type { FabricaProduto } from "../types/fabricaProdutos";
import type { FormulaResumo, FormulaEmbalagem } from "../types/fabricacao";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// rendimento vem como fracao (+0.12 = rendeu 12% a mais que a receita previa)
function formatRendimento(v: number, lotes: number): string {
  if (!lotes) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${(v * 100).toFixed(1)}%`;
}

const VAZIO = { sku: "", nome: "", formulaId: "", embalagemId: "", precoVenda: "", ativo: true };
type Rascunho = typeof VAZIO;

export function FabricaProdutos() {
  const [produtos, setProdutos] = useState<FabricaProduto[] | null>(null);
  const [formulas, setFormulas] = useState<FormulaResumo[]>([]);
  const [embalagens, setEmbalagens] = useState<FormulaEmbalagem[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho>(VAZIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [ps, fs] = await Promise.all([fetchFabricaProdutos(), fetchFormulas()]);
      setProdutos(ps);
      setFormulas(fs);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setProdutos([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // As embalagens dependem da fórmula escolhida — o custo do produto sai do par
  // (fórmula, embalagem), então o segundo select só faz sentido depois do primeiro.
  useEffect(() => {
    const id = Number(rascunho.formulaId);
    if (!id) {
      setEmbalagens([]);
      return;
    }
    let cancelado = false;
    void fetchFormula(id)
      .then((f) => {
        if (!cancelado) setEmbalagens(f.embalagens);
      })
      .catch(() => {
        if (!cancelado) setEmbalagens([]);
      });
    return () => {
      cancelado = true;
    };
  }, [rascunho.formulaId]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t || !produtos) return produtos ?? [];
    return produtos.filter((p) => p.sku.toLowerCase().includes(t) || p.nome.toLowerCase().includes(t));
  }, [produtos, busca]);

  const totais = useMemo(() => {
    const lista = filtrados.filter((p) => p.ativo);
    if (!lista.length) return null;
    const custo = lista.reduce((s, p) => s + p.custo, 0);
    const preco = lista.reduce((s, p) => s + p.precoVenda, 0);
    return {
      itens: lista.length,
      margemMedia: preco > 0 ? (preco - custo) / preco : 0,
    };
  }, [filtrados]);

  function editar(p: FabricaProduto) {
    setEditandoId(p.id);
    setRascunho({
      sku: p.sku,
      nome: p.nome,
      formulaId: p.formulaId ? String(p.formulaId) : "",
      embalagemId: p.embalagemId ? String(p.embalagemId) : "",
      precoVenda: String(p.precoVenda),
      ativo: p.ativo,
    });
    setErro(null);
  }

  function cancelar() {
    setEditandoId(null);
    setRascunho(VAZIO);
    setErro(null);
  }

  async function salvar() {
    const entrada = {
      sku: rascunho.sku.trim(),
      nome: rascunho.nome.trim(),
      formulaId: rascunho.formulaId ? Number(rascunho.formulaId) : null,
      embalagemId: rascunho.embalagemId ? Number(rascunho.embalagemId) : null,
      precoVenda: Number(rascunho.precoVenda.replace(",", ".")) || 0,
      ativo: rascunho.ativo,
    };
    if (!entrada.sku || !entrada.nome) {
      setErro("SKU e nome são obrigatórios.");
      return;
    }
    setSalvando(true);
    try {
      if (editandoId) await atualizarFabricaProduto(editandoId, entrada);
      else await criarFabricaProduto(entrada);
      cancelar();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: FabricaProduto) {
    try {
      await excluirFabricaProduto(p.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Produtos</h1>
          <p className="financeiro-td-mudo">
            Produto acabado que a fábrica vende. O custo vem da fórmula ligada e acompanha sozinho
            qualquer mudança de preço de matéria-prima — aqui você só define o preço de venda.
          </p>
        </div>
        {totais && (
          <div>
            <div className="financeiro-stat-label">MARGEM MÉDIA ({totais.itens} ativos)</div>
            <div className="financeiro-stat-valor">{formatPercent(totais.margemMedia)}</div>
          </div>
        )}
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}

      <div className="financeiro-filtros">
        <input
          className="clonar-input"
          placeholder="Nome ou SKU do produto"
          value={rascunho.nome}
          onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="SKU"
          value={rascunho.sku}
          onChange={(e) => setRascunho((r) => ({ ...r, sku: e.target.value }))}
        />
        <select
          className="clonar-input"
          value={rascunho.formulaId}
          onChange={(e) => setRascunho((r) => ({ ...r, formulaId: e.target.value, embalagemId: "" }))}
        >
          <option value="">Fórmula (opcional)</option>
          {formulas.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
        <select
          className="clonar-input"
          value={rascunho.embalagemId}
          disabled={!embalagens.length}
          onChange={(e) => setRascunho((r) => ({ ...r, embalagemId: e.target.value }))}
        >
          <option value="">{embalagens.length ? "Embalagem" : "Escolha a fórmula"}</option>
          {embalagens.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome} — {e.pesoKg}kg
            </option>
          ))}
        </select>
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Preço venda (R$)"
          value={rascunho.precoVenda}
          onChange={(e) => setRascunho((r) => ({ ...r, precoVenda: e.target.value }))}
        />
        <button type="button" className="btn-responder" onClick={() => void salvar()} disabled={salvando}>
          <IconPlus size={14} /> {editandoId ? "Salvar" : "Adicionar"}
        </button>
        {editandoId && (
          <button type="button" className="btn-excluir" onClick={cancelar}>
            Cancelar
          </button>
        )}
      </div>

      <div className="financeiro-busca">
        <input
          className="clonar-input"
          placeholder="Buscar por nome ou SKU"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>SKU</th>
              <th>PRODUTO</th>
              <th>FÓRMULA</th>
              <th>EMBALAGEM</th>
              <th className="financeiro-th-numero">CUSTO TEÓRICO</th>
              <th className="financeiro-th-numero">RENDIMENTO</th>
              <th className="financeiro-th-numero">CUSTO REAL</th>
              <th className="financeiro-th-numero">PREÇO VENDA</th>
              <th className="financeiro-th-numero">MARGEM CONTRIB.</th>
              <th className="financeiro-th-numero">MARKUP</th>
              <th className="financeiro-th-numero">% LUCRO</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {produtos === null && (
              <tr>
                <td colSpan={12}>Carregando…</td>
              </tr>
            )}
            {produtos !== null && !filtrados.length && (
              <tr>
                <td colSpan={12}>Nenhum produto cadastrado ainda.</td>
              </tr>
            )}
            {filtrados.map((p) => (
              <tr key={p.id} style={p.ativo ? undefined : { opacity: 0.5 }}>
                <td>{p.sku}</td>
                <td>
                  <button type="button" className="fabricacao-envase-nome-editavel" onClick={() => editar(p)}>
                    {p.nome}
                  </button>
                </td>
                <td className="financeiro-td-mudo">{p.formulaNome ?? "—"}</td>
                <td className="financeiro-td-mudo">
                  {p.embalagemNome ? `${p.embalagemNome} (${p.pesoKg}kg)` : "—"}
                </td>
                <td className="financeiro-th-numero financeiro-td-mudo">{formatCurrency(p.custoTeorico)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo" title={p.lotes ? `${p.lotes} lote(s) lançado(s)` : "sem lote lançado"}>
                  {formatRendimento(p.rendimento, p.lotes)}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(p.custo)}</td>
                <td className="financeiro-th-numero">{formatCurrency(p.precoVenda)}</td>
                <td className="financeiro-th-numero">{formatCurrency(p.margemContribuicao)}</td>
                <td className="financeiro-th-numero">{formatPercent(p.markup)}</td>
                <td className="financeiro-th-numero">{formatPercent(p.percentualLucro)}</td>
                <td>
                  <BotaoExcluir onConfirmar={() => void excluir(p)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
