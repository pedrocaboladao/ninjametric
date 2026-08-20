import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaClientes,
  criarFabricaCliente,
  atualizarFabricaCliente,
  excluirFabricaCliente,
} from "../api/fabricaClientes";
import type { FabricaCliente, FabricaClienteEntrada } from "../types/fabricaClientes";
import { IconPlus, IconTrash } from "./icons";

const VAZIO: FabricaClienteEntrada = {
  nome: "", tipo: "LOJA", cnpj: null, inscricaoEstadual: null, email: null, telefone: null,
  cep: null, logradouro: null, numero: null, complemento: null, bairro: null,
  cidade: null, uf: null, observacao: null, ativo: true,
};

// campos de texto do formulário longo, na ordem em que fazem sentido preencher
const CAMPOS: Array<[keyof FabricaClienteEntrada, string]> = [
  ["cnpj", "CNPJ"],
  ["inscricaoEstadual", "Inscrição estadual"],
  ["email", "E-mail"],
  ["telefone", "Telefone"],
  ["cep", "CEP"],
  ["logradouro", "Logradouro"],
  ["numero", "Número"],
  ["complemento", "Complemento"],
  ["bairro", "Bairro"],
  ["cidade", "Cidade"],
  ["uf", "UF"],
  ["observacao", "Observação"],
];

export function FabricaClientes() {
  const [clientes, setClientes] = useState<FabricaCliente[] | null>(null);
  const [rascunho, setRascunho] = useState<FabricaClienteEntrada>(VAZIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      setClientes(await fetchFabricaClientes());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setClientes([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!clientes) return [];
    if (!t) return clientes;
    return clientes.filter(
      (c) => c.nome.toLowerCase().includes(t) || (c.cnpj ?? "").includes(t) || (c.cidade ?? "").toLowerCase().includes(t)
    );
  }, [clientes, busca]);

  const resumo = useMemo(() => {
    if (!clientes?.length) return null;
    return { total: clientes.length, completos: clientes.filter((c) => c.completo).length };
  }, [clientes]);

  function editar(c: FabricaCliente) {
    const { id, completo, faltando, ...resto } = c;
    void id; void completo; void faltando;
    setEditandoId(c.id);
    setRascunho(resto);
    setErro(null);
  }

  function cancelar() {
    setEditandoId(null);
    setRascunho(VAZIO);
    setErro(null);
  }

  async function salvar() {
    if (!rascunho.nome.trim()) {
      setErro("Informe o nome do cliente.");
      return;
    }
    setSalvando(true);
    try {
      if (editandoId) await atualizarFabricaCliente(editandoId, rascunho);
      else await criarFabricaCliente(rascunho);
      cancelar();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(c: FabricaCliente) {
    if (!confirm(`Excluir o cliente "${c.nome}"?`)) return;
    try {
      await excluirFabricaCliente(c.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  function campo(chave: keyof FabricaClienteEntrada, rotulo: string) {
    return (
      <input
        key={chave}
        className="clonar-input fabricacao-input-pequeno"
        placeholder={rotulo}
        value={(rascunho[chave] as string | null) ?? ""}
        onChange={(e) => setRascunho((r) => ({ ...r, [chave]: e.target.value || null }))}
      />
    );
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Clientes</h1>
          <p className="financeiro-td-mudo">
            Lojas do grupo e clientes de fora. Só o nome é obrigatório — os dados fiscais podem
            ser preenchidos depois, e a coluna CADASTRO mostra o que ainda falta pra emitir nota.
          </p>
        </div>
        {resumo && (
          <div>
            <div className="financeiro-stat-label">CADASTRO COMPLETO</div>
            <div className="financeiro-stat-valor">
              {resumo.completos}/{resumo.total}
            </div>
          </div>
        )}
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}

      <div className="financeiro-filtros">
        <input
          className="clonar-input"
          placeholder="Nome do cliente"
          value={rascunho.nome}
          onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
        />
        <select
          className="clonar-input fabricacao-input-pequeno"
          value={rascunho.tipo}
          onChange={(e) => setRascunho((r) => ({ ...r, tipo: e.target.value as "LOJA" | "EXTERNO" }))}
        >
          <option value="LOJA">Loja do grupo</option>
          <option value="EXTERNO">Cliente externo</option>
        </select>
        {CAMPOS.map(([chave, rotulo]) => campo(chave, rotulo))}
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
          placeholder="Buscar por nome, CNPJ ou cidade"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <div className="financeiro-tabela-wrap">
        <table className="financeiro-tabela">
          <thead>
            <tr>
              <th>CLIENTE</th>
              <th>TIPO</th>
              <th>CNPJ</th>
              <th>CIDADE/UF</th>
              <th>CONTATO</th>
              <th>CADASTRO</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clientes === null && (
              <tr>
                <td colSpan={7}>Carregando…</td>
              </tr>
            )}
            {clientes !== null && !filtrados.length && (
              <tr>
                <td colSpan={7}>Nenhum cliente cadastrado ainda.</td>
              </tr>
            )}
            {filtrados.map((c) => (
              <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.5 }}>
                <td>
                  <button type="button" className="fabricacao-envase-nome-editavel" onClick={() => editar(c)}>
                    {c.nome}
                  </button>
                </td>
                <td className="financeiro-td-mudo">{c.tipo === "LOJA" ? "Loja do grupo" : "Externo"}</td>
                <td className="financeiro-td-mudo">{c.cnpj ?? "—"}</td>
                <td className="financeiro-td-mudo">
                  {c.cidade ? `${c.cidade}${c.uf ? "/" + c.uf : ""}` : "—"}
                </td>
                <td className="financeiro-td-mudo">{c.telefone ?? c.email ?? "—"}</td>
                <td className="financeiro-td-mudo" title={c.faltando.join(", ")}>
                  {c.completo ? "completo" : `falta ${c.faltando.length}`}
                </td>
                <td>
                  <button type="button" className="btn-excluir" onClick={() => void excluir(c)} title="Excluir">
                    <IconTrash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
