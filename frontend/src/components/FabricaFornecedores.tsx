import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFornecedores,
  fetchFornecedoresPendentes,
  criarFornecedor,
  atualizarFornecedor,
  excluirFornecedor,
} from "../api/fabricaFornecedores";
import type {
  Fornecedor,
  FornecedorEntrada,
  FornecedorPendente,
} from "../types/fabricaFornecedores";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";

// As mesmas do lançamento de conta: escolher aqui já sugere a categoria na
// hora de lançar, e o nome sai igual todas as vezes.
const CATEGORIAS = [
  "REVENDA",
  "MATÉRIA-PRIMA",
  "EMBALAGEM",
  "IMOBILIZADO",
  "ALUGUEL",
  "ÁGUA",
  "LUZ",
  "SALÁRIO",
  "MANUTENÇÃO",
  "IMPOSTO",
  "FRETE",
  "CONSUMO",
  "OUTROS",
];

const VAZIO: FornecedorEntrada = {
  nome: "",
  cnpj: null,
  email: null,
  telefone: null,
  cidade: null,
  uf: null,
  categoriaPadrao: null,
  observacao: null,
  ativo: true,
};

export function FabricaFornecedores() {
  const [lista, setLista] = useState<Fornecedor[] | null>(null);
  const [pendentes, setPendentes] = useState<FornecedorPendente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState<FornecedorEntrada>({ ...VAZIO });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([fetchFornecedores(), fetchFornecedoresPendentes()]);
      setLista(f);
      setPendentes(p);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setLista([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const t = busca
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    if (!t.length) return lista ?? [];
    return (lista ?? []).filter((f) => {
      const alvo = `${f.nome} ${f.cnpj ?? ""} ${f.cidade ?? ""} ${f.categoriaPadrao ?? ""}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      return t.every((x) => alvo.includes(x));
    });
  }, [lista, busca]);

  function novo(nome = "", categoria: string | null = null) {
    setEditandoId(null);
    setForm({ ...VAZIO, nome, categoriaPadrao: categoria });
    setMostrarForm(true);
    setErro(null);
  }

  function editar(f: Fornecedor) {
    setEditandoId(f.id);
    setForm({
      nome: f.nome,
      cnpj: f.cnpj,
      email: f.email,
      telefone: f.telefone,
      cidade: f.cidade,
      uf: f.uf,
      categoriaPadrao: f.categoriaPadrao,
      observacao: f.observacao,
      ativo: f.ativo,
    });
    setMostrarForm(true);
    setErro(null);
  }

  async function salvar() {
    if (!form.nome.trim()) return setErro("Informe o nome do fornecedor.");
    setSalvando(true);
    try {
      if (editandoId) {
        await atualizarFornecedor(editandoId, form);
        setAviso("Fornecedor salvo. Se o nome mudou, as contas dele mudaram junto.");
      } else {
        await criarFornecedor(form);
        setAviso("Fornecedor cadastrado.");
      }
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

  // traz de uma vez todo mundo que já aparece nas contas
  async function importarPendentes() {
    setSalvando(true);
    try {
      for (const p of pendentes) {
        await criarFornecedor({ ...VAZIO, nome: p.nome, categoriaPadrao: p.categoria });
      }
      setAviso(`${pendentes.length} fornecedores cadastrados a partir das contas.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(f: Fornecedor) {
    try {
      await excluirFornecedor(f.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  const campo = (
    chave: keyof FornecedorEntrada,
    placeholder: string,
    pequeno = false
  ) => (
    <input
      className={`clonar-input${pequeno ? " fabricacao-input-pequeno" : ""}`}
      placeholder={placeholder}
      value={(form[chave] as string | null) ?? ""}
      onChange={(e) => setForm((f) => ({ ...f, [chave]: e.target.value || null }))}
    />
  );

  return (
    <div>
      <p className="financeiro-td-mudo">
        O nome do fornecedor vinha digitado em cada conta, e o estrago apareceu na primeira carga:
        "METALLOG" e "MATALLOG BRASIL" são a mesma empresa. Cadastrando aqui, o nome sai sempre
        igual no lançamento — e o total por fornecedor fecha.
      </p>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      {pendentes.length > 0 && (
        <div className="financeiro-filtros">
          <p className="financeiro-td-mudo">
            <strong>{pendentes.length}</strong> fornecedores aparecem nas contas mas não estão
            cadastrados.
          </p>
          <button
            type="button"
            className="btn-responder"
            onClick={() => void importarPendentes()}
            disabled={salvando}
          >
            Cadastrar todos a partir das contas
          </button>
        </div>
      )}

      <div className="financeiro-filtros">
        <input
          className="clonar-input"
          placeholder="Buscar por nome, CNPJ, cidade ou categoria"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <button type="button" className="btn-responder" onClick={() => novo()}>
          <IconPlus size={14} /> Novo fornecedor
        </button>
      </div>

      {mostrarForm && (
        <>
          <div className="financeiro-filtros contas-form">
            {campo("nome", "Nome do fornecedor")}
            {campo("cnpj", "CNPJ", true)}
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={form.categoriaPadrao ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, categoriaPadrao: e.target.value || null }))
              }
            >
              <option value="">O que ele fornece</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="financeiro-filtros contas-form">
            {campo("telefone", "Telefone", true)}
            {campo("email", "E-mail", true)}
            {campo("cidade", "Cidade", true)}
            {campo("uf", "UF", true)}
          </div>
          <div className="financeiro-filtros contas-form">
            <label className="financeiro-td-mudo">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              />{" "}
              ativo — desmarque quem você não compra mais
            </label>
            {campo("observacao", "Observação")}
          </div>
          <div className="financeiro-filtros">
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
          </div>
        </>
      )}

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>FORNECEDOR</th>
              <th>FORNECE</th>
              <th>CNPJ</th>
              <th>CIDADE</th>
              <th className="financeiro-th-numero">CONTAS</th>
              <th className="financeiro-th-numero">TOTAL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista === null && (
              <tr>
                <td colSpan={7}>Carregando…</td>
              </tr>
            )}
            {lista !== null && !visiveis.length && (
              <tr>
                <td colSpan={7}>Nenhum fornecedor cadastrado.</td>
              </tr>
            )}
            {visiveis.map((f) => (
              <tr key={f.id} style={f.ativo ? undefined : { opacity: 0.5 }}>
                <td>{f.nome}</td>
                <td className="financeiro-td-mudo">{f.categoriaPadrao ?? "—"}</td>
                <td className="financeiro-td-mudo">{f.cnpj ?? "—"}</td>
                <td className="financeiro-td-mudo">
                  {f.cidade ?? "—"}
                  {f.uf && ` / ${f.uf}`}
                </td>
                <td className="financeiro-th-numero financeiro-td-mudo">{f.contas || "—"}</td>
                <td className="financeiro-th-numero">
                  {f.total ? formatCurrency(f.total) : "—"}
                </td>
                <td className="contas-acoes">
                  <button type="button" className="btn-excluir" onClick={() => editar(f)}>
                    Editar
                  </button>
                  <BotaoExcluir onConfirmar={() => void apagar(f)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
