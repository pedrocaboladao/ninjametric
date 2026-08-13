import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMateriasPrimas,
  criarMateriaPrima,
  atualizarMateriaPrima,
  excluirMateriaPrima,
  fetchComprasMateriaPrima,
  registrarCompraMateriaPrima,
  atualizarCompraMateriaPrima,
  excluirCompraMateriaPrima,
  fetchFormulas,
  fetchFormula,
  criarFormula,
  atualizarFormula,
  excluirFormula,
  fetchLotes,
  fetchTodosLotes,
  registrarLote,
  atualizarLote,
  excluirLote,
  fetchDadosMl,
  type EnvaseLoteEntrada,
} from "../api/fabricacao";
import { fetchLojas, type Loja } from "../api/lojas";
import type {
  MateriaPrima,
  MateriaPrimaCompra,
  FormulaResumo,
  Formula,
  FormulaEmbalagem,
  FormulaLote,
  FormulaLoteComFormula,
} from "../types/fabricacao";
import { formatCurrency } from "../utils/format";
import { IconPlus, IconTrash, IconClock, IconMoney, IconWrench, IconChevron, IconChimney, IconFlask } from "./icons";

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
  const [aberta, setAberta] = useState(() => localStorage.getItem("fabricacao-materias-primas-aberta") !== "false");

  function alternarAberta() {
    setAberta((atual) => {
      const novo = !atual;
      localStorage.setItem("fabricacao-materias-primas-aberta", String(novo));
      return novo;
    });
  }

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
      <button type="button" className="fabricacao-secao-toggle" onClick={alternarAberta}>
        <IconChevron open={aberta} />
        <IconChimney size={17} />
        <h2>Matérias-primas</h2>
        <span className="financeiro-td-mudo">({materiasPrimas.length})</span>
      </button>

      {aberta && (
        <>
          <p className="painel-sub">
            Cadastro único, reaproveitado em quantas fórmulas precisar — mudar o custo aqui atualiza todas as
            fórmulas que usam essa matéria-prima. Registre as compras reais (valor pago + frete) pra manter o
            custo/kg em dia.
          </p>
          {erro && <div className="state-message state-error">{erro}</div>}
          <div className="financeiro-busca">
            <input
              className="clonar-input"
              placeholder="Nome da matéria-prima"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
            />
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
        </>
      )}
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

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editData, setEditData] = useState("");
  const [editQuantidadeKg, setEditQuantidadeKg] = useState("");
  const [editValorPago, setEditValorPago] = useState("");
  const [editValorFrete, setEditValorFrete] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

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

  function iniciarEdicao(compra: MateriaPrimaCompra) {
    setEditandoId(compra.id);
    setEditData(compra.data);
    setEditQuantidadeKg(String(compra.quantidadeKg));
    setEditValorPago(String(compra.valorPago));
    setEditValorFrete(String(compra.valorFrete));
    setErro(null);
  }

  async function salvarEdicao(compraId: number) {
    const quantidade = Number(editQuantidadeKg.replace(",", "."));
    const pago = Number(editValorPago.replace(",", "."));
    const frete = Number(editValorFrete.replace(",", ".")) || 0;
    if (!editData || !Number.isFinite(quantidade) || quantidade <= 0 || !Number.isFinite(pago) || pago < 0) {
      setErro("Preencha data, quantidade e valor pago corretamente.");
      return;
    }
    setSalvandoEdicao(true);
    setErro(null);
    try {
      await atualizarCompraMateriaPrima(materiaPrima.id, compraId, editData, quantidade, pago, frete);
      setEditandoId(null);
      carregar();
      onCustoAtualizado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar compra.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function excluir(compraId: number) {
    try {
      await excluirCompraMateriaPrima(materiaPrima.id, compraId);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir compra.");
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) =>
              editandoId === c.id ? (
                <tr key={c.id}>
                  <td>
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      type="date"
                      value={editData}
                      onChange={(e) => setEditData(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editQuantidadeKg}
                      onChange={(e) => setEditQuantidadeKg(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editValorPago}
                      onChange={(e) => setEditValorPago(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editValorFrete}
                      onChange={(e) => setEditValorFrete(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td>
                    <button type="button" className="btn-responder" disabled={salvandoEdicao} onClick={() => salvarEdicao(c.id)}>
                      {salvandoEdicao ? "..." : "Salvar"}
                    </button>
                    <button type="button" className="btn-excluir" onClick={() => setEditandoId(null)}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td>{c.data}</td>
                  <td className="financeiro-th-numero">{c.quantidadeKg}kg</td>
                  <td className="financeiro-th-numero">{formatCurrency(c.valorPago)}</td>
                  <td className="financeiro-th-numero">{formatCurrency(c.valorFrete)}</td>
                  <td className="financeiro-th-numero">{formatCurrency(c.custoPorKg)}</td>
                  <td>
                    <button type="button" className="btn-excluir" onClick={() => iniciarEdicao(c)} title="Editar">
                      <IconWrench size={14} />
                    </button>
                    <button type="button" className="btn-excluir" onClick={() => excluir(c.id)} title="Excluir">
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

// Linha de input "nome do envase: [quantidade]" reaproveitada tanto pra
// lançar um lote novo quanto pra editar um já existente.
function QuantidadesEnvaseInputs({
  embalagens,
  quantidades,
  onMudar,
}: {
  embalagens: FormulaEmbalagem[];
  quantidades: Record<number, string>;
  onMudar: (embalagemId: number, valor: string) => void;
}) {
  const pesoTotal = embalagens.reduce((soma, e) => soma + (Number(quantidades[e.id]?.replace(",", ".")) || 0) * e.pesoKg, 0);
  return (
    <div className="fabricacao-lote-quantidades">
      {embalagens.map((e) => (
        <label key={e.id} className="fabricacao-campo-label">
          {e.nome} (unid.)
          <input
            className="clonar-input fabricacao-input-pequeno"
            placeholder="0"
            value={quantidades[e.id] ?? ""}
            onChange={(ev) => onMudar(e.id, ev.target.value)}
          />
        </label>
      ))}
      <span className="financeiro-td-mudo">Peso real total: {pesoTotal.toFixed(2)}kg</span>
    </div>
  );
}

function envasesEntradaDeQuantidades(embalagens: FormulaEmbalagem[], quantidades: Record<number, string>): EnvaseLoteEntrada[] {
  return embalagens
    .map((e) => ({ nome: e.nome, pesoKg: e.pesoKg, custoEmbalagem: e.custoEmbalagem, quantidade: Math.trunc(Number(quantidades[e.id]?.replace(",", ".")) || 0) }))
    .filter((e) => e.quantidade > 0);
}

function LotesSecao({ formula }: { formula: Formula }) {
  const [lotes, setLotes] = useState<FormulaLote[] | null>(null);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [horaInicio, setHoraInicio] = useState("");
  const [horaTermino, setHoraTermino] = useState("");
  const [pesoPrevisto, setPesoPrevisto] = useState(() => String(formula.pesoLoteKg));
  const [pesoReal, setPesoReal] = useState("");
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editData, setEditData] = useState("");
  const [editHoraInicio, setEditHoraInicio] = useState("");
  const [editHoraTermino, setEditHoraTermino] = useState("");
  const [editPesoPrevisto, setEditPesoPrevisto] = useState("");
  const [editPesoReal, setEditPesoReal] = useState("");
  const [editQuantidades, setEditQuantidades] = useState<Record<number, string>>({});
  const [editObservacao, setEditObservacao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregar = useCallback(() => {
    fetchLotes(formula.id).then(setLotes).catch(() => setLotes([]));
  }, [formula.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function registrar() {
    const previsto = Number(pesoPrevisto.replace(",", "."));
    const real = Number(pesoReal.replace(",", "."));
    if (!data || !Number.isFinite(previsto) || previsto <= 0 || !Number.isFinite(real) || real <= 0) {
      setErro("Informe a data, o peso previsto e o peso real.");
      return;
    }
    const envases = envasesEntradaDeQuantidades(formula.embalagens, quantidades);
    setSalvando(true);
    setErro(null);
    try {
      await registrarLote(formula.id, data, horaInicio || null, horaTermino || null, previsto, real, envases, observacao.trim() || null);
      setPesoPrevisto(String(formula.pesoLoteKg));
      setPesoReal("");
      setQuantidades({});
      setHoraInicio("");
      setHoraTermino("");
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
    setEditHoraInicio(lote.horaInicio ?? "");
    setEditHoraTermino(lote.horaTermino ?? "");
    setEditPesoPrevisto(String(lote.pesoPrevistoKg));
    setEditPesoReal(String(lote.pesoRealKg));
    const preenchidas: Record<number, string> = {};
    for (const e of formula.embalagens) {
      const existente = lote.envases.find((le) => le.nome === e.nome);
      if (existente) preenchidas[e.id] = String(existente.quantidade);
    }
    setEditQuantidades(preenchidas);
    setEditObservacao(lote.observacao ?? "");
    setErro(null);
  }

  async function salvarEdicao(loteId: number) {
    const previsto = Number(editPesoPrevisto.replace(",", "."));
    const real = Number(editPesoReal.replace(",", "."));
    if (!editData || !Number.isFinite(previsto) || previsto <= 0 || !Number.isFinite(real) || real <= 0) {
      setErro("Informe a data, o peso previsto e o peso real.");
      return;
    }
    const envases = envasesEntradaDeQuantidades(formula.embalagens, editQuantidades);
    setSalvandoEdicao(true);
    setErro(null);
    try {
      await atualizarLote(
        formula.id,
        loteId,
        editData,
        editHoraInicio || null,
        editHoraTermino || null,
        previsto,
        real,
        envases,
        editObservacao.trim() || null
      );
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
        Previsto e real são digitados direto (dá pra editar os dois a qualquer momento). O detalhamento por
        tamanho de envase é opcional, só pra ratear as sobras — não precisa fechar exatamente com o peso real.
      </p>
      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="financeiro-busca">
        <input className="clonar-input fabricacao-input-pequeno" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <input
          className="clonar-input fabricacao-input-pequeno"
          type="time"
          value={horaInicio}
          onChange={(e) => setHoraInicio(e.target.value)}
          title="Início"
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          type="time"
          value={horaTermino}
          onChange={(e) => setHoraTermino(e.target.value)}
          title="Término"
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Previsto (kg)"
          value={pesoPrevisto}
          onChange={(e) => setPesoPrevisto(e.target.value)}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Real (kg)"
          value={pesoReal}
          onChange={(e) => setPesoReal(e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="Observação (opcional)"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>
      {formula.embalagens.length > 0 && (
        <QuantidadesEnvaseInputs
          embalagens={formula.embalagens}
          quantidades={quantidades}
          onMudar={(id, valor) => setQuantidades((atual) => ({ ...atual, [id]: valor }))}
        />
      )}
      <button type="button" className="btn-responder" disabled={salvando} onClick={registrar}>
        <IconPlus size={15} /> {salvando ? "..." : "Registrar lote"}
      </button>

      {lotes === null && <div className="state-message">Carregando lotes...</div>}
      {lotes?.length === 0 && <div className="state-message">Nenhum lote registrado ainda.</div>}
      {lotes && lotes.length > 0 && (
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Início</th>
              <th>Término</th>
              <th className="financeiro-th-numero">Previsto</th>
              <th className="financeiro-th-numero">Real</th>
              <th className="financeiro-th-numero">Diferença</th>
              <th className="financeiro-th-numero">Valor</th>
              <th className="financeiro-th-numero">Custo real/kg</th>
              <th className="financeiro-th-numero">Envase (custo diluído)</th>
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
                  <td>
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      type="time"
                      value={editHoraInicio}
                      onChange={(e) => setEditHoraInicio(e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      type="time"
                      value={editHoraTermino}
                      onChange={(e) => setEditHoraTermino(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editPesoPrevisto}
                      onChange={(e) => setEditPesoPrevisto(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero">
                    <input
                      className="clonar-input fabricacao-input-pequeno"
                      value={editPesoReal}
                      onChange={(e) => setEditPesoReal(e.target.value)}
                    />
                  </td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                  <td colSpan={2}>
                    {formula.embalagens.length > 0 && (
                      <QuantidadesEnvaseInputs
                        embalagens={formula.embalagens}
                        quantidades={editQuantidades}
                        onMudar={(id, valor) => setEditQuantidades((atual) => ({ ...atual, [id]: valor }))}
                      />
                    )}
                    <input
                      className="clonar-input"
                      placeholder="Observação"
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
                  <td className="financeiro-td-mudo">{l.horaInicio ?? "—"}</td>
                  <td className="financeiro-td-mudo">{l.horaTermino ?? "—"}</td>
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
                  <td className="financeiro-th-numero">{formatCurrency(l.custoRealPorKg)}</td>
                  <td className="financeiro-th-numero">
                    {l.envases.length === 0 ? (
                      <span className="financeiro-td-mudo">—</span>
                    ) : (
                      l.envases.map((e) => (
                        <div key={e.id} className="fabricacao-lote-preco-linha">
                          {e.quantidade}× {e.nome}: {formatCurrency(e.custoDiluido)}/un
                        </div>
                      ))
                    )}
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
      <button type="button" className="clonar-voltar-topo" onClick={onCancelar}>
        ← Voltar
      </button>

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

function HistoricoLotesGlobalSecao({ formulas }: { formulas: FormulaResumo[] }) {
  const [aberta, setAberta] = useState(() => localStorage.getItem("fabricacao-historico-lotes-aberta") === "true");
  const [lotes, setLotes] = useState<FormulaLoteComFormula[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editData, setEditData] = useState("");
  const [editHoraInicio, setEditHoraInicio] = useState("");
  const [editHoraTermino, setEditHoraTermino] = useState("");
  const [editPesoPrevisto, setEditPesoPrevisto] = useState("");
  const [editPesoReal, setEditPesoReal] = useState("");
  const [editFormulaEmbalagens, setEditFormulaEmbalagens] = useState<FormulaEmbalagem[] | null>(null);
  const [editQuantidades, setEditQuantidades] = useState<Record<number, string>>({});
  const [editObservacao, setEditObservacao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [novaFormulaId, setNovaFormulaId] = useState<number | null>(null);
  const [novaFormulaEmbalagens, setNovaFormulaEmbalagens] = useState<FormulaEmbalagem[] | null>(null);
  const [novaData, setNovaData] = useState(() => new Date().toISOString().slice(0, 10));
  const [novaHoraInicio, setNovaHoraInicio] = useState("");
  const [novaHoraTermino, setNovaHoraTermino] = useState("");
  const [novoPesoPrevisto, setNovoPesoPrevisto] = useState("");
  const [novoPesoReal, setNovoPesoReal] = useState("");
  const [novasQuantidades, setNovasQuantidades] = useState<Record<number, string>>({});
  const [novaObservacao, setNovaObservacao] = useState("");
  const [salvandoNovo, setSalvandoNovo] = useState(false);

  const carregar = useCallback(() => {
    fetchTodosLotes().then(setLotes).catch(() => setLotes([]));
  }, []);

  useEffect(() => {
    if (aberta && lotes === null) carregar();
  }, [aberta, lotes, carregar]);

  useEffect(() => {
    if (!mostrandoForm || novaFormulaId === null) return;
    setNovaFormulaEmbalagens(null);
    setNovasQuantidades({});
    const formulaResumo = formulas.find((f) => f.id === novaFormulaId);
    setNovoPesoPrevisto(formulaResumo ? String(formulaResumo.pesoLoteKg) : "");
    fetchFormula(novaFormulaId)
      .then((f) => setNovaFormulaEmbalagens(f.embalagens))
      .catch(() => setNovaFormulaEmbalagens([]));
  }, [mostrandoForm, novaFormulaId, formulas]);

  function alternarAberta() {
    setAberta((atual) => {
      const novo = !atual;
      localStorage.setItem("fabricacao-historico-lotes-aberta", String(novo));
      if (novo && lotes === null) carregar();
      return novo;
    });
  }

  function abrirFormularioNovo() {
    setMostrandoForm(true);
    setNovaFormulaId(formulas[0]?.id ?? null);
    setNovaData(new Date().toISOString().slice(0, 10));
    setNovaHoraInicio("");
    setNovaHoraTermino("");
    setNovoPesoReal("");
    setNovaObservacao("");
    setErro(null);
    if (lotes === null) carregar();
  }

  async function lancarLote() {
    const previsto = Number(novoPesoPrevisto.replace(",", "."));
    const real = Number(novoPesoReal.replace(",", "."));
    if (!novaFormulaId || !novaData || !Number.isFinite(previsto) || previsto <= 0 || !Number.isFinite(real) || real <= 0) {
      setErro("Escolha a fórmula e informe data, previsto e real.");
      return;
    }
    const envases = envasesEntradaDeQuantidades(novaFormulaEmbalagens ?? [], novasQuantidades);
    setSalvandoNovo(true);
    setErro(null);
    try {
      await registrarLote(
        novaFormulaId,
        novaData,
        novaHoraInicio || null,
        novaHoraTermino || null,
        previsto,
        real,
        envases,
        novaObservacao.trim() || null
      );
      setMostrandoForm(false);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao lançar lote.");
    } finally {
      setSalvandoNovo(false);
    }
  }

  async function iniciarEdicao(lote: FormulaLoteComFormula) {
    setEditandoId(lote.id);
    setEditData(lote.data);
    setEditHoraInicio(lote.horaInicio ?? "");
    setEditHoraTermino(lote.horaTermino ?? "");
    setEditPesoPrevisto(String(lote.pesoPrevistoKg));
    setEditPesoReal(String(lote.pesoRealKg));
    setEditObservacao(lote.observacao ?? "");
    setEditFormulaEmbalagens(null);
    setEditQuantidades({});
    setErro(null);
    try {
      const f = await fetchFormula(lote.formulaId);
      setEditFormulaEmbalagens(f.embalagens);
      const preenchidas: Record<number, string> = {};
      for (const e of f.embalagens) {
        const existente = lote.envases.find((le) => le.nome === e.nome);
        if (existente) preenchidas[e.id] = String(existente.quantidade);
      }
      setEditQuantidades(preenchidas);
    } catch {
      setEditFormulaEmbalagens([]);
    }
  }

  async function salvarEdicao(lote: FormulaLoteComFormula) {
    const previsto = Number(editPesoPrevisto.replace(",", "."));
    const real = Number(editPesoReal.replace(",", "."));
    if (!editData || !Number.isFinite(previsto) || previsto <= 0 || !Number.isFinite(real) || real <= 0) {
      setErro("Informe data, previsto e real.");
      return;
    }
    const envases = envasesEntradaDeQuantidades(editFormulaEmbalagens ?? [], editQuantidades);
    setSalvandoEdicao(true);
    setErro(null);
    try {
      await atualizarLote(
        lote.formulaId,
        lote.id,
        editData,
        editHoraInicio || null,
        editHoraTermino || null,
        previsto,
        real,
        envases,
        editObservacao.trim() || null
      );
      setEditandoId(null);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao atualizar lote.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function excluir(lote: FormulaLoteComFormula) {
    try {
      await excluirLote(lote.formulaId, lote.id);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir lote.");
    }
  }

  return (
    <div className="fabricacao-secao">
      <div className="fabricacao-secao-titulo-acao">
        <button type="button" className="fabricacao-secao-toggle" onClick={alternarAberta}>
          <IconChevron open={aberta} />
          <IconClock size={16} />
          <h2>Histórico de lotes</h2>
          {lotes !== null && <span className="financeiro-td-mudo">({lotes.length})</span>}
        </button>
        <button
          type="button"
          className="btn-responder"
          disabled={formulas.length === 0}
          title={formulas.length === 0 ? "Cadastre ao menos uma fórmula primeiro" : undefined}
          onClick={abrirFormularioNovo}
        >
          <IconPlus size={15} /> Lançar lote
        </button>
      </div>

      {(aberta || mostrandoForm) && (
        <>
          <p className="painel-sub">Todos os lotes de produção de todas as fórmulas juntos, do mais recente pro mais antigo.</p>
          {erro && <div className="state-message state-error">{erro}</div>}

          {mostrandoForm && (
            <>
              <div className="financeiro-busca">
                <select
                  className="dashboard-select"
                  value={novaFormulaId ?? ""}
                  onChange={(e) => setNovaFormulaId(Number(e.target.value))}
                >
                  {formulas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
                <input
                  className="clonar-input fabricacao-input-pequeno"
                  type="date"
                  value={novaData}
                  onChange={(e) => setNovaData(e.target.value)}
                />
                <input
                  className="clonar-input fabricacao-input-pequeno"
                  type="time"
                  value={novaHoraInicio}
                  onChange={(e) => setNovaHoraInicio(e.target.value)}
                  title="Início"
                />
                <input
                  className="clonar-input fabricacao-input-pequeno"
                  type="time"
                  value={novaHoraTermino}
                  onChange={(e) => setNovaHoraTermino(e.target.value)}
                  title="Término"
                />
                <input
                  className="clonar-input fabricacao-input-pequeno"
                  placeholder="Previsto (kg)"
                  value={novoPesoPrevisto}
                  onChange={(e) => setNovoPesoPrevisto(e.target.value)}
                />
                <input
                  className="clonar-input fabricacao-input-pequeno"
                  placeholder="Real (kg)"
                  value={novoPesoReal}
                  onChange={(e) => setNovoPesoReal(e.target.value)}
                />
                <input
                  className="clonar-input"
                  placeholder="Observação (opcional)"
                  value={novaObservacao}
                  onChange={(e) => setNovaObservacao(e.target.value)}
                />
              </div>
              {novaFormulaEmbalagens === null ? (
                <div className="state-message">Carregando tamanhos de envase...</div>
              ) : novaFormulaEmbalagens.length === 0 ? (
                <div className="state-message">Essa fórmula não tem nenhum tamanho de envase cadastrado ainda.</div>
              ) : (
                <QuantidadesEnvaseInputs
                  embalagens={novaFormulaEmbalagens}
                  quantidades={novasQuantidades}
                  onMudar={(id, valor) => setNovasQuantidades((atual) => ({ ...atual, [id]: valor }))}
                />
              )}
              <div className="fabricacao-editor-acoes">
                <button type="button" className="btn-responder" disabled={salvandoNovo} onClick={lancarLote}>
                  {salvandoNovo ? "..." : "Salvar"}
                </button>
                <button type="button" className="btn-excluir" onClick={() => setMostrandoForm(false)}>
                  Cancelar
                </button>
              </div>
            </>
          )}

          {lotes === null && <div className="state-message">Carregando...</div>}
          {lotes?.length === 0 && <div className="state-message">Nenhum lote registrado ainda.</div>}
          {lotes && lotes.length > 0 && (
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>Fórmula</th>
                  <th>Data</th>
                  <th>Início</th>
                  <th>Término</th>
                  <th className="financeiro-th-numero">Previsto</th>
                  <th className="financeiro-th-numero">Real</th>
                  <th className="financeiro-th-numero">Diferença</th>
                  <th className="financeiro-th-numero">Valor</th>
                  <th className="financeiro-th-numero">Custo real/kg</th>
                  <th className="financeiro-th-numero">Envase (custo diluído)</th>
                  <th>Observação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) =>
                  editandoId === l.id ? (
                    <tr key={l.id}>
                      <td className="financeiro-td-mudo">{l.formulaNome}</td>
                      <td>
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          type="date"
                          value={editData}
                          onChange={(e) => setEditData(e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          type="time"
                          value={editHoraInicio}
                          onChange={(e) => setEditHoraInicio(e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          type="time"
                          value={editHoraTermino}
                          onChange={(e) => setEditHoraTermino(e.target.value)}
                        />
                      </td>
                      <td className="financeiro-th-numero">
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          value={editPesoPrevisto}
                          onChange={(e) => setEditPesoPrevisto(e.target.value)}
                        />
                      </td>
                      <td className="financeiro-th-numero">
                        <input
                          className="clonar-input fabricacao-input-pequeno"
                          value={editPesoReal}
                          onChange={(e) => setEditPesoReal(e.target.value)}
                        />
                      </td>
                      <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                      <td className="financeiro-th-numero financeiro-td-mudo">—</td>
                      <td colSpan={2}>
                        {editFormulaEmbalagens === null ? (
                          <span className="financeiro-td-mudo">Carregando...</span>
                        ) : (
                          <QuantidadesEnvaseInputs
                            embalagens={editFormulaEmbalagens}
                            quantidades={editQuantidades}
                            onMudar={(id, valor) => setEditQuantidades((atual) => ({ ...atual, [id]: valor }))}
                          />
                        )}
                        <input
                          className="clonar-input"
                          placeholder="Observação"
                          value={editObservacao}
                          onChange={(e) => setEditObservacao(e.target.value)}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn-responder" disabled={salvandoEdicao} onClick={() => salvarEdicao(l)}>
                          {salvandoEdicao ? "..." : "Salvar"}
                        </button>
                        <button type="button" className="btn-excluir" onClick={() => setEditandoId(null)}>
                          Cancelar
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={l.id}>
                      <td>{l.formulaNome}</td>
                      <td>{l.data}</td>
                      <td className="financeiro-td-mudo">{l.horaInicio ?? "—"}</td>
                      <td className="financeiro-td-mudo">{l.horaTermino ?? "—"}</td>
                      <td className="financeiro-th-numero">{l.pesoPrevistoKg}kg</td>
                      <td className="financeiro-th-numero">{l.pesoRealKg}kg</td>
                      <td className={`financeiro-th-numero ${l.diferencaKg >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
                        {l.diferencaKg >= 0 ? "+" : ""}
                        {l.diferencaKg.toFixed(2)}kg
                        {l.diferencaPercentual !== null && ` (${l.diferencaPercentual >= 0 ? "+" : ""}${l.diferencaPercentual.toFixed(1)}%)`}
                      </td>
                      <td className={`financeiro-th-numero ${l.diferencaKg >= 0 ? "financeiro-margem-positiva" : "financeiro-margem-negativa"}`}>
                        {l.diferencaKg >= 0 ? "+" : ""}
                        {(() => {
                          const formula = formulas.find((f) => f.id === l.formulaId);
                          return formatCurrency(l.diferencaKg * (formula?.custoPorKg ?? 0));
                        })()}
                      </td>
                      <td className="financeiro-th-numero">{formatCurrency(l.custoRealPorKg)}</td>
                      <td className="financeiro-th-numero">
                        {l.envases.length === 0 ? (
                          <span className="financeiro-td-mudo">—</span>
                        ) : (
                          l.envases.map((e) => (
                            <div key={e.id} className="fabricacao-lote-preco-linha">
                              {e.quantidade}× {e.nome}: {formatCurrency(e.custoDiluido)}/un
                            </div>
                          ))
                        )}
                      </td>
                      <td className="financeiro-td-mudo">{l.observacao ?? "—"}</td>
                      <td>
                        <button type="button" className="btn-excluir" onClick={() => iniciarEdicao(l)} title="Editar">
                          <IconWrench size={14} />
                        </button>
                        <button type="button" className="btn-excluir" onClick={() => excluir(l)} title="Excluir">
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

const FORMULA_VAZIA: Formula = {
  id: 0,
  nome: "",
  pesoLoteKg: 1,
  custoPorKg: 0,
  custoFabricacaoTotal: 0,
  subFormulaIds: [],
  itens: [],
  embalagens: [],
};

export function Fabricacao() {
  const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrima[]>([]);
  const [formulas, setFormulas] = useState<FormulaResumo[] | null>(null);
  const [formulaAberta, setFormulaAberta] = useState<Formula | null>(null);
  const [carregandoFormula, setCarregandoFormula] = useState(false);
  const [formulasAberta, setFormulasAberta] = useState(() => localStorage.getItem("fabricacao-formulas-aberta") !== "false");

  function alternarFormulasAberta() {
    setFormulasAberta((atual) => {
      const novo = !atual;
      localStorage.setItem("fabricacao-formulas-aberta", String(novo));
      return novo;
    });
  }

  const [basesExpandidas, setBasesExpandidas] = useState<Set<number>>(new Set());
  function alternarBaseExpandida(id: number) {
    setBasesExpandidas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  // Fórmulas que dependem de outra (ex.: uma cor que usa uma Base) não
  // aparecem soltas na lista — ficam agrupadas dentro da fórmula-base
  // delas, que vira expansível. Fórmula sem dependência nenhuma (seja
  // porque é uma Base, seja porque é solta mesmo) fica no topo.
  const filhosPorBase = useMemo(() => {
    const mapa = new Map<number, FormulaResumo[]>();
    for (const f of formulas ?? []) {
      for (const baseId of f.subFormulaIds) {
        if (!mapa.has(baseId)) mapa.set(baseId, []);
        mapa.get(baseId)!.push(f);
      }
    }
    return mapa;
  }, [formulas]);

  const formulasTopo = useMemo(() => (formulas ?? []).filter((f) => f.subFormulaIds.length === 0), [formulas]);

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
          <button type="button" className="fabricacao-secao-toggle" onClick={alternarFormulasAberta}>
            <IconChevron open={formulasAberta} />
            <IconFlask size={16} />
            <h2>Fórmulas Emborrachadas</h2>
            <span className="financeiro-td-mudo">({formulas?.length ?? 0})</span>
          </button>
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

        {(formulasAberta || formulaAberta) && (
          <>
            {formulas === null && <div className="state-message">Carregando...</div>}
            {formulas?.length === 0 && !formulaAberta && (
              <div className="state-message">Nenhuma fórmula cadastrada ainda.</div>
            )}
            {carregandoFormula && <div className="state-message">Carregando fórmula...</div>}

            {!formulaAberta &&
              formulasTopo.map((f) => {
                const filhos = filhosPorBase.get(f.id) ?? [];
                const temFilhos = filhos.length > 0;
                const expandida = basesExpandidas.has(f.id);
                return (
                  <div key={f.id}>
                    <div className="fabricacao-formula-linha">
                      {temFilhos && (
                        <button
                          type="button"
                          className="fabricacao-formula-expandir"
                          onClick={() => alternarBaseExpandida(f.id)}
                          title={expandida ? "Recolher cores" : `Mostrar ${filhos.length} cor(es)`}
                        >
                          <IconChevron open={expandida} />
                        </button>
                      )}
                      <button type="button" className="fabricacao-formula-card" onClick={() => abrirFormula(f.id)}>
                        <span className="fabricacao-formula-nome">
                          {f.nome}
                          {temFilhos && <span className="financeiro-td-mudo"> ({filhos.length})</span>}
                        </span>
                        <span className="financeiro-td-mudo">{f.pesoLoteKg}kg por lote</span>
                        <span className="fabricacao-formula-custo">{formatCurrency(f.custoFabricacaoTotal)}</span>
                      </button>
                    </div>
                    {temFilhos && expandida && (
                      <div className="fabricacao-formula-filhos">
                        {filhos.map((filho) => (
                          <button
                            key={filho.id}
                            type="button"
                            className="fabricacao-formula-card fabricacao-formula-card-filho"
                            onClick={() => abrirFormula(filho.id)}
                          >
                            <span className="fabricacao-formula-nome">{filho.nome}</span>
                            <span className="financeiro-td-mudo">{filho.pesoLoteKg}kg por lote</span>
                            <span className="fabricacao-formula-custo">{formatCurrency(filho.custoFabricacaoTotal)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

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
          </>
        )}
      </div>

      <HistoricoLotesGlobalSecao formulas={formulas ?? []} />
    </div>
  );
}
