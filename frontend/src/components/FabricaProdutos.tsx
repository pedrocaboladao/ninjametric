import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaProdutos,
  criarFabricaProduto,
  atualizarFabricaProduto,
  excluirFabricaProduto,
  importarCatalogo,
  baixarCatalogo,
  conferirPrecos,
  aplicarPrecos,
} from "../api/fabricaProdutos";
import { fetchFormulas, fetchFormula } from "../api/fabricacao";
import type {
  FabricaProduto,
  OrigemProduto,
  ConferenciaCatalogo,
  TipoProduto,
} from "../types/fabricaProdutos";
import { Modal } from "./Modal";
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
  tipo: "REVENDA" as TipoProduto,
  ean: "",
  familia: "",
  custoCompra: "",
  formulaId: "",
  embalagemId: "",
  precoVenda: "",
  ativo: true,
};
type Rascunho = typeof VAZIO;

// minusculo e sem acento dos dois lados: quem digita "cancao" tem que achar
// "Canção", e quem digita "GALAO" tem que achar "GALÃO"
function semAcento(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

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
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaCatalogo | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [aAplicar, setAAplicar] = useState<Set<number>>(new Set());

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

  // Cada palavra procurada separada, em qualquer ordem e sem acento.
  //
  // Antes era um pedaco so, e casava em qualquer um dos campos: "resiflex 18"
  // nao achava nada, porque nenhum campo sozinho continha as duas palavras
  // nessa ordem. Num catalogo de 5.266 SKUs, procurar exige combinar — cor,
  // tamanho, familia — e o operador nao lembra a ordem em que o SKU foi escrito.
  //
  // O codigo de barras entra junto: quem esta com o produto na mao bipa.
  const filtrados = useMemo(() => {
    let base = produtos ?? [];
    if (filtroOrigem) base = base.filter((p) => p.origem === filtroOrigem);
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return base;
    return base.filter((p) => {
      const alvo = semAcento(
        [
          p.sku,
          p.nome,
          p.ean ?? "",
          p.familia ?? "",
          p.tipo,
          p.origem,
          p.formulaNome ?? "",
          p.embalagemNome ?? "",
          String(p.precoVenda),
          p.precoVenda.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
        ].join(" ")
      );
      return termos.every((t) => alvo.includes(t));
    });
  }, [produtos, busca, filtroOrigem]);

  // O total do que a busca achou.
  //
  // A margem aqui e media simples, e sai dito com todas as letras: sem
  // quantidade vendida nao da pra ponderar, e uma media simples de catalogo nao
  // e a margem do negocio. Chamar de "margem" sem qualificar deixaria comparar
  // com os 18,9% do DRE, que sao outra conta.
  const achado = useMemo(() => {
    const ativos = filtrados.filter((p) => p.ativo);
    const semCusto = filtrados.filter((p) => p.semCusto.length).length;
    const comMargem = ativos.filter((p) => p.precoVenda > 0 && !p.semCusto.length);
    const margem =
      comMargem.length
        ? comMargem.reduce((t, p) => t + p.percentualLucro, 0) / comMargem.length
        : 0;
    return { n: filtrados.length, ativos: ativos.length, semCusto, margem, comMargem: comMargem.length };
  }, [filtrados]);

  // Produto com custo zero nao se denuncia: ele aparece com 100% de margem, o
  // que passa por otimo em vez de cadastro pela metade. Seis EMBORRACHADO
  // CERAMICA ficaram meses assim.
  const semCusto = useMemo(() => filtrados.filter((p) => p.semCusto.length > 0), [filtrados]);

  const porOrigem = useMemo(() => {
    const m = { FABRICA: 0, DISTRIBUIDORA: 0 };
    for (const p of produtos ?? []) m[p.origem] += 1;
    return m;
  }, [produtos]);

  // Traz os 5 mil SKUs do catalogo do Mercado Livre como produto de revenda.
  // SKU que ja existe aqui nao e tocado: o produto de fabrica com o mesmo
  // codigo tem custo vindo da formula, e sobrescrever apagaria isso.
  // A tela do Pedro le a planilha toda vez, entao muda sozinha. Aqui os
  // produtos sao copia: ficariam congelados no preco do dia da importacao. O
  // botao traz a diferenca pra decidir — preco de venda mudando sem ninguem
  // ver so aparece tres meses depois, no DRE.
  async function conferir() {
    setConferindo(true);
    try {
      const c = await conferirPrecos();
      setConferencia(c);
      setAAplicar(new Set(c.diferencas.map((d) => d.id)));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao conferir os preços.");
    } finally {
      setConferindo(false);
    }
  }

  async function aplicar() {
    if (!conferencia) return;
    setSalvando(true);
    try {
      const r = await aplicarPrecos([...aAplicar]);
      setAviso(`${r.atualizados} preços atualizados pela planilha.`);
      setConferencia(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar os preços.");
    } finally {
      setSalvando(false);
    }
  }

  async function exportar() {
    setExportando(true);
    setErro(null);
    try {
      // leva o filtro de origem que está na tela: quem filtrou distribuição
      // quer a distribuição no arquivo, não os cinco mil
      await baixarCatalogo(filtroOrigem || undefined);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao exportar o catálogo.");
    } finally {
      setExportando(false);
    }
  }

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
      tipo: p.tipo,
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
      tipo: rascunho.tipo,
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

      {conferencia && (
        <Modal
          titulo="Preços da planilha"
          subtitulo={
            conferencia.diferencas.length
              ? `${conferencia.diferencas.length} de ${conferencia.conferidos} produtos mudaram de preço`
              : `Nenhuma diferença nos ${conferencia.conferidos} produtos de revenda`
          }
          onFechar={() => setConferencia(null)}
          rodape={
            conferencia.diferencas.length ? (
              <>
                <button
                  type="button"
                  className="btn-responder"
                  onClick={() => void aplicar()}
                  disabled={salvando || !aAplicar.size}
                >
                  Aplicar {aAplicar.size} preço{aAplicar.size === 1 ? "" : "s"}
                </button>
                <button type="button" className="btn-excluir" onClick={() => setConferencia(null)}>
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" className="btn-responder" onClick={() => setConferencia(null)}>
                Fechar
              </button>
            )
          }
        >
          {conferencia.foraDaPlanilha.length > 0 && (
            <p className="financeiro-td-mudo">
              {conferencia.foraDaPlanilha.length} produto
              {conferencia.foraDaPlanilha.length === 1 ? "" : "s"} do cadastro não aparece
              {conferencia.foraDaPlanilha.length === 1 ? "" : "m"} mais na planilha — saiu de linha
              ou mudou de SKU. Não mexi neles.
            </p>
          )}

          {conferencia.diferencas.length > 0 && (
            <div className="financeiro-tabela-wrap">
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    <th />
                    <th>PRODUTO</th>
                    <th className="financeiro-th-numero">HOJE</th>
                    <th className="financeiro-th-numero">NA PLANILHA</th>
                    <th className="financeiro-th-numero">DIFERENÇA</th>
                  </tr>
                </thead>
                <tbody>
                  {conferencia.diferencas.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={aAplicar.has(d.id)}
                          onChange={(e) =>
                            setAAplicar((v) => {
                              const n = new Set(v);
                              if (e.target.checked) n.add(d.id);
                              else n.delete(d.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>{d.sku}</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">
                        {formatCurrency(d.precoAtual)}
                      </td>
                      <td className="financeiro-th-numero">{formatCurrency(d.precoPlanilha)}</td>
                      <td className="financeiro-th-numero">
                        {d.diferenca > 0 ? "+" : ""}
                        {formatCurrency(d.diferenca)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

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
        <select
          className="clonar-input fabricacao-input-pequeno"
          value={rascunho.tipo}
          onChange={(e) => setRascunho((r) => ({ ...r, tipo: e.target.value as TipoProduto }))}
          title="Revenda: a loja compra pra anunciar e vender. Insumo: a expedição consome — caixa, saco, fita — e não entra no SKU MASTER."
        >
          <option value="REVENDA">Revenda</option>
          <option value="INSUMO">Insumo</option>
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
          placeholder="Buscar: nome, SKU, código de barras, família, preço…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          title="Cada palavra é procurada separada e em qualquer ordem, sem acento: 'resiflex 18 cinza' acha o mesmo que 'cinza resiflex 18'."
        />
        {busca && (
          <button type="button" className="btn-excluir" onClick={() => setBusca("")}>
            Limpar
          </button>
        )}
        <button
          type="button"
          className="btn-responder"
          onClick={() => void exportar()}
          disabled={exportando || !produtos?.length}
          title="Baixa a lista em Excel: nome, SKU, custo, venda e margem. Fábrica e distribuição na mesma aba, com a coluna ORIGEM separando. O filtro em cima segue pro arquivo."
        >
          {exportando ? "Gerando…" : "Exportar .xlsx"}
        </button>
        <button
          type="button"
          className="btn-excluir"
          onClick={() => void importar()}
          disabled={importando}
          title="Traz os produtos de revenda do catálogo do Mercado Livre. A planilha não é alterada, e SKU que já existe aqui não é tocado."
        >
          {importando ? "Importando…" : "Importar catálogo"}
        </button>
        {porOrigem.DISTRIBUIDORA > 0 && (
          <button
            type="button"
            className="btn-excluir"
            onClick={() => void conferir()}
            disabled={conferindo}
            title="Compara o preço de venda dos produtos de revenda com a planilha e mostra o que mudou"
          >
            {conferindo ? "Conferindo…" : "Ajustar preços pela planilha"}
          </button>
        )}
      </div>

      {busca.trim() && (
        <p className="financeiro-td-mudo">
          {achado.n === 0 ? (
            <>
              Nada encontrado para <strong>{busca}</strong>.
            </>
          ) : (
            <>
              <strong>
                {achado.n} produto{achado.n === 1 ? "" : "s"}
              </strong>{" "}
              · {achado.ativos} ativo{achado.ativos === 1 ? "" : "s"}
              {achado.semCusto > 0 && (
                <>
                  {" "}
                  · <strong>{achado.semCusto} sem custo</strong>
                </>
              )}
              {achado.comMargem > 0 && (
                <>
                  {" "}
                  · margem média {(100 * achado.margem).toFixed(1)}%{" "}
                  <span title="Média simples entre os produtos, sem peso de quantidade vendida. Não é a margem do mês — essa está no DRE.">
                    (média simples, sem peso de venda)
                  </span>
                </>
              )}
            </>
          )}
        </p>
      )}

      {semCusto.length > 0 && (
        <div className="credito-alerta">
          <p>
            <strong>
              {semCusto.length} produto{semCusto.length === 1 ? "" : "s"} com custo zerado
            </strong>{" "}
            — eles aparecem com 100% de margem, que parece ótimo e não é: é cadastro pela
            metade. O motivo de cada um está na coluna CUSTO.
          </p>
          <p className="financeiro-td-mudo">
            {[...new Set(semCusto.flatMap((p) => p.semCusto))].map((motivo) => (
              <span key={motivo}>
                {motivo}: {semCusto.filter((p) => p.semCusto.includes(motivo)).length}
                {"   "}
              </span>
            ))}
          </p>
        </div>
      )}

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
                <td
                  className="financeiro-th-numero"
                  title={p.semCusto.length ? p.semCusto.join(" · ") : undefined}
                >
                  {formatCurrency(p.custo)}
                  {p.semCusto.length > 0 && (
                    <div className="produto-sem-custo">{p.semCusto.join(" · ")}</div>
                  )}
                </td>
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
