import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaProdutos,
  criarFabricaProduto,
  atualizarFabricaProduto,
  excluirFabricaProduto,
  importarCatalogo,
} from "../api/fabricaProdutos";
import { fetchFormulas, fetchFormula } from "../api/fabricacao";
import type { FabricaProduto, OrigemProduto } from "../types/fabricaProdutos";
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

const VAZIO = {
  sku: "",
  nome: "",
  origem: "FABRICA" as OrigemProduto,
  ean: "",
  familia: "",
  custoCompra: "",
  formulaId: "",
  embalagemId: "",
  precoVenda: "",
  ativo: true,
};
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
  const [filtroOrigem, setFiltroOrigem] = useState<"" | OrigemProduto>("");
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

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
    let base = produtos ?? [];
    if (filtroOrigem) base = base.filter((p) => p.origem === filtroOrigem);
    if (!t) return base;
    // codigo de barras entra na busca: quem esta com o produto na mao bipa
    return base.filter(
      (p) =>
        p.sku.toLowerCase().includes(t) ||
        p.nome.toLowerCase().includes(t) ||
        (p.ean ?? "").includes(t) ||
        (p.familia ?? "").toLowerCase().includes(t)
    );
  }, [produtos, busca, filtroOrigem]);

  const porOrigem = useMemo(() => {
    const m = { FABRICA: 0, DISTRIBUIDORA: 0 };
    for (const p of produtos ?? []) m[p.origem] += 1;
    return m;
  }, [produtos]);

  // Traz os 5 mil SKUs do catalogo do Mercado Livre como produto de revenda.
  // SKU que ja existe aqui nao e tocado: o produto de fabrica com o mesmo
  // codigo tem custo vindo da formula, e sobrescrever apagaria isso.
  async function importar() {
    setImportando(true);
    try {
      const r = await importarCatalogo();
      setErro(null);
      setAviso(
        `${r.criados} produtos importados em ${r.familias} famílias. ` +
          `${r.jaExistiam} já existiam e não foram tocados. ` +
          `Falta preencher o custo de compra de cada um.`
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar o catálogo.");
    } finally {
      setImportando(false);
    }
  }

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
      origem: p.origem,
      ean: p.ean ?? "",
      familia: p.familia ?? "",
      custoCompra: p.custoCompra !== null ? String(p.custoCompra) : "",
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
    const revenda = rascunho.origem === "DISTRIBUIDORA";
    const entrada = {
      sku: rascunho.sku.trim(),
      nome: rascunho.nome.trim(),
      origem: rascunho.origem,
      ean: rascunho.ean.trim() || null,
      familia: rascunho.familia.trim() || null,
      // custo digitado só na revenda: no produto de fábrica ele vem da fórmula
      custoCompra: revenda ? Number(rascunho.custoCompra.replace(",", ".")) || 0 : null,
      formulaId: revenda || !rascunho.formulaId ? null : Number(rascunho.formulaId),
      embalagemId: revenda || !rascunho.embalagemId ? null : Number(rascunho.embalagemId),
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
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

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
          className="clonar-input fabricacao-input-pequeno"
          value={rascunho.origem}
          onChange={(e) =>
            setRascunho((r) => ({ ...r, origem: e.target.value as OrigemProduto }))
          }
          title="Fábrica: o custo vem da fórmula. Distribuidora: comprado pronto, custo digitado."
        >
          <option value="FABRICA">Fábrica</option>
          <option value="DISTRIBUIDORA">Distribuidora</option>
        </select>
        {rascunho.origem === "FABRICA" ? (
          <>
            <select
              className="clonar-input"
              value={rascunho.formulaId}
              onChange={(e) =>
                setRascunho((r) => ({ ...r, formulaId: e.target.value, embalagemId: "" }))
              }
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
          </>
        ) : (
          <>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Custo de compra (R$)"
              value={rascunho.custoCompra}
              onChange={(e) => setRascunho((r) => ({ ...r, custoCompra: e.target.value }))}
              title="O que você pagou ao fornecedor. É este número que dá a sua margem."
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Código de barras"
              value={rascunho.ean}
              onChange={(e) => setRascunho((r) => ({ ...r, ean: e.target.value }))}
            />
          </>
        )}
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

      <div className="origem-abas">
        {(["", "FABRICA", "DISTRIBUIDORA"] as const).map((o) => (
          <button
            key={o || "todos"}
            type="button"
            className={filtroOrigem === o ? "btn-responder" : "btn-excluir"}
            onClick={() => setFiltroOrigem(o)}
          >
            {o === "" ? "Todos" : o === "FABRICA" ? "Produto fábrica" : "Produto distribuição"}
            {o !== "" && ` (${porOrigem[o]})`}
          </button>
        ))}
      </div>

      <div className="financeiro-filtros">
        <input
          className="clonar-input"
          placeholder="Buscar por nome, SKU, código de barras ou família"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button
          type="button"
          className="btn-excluir"
          onClick={() => void importar()}
          disabled={importando}
          title="Traz os produtos de revenda do catálogo do Mercado Livre. A planilha não é alterada, e SKU que já existe aqui não é tocado."
        >
          {importando ? "Importando…" : "Importar catálogo"}
        </button>
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
