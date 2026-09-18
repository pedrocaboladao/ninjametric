import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchConversas,
  fetchUsuariosParaConversa,
  fetchMensagens,
  enviarMensagem,
} from "../api/mensagens";
import type { Conversa, Mensagem, UsuarioBasico } from "../types/mensagens";
import type { Usuario } from "../types/usuarios";
import { formatDataHora } from "../utils/format";

const POLL_CONVERSAS_MS = 15 * 1000;
const POLL_THREAD_MS = 5 * 1000;

interface Props {
  usuario: Usuario;
  // Chamado sempre que uma conversa é aberta/atualizada — o badge do
  // sidebar (App.tsx) tem seu próprio polling, mas isso zera o número na
  // hora em vez de esperar até 15s pra refletir que já foi lida.
  onMensagemLida: () => void;
}

function StatusOnline({ online }: { online: boolean }) {
  return <span className={`mensagens-status-dot ${online ? "mensagens-status-dot-online" : ""}`} title={online ? "Online" : "Offline"} />;
}

function NovaConversa({ onEscolher }: { onEscolher: (usuario: UsuarioBasico) => void }) {
  const [usuarios, setUsuarios] = useState<UsuarioBasico[] | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchUsuariosParaConversa()
      .then(setUsuarios)
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar usuários."));
  }, []);

  const filtrados = usuarios?.filter((u) => u.nome.toLowerCase().includes(busca.toLowerCase())) ?? [];

  return (
    <div className="mensagens-nova-conversa">
      <input
        type="text"
        className="clonar-input"
        placeholder="Buscar pessoa..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
      />
      {erro && <div className="state-message state-error">{erro}</div>}
      {usuarios === null && !erro && <div className="state-message">Carregando...</div>}
      <div className="mensagens-lista-usuarios">
        {filtrados.map((u) => (
          <button key={u.id} type="button" className="mensagens-usuario-item" onClick={() => onEscolher(u)}>
            <StatusOnline online={u.online} />
            {u.nome}
          </button>
        ))}
        {usuarios !== null && filtrados.length === 0 && <div className="state-message">Ninguém encontrado.</div>}
      </div>
    </div>
  );
}

function Thread({
  outroUsuario,
  meuUsuarioId,
  onFechar,
  onMensagemLida,
}: {
  outroUsuario: UsuarioBasico;
  meuUsuarioId: number;
  onFechar: () => void;
  onMensagemLida: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await fetchMensagens(outroUsuario.id);
      setMensagens(dados);
      onMensagemLida();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar a conversa.");
    }
  }, [outroUsuario.id, onMensagemLida]);

  useEffect(() => {
    setMensagens(null);
    carregar();
    timerRef.current = setInterval(carregar, POLL_THREAD_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [carregar]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens?.length]);

  async function enviar() {
    // enviando também guarda contra clique duplo (o texto some do input
    // assim que a mensagem é aceita, mas a resposta do servidor pode
    // demorar um pouquinho) — sem isso, apertar Enter rápido demais dava
    // pra mandar a mesma mensagem duas vezes.
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const nova = await enviarMensagem(outroUsuario.id, texto.trim());
      setMensagens((atual) => (atual ? [...atual, nova] : [nova]));
      setTexto("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mensagens-thread">
      <div className="mensagens-thread-topo">
        <button type="button" className="mensagens-voltar" onClick={onFechar}>
          ← Conversas
        </button>
        <StatusOnline online={outroUsuario.online} />
        <span className="financeiro-td-titulo">{outroUsuario.nome}</span>
      </div>

      <div className="mensagens-thread-corpo">
        {mensagens === null && !erro && <div className="state-message">Carregando...</div>}
        {mensagens?.length === 0 && <div className="state-message">Nenhuma mensagem ainda — diga oi.</div>}
        {mensagens?.map((m) => (
          <div
            key={m.id}
            className={`mensagens-bolha ${m.remetenteId === meuUsuarioId ? "mensagens-bolha-minha" : "mensagens-bolha-outro"}`}
          >
            <div>{m.texto}</div>
            <span className="mensagens-bolha-hora">{formatDataHora(m.criadoEm)}</span>
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      <div className="mensagens-thread-envio">
        <input
          type="text"
          className="clonar-input"
          placeholder="Escreva uma mensagem..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
        />
        <button type="button" className="btn-responder" onClick={enviar} disabled={enviando || !texto.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}

export function Mensagens({ usuario, onMensagemLida }: Props) {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindoNova, setAbrindoNova] = useState(false);
  const [conversaAberta, setConversaAberta] = useState<UsuarioBasico | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      setConversas(await fetchConversas());
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao carregar conversas.");
    }
  }, []);

  useEffect(() => {
    carregar();
    timerRef.current = setInterval(carregar, POLL_CONVERSAS_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [carregar]);

  function abrirConversa(outroUsuario: UsuarioBasico) {
    setConversaAberta(outroUsuario);
    setAbrindoNova(false);
  }

  // Sem useCallback aqui, essa função nasceria de novo a cada render da tela
  // — o Thread usa ela como dependência do próprio useCallback/useEffect de
  // buscar a conversa, então uma referência nova a cada vez reiniciava esse
  // efeito em loop (a tela "piscava" entre carregando e carregado sem parar).
  const handleMensagemLida = useCallback(() => {
    carregar();
    onMensagemLida();
  }, [carregar, onMensagemLida]);

  return (
    <div className="financeiro-page mensagens-page">
      <div className="financeiro-topo">
        <div>
          <h1>Chat</h1>
          <p className="painel-sub">Converse direto com qualquer pessoa que usa o painel.</p>
        </div>
      </div>

      <div className="mensagens-layout">
        <div className={`mensagens-coluna-lista ${conversaAberta ? "mensagens-coluna-lista-oculta-mobile" : ""}`}>
          <button type="button" className="btn-responder mensagens-nova-btn" onClick={() => setAbrindoNova((v) => !v)}>
            {abrindoNova ? "Cancelar" : "+ Nova conversa"}
          </button>

          {abrindoNova && <NovaConversa onEscolher={abrirConversa} />}

          {erro && <div className="state-message state-error">{erro}</div>}
          {!erro && conversas === null && <div className="state-message">Carregando...</div>}
          {conversas?.length === 0 && !abrindoNova && (
            <div className="state-message">Nenhuma conversa ainda — clique em "Nova conversa".</div>
          )}

          {!abrindoNova &&
            conversas?.map((c) => (
              <button
                key={c.usuario.id}
                type="button"
                className={`mensagens-conversa-item ${conversaAberta?.id === c.usuario.id ? "mensagens-conversa-item-ativa" : ""}`}
                onClick={() => abrirConversa(c.usuario)}
              >
                <div className="mensagens-conversa-linha1">
                  <span className="mensagens-conversa-nome">
                    <StatusOnline online={c.usuario.online} />
                    <span className="financeiro-td-titulo">{c.usuario.nome}</span>
                  </span>
                  {c.naoLidas > 0 && <span className="sidebar-badge">{c.naoLidas}</span>}
                </div>
                <div className="financeiro-td-mudo mensagens-conversa-preview">
                  {c.enviadaPorMim ? "Você: " : ""}
                  {c.ultimaMensagem}
                </div>
              </button>
            ))}
        </div>

        <div className={`mensagens-coluna-thread ${!conversaAberta ? "mensagens-coluna-thread-oculta-mobile" : ""}`}>
          {conversaAberta ? (
            <Thread
              outroUsuario={conversaAberta}
              meuUsuarioId={usuario.id}
              onFechar={() => setConversaAberta(null)}
              onMensagemLida={handleMensagemLida}
            />
          ) : (
            <div className="state-message mensagens-sem-selecao">Selecione uma conversa pra começar.</div>
          )}
        </div>
      </div>
    </div>
  );
}
