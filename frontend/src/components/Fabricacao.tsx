import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMateriasPrimas,
  criarMateriaPrima,
  atualizarMateriaPrima,
  excluirMateriaPrima,
  fetchFormulas,
  fetchFormula,
  criarFormula,
  atualizarFormula,
  excluirFormula,
  fetchDadosMl,
} from "../api/fabricacao";
import { fetchLojas, type Loja } from "../api/lojas";
import type { MateriaPrima, FormulaResumo, Formula } from "../types/fabricacao";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash } from "./icons";

function MateriasPrimasSecao({
  materiasPrimas,
  onMudou,
}: {
  materiasPrimas: MateriaPrima[];
  onMudou: () => void;
}) {
  const [novoNome, setNovoNome] = useState("");
  const [novoCusto, setNovoCusto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [custoEditado, setCustoEditado] = useState("");

  async function adicionar() {
    const custo = Number(novoCusto.replace(",", "."));
    if (!novoNome.trim() || !Number.isFinite(custo) || custo < 0) {
      setErro("Informe nome e um custo por kg válido.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await criarMateriaPrima(novoNome.trim(), custo);
      setNovoNome("");
      setNovoCusto("");
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar matéria-prima.");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(id: number, nome: string) {
    const custo = Number(custoEditado.replace(",", "."));
    if (!Number.isFinite(custo) || custo < 0) return;
    try {
      await atualizarMateriaPrima(id, nome, custo);
      setEditandoId(null);
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar.");
    }
  }

  async function excluir(id: number) {
    try {
      await excluirMateriaPrima(id);
      onMudou();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  return (
    <div className="fabricacao-secao">
      <h2>Matérias-primas</h2>
      <p className="painel-sub">
        Cadastro único, reaproveitado em quantas fórmulas precisar — mudar o custo aqui atualiza todas as fórmulas
        que usam essa matéria-prima.
      </p>
      {erro && <div className="state-message state-error">{erro}</div>}
      <div className="financeiro-busca">
        <input className="clonar-input" placeholder="Nome da matéria-prima" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <input
          className="clonar-input"
          placeholder="Custo por kg (R$)"
          value={novoCusto}
          onChange={(e) => setNovoCusto(e.target.value)}
        />
        <button type="button" className="btn-responder" disabled={salvando} onClick={adicionar}>
          <IconPlus size={15} /> {salvando ? "..." : "Adicionar"}
        </button>
      </div>

      {materiasPrimas.length === 0 && <div className="state-message">Nenhuma matéria-prima cadastrada ainda.</div>}
      {materiasPrimas.map((mp) => (
        <div key={mp.id} className="financeiro-impostos-linha">
          <span>{mp.nome}</span>
          {editandoId === mp.id ? (
            <div className="financeiro-impostos-campo">
              <input
                className="clonar-input fabricacao-input-pequeno"
                value={custoEditado}
                onChange={(e) => setCustoEditado(e.target.value)}
                autoFocus
              />
              <button type="button" className="btn-responder" onClick={() => salvarEdicao(mp.id, mp.nome)}>
                Salvar
              </button>
              <button type="button" className="btn-excluir" onClick={() => setEditandoId(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <div className="financeiro-impostos-campo">
              <button
                type="button"
                className="fabricacao-custo-botao"
                onClick={() => {
                  setEditandoId(mp.id);
                  setCustoEditado(String(mp.custoPorKg));
                }}
                title="Clique pra editar"
              >
                {formatCurrency(mp.custoPorKg)}/kg
              </button>
              <button type="button" className="btn-excluir" onClick={() => excluir(mp.id)} title="Excluir">
                <IconTrash size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface ItemEditavel {
  materiaPrimaId: number;
  percentual: string;
}

function FormulaEditor({
  formula,
  materiasPrimas,
  onSalvo,
  onCancelar,
  onExcluido,
}: {
  formula: Formula;
  materiasPrimas: MateriaPrima[];
  onSalvo: () => void;
  onCancelar: () => void;
  onExcluido: () => void;
}) {
  const ehNova = formula.id === 0;
  const [nome, setNome] = useState(formula.nome);
  const [sku, setSku] = useState(formula.sku ?? "");
  const [pesoLoteKg, setPesoLoteKg] = useState(String(formula.pesoLoteKg));
  const [custoEmbalagem, setCustoEmbalagem] = useState(String(formula.custoEmbalagem));
  const [itens, setItens] = useState<ItemEditavel[]>(
    formula.itens.map((i) => ({ materiaPrimaId: i.materiaPrimaId, percentual: String(i.percentual) }))
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [buscandoMl, setBuscandoMl] = useState(false);
  const [precoVenda, setPrecoVenda] = useState("0");
  const [tarifa, setTarifa] = useState("0");
  const [frete, setFrete] = useState("0");
  const [imposto, setImposto] = useState("0");
  const [amostraMl, setAmostraMl] = useState<number | null>(null);

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const materiaPrimaPorId = useMemo(() => new Map(materiasPrimas.map((m) => [m.id, m])), [materiasPrimas]);
  const peso = Number(pesoLoteKg.replace(",", ".")) || 0;
  const embalagem = Number(custoEmbalagem.replace(",", ".")) || 0;

  const linhasCalculadas = itens.map((item) => {
    const mp = materiaPrimaPorId.get(item.materiaPrimaId);
    const percentual = Number(item.percentual.replace(",", ".")) || 0;
    const massaKg = (percentual / 100) * peso;
    const custo = mp ? massaKg * mp.custoPorKg : 0;
    return { ...item, percentual, mp, massaKg, custo };
  });
  const somaPercentuais = linhasCalculadas.reduce((s, l) => s + l.percentual, 0);
  const custoFabricacao = linhasCalculadas.reduce((s, l) => s + l.custo, 0);
  const custoProdutoPronto = custoFabricacao + embalagem;

  const precoVendaNum = Number(precoVenda.replace(",", ".")) || 0;
  const tarifaNum = Number(tarifa.replace(",", ".")) || 0;
  const freteNum = Number(frete.replace(",", ".")) || 0;
  const impostoNum = Number(imposto.replace(",", ".")) || 0;
  const margem = precoVendaNum - tarifaNum - freteNum - impostoNum - custoProdutoPronto;
  const margemPercentual = precoVendaNum > 0 ? (margem / precoVendaNum) * 100 : null;

  function adicionarItem() {
    if (materiasPrimas.length === 0) return;
    setItens((atual) => [...atual, { materiaPrimaId: materiasPrimas[0].id, percentual: "0" }]);
  }

  function removerItem(indice: number) {
    setItens((atual) => atual.filter((_, i) => i !== indice));
  }

  function atualizarItem(indice: number, campo: "materiaPrimaId" | "percentual", valor: string) {
    setItens((atual) =>
      atual.map((item, i) =>
        i === indice ? { ...item, [campo]: campo === "materiaPrimaId" ? Number(valor) : valor } : item
      )
    );
  }

  async function puxarDadosMl() {
    if (ehNova) return;
    setBuscandoMl(true);
    setErro(null);
    try {
      const dados = await fetchDadosMl(formula.id, lojaFiltro);
      if (dados.qtdVendas === 0) {
        setErro("Não achei nenhuma venda desse SKU nos últimos 30 dias — confira o SKU vinculado.");
      } else {
        setPrecoVenda(dados.precoMedio.toFixed(2));
        setTarifa(dados.tarifaMedia.toFixed(2));
        setFrete(dados.freteMedio.toFixed(2));
        setImposto(dados.impostoMedio.toFixed(2));
        setAmostraMl(dados.qtdVendas);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao buscar dados do Mercado Livre.");
    } finally {
      setBuscandoMl(false);
    }
  }

  async function salvar() {
    if (!nome.trim()) {
      setErro("Informe o nome da fórmula.");
      return;
    }
    if (!Number.isFinite(peso) || peso <= 0) {
      setErro("Peso do lote inválido.");
      return;
    }
    const itensValidos = linhasCalculadas
      .filter((l) => l.mp !== undefined && l.percentual > 0)
      .map((l) => ({ materiaPrimaId: l.materiaPrimaId, percentual: l.percentual }));
    if (itensValidos.length === 0) {
      setErro("Adicione ao menos uma matéria-prima com % maior que zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    const entrada = {
      nome: nome.trim(),
      sku: sku.trim() || null,
      pesoLoteKg: peso,
      custoEmbalagem: embalagem,
      itens: itensValidos,
    };
    try {
      if (ehNova) {
        await criarFormula(entrada);
      } else {
        await atualizarFormula(formula.id, entrada);
      }
      onSalvo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar fórmula.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (ehNova) return;
    try {
      await excluirFormula(formula.id);
      onExcluido();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir fórmula.");
    }
  }

  return (
    <div className="fabricacao-editor">
      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="fabricacao-editor-topo">
        <input className="clonar-input" placeholder="Nome da fórmula" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className="clonar-input" placeholder="SKU vinculado (opcional)" value={sku} onChange={(e) => setSku(e.target.value)} />
        <input
          className="clonar-input"
          placeholder="Peso do lote (kg)"
          value={pesoLoteKg}
          onChange={(e) => setPesoLoteKg(e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="Custo de embalagem (R$)"
          value={custoEmbalagem}
          onChange={(e) => setCustoEmbalagem(e.target.value)}
        />
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>Matéria-prima</th>
              <th className="financeiro-th-numero">%</th>
              <th className="financeiro-th-numero">Massa (kg)</th>
              <th className="financeiro-th-numero">Custo/kg</th>
              <th className="financeiro-th-numero">Custo total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhasCalculadas.map((linha, indice) => (
              <tr key={indice}>
                <td>
                  <select
                    className="dashboard-select"
                    value={linha.materiaPrimaId}
                    onChange={(e) => atualizarItem(indice, "materiaPrimaId", e.target.value)}
                  >
                    {materiasPrimas.map((mp) => (
                      <option key={mp.id} value={mp.id}>
                        {mp.nome}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="financeiro-th-numero">
                  <input
                    className="clonar-input fabricacao-input-pequeno"
                    value={linha.percentual === 0 ? "" : String(itens[indice].percentual)}
                    placeholder="0"
                    onChange={(e) => atualizarItem(indice, "percentual", e.target.value)}
                  />
                </td>
                <td className="financeiro-th-numero">{linha.massaKg.toFixed(3)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {linha.mp ? formatCurrency(linha.mp.custoPorKg) : "—"}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(linha.custo)}</td>
                <td>
                  <button type="button" className="btn-excluir" onClick={() => removerItem(indice)}>
                    <IconTrash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fabricacao-rodape-tabela">
        <button type="button" className="btn-responder" onClick={adicionarItem} disabled={materiasPrimas.length === 0}>
          <IconPlus size={14} /> Adicionar matéria-prima
        </button>
        <span className={somaPercentuais.toFixed(1) === "100.0" ? "financeiro-margem-positiva" : "financeiro-margem-alerta"}>
          Soma: {somaPercentuais.toFixed(1)}% {somaPercentuais.toFixed(1) !== "100.0" && "— o ideal é fechar em 100%"}
        </span>
      </div>

      <div className="fabricacao-resumo-custos">
        <div>
          <span className="financeiro-stat-label">Custo de fabricação</span>
          <span className="financeiro-stat-valor">{formatCurrency(custoFabricacao)}</span>
        </div>
        <div>
          <span className="financeiro-stat-label">+ Embalagem</span>
          <span className="financeiro-stat-valor">{formatCurrency(embalagem)}</span>
        </div>
        <div>
          <span className="financeiro-stat-label">= Custo do produto pronto</span>
          <span className="financeiro-stat-valor financeiro-stat-valor-grande">{formatCurrency(custoProdutoPronto)}</span>
        </div>
      </div>

      <div className="fabricacao-secao-ml">
        <h3>Margem vs. Mercado Livre</h3>
        {ehNova ? (
          <p className="painel-sub">Salve a fórmula primeiro pra poder puxar dados reais de venda do SKU vinculado.</p>
        ) : (
          <div className="financeiro-filtros">
            <select className="dashboard-select" value={lojaFiltro} onChange={(e) => {
              const valor = e.target.value;
              setLojaFiltro(valor === "todas" || valor === "minhas" ? valor : Number(valor));
            }}>
              <option value="todas">Todas as lojas</option>
              <option value="minhas">Minhas lojas</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <button type="button" className="btn-responder" onClick={puxarDadosMl} disabled={buscandoMl || !sku.trim()}>
              {buscandoMl ? "Buscando..." : "Puxar dados do Mercado Livre"}
            </button>
            {amostraMl !== null && (
              <span className="financeiro-td-mudo">com base em {amostraMl} venda{amostraMl > 1 ? "s" : ""} recente{amostraMl > 1 ? "s" : ""}</span>
            )}
          </div>
        )}

        <div className="fabricacao-editor-topo">
          <label className="fabricacao-campo-label">
            Preço de venda
            <input className="clonar-input" value={precoVenda} onChange={(e) => setPrecoVenda(e.target.value)} />
          </label>
          <label className="fabricacao-campo-label">
            Tarifa ML
            <input className="clonar-input" value={tarifa} onChange={(e) => setTarifa(e.target.value)} />
          </label>
          <label className="fabricacao-campo-label">
            Frete
            <input className="clonar-input" value={frete} onChange={(e) => setFrete(e.target.value)} />
          </label>
          <label className="fabricacao-campo-label">
            Imposto
            <input className="clonar-input" value={imposto} onChange={(e) => setImposto(e.target.value)} />
          </label>
        </div>

        <div className={`fabricacao-margem-resultado ${margem >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
          Margem: {formatCurrency(margem)}
          {margemPercentual !== null && ` (${margemPercentual.toFixed(1)}%)`}
        </div>
      </div>

      <div className="fabricacao-editor-acoes">
        <button type="button" className="btn-responder" disabled={salvando} onClick={salvar}>
          {salvando ? "Salvando..." : "Salvar fórmula"}
        </button>
        <button type="button" className="btn-excluir" onClick={onCancelar}>
          Cancelar
        </button>
        {!ehNova && (
          <button type="button" className="btn-excluir" onClick={excluir}>
            Excluir fórmula
          </button>
        )}
      </div>
    </div>
  );
}

const FORMULA_VAZIA: Formula = { id: 0, nome: "", sku: null, pesoLoteKg: 1, custoEmbalagem: 0, custoFabricacao: 0, itens: [] };

export function Fabricacao() {
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrima[]>([]);
  const [formulas, setFormulas] = useState<FormulaResumo[] | null>(null);
  const [formulaAberta, setFormulaAberta] = useState<Formula | null>(null);
  const [carregandoFormula, setCarregandoFormula] = useState(false);

  const carregarMateriasPrimas = useCallback(() => {
    fetchMateriasPrimas().then(setMateriasPrimas).catch(() => {});
  }, []);

  const carregarFormulas = useCallback(() => {
    fetchFormulas().then(setFormulas).catch(() => {});
  }, []);

  useEffect(() => {
    carregarMateriasPrimas();
    carregarFormulas();
  }, [carregarMateriasPrimas, carregarFormulas]);

  async function abrirFormula(id: number) {
    setCarregandoFormula(true);
    try {
      setFormulaAberta(await fetchFormula(id));
    } catch {
      setFormulaAberta(null);
    } finally {
      setCarregandoFormula(false);
    }
  }

  function fecharEditor() {
    setFormulaAberta(null);
    carregarFormulas();
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Fabricação</span>
          <h1>Custo de produção e margem de fábrica</h1>
          <p className="painel-sub">
            Cadastre a fórmula (matéria-prima + %) de cada produto fabricado, vincule ao SKU real e compare o custo
            de fabricação com o preço, frete e tarifa reais do Mercado Livre.
          </p>
        </div>
      </div>

      <MateriasPrimasSecao materiasPrimas={materiasPrimas} onMudou={carregarMateriasPrimas} />

      <div className="fabricacao-secao">
        <div className="fabricacao-secao-titulo-acao">
          <h2>Fórmulas</h2>
          <button
            type="button"
            className="btn-responder"
            disabled={materiasPrimas.length === 0}
            title={materiasPrimas.length === 0 ? "Cadastre ao menos uma matéria-prima primeiro" : undefined}
            onClick={() => setFormulaAberta(FORMULA_VAZIA)}
          >
            <IconPlus size={15} /> Nova fórmula
          </button>
        </div>

        {formulas === null && <div className="state-message">Carregando...</div>}
        {formulas?.length === 0 && !formulaAberta && (
          <div className="state-message">Nenhuma fórmula cadastrada ainda.</div>
        )}
        {carregandoFormula && <div className="state-message">Carregando fórmula...</div>}

        {!formulaAberta &&
          formulas?.map((f) => (
            <button key={f.id} type="button" className="fabricacao-formula-card" onClick={() => abrirFormula(f.id)}>
              <span className="fabricacao-formula-nome">{f.nome}</span>
              <span className="financeiro-td-mudo">{f.sku ?? "sem SKU vinculado"}</span>
              <span className="fabricacao-formula-custo">{formatCurrency(f.custoFabricacao)}</span>
            </button>
          ))}

        {formulaAberta && (
          <FormulaEditor
            formula={formulaAberta}
            materiasPrimas={materiasPrimas}
            onSalvo={fecharEditor}
            onCancelar={() => setFormulaAberta(null)}
            onExcluido={fecharEditor}
          />
        )}
      </div>
    </div>
  );
}
