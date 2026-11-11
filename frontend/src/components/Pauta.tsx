import { useEffect, useState } from "react";
import type { PautaItem } from "../types/pauta";
import type { Usuario } from "../types/usuarios";
import {
  fetchPauta,
  criarItemPauta,
  apoiarItem,
  desapoiarItem,
  selecionarParaReuniao,
  marcarDiscutido,
  adiarItem,
  excluirItemPauta,
} from "../api/pauta";
import { fetchLojas, type Loja } from "../api/lojas";
import { IconMegaphone, IconTrash } from "./icons";

interface Props {
  usuario: Usuario;
}

type Aba = "sugestoes" | "proxima" | "adiados" | "historico";

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function proximaSegunda(): string {
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  const diasAteSegunda = diaSemana === 1 ? 7 : ((8 - diaSemana) % 7) || 7;
  const alvo = new Date(hoje);
  alvo.setDate(hoje.getDate() + diasAteSegunda);
  return alvo.toISOString().slice(0, 10);
}

export function Pauta({ usuario }: Props) {
  const [itens, setItens] = useState<PautaItem[] | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("sugestoes");

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [lojaId, setLojaId] = useState<string>("");
  const [area, setArea] = useState("");
  const [enviando, setEnviando] = useState(false);

  const [dataRascunho, setDataRascunho] = useState<Record<number, string>>({});
  const [decisaoRascunho, setDecisaoRascunho] = useState<Record<number, string>>({});
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<number | null>(null);

  useEffect(() => {
    carregar();
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  async function carregar() {
    try {
      setItens(await fetchPauta());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar a pauta.");
    }
  }

  async function handleCriar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!titulo.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      await criarItemPauta({
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        lojaId: lojaId ? Number(lojaId) : null,
        area: area.trim() || null,
      });
      setTitulo("");
      setDescricao("");
      setLojaId("");
      setArea("");
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar sugestão.");
    } finally {
      setEnviando(false);
    }
  }

  async function handleApoio(item: PautaItem) {
    try {
      if (item.apoiadoPorMim) await desapoiarItem(item.id);
      else await apoiarItem(item.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao apoiar item.");
    }
  }

  async function handleSelecionar(item: PautaItem) {
    const data = dataRascunho[item.id] || proximaSegunda();
    setAcaoEmAndamento(item.id);
    try {
      await selecionarParaReuniao(item.id, data);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao selecionar item.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleDiscutido(item: PautaItem) {
    setAcaoEmAndamento(item.id);
    try {
      await marcarDiscutido(item.id, decisaoRascunho[item.id]?.trim() || null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao marcar como discutido.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleAdiar(item: PautaItem) {
    setAcaoEmAndamento(item.id);
    try {
      await adiarItem(item.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao adiar item.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleExcluir(item: PautaItem) {
    if (!confirm(`Excluir "${item.titulo}"?`)) return;
    setAcaoEmAndamento(item.id);
    try {
      await excluirItemPauta(item.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir item.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  const sugeridos = (itens ?? []).filter((i) => i.status === "sugerido").sort((a, b) => b.apoios - a.apoios);
  const selecionados = (itens ?? [])
    .filter((i) => i.status === "selecionado")
    .sort((a, b) => (a.reuniaoData ?? "").localeCompare(b.reuniaoData ?? ""));
  const adiados = (itens ?? []).filter((i) => i.status === "adiado");
  const discutidos = (itens ?? [])
    .filter((i) => i.status === "discutido")
    .sort((a, b) => (b.reuniaoData ?? "").localeCompare(a.reuniaoData ?? ""));

  const listas: Record<Aba, PautaItem[]> = {
    sugestoes: sugeridos,
    proxima: selecionados,
    adiados,
    historico: discutidos,
  };

  function tagsItem(item: PautaItem) {
    return (
      <div className="pauta-tags">
        {item.lojaNome && <span className="pauta-tag">{item.lojaNome}</span>}
        {item.area && <span className="pauta-tag pauta-tag-area">{item.area}</span>}
      </div>
    );
  }

  return (
    <div className="pauta-page">
      <div className="tarefas-topo">
        <span className="painel-eyebrow">Reuniões</span>
        <h1>
          <IconMegaphone size={22} /> Pauta de Reunião
        </h1>
        <p className="painel-sub">Sugira assuntos, apoie os que também importam pra você e acompanhe o que foi decidido.</p>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      <form className="pauta-form" onSubmit={handleCriar}>
        <input
          className="pauta-input"
          placeholder="Título da sugestão"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          maxLength={200}
        />
        <textarea
          className="pauta-textarea"
          placeholder="Descrição (opcional) — por que isso importa?"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
        />
        <div className="pauta-form-linha">
          <select className="dashboard-select" value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
            <option value="">Loja (opcional)</option>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <input
            className="pauta-input pauta-input-area"
            placeholder="Área (ex: Ads, Financeiro)"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            list="pauta-areas"
            maxLength={40}
          />
          <datalist id="pauta-areas">
            <option value="Ads" />
            <option value="Financeiro" />
            <option value="Produtos" />
            <option value="Operação" />
            <option value="Geral" />
          </datalist>
          <button type="submit" className="btn-responder" disabled={enviando || !titulo.trim()}>
            {enviando ? "Enviando..." : "Sugerir"}
          </button>
        </div>
      </form>

      <div className="tarefas-abas-linha">
        <div className="tarefas-abas">
          <button className={`tarefas-aba ${aba === "sugestoes" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("sugestoes")}>
            Sugestões ({sugeridos.length})
          </button>
          <button className={`tarefas-aba ${aba === "proxima" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("proxima")}>
            Pauta da reunião ({selecionados.length})
          </button>
          {adiados.length > 0 && (
            <button className={`tarefas-aba ${aba === "adiados" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("adiados")}>
              Adiados ({adiados.length})
            </button>
          )}
          <button className={`tarefas-aba ${aba === "historico" ? "tarefas-aba-ativa" : ""}`} onClick={() => setAba("historico")}>
            Histórico ({discutidos.length})
          </button>
        </div>
      </div>

      {itens === null && <div className="state-message">Carregando...</div>}

      {itens !== null && listas[aba].length === 0 && <div className="state-message">Nada por aqui ainda.</div>}

      <div className="pauta-lista">
        {listas[aba].map((item) => (
          <div key={item.id} className="pauta-item">
            <div className="pauta-item-topo">
              <div>
                <div className="pauta-item-titulo">{item.titulo}</div>
                {item.descricao && <div className="pauta-item-descricao">{item.descricao}</div>}
                {tagsItem(item)}
                <div className="pauta-item-meta">
                  sugerido por {item.criadoPorNome}
                  {item.reuniaoData && ` · reunião em ${formatarData(item.reuniaoData)}`}
                </div>
              </div>

              {aba === "sugestoes" && (
                <button
                  className={`pauta-apoio ${item.apoiadoPorMim ? "pauta-apoio-ativo" : ""}`}
                  onClick={() => handleApoio(item)}
                >
                  ▲ {item.apoios}
                </button>
              )}
            </div>

            {item.decisao && (
              <div className="pauta-decisao">
                <strong>Decisão:</strong> {item.decisao}
              </div>
            )}

            {usuario.admin && aba === "sugestoes" && (
              <div className="pauta-acoes">
                <input
                  type="date"
                  className="dashboard-select"
                  value={dataRascunho[item.id] ?? proximaSegunda()}
                  onChange={(e) => setDataRascunho((d) => ({ ...d, [item.id]: e.target.value }))}
                />
                <button className="btn-responder" disabled={acaoEmAndamento === item.id} onClick={() => handleSelecionar(item)}>
                  Selecionar pra pauta
                </button>
                <button className="btn-excluir" disabled={acaoEmAndamento === item.id} onClick={() => handleExcluir(item)}>
                  <IconTrash size={14} />
                </button>
              </div>
            )}

            {usuario.admin && aba === "adiados" && (
              <div className="pauta-acoes">
                <input
                  type="date"
                  className="dashboard-select"
                  value={dataRascunho[item.id] ?? proximaSegunda()}
                  onChange={(e) => setDataRascunho((d) => ({ ...d, [item.id]: e.target.value }))}
                />
                <button className="btn-responder" disabled={acaoEmAndamento === item.id} onClick={() => handleSelecionar(item)}>
                  Reagendar pra pauta
                </button>
              </div>
            )}

            {usuario.admin && aba === "proxima" && (
              <div className="pauta-acoes pauta-acoes-coluna">
                <textarea
                  className="pauta-textarea"
                  placeholder="Decisão / encaminhamento (opcional)"
                  rows={2}
                  value={decisaoRascunho[item.id] ?? ""}
                  onChange={(e) => setDecisaoRascunho((d) => ({ ...d, [item.id]: e.target.value }))}
                />
                <div className="pauta-form-linha">
                  <button className="btn-responder" disabled={acaoEmAndamento === item.id} onClick={() => handleDiscutido(item)}>
                    Marcar como discutido
                  </button>
                  <button className="btn-excluir" disabled={acaoEmAndamento === item.id} onClick={() => handleAdiar(item)}>
                    Adiar
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
