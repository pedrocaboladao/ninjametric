import { useCallback, useEffect, useState } from "react";
import {
  fetchLancamentos,
  fetchResumoContas,
  criarLancamento,
  criarLancamentoParcelado,
  criarLancamentoRateado,
  atualizarLancamento,
  marcarComoPago,
  excluirLancamento,
  fetchContatos,
  criarContato,
  excluirContato,
  fetchGastoPorCategoria,
  fetchRankingLojasContas,
} from "../api/contas";
import { fetchLojas, type Loja } from "../api/lojas";
import type {
  Lancamento,
  ResumoContas,
  TipoLancamento,
  StatusLancamento,
  Contato,
  TipoContato,
  GastoCategoria,
  RankingLojaContas,
} from "../types/contas";
import type { Usuario } from "../types/usuarios";
import { IconPlus } from "./icons";
import { formatCurrency, corDaLoja } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

const CORES_CATEGORIA = ["#f87171", "#38bdf8", "#facc15", "#4ade80", "#a78bfa", "#f472b6", "#94a3b8"];

function DonutCategoria({ dados }: { dados: GastoCategoria[] }) {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (total <= 0) return null;
  let acumulado = 0;
  const stops = dados.map((d, i) => {
    const inicio = (acumulado / total) * 360;
    acumulado += d.valor;
    const fim = (acumulado / total) * 360;
    return `${CORES_CATEGORIA[i % CORES_CATEGORIA.length]} ${inicio}deg ${fim}deg`;
  });
  return (
    <div className="financeiro-donut-card">
      <span className="financeiro-stat-label">Gasto por categoria</span>
      <div className="financeiro-donut-corpo">
        <div className="financeiro-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
          <div className="financeiro-donut-furo" />
        </div>
        <div className="financeiro-donut-legenda">
          {dados.map((d, i) => (
            <div key={d.categoria} className="financeiro-donut-item">
              <i className="financeiro-donut-dot" style={{ background: CORES_CATEGORIA[i % CORES_CATEGORIA.length] }} />
              <span>{d.categoria}</span>
              <b>{formatCurrency(d.valor)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RankingLojasContas({ dados }: { dados: RankingLojaContas[] }) {
  if (dados.length === 0) return null;
  const maior = Math.max(...dados.map((d) => d.emAbertoPagar), 1);
  return (
    <div className="financeiro-donut-card">
      <span className="financeiro-stat-label">Em aberto por loja (a pagar)</span>
      {dados.map((d) => (
        <div key={d.lojaId} className="contas-ranking-item">
          <span className="contas-ranking-nome">{d.lojaNome}</span>
          <div className="contas-ranking-barra-wrap">
            <div
              className="contas-ranking-barra"
              style={{ width: `${(d.emAbertoPagar / maior) * 100}%`, background: corDaLoja(d.lojaId) }}
            />
          </div>
          <span className="contas-ranking-valor">{formatCurrency(d.emAbertoPagar)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  usuario: Usuario;
}

const CATEGORIAS_SUGERIDAS = ["Fornecedor", "Aluguel", "Salário", "Imposto", "Frete", "Outros"];

function dataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hojeISO(): string {
  return dataISO(new Date());
}

function formatDataCurta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

function classeStatus(l: Lancamento): string {
  if (l.status === "cancelado") return "financeiro-margem-neutra";
  if (l.status === "pago") return "financeiro-margem-positiva";
  if (l.atrasado) return "financeiro-margem-negativa";
  return "financeiro-margem-alerta";
}

function labelStatus(l: Lancamento): string {
  if (l.status === "pago") return "Pago";
  if (l.status === "cancelado") return "Cancelado";
  return l.atrasado ? "Atrasado" : "Pendente";
}

type ModoLancamento = "unico" | "parcelado" | "rateado";

interface FormState {
  lojaId: number | null;
  lojaIdsRateio: number[];
  tipo: TipoLancamento;
  descricao: string;
  categoria: string;
  contatoId: number | null;
  valor: string;
  vencimento: string;
  observacao: string;
  modo: ModoLancamento;
  quantidadeParcelas: string;
}

function formVazio(lojaPadrao: number | null): FormState {
  return {
    lojaId: lojaPadrao,
    lojaIdsRateio: [],
    tipo: "pagar",
    descricao: "",
    categoria: "",
    contatoId: null,
    valor: "",
    vencimento: hojeISO(),
    observacao: "",
    modo: "unico",
    quantidadeParcelas: "2",
  };
}

function GerenciarContatos({ onFechar, onAtualizado }: { onFechar: () => void; onAtualizado: () => void }) {
  const [tipo, setTipo] = useState<TipoContato>("fornecedor");
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novoDocumento, setNovoDocumento] = useState("");
  const [novoDadosBancarios, setNovoDadosBancarios] = useState("");
  const [novoContato, setNovoContato] = useState("");
  const [criando, setCriando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  const carregar = useCallback(() => {
    fetchContatos(tipo)
      .then(setContatos)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar."));
  }, [tipo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar() {
    if (!novoNome.trim()) {
      setErro("Informe o nome.");
      return;
    }
    setCriando(true);
    setErro(null);
    try {
      await criarContato({
        tipo,
        nome: novoNome.trim(),
        documento: novoDocumento.trim() || null,
        dadosBancarios: novoDadosBancarios.trim() || null,
        contato: novoContato.trim() || null,
      });
      setNovoNome("");
      setNovoDocumento("");
      setNovoDadosBancarios("");
      setNovoContato("");
      carregar();
      onAtualizado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar.");
    } finally {
      setCriando(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esse contato? Lançamentos já vinculados a ele continuam, só perdem o vínculo.")) return;
    setExcluindoId(id);
    setErro(null);
    try {
      await excluirContato(id);
      carregar();
      onAtualizado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="financeiro-impostos">
      <div className="financeiro-impostos-header">
        <span>Fornecedores e clientes</span>
        <button type="button" className="btn-excluir" onClick={onFechar}>
          Fechar
        </button>
      </div>
      <div className="precificacao-abas">
        <button
          type="button"
          className={`precificacao-aba ${tipo === "fornecedor" ? "precificacao-aba-ativa" : ""}`}
          onClick={() => setTipo("fornecedor")}
        >
          Fornecedores
        </button>
        <button
          type="button"
          className={`precificacao-aba ${tipo === "cliente" ? "precificacao-aba-ativa" : ""}`}
          onClick={() => setTipo("cliente")}
        >
          Clientes
        </button>
      </div>
      {erro && <div className="state-message state-error">{erro}</div>}
      <div className="financeiro-busca">
        <input className="clonar-input" placeholder="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <input
          className="clonar-input"
          placeholder="Documento (CPF/CNPJ)"
          value={novoDocumento}
          onChange={(e) => setNovoDocumento(e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="Contato (telefone/e-mail)"
          value={novoContato}
          onChange={(e) => setNovoContato(e.target.value)}
        />
        <input
          className="clonar-input"
          placeholder="Dados bancários (opcional)"
          value={novoDadosBancarios}
          onChange={(e) => setNovoDadosBancarios(e.target.value)}
        />
        <button type="button" className="btn-responder" disabled={criando} onClick={criar}>
          {criando ? "..." : "Adicionar"}
        </button>
      </div>
      {contatos === null && <div className="state-message">Carregando...</div>}
      {contatos?.map((c) => (
        <div key={c.id} className="financeiro-impostos-linha">
          <span>
            {c.nome}
            {c.documento ? ` · ${c.documento}` : ""}
          </span>
          <button
            type="button"
            className="btn-excluir"
            disabled={excluindoId === c.id}
            onClick={() => excluir(c.id)}
          >
            {excluindoId === c.id ? "..." : "Excluir"}
          </button>
        </div>
      ))}
      {contatos?.length === 0 && (
        <div className="state-message">Nenhum {tipo === "fornecedor" ? "fornecedor" : "cliente"} cadastrado.</div>
      )}
    </div>
  );
}

interface ItemImportacao {
  descricao: string;
  valor: number;
  categoria: string | null;
}

// Aceita colar direto de uma planilha/tabela: "Descrição<TAB>R$ 1.234,56"
// por linha. Se não tiver TAB (ex.: coisas espaçadas manualmente), separa
// pelo último "R$" da linha como fallback.
function parseLinhaImportacao(linha: string): ItemImportacao | null {
  const bruta = linha.trim();
  if (!bruta) return null;

  let partes = bruta
    .split("\t")
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 2) {
    const idx = bruta.lastIndexOf("R$");
    if (idx <= 0) return null;
    partes = [bruta.slice(0, idx).trim(), bruta.slice(idx).trim()];
  }

  const descricao = partes[0];
  const valorTexto = partes[partes.length - 1]
    .replace(/R\$\s?/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const valor = Number(valorTexto);
  if (!descricao || Number.isNaN(valor) || valor <= 0) return null;

  return { descricao, valor, categoria: categoriaSugerida(descricao) };
}

// Só um empurrãozinho pra não precisar categorizar tudo na mão depois —
// continua editável por lançamento a qualquer momento.
function categoriaSugerida(descricao: string): string | null {
  const d = descricao
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  if (d.includes("SALARIO") || d.includes("VALE ") || d.includes("RESCISAO") || d.includes("HONORARIO")) return "Salário";
  if (d.includes("ALUGUEL")) return "Aluguel";
  if (d.includes("IMPOSTO") || d.includes("DARF") || d.includes("INSS") || d.includes("FGTS") || d.includes("PARCELAMENTO"))
    return "Imposto";
  if (d.includes("FRETE") || d.includes("UBER") || d.includes("COMBUSTIVEL")) return "Frete";
  return null;
}

function ImportarListaLancamentos({
  lojas,
  onFechar,
  onImportado,
}: {
  lojas: Loja[];
  onFechar: () => void;
  onImportado: () => void;
}) {
  const [lojaId, setLojaId] = useState<number | null>(lojas[0]?.id ?? null);
  const [tipo, setTipo] = useState<TipoLancamento>("pagar");
  const [vencimento, setVencimento] = useState(hojeISO());
  const [texto, setTexto] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [erros, setErros] = useState<string[]>([]);

  const itens = texto
    .split("\n")
    .map(parseLinhaImportacao)
    .filter((i): i is ItemImportacao => i !== null);
  const totalItens = itens.reduce((s, i) => s + i.valor, 0);

  async function importar() {
    if (lojaId === null || itens.length === 0) return;
    setImportando(true);
    setErros([]);
    setProgresso({ feitos: 0, total: itens.length });

    const falhas: string[] = [];
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      try {
        await criarLancamento({
          lojaId,
          tipo,
          descricao: item.descricao,
          categoria: item.categoria,
          valor: item.valor,
          vencimento,
        });
      } catch (err) {
        falhas.push(`${item.descricao}: ${err instanceof Error ? err.message : "falha desconhecida"}`);
      }
      setProgresso({ feitos: i + 1, total: itens.length });
    }

    setErros(falhas);
    setImportando(false);
    onImportado();
    if (falhas.length === 0) onFechar();
  }

  return (
    <div className="financeiro-impostos">
      <div className="financeiro-impostos-header">
        <span>Importar lista de lançamentos</span>
        <button type="button" className="btn-excluir" onClick={onFechar}>
          Fechar
        </button>
      </div>
      <p className="painel-sub">
        Cole uma lista com "Descrição" e "Valor" por linha (funciona colando direto de uma planilha/tabela) — cada
        linha vira um lançamento.
      </p>
      <div className="financeiro-busca">
        <select
          className="dashboard-select"
          value={lojaId ?? ""}
          onChange={(e) => setLojaId(Number(e.target.value))}
        >
          <option value="" disabled>
            Loja...
          </option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <select className="dashboard-select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoLancamento)}>
          <option value="pagar">A pagar</option>
          <option value="receber">A receber</option>
        </select>
        <input
          type="date"
          className="dashboard-select"
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
        />
      </div>
      <textarea
        className="clonar-input"
        placeholder={"Cole aqui, uma linha por lançamento. Ex:\nAluguel Barracão\tR$ 3.343,22"}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        style={{ width: "100%", marginTop: 8, resize: "vertical", fontFamily: "monospace" }}
      />
      <div className="financeiro-stat-sub" style={{ marginTop: 6 }}>
        {itens.length > 0
          ? `${itens.length} lançamento${itens.length > 1 ? "s" : ""} reconhecido${itens.length > 1 ? "s" : ""} · total ${formatCurrency(totalItens)}`
          : "Nenhum lançamento reconhecido ainda."}
      </div>
      {progresso && (
        <div className="financeiro-stat-sub">
          Importando... {progresso.feitos}/{progresso.total}
        </div>
      )}
      {erros.length > 0 && (
        <div className="state-message state-error">
          {erros.length} falharam: {erros.join("; ")}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn-responder"
          disabled={importando || lojaId === null || itens.length === 0}
          onClick={importar}
        >
          {importando ? "Importando..." : `Importar ${itens.length || ""} lançamento${itens.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

export function Contas({ usuario: _usuario }: Props) {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaFiltro, setLojaFiltro] = useState<number | "todas" | "minhas">("todas");
  const [tipoFiltro, setTipoFiltro] = useState<"" | TipoLancamento>("");
  const [statusFiltro, setStatusFiltro] = useState<"" | StatusLancamento | "atrasado" | "vence_breve">("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(() => formVazio(null));
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [gerenciandoContatos, setGerenciandoContatos] = useState(false);
  const [importandoLista, setImportandoLista] = useState(false);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => {});
  }, []);

  const recarregarContatos = useCallback(() => {
    fetchContatos()
      .then(setContatos)
      .catch(() => {});
  }, []);

  useEffect(() => {
    recarregarContatos();
  }, [recarregarContatos]);

  const contatosDoTipo = contatos.filter((c) => c.tipo === (form.tipo === "pagar" ? "fornecedor" : "cliente"));

  const statusParaApi =
    statusFiltro === "atrasado" || statusFiltro === "vence_breve" ? "pendente" : statusFiltro || undefined;

  const buscarLista = useCallback(
    () =>
      fetchLancamentos({
        lojaFiltro,
        tipo: tipoFiltro || undefined,
        status: statusParaApi,
        dataInicio: dataInicio && dataFim ? dataInicio : undefined,
        dataFim: dataInicio && dataFim ? dataFim : undefined,
      }),
    [lojaFiltro, tipoFiltro, statusParaApi, dataInicio, dataFim]
  );
  const {
    dados: lancamentos,
    erro: erroLista,
    atualizarAgora: recarregarLista,
  } = useBuscaComCancelamento<Lancamento[]>(buscarLista, true);

  const buscarResumo = useCallback(
    () =>
      fetchResumoContas({
        lojaFiltro,
        dataInicio: dataInicio && dataFim ? dataInicio : undefined,
        dataFim: dataInicio && dataFim ? dataFim : undefined,
      }),
    [lojaFiltro, dataInicio, dataFim]
  );
  const { dados: resumo, atualizarAgora: recarregarResumo } = useBuscaComCancelamento<ResumoContas>(buscarResumo, true);

  const buscarCategorias = useCallback(
    () =>
      fetchGastoPorCategoria({
        lojaFiltro,
        tipo: tipoFiltro || undefined,
        status: statusParaApi,
        dataInicio: dataInicio && dataFim ? dataInicio : undefined,
        dataFim: dataInicio && dataFim ? dataFim : undefined,
      }),
    [lojaFiltro, tipoFiltro, statusParaApi, dataInicio, dataFim]
  );
  const { dados: gastoPorCategoria, atualizarAgora: recarregarCategorias } = useBuscaComCancelamento<GastoCategoria[]>(
    buscarCategorias,
    true
  );

  const rankingAtivo = lojaFiltro === "todas" || lojaFiltro === "minhas";
  const buscarRanking = useCallback(() => fetchRankingLojasContas(lojaFiltro), [lojaFiltro]);
  const { dados: rankingLojas, atualizarAgora: recarregarRanking } = useBuscaComCancelamento<RankingLojaContas[]>(
    buscarRanking,
    rankingAtivo
  );

  const listaExibida = (lancamentos ?? []).filter((l) => {
    if (statusFiltro === "atrasado") return l.atrasado;
    if (statusFiltro === "vence_breve") return l.diasParaVencer !== null && l.diasParaVencer <= 5;
    return true;
  });

  function recarregarTudo() {
    recarregarCategorias();
    if (rankingAtivo) recarregarRanking();
    recarregarLista();
    recarregarResumo();
  }

  function abrirNovo() {
    setEditandoId(null);
    setForm(formVazio(lojas[0]?.id ?? null));
    setErroForm(null);
    setFormAberto(true);
  }

  function abrirEdicao(l: Lancamento) {
    setEditandoId(l.id);
    setForm({
      lojaId: l.lojaId,
      lojaIdsRateio: [],
      tipo: l.tipo,
      descricao: l.descricao,
      categoria: l.categoria ?? "",
      contatoId: l.contatoId,
      valor: String(l.valor),
      vencimento: l.vencimento,
      observacao: l.observacao ?? "",
      modo: "unico",
      quantidadeParcelas: "2",
    });
    setErroForm(null);
    setFormAberto(true);
  }

  function fecharForm() {
    setFormAberto(false);
    setEditandoId(null);
    setErroForm(null);
  }

  async function salvar() {
    const valorNum = Number(form.valor.replace(",", "."));
    if (!form.descricao.trim()) {
      setErroForm("Informe a descrição.");
      return;
    }
    if (Number.isNaN(valorNum) || valorNum <= 0) {
      setErroForm("Informe um valor maior que zero.");
      return;
    }
    if (!form.vencimento) {
      setErroForm("Informe a data de vencimento.");
      return;
    }
    let quantidadeParcelas = 0;
    if (form.modo === "parcelado" && editandoId === null) {
      quantidadeParcelas = Number(form.quantidadeParcelas);
      if (!Number.isInteger(quantidadeParcelas) || quantidadeParcelas < 2 || quantidadeParcelas > 60) {
        setErroForm("Informe uma quantidade de parcelas entre 2 e 60.");
        return;
      }
    }
    if (form.modo === "rateado" && editandoId === null && form.lojaIdsRateio.length < 2) {
      setErroForm("Escolha pelo menos 2 lojas pra ratear.");
      return;
    }

    setSalvando(true);
    setErroForm(null);
    try {
      if (editandoId !== null) {
        await atualizarLancamento(editandoId, {
          descricao: form.descricao.trim(),
          categoria: form.categoria.trim() || null,
          valor: valorNum,
          vencimento: form.vencimento,
          observacao: form.observacao.trim() || null,
        });
      } else if (form.modo === "rateado") {
        await criarLancamentoRateado({
          lojaIds: form.lojaIdsRateio,
          tipo: form.tipo,
          descricao: form.descricao.trim(),
          categoria: form.categoria.trim() || null,
          contatoId: form.contatoId,
          valorTotal: valorNum,
          vencimento: form.vencimento,
          observacao: form.observacao.trim() || null,
        });
      } else {
        if (form.lojaId === null) {
          setErroForm("Selecione uma loja.");
          setSalvando(false);
          return;
        }
        if (form.modo === "parcelado") {
          await criarLancamentoParcelado({
            lojaId: form.lojaId,
            tipo: form.tipo,
            descricao: form.descricao.trim(),
            categoria: form.categoria.trim() || null,
            contatoId: form.contatoId,
            valorParcela: valorNum,
            primeiroVencimento: form.vencimento,
            quantidadeParcelas,
            observacao: form.observacao.trim() || null,
          });
        } else {
          await criarLancamento({
            lojaId: form.lojaId,
            tipo: form.tipo,
            descricao: form.descricao.trim(),
            categoria: form.categoria.trim() || null,
            contatoId: form.contatoId,
            valor: valorNum,
            vencimento: form.vencimento,
            observacao: form.observacao.trim() || null,
          });
        }
      }
      fecharForm();
      recarregarTudo();
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : "Falha ao salvar lançamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function marcarPago(id: number) {
    try {
      await marcarComoPago(id);
      recarregarTudo();
    } catch {
      // erro exibido implicitamente pela lista não atualizar; simples o bastante pra não precisar de toast
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esse lançamento? Não tem como desfazer.")) return;
    setExcluindoId(id);
    try {
      await excluirLancamento(id);
      recarregarTudo();
    } catch {
      // idem
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Contas a pagar e receber</span>
          <h1>Lançamentos</h1>
          <p className="painel-sub">
            Despesas e recebimentos que não vêm do Mercado Livre — fornecedor, aluguel, salário, imposto etc.
          </p>
        </div>
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
          <select className="dashboard-select" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as "" | TipoLancamento)}>
            <option value="">Todos os tipos</option>
            <option value="pagar">A pagar</option>
            <option value="receber">A receber</option>
          </select>
          <select
            className="dashboard-select"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as "" | StatusLancamento | "atrasado" | "vence_breve")}
          >
            <option value="">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="vence_breve">Vence em breve</option>
            <option value="atrasado">Atrasado</option>
            <option value="pago">Pago</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <button
            type="button"
            className="painel-estudo-gerenciar-btn"
            onClick={() => setGerenciandoContatos((g) => !g)}
          >
            {gerenciandoContatos ? "Fechar cadastro" : "Fornecedores/Clientes"}
          </button>
          <button
            type="button"
            className="painel-estudo-gerenciar-btn"
            onClick={() => setImportandoLista((g) => !g)}
          >
            {importandoLista ? "Fechar importação" : "Importar lista"}
          </button>
          <button type="button" className="contas-btn-novo" onClick={abrirNovo}>
            <IconPlus size={15} />
            Novo lançamento
          </button>
        </div>
      </div>

      {gerenciandoContatos && (
        <GerenciarContatos onFechar={() => setGerenciandoContatos(false)} onAtualizado={recarregarContatos} />
      )}
      {importandoLista && (
        <ImportarListaLancamentos
          lojas={lojas}
          onFechar={() => setImportandoLista(false)}
          onImportado={recarregarTudo}
        />
      )}

      <div className="financeiro-filtro-datas">
        <input type="date" className="dashboard-select" value={dataInicio} max={dataFim || undefined} onChange={(e) => setDataInicio(e.target.value)} />
        <span>até</span>
        <input type="date" className="dashboard-select" value={dataFim} min={dataInicio || undefined} onChange={(e) => setDataFim(e.target.value)} />
        <span className="financeiro-stat-sub">Filtra o vencimento — deixe em branco pra ver tudo</span>
        {(dataInicio || dataFim) && (
          <button
            type="button"
            className="btn-excluir"
            onClick={() => {
              setDataInicio("");
              setDataFim("");
            }}
          >
            Limpar datas
          </button>
        )}
      </div>

      {formAberto && (
        <div className="financeiro-impostos">
          <div className="financeiro-impostos-header">
            <span>{editandoId !== null ? "Editar lançamento" : "Novo lançamento"}</span>
            <button type="button" className="btn-excluir" onClick={fecharForm}>
              Fechar
            </button>
          </div>
          {erroForm && <div className="state-message state-error">{erroForm}</div>}
          {editandoId === null && (
            <div className="precificacao-abas">
              <button
                type="button"
                className={`precificacao-aba ${form.modo === "unico" ? "precificacao-aba-ativa" : ""}`}
                onClick={() => setForm((f) => ({ ...f, modo: "unico" }))}
              >
                Único
              </button>
              <button
                type="button"
                className={`precificacao-aba ${form.modo === "parcelado" ? "precificacao-aba-ativa" : ""}`}
                onClick={() => setForm((f) => ({ ...f, modo: "parcelado" }))}
              >
                Parcelado
              </button>
              <button
                type="button"
                className={`precificacao-aba ${form.modo === "rateado" ? "precificacao-aba-ativa" : ""}`}
                onClick={() => setForm((f) => ({ ...f, modo: "rateado" }))}
              >
                Rateado entre lojas
              </button>
            </div>
          )}
          {form.modo === "rateado" && editandoId === null ? (
            <div className="financeiro-rateio-lojas">
              {lojas.map((l) => {
                const marcada = form.lojaIdsRateio.includes(l.id);
                return (
                  <label key={l.id} className="financeiro-checkbox-parcelar">
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          lojaIdsRateio: e.target.checked
                            ? [...f.lojaIdsRateio, l.id]
                            : f.lojaIdsRateio.filter((id) => id !== l.id),
                        }))
                      }
                    />
                    {l.nome}
                  </label>
                );
              })}
            </div>
          ) : null}
          <div className="financeiro-busca">
            {form.modo !== "rateado" && (
              <select
                className="dashboard-select"
                value={form.lojaId ?? ""}
                disabled={editandoId !== null}
                onChange={(e) => setForm((f) => ({ ...f, lojaId: Number(e.target.value) }))}
              >
                <option value="" disabled>
                  Loja...
                </option>
                {lojas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </select>
            )}
            <select
              className="dashboard-select"
              value={form.tipo}
              disabled={editandoId !== null}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoLancamento, contatoId: null }))}
            >
              <option value="pagar">A pagar</option>
              <option value="receber">A receber</option>
            </select>
            <select
              className="dashboard-select"
              value={form.contatoId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, contatoId: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">{form.tipo === "pagar" ? "Fornecedor (opcional)" : "Cliente (opcional)"}</option>
              {contatosDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            <input
              className="clonar-input"
              placeholder="Descrição"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <input
              className="clonar-input"
              placeholder="Categoria (opcional)"
              list="contas-categorias-sugeridas"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            />
            <datalist id="contas-categorias-sugeridas">
              {CATEGORIAS_SUGERIDAS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              className="clonar-input"
              inputMode="decimal"
              placeholder={
                form.modo === "parcelado" ? "Valor de cada parcela" : form.modo === "rateado" ? "Valor total" : "Valor"
              }
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
            />
            <input
              type="date"
              className="dashboard-select"
              value={form.vencimento}
              onChange={(e) => setForm((f) => ({ ...f, vencimento: e.target.value }))}
            />
            {form.modo === "parcelado" && (
              <input
                type="number"
                min={2}
                max={60}
                className="clonar-input"
                placeholder="Qtd. parcelas"
                value={form.quantidadeParcelas}
                onChange={(e) => setForm((f) => ({ ...f, quantidadeParcelas: e.target.value }))}
              />
            )}
          </div>
          {form.modo === "parcelado" && editandoId === null && (
            <span className="financeiro-stat-sub">
              O vencimento acima vira o da 1ª parcela; as seguintes vencem 1 mês depois, uma da outra.
            </span>
          )}
          {form.modo === "rateado" && editandoId === null && (
            <span className="financeiro-stat-sub">
              O valor total é dividido em partes iguais entre as lojas marcadas acima.
            </span>
          )}
          <textarea
            className="clonar-input"
            placeholder="Observação (opcional)"
            value={form.observacao}
            onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
            rows={2}
            style={{ width: "100%", marginTop: 8, resize: "vertical" }}
          />
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn-responder" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando..." : editandoId !== null ? "Salvar alterações" : "Criar lançamento"}
            </button>
          </div>
        </div>
      )}

      {resumo && (
        <div className="financeiro-cards-cor">
          <div className="financeiro-card-cor financeiro-card-vermelho">
            <div className="financeiro-card-cor-topo">
              <span>A pagar em aberto</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className="financeiro-card-cor-valor">{formatCurrency(resumo.emAbertoPagar)}</span>
              <div className="financeiro-card-cor-linha">
                <span>Atrasado</span>
                <b>{formatCurrency(resumo.atrasadoPagar)}</b>
              </div>
            </div>
          </div>
          <div className="financeiro-card-cor financeiro-card-azul">
            <div className="financeiro-card-cor-topo">
              <span>A receber em aberto</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className="financeiro-card-cor-valor">{formatCurrency(resumo.emAbertoReceber)}</span>
              <div className="financeiro-card-cor-linha">
                <span>Atrasado</span>
                <b>{formatCurrency(resumo.atrasadoReceber)}</b>
              </div>
            </div>
          </div>
          <div className="financeiro-card-cor financeiro-card-verde">
            <div className="financeiro-card-cor-topo">
              <span>Saldo do período (pago x recebido)</span>
            </div>
            <div className="financeiro-card-cor-corpo">
              <span className={`financeiro-card-cor-valor ${resumo.saldoPeriodo < 0 ? "financeiro-margem-negativa" : ""}`}>
                {formatCurrency(resumo.saldoPeriodo)}
              </span>
              <div className="financeiro-card-cor-linha">
                <span>Pago</span>
                <b>{formatCurrency(resumo.pagoPeriodo)}</b>
              </div>
              <div className="financeiro-card-cor-linha">
                <span>Recebido</span>
                <b>{formatCurrency(resumo.recebidoPeriodo)}</b>
              </div>
            </div>
          </div>
        </div>
      )}

      {((gastoPorCategoria && gastoPorCategoria.length > 0) || (rankingAtivo && rankingLojas && rankingLojas.length > 0)) && (
        <div className="contas-linha-2col">
          {gastoPorCategoria && <DonutCategoria dados={gastoPorCategoria} />}
          {rankingAtivo && rankingLojas && <RankingLojasContas dados={rankingLojas} />}
        </div>
      )}

      {erroLista && <div className="state-message state-error">{erroLista}</div>}
      {!erroLista && lancamentos === null && <div className="state-message">Carregando lançamentos...</div>}

      {lancamentos !== null && listaExibida.length === 0 && (
        <div className="state-message">Nenhum lançamento encontrado com esse filtro.</div>
      )}

      {listaExibida.length > 0 && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>Loja</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Vencimento</th>
                <th className="financeiro-th-numero">Valor</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {listaExibida.map((l) => (
                <tr key={l.id}>
                  <td>{l.lojaNome}</td>
                  <td>{l.tipo === "pagar" ? "A pagar" : "A receber"}</td>
                  <td className="financeiro-td-titulo" title={l.descricao}>
                    {l.descricao}
                    {l.contatoNome && <div className="financeiro-td-mudo financeiro-td-sublinha">{l.contatoNome}</div>}
                  </td>
                  <td className="financeiro-td-mudo">{l.categoria ?? "—"}</td>
                  <td>
                    {formatDataCurta(l.vencimento)}
                    {l.parcelaTotal && (
                      <div className="financeiro-td-mudo financeiro-td-sublinha">
                        Parcela {l.parcelaNumero}/{l.parcelaTotal}
                      </div>
                    )}
                    {l.rateioTotal && (
                      <div className="financeiro-td-mudo financeiro-td-sublinha">Rateado entre {l.rateioTotal} lojas</div>
                    )}
                  </td>
                  <td className="financeiro-th-numero">{formatCurrency(l.valor)}</td>
                  <td className={classeStatus(l)}>
                    {labelStatus(l)}
                    {l.diasParaVencer !== null && l.diasParaVencer <= 5 && (
                      <div className="contas-badge-vence-breve">
                        Vence em {l.diasParaVencer === 0 ? "hoje" : `${l.diasParaVencer}d`}
                      </div>
                    )}
                  </td>
                  <td className="financeiro-acoes">
                    {l.status === "pendente" && (
                      <button type="button" className="btn-responder" onClick={() => marcarPago(l.id)}>
                        Marcar pago
                      </button>
                    )}
                    <button type="button" className="btn-responder" onClick={() => abrirEdicao(l)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn-excluir"
                      disabled={excluindoId === l.id}
                      onClick={() => excluir(l.id)}
                    >
                      {excluindoId === l.id ? "..." : "Excluir"}
                    </button>
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
