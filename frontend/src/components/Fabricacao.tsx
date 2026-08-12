import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMateriasPrimas,
  criarMateriaPrima,
  atualizarMateriaPrima,
  excluirMateriaPrima,
  fetchComprasMateriaPrima,
  registrarCompraMateriaPrima,
  fetchFormulas,
  fetchFormula,
  criarFormula,
  atualizarFormula,
  excluirFormula,
  fetchLotes,
  registrarLote,
  atualizarLote,
  excluirLote,
  fetchDadosMl,
} from "../api/fabricacao";
import { fetchLojas, type Loja } from "../api/lojas";
import type { MateriaPrima, MateriaPrimaCompra, FormulaResumo, Formula, FormulaLote } from "../types/fabricacao";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash, IconClock, IconMoney, IconWrench } from "./icons";

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
  const [comprasAbertasId, setComprasAbertasId] = useState<number | null>(null);

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
        que usam essa matéria-prima. Registre as compras reais (valor pago + frete) pra manter o custo/kg em dia.
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
        <div key={mp.id}>
          <div className="financeiro-impostos-linha">
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
                <button
                  type="button"
                  className="btn-excluir"
                  onClick={() => setComprasAbertasId(comprasAbertasId === mp.id ? null : mp.id)}
                  title="Compras"
                >
                  <IconMoney size={14} />
                </button>
                <button type="button" className="btn-excluir" onClick={() => excluir(mp.id)} title="Excluir">
                  <IconTrash size={14} />
                </button>
              </div>
            )}
          </div>
          {comprasAbertasId === mp.id && (
            <ComprasMateriaPrima materiaPrima={mp} onCustoAtualizado={onMudou} />
          )}
        </div>
      ))}
    </div>
  );
}

function ComprasMateriaPrima({
  materiaPrima,
  onCustoAtualizado,
}: {
  materiaPrima: MateriaPrima;
  onCustoAtualizado: () => void;
}) {
  const [compras, setCompras] = useState<MateriaPrimaCompra[] | null>(null);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantidadeKg, setQuantidadeKg] = useState("");
  const [valorPago, setValorPago] = useState("");
  const [valorFrete, setValorFrete] = useState("0");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetchComprasMateriaPrima(materiaPrima.id).then(setCompras).catch(() => setCompras([]));
  }, [materiaPrima.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const quantidadeNum = Number(quantidadeKg.replace(",", ".")) || 0;
  const pagoNum = Number(valorPago.replace(",", ".")) || 0;
  const freteNum = Number(valorFrete.replace(",", ".")) || 0;
  const custoPrevisto = quantidadeNum > 0 ? (pagoNum + freteNum) / quantidadeNum : null;

  async function registrar() {
    if (!data || quantidadeNum <= 0 || pagoNum < 0 || freteNum < 0) {
      setErro("Preencha data, quantidade e valor pago corretamente.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await registrarCompraMateriaPrima(materiaPrima.id, data, quantidadeNum, pagoNum, freteNum);
      setQuantidadeKg("");
      setValorPago("");
      setValorFrete("0");
      carregar();
      onCustoAtualizado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar compra.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fabricacao-compras">
      {erro && <div className="state-message state-error">{erro}</div>}
      <div className="financeiro-busca">
        <input className="clonar-input fabricacao-input-pequeno" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Quantidade (kg)"
          value={quantidadeKg}
          onChange={(e) => setQuantidadeKg(e.target.value)}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Valor pago (R$)"
          value={valorPago}
          onChange={(e) => setValorPago(e.target.value)}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Frete (R$)"
          value={valorFrete}
          onChange={(e) => setValorFrete(e.target.value)}
        />
        <button type="button" className="btn-responder" disabled={salvando} onClick={registrar}>
          {salvando ? "..." : "Registrar compra"}
        </button>
      </div>
      {custoPrevisto !== null && (
        <span className="financeiro-td-mudo">
          Isso vira custo/kg de {formatCurrency(custoPrevisto)} (já com frete embutido)
        </span>
      )}
      {compras === null && <div className="state-message">Carregando compras...</div>}
      {compras?.length === 0 && <div className="state-message">Nenhuma compra registrada ainda.</div>}
      {compras && compras.length > 0 && (
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th className="financeiro-th-numero">Quantidade</th>
              <th className="financeiro-th-numero">Pago</th>
              <th className="financeiro-th-numero">Frete</th>
              <th className="financeiro-th-numero">Custo/kg</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id}>
                <td>{c.data}</td>
                <td className="financeiro-th-numero">{c.quantidadeKg}kg</td>
                <td className="financeiro-th-numero">{formatCurrency(c.valorPago)}</td>
                <td className="financeiro-th-numero">{formatCurrency(c.valorFrete)}</td>
                <td className="financeiro-th-numero">{formatCurrency(c.custoPorKg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ItemEditavel {
  tipo: "materia_prima" | "formula";
  refId: number;
  percentual: string;
}

interface EmbalagemEditavel {
  id: number | null;
  nome: string;
  pesoKg: string;
  custoEmbalagem: string;
  sku: string;
}

function EmbalagemLinha({
  embalagem,
  custoPorKgFormula,
  onMudar,
  onRemover,
  formulaId,
  ehNova,
  lojas,
}: {
  embalagem: EmbalagemEditavel;
  custoPorKgFormula: number;
  onMudar: (campo: keyof EmbalagemEditavel, valor: string) => void;
  onRemover: () => void;
  formulaId: number;
  ehNova: boolean;
  lojas: Loja[];
}) {
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [precoVenda, setPrecoVenda] = useState<number | null>(null);
  const [custosMl, setCustosMl] = useState<{ tarifa: number; frete: number; imposto: number } | null>(null);
  const [amostra, setAmostra] = useState<number | null>(null);

  const pesoKg = Number(embalagem.pesoKg.replace(",", ".")) || 0;
  const custoEmbalagem = Number(embalagem.custoEmbalagem.replace(",", ".")) || 0;
  const custoProduto = custoPorKgFormula * pesoKg;
  const custoFinal = custoProduto + custoEmbalagem;

  const margem =
    precoVenda !== null && custosMl !== null ? precoVenda - custosMl.tarifa - custosMl.frete - custosMl.imposto - custoFinal : null;

  async function puxarDadosMl() {
    if (ehNova || !embalagem.sku.trim()) return;
    setBuscando(true);
    setErro(null);
    try {
      const dados = await fetchDadosMl(formulaId, embalagem.sku.trim(), lojaFiltro);
      if (dados.qtdVendas === 0) {
        setErro("Não achei venda desse SKU nos últimos 30 dias.");
        setPrecoVenda(null);
        setCustosMl(null);
      } else {
        setPrecoVenda(dados.precoMedio);
        setCustosMl({ tarifa: dados.tarifaMedia, frete: dados.freteMedio, imposto: dados.impostoMedio });
        setAmostra(dados.qtdVendas);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao buscar dados do Mercado Livre.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="fabricacao-embalagem-linha">
      <div className="fabricacao-editor-topo">
        <input
          className="clonar-input"
          placeholder="Nome (ex: Balde 18kg)"
          value={embalagem.nome}
          onChange={(e) => onMudar("nome", e.target.value)}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Peso (kg)"
          value={embalagem.pesoKg}
          onChange={(e) => onMudar("pesoKg", e.target.value)}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Custo embalagem (R$)"
          value={embalagem.custoEmbalagem}
          onChange={(e) => onMudar("custoEmbalagem", e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="SKU no ML (opcional)"
          value={embalagem.sku}
          onChange={(e) => onMudar("sku", e.target.value)}
        />
        <button type="button" className="btn-excluir" onClick={onRemover} title="Remover">
          <IconTrash size={14} />
        </button>
      </div>

      <div className="fabricacao-resumo-custos">
        <div>
          <span className="financeiro-stat-label">Produto ({pesoKg}kg)</span>
          <span className="financeiro-stat-valor">{formatCurrency(custoProduto)}</span>
        </div>
        <div>
          <span className="financeiro-stat-label">+ Embalagem</span>
          <span className="financeiro-stat-valor">{formatCurrency(custoEmbalagem)}</span>
        </div>
        <div>
          <span className="financeiro-stat-label">= Custo final</span>
          <span className="financeiro-stat-valor financeiro-stat-valor-grande">{formatCurrency(custoFinal)}</span>
        </div>
      </div>

      {!ehNova && embalagem.sku.trim() && (
        <div className="fabricacao-secao-ml">
          {erro && <div className="state-message state-error">{erro}</div>}
          <div className="financeiro-filtros">
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
            <button type="button" className="btn-responder" onClick={puxarDadosMl} disabled={buscando}>
              {buscando ? "Buscando..." : "Puxar dados do Mercado Livre"}
            </button>
            {amostra !== null && (
              <span className="financeiro-td-mudo">
                com base em {amostra} venda{amostra > 1 ? "s" : ""} recente{amostra > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {margem !== null && (
            <div className={`fabricacao-margem-resultado ${margem >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
              Margem: {formatCurrency(margem)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LotesSecao({ formula }: { formula: Formula }) {
  const [lotes, setLotes] = useState<FormulaLote[] | null>(null);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [pesoReal, setPesoReal] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editData, setEditData] = useState("");
  const [editPesoReal, setEditPesoReal] = useState("");
  const [editObservacao, setEditObservacao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregar = useCallback(() => {
    fetchLotes(formula.id).then(setLotes).catch(() => setLotes([]));
  }, [formula.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function registrar() {
    const peso = Number(pesoReal.replace(",", "."));
    if (!data || !Number.isFinite(peso) || peso <= 0) {
      setErro("Informe data e peso real válidos.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await registrarLote(formula.id, data, peso, observacao.trim() || null);
      setPesoReal("");
      setObservacao("");
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar lote.");
    } finally {
      setSalvando(false);
    }
  }

  function iniciarEdicao(lote: FormulaLote) {
    setEditandoId(lote.id);
    setEditData(lote.data);
    setEditPesoReal(String(lote.pesoRealKg));
    setEditObservacao(lote.observacao ?? "");
    setErro(null);
  }

  async function salvarEdicao(loteId: number) {
    const peso = Number(editPesoReal.replace(",", "."));
    if (!editData || !Number.isFinite(peso) || peso <= 0) {
      setErro("Informe data e peso real válidos.");
      return;
    }
    setSalvandoEdicao(true);
    setErro(null);
    try {
      await atualizarLote(formula.id, loteId, editData, peso, editObservacao.trim() || null);
      setEditandoId(null);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar lote.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function excluir(loteId: number) {
    try {
      await excluirLote(formula.id, loteId);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir lote.");
    }
  }

  return (
    <div className="fabricacao-secao-ml">
      <h3>
        <IconClock size={16} /> Histórico de lotes de produção
      </h3>
      <p className="painel-sub">
        Peso previsto pela fórmula: {formula.pesoLoteKg}kg. Registre o que realmente saiu de cada lote pra
        acompanhar déficit/superávit.
      </p>
      {erro && <div className="state-message state-error">{erro}</div>}
      <div className="financeiro-busca">
        <input className="clonar-input fabricacao-input-pequeno" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Peso real (kg)"
          value={pesoReal}
          onChange={(e) => setPesoReal(e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="Observação (opcional)"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
        <button type="button" className="btn-responder" disabled={salvando} onClick={registrar}>
          <IconPlus size={15} /> {salvando ? "..." : "Registrar lote"}
        </button>
      </div>

      {lotes === null && <div className="state-message">Carregando lotes...</div>}
      {lotes?.length === 0 && <div className="state-message">Nenhum lote registrado ainda.</div>}
      {lotes && lotes.length > 0 && (
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th className="financeiro-th-numero">Previsto</th>
              <th className="financeiro-th-numero">Real</th>
              <th className="financeiro-th-numero">Diferença</th>
              <th className="financeiro-th-numero">Valor</th>
              <th>Observação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) =>
              editandoId === l.id ? (
                <tr key={l.id}>
                  <td>
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      type="date"
                      value={editData}
                      onChange={(e) => setEditData(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">{l.pesoPrevistoKg}kg</td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editPesoReal}
                      onChange={(e) => setEditPesoReal(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td>
                    <input
                      className="clonar-input"
                      value={editObservacao}
                      onChange={(e) => setEditObservacao(e.target.value)}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-responder" disabled={salvandoEdicao} onClick={() => salvarEdicao(l.id)}>
                      {salvandoEdicao ? "..." : "Salvar"}
                    </button>
                    <button type="button" className="btn-excluir" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id}>
                  <td>{l.data}</td>
                  <td className="financeiro-th-numero">{l.pesoPrevistoKg}kg</td>
                  <td className="financeiro-th-numero">{l.pesoRealKg}kg</td>
                  <td className={`financeiro-th-numero ${l.diferencaKg >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
                    {l.diferencaKg >= 0 ? "+" : ""}
                    {l.diferencaKg.toFixed(2)}kg
                    {l.diferencaPercentual !== null && ` (${l.diferencaPercentual >= 0 ? "+" : ""}${l.diferencaPercentual.toFixed(1)}%)`}
                  </td>
                  <td className={`financeiro-th-numero ${l.diferencaKg >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
                    {l.diferencaKg >= 0 ? "+" : ""}
                    {formatCurrency(l.diferencaKg * formula.custoPorKg)}
                  </td>
                  <td className="financeiro-td-mudo">{l.observacao ?? "—"}</td>
                  <td>
                    <button type="button" className="btn-excluir" onClick={() => iniciarEdicao(l)} title="Editar">
                      <IconWrench size={14} />
                    </button>
                    <button type="button" className="btn-excluir" onClick={() => excluir(l.id)} title="Excluir">
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FormulaEditor({
  formula,
  materiasPrimas,
  formulas,
  onSalvo,
  onCancelar,
  onExcluido,
}: {
  formula: Formula;
  materiasPrimas: MateriaPrima[];
  formulas: FormulaResumo[];
  onSalvo: () => void;
  onCancelar: () => void;
  onExcluido: () => void;
}) {
  const ehNova = formula.id === 0;
  const [nome, setNome] = useState(formula.nome);
  const [pesoLoteKg, setPesoLoteKg] = useState(String(formula.pesoLoteKg));
  const [itens, setItens] = useState<ItemEditavel[]>(
    formula.itens.map((i) => ({
      tipo: i.tipo,
      refId: i.tipo === "materia_prima" ? i.materiaPrimaId! : i.subFormulaId!,
      percentual: String(i.percentual),
    }))
  );
  const [embalagens, setEmbalagens] = useState<EmbalagemEditavel[]>(
    formula.embalagens.map((e) => ({
      id: e.id,
      nome: e.nome,
      pesoKg: String(e.pesoKg),
      custoEmbalagem: String(e.custoEmbalagem),
      sku: e.sku ?? "",
    }))
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const materiaPrimaPorId = useMemo(() => new Map(materiasPrimas.map((m) => [m.id, m])), [materiasPrimas]);
  const formulasDisponiveis = useMemo(() => formulas.filter((f) => f.id !== formula.id), [formulas, formula.id]);
  const formulaPorId = useMemo(() => new Map(formulas.map((f) => [f.id, f])), [formulas]);

  const peso = Number(pesoLoteKg.replace(",", ".")) || 0;

  const linhasCalculadas = itens.map((item) => {
    const percentual = Number(item.percentual.replace(",", ".")) || 0;
    const custoPorKgItem =
      item.tipo === "materia_prima" ? materiaPrimaPorId.get(item.refId)?.custoPorKg : formulaPorId.get(item.refId)?.custoPorKg;
    const massaKg = (percentual / 100) * peso;
    const custo = custoPorKgItem !== undefined ? massaKg * custoPorKgItem : 0;
    return { ...item, percentual, custoPorKgItem, massaKg, custo };
  });
  const somaPercentuais = linhasCalculadas.reduce((s, l) => s + l.percentual, 0);
  const custoPorKgFormula = linhasCalculadas.reduce((s, l) => s + ((l.custoPorKgItem ?? 0) * l.percentual) / 100, 0);
  const custoFabricacaoTotal = custoPorKgFormula * peso;

  function adicionarItem(indice: number) {
    setItens((atual) => {
      const copia = [...atual];
      copia.splice(indice + 1, 0, { tipo: "materia_prima", refId: materiasPrimas[0]?.id ?? 0, percentual: "0" });
      return copia;
    });
  }

  function adicionarPrimeiroItem() {
    const tipo: ItemEditavel["tipo"] = materiasPrimas.length > 0 ? "materia_prima" : "formula";
    const refId = tipo === "materia_prima" ? materiasPrimas[0]?.id ?? 0 : formulasDisponiveis[0]?.id ?? 0;
    setItens((atual) => [...atual, { tipo, refId, percentual: "0" }]);
  }

  function removerItem(indice: number) {
    setItens((atual) => atual.filter((_, i) => i !== indice));
  }

  function atualizarItemTipo(indice: number, tipo: ItemEditavel["tipo"]) {
    const refId = tipo === "materia_prima" ? materiasPrimas[0]?.id ?? 0 : formulasDisponiveis[0]?.id ?? 0;
    setItens((atual) => atual.map((item, i) => (i === indice ? { ...item, tipo, refId } : item)));
  }

  function atualizarItemCampo(indice: number, campo: "refId" | "percentual", valor: string) {
    setItens((atual) =>
      atual.map((item, i) => (i === indice ? { ...item, [campo]: campo === "refId" ? Number(valor) : valor } : item))
    );
  }

  function adicionarEmbalagem() {
    setEmbalagens((atual) => [...atual, { id: null, nome: "", pesoKg: "", custoEmbalagem: "0", sku: "" }]);
  }

  function atualizarEmbalagem(indice: number, campo: keyof EmbalagemEditavel, valor: string) {
    setEmbalagens((atual) => atual.map((e, i) => (i === indice ? { ...e, [campo]: valor } : e)));
  }

  function removerEmbalagem(indice: number) {
    setEmbalagens((atual) => atual.filter((_, i) => i !== indice));
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
      .filter((l) => l.percentual > 0)
      .map((l) => ({
        materiaPrimaId: l.tipo === "materia_prima" ? l.refId : null,
        subFormulaId: l.tipo === "formula" ? l.refId : null,
        percentual: l.percentual,
      }));
    if (itensValidos.length === 0) {
      setErro("Adicione ao menos um item (matéria-prima ou fórmula) com % maior que zero.");
      return;
    }
    const embalagensValidas = embalagens
      .filter((e) => e.nome.trim() && Number(e.pesoKg.replace(",", ".")) > 0)
      .map((e) => ({
        nome: e.nome.trim(),
        pesoKg: Number(e.pesoKg.replace(",", ".")),
        custoEmbalagem: Number(e.custoEmbalagem.replace(",", ".")) || 0,
        sku: e.sku.trim() || null,
      }));

    setSalvando(true);
    setErro(null);
    const entrada = { nome: nome.trim(), pesoLoteKg: peso, itens: itensValidos, embalagens: embalagensValidas };
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

  const semOpcoes = materiasPrimas.length === 0 && formulasDisponiveis.length === 0;

  return (
    <div className="fabricacao-editor">
      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="fabricacao-editor-topo">
        <input className="clonar-input" placeholder="Nome da fórmula" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input
          className="clonar-input"
          placeholder="Peso do lote inteiro (kg)"
          value={pesoLoteKg}
          onChange={(e) => setPesoLoteKg(e.target.value)}
        />
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Item</th>
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
                    value={linha.tipo}
                    onChange={(e) => atualizarItemTipo(indice, e.target.value as ItemEditavel["tipo"])}
                  >
                    <option value="materia_prima" disabled={materiasPrimas.length === 0}>
                      Matéria-prima
                    </option>
                    <option value="formula" disabled={formulasDisponiveis.length === 0}>
                      Fórmula
                    </option>
                  </select>
                </td>
                <td>
                  <select className="dashboard-select" value={linha.refId} onChange={(e) => atualizarItemCampo(indice, "refId", e.target.value)}>
                    {linha.tipo === "materia_prima"
                      ? materiasPrimas.map((mp) => (
                          <option key={mp.id} value={mp.id}>
                            {mp.nome}
                          </option>
                        ))
                      : formulasDisponiveis.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                  </select>
                </td>
                <td className="financeiro-th-numero">
                  <input
                    className="clonar-input fabricacao-input-pequeno"
                    value={linha.percentual === 0 ? "" : itens[indice].percentual}
                    placeholder="0"
                    onChange={(e) => atualizarItemCampo(indice, "percentual", e.target.value)}
                  />
                </td>
                <td className="financeiro-th-numero">{linha.massaKg.toFixed(3)}</td>
                <td className="financeiro-th-numero financeiro-td-mudo">
                  {linha.custoPorKgItem !== undefined ? formatCurrency(linha.custoPorKgItem) : "—"}
                </td>
                <td className="financeiro-th-numero">{formatCurrency(linha.custo)}</td>
                <td>
                  <button type="button" className="btn-excluir" onClick={() => removerItem(indice)}>
                    <IconTrash size={14} />
                  </button>
                  <button type="button" className="btn-excluir" onClick={() => adicionarItem(indice)} title="Adicionar item abaixo">
                    <IconPlus size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fabricacao-rodape-tabela">
        <button type="button" className="btn-responder" onClick={adicionarPrimeiroItem} disabled={semOpcoes}>
          <IconPlus size={14} /> Adicionar item
        </button>
        <span className={somaPercentuais.toFixed(1) === "100.0" ? "financeiro-margem-positiva" : "financeiro-margem-alerta"}>
          Soma: {somaPercentuais.toFixed(1)}% {somaPercentuais.toFixed(1) !== "100.0" && "— o ideal é fechar em 100%"}
        </span>
      </div>

      <div className="fabricacao-resumo-custos">
        <div>
          <span className="financeiro-stat-label">Custo por kg</span>
          <span className="financeiro-stat-valor">{formatCurrency(custoPorKgFormula)}</span>
        </div>
        <div>
          <span className="financeiro-stat-label">× Peso do lote ({peso}kg)</span>
          <span className="financeiro-stat-valor financeiro-stat-valor-grande">{formatCurrency(custoFabricacaoTotal)}</span>
        </div>
      </div>

      <div className="fabricacao-secao-ml">
        <div className="fabricacao-secao-titulo-acao">
          <h3>Envase</h3>
          <button type="button" className="btn-responder" onClick={adicionarEmbalagem}>
            <IconPlus size={14} /> Adicionar tamanho
          </button>
        </div>
        <p className="painel-sub">Cada tamanho fracionado do lote, com seu custo de embalagem e SKU (se vendido separadamente).</p>
        {embalagens.length === 0 && <div className="state-message">Nenhum tamanho de envase cadastrado ainda.</div>}
        {embalagens.map((e, indice) => (
          <EmbalagemLinha
            key={indice}
            embalagem={e}
            custoPorKgFormula={custoPorKgFormula}
            onMudar={(campo, valor) => atualizarEmbalagem(indice, campo, valor)}
            onRemover={() => removerEmbalagem(indice)}
            formulaId={formula.id}
            ehNova={ehNova}
            lojas={lojas}
          />
        ))}
      </div>

      {!ehNova && <LotesSecao formula={formula} />}

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

const FORMULA_VAZIA: Formula = { id: 0, nome: "", pesoLoteKg: 1, custoPorKg: 0, custoFabricacaoTotal: 0, itens: [], embalagens: [] };

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
          <span className="painel-eyebrow">Custo de Fabricação</span>
          <h1>Custo de produção, envase e margem de fábrica</h1>
          <p className="painel-sub">
            Cadastre matérias-primas (com histórico de compras), monte fórmulas — inclusive fórmulas que usam outras
            fórmulas como ingrediente (ex.: uma Base) —, os tamanhos de envase de cada uma e compare com o preço
            real do Mercado Livre. Registre os lotes de produção pra acompanhar déficit/superávit.
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
              <span className="financeiro-td-mudo">{f.pesoLoteKg}kg por lote</span>
              <span className="fabricacao-formula-custo">{formatCurrency(f.custoFabricacaoTotal)}</span>
            </button>
          ))}

        {formulaAberta && formulas && (
          <FormulaEditor
            formula={formulaAberta}
            materiasPrimas={materiasPrimas}
            formulas={formulas}
            onSalvo={fecharEditor}
            onCancelar={() => setFormulaAberta(null)}
            onExcluido={fecharEditor}
          />
        )}
      </div>
    </div>
  );
}
