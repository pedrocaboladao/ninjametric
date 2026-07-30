import { useEffect, useState } from "react";
import { fetchUsuarios, criarUsuario, atualizarUsuario, excluirUsuario } from "../api/usuarios";
import { fetchLojasTodas } from "../api/lojas";
import type { Usuario } from "../types/usuarios";
import type { LojaTodas } from "../api/lojas";
import { MODULOS } from "../constants/modulos";
import { IconTrash } from "./icons";

export function Usuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [lojas, setLojas] = useState<LojaTodas[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const [novoUsername, setNovoUsername] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novasPermissoes, setNovasPermissoes] = useState<string[]>([]);
  const [novasLojas, setNovasLojas] = useState<number[]>([]);
  const [novasTodasLojas, setNovasTodasLojas] = useState(false);
  const [novasClonarTodasLojas, setNovasClonarTodasLojas] = useState(false);
  const [criando, setCriando] = useState(false);

  const [senhaAbertaId, setSenhaAbertaId] = useState<number | null>(null);
  const [novaSenhaUsuario, setNovaSenhaUsuario] = useState("");
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<number | null>(null);

  useEffect(() => {
    carregar();
    carregarLojas();
  }, []);

  async function carregar() {
    try {
      setUsuarios(await fetchUsuarios());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar usuários.");
    }
  }

  async function carregarLojas() {
    try {
      setLojas(await fetchLojasTodas());
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao carregar lojas.");
    }
  }

  function alternarNovaPermissao(chave: string) {
    setNovasPermissoes((atual) => (atual.includes(chave) ? atual.filter((m) => m !== chave) : [...atual, chave]));
  }

  function alternarNovaLoja(lojaId: number) {
    setNovasLojas((atual) => (atual.includes(lojaId) ? atual.filter((id) => id !== lojaId) : [...atual, lojaId]));
  }

  async function handleCriarUsuario(e: React.FormEvent) {
    e.preventDefault();
    if (!novoUsername.trim() || !novoNome.trim() || novaSenha.length < 6) return;
    setCriando(true);
    setErro(null);
    try {
      await criarUsuario(
        novoUsername.trim(),
        novaSenha,
        novoNome.trim(),
        novasPermissoes,
        novasLojas,
        novasTodasLojas,
        novasClonarTodasLojas
      );
      setNovoUsername("");
      setNovoNome("");
      setNovaSenha("");
      setNovasPermissoes([]);
      setNovasLojas([]);
      setNovasTodasLojas(false);
      setNovasClonarTodasLojas(false);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao criar usuário.");
    } finally {
      setCriando(false);
    }
  }

  async function alternarPermissao(usuario: Usuario, chave: string) {
    const novas = usuario.permissoes.includes(chave)
      ? usuario.permissoes.filter((m) => m !== chave)
      : [...usuario.permissoes, chave];
    try {
      await atualizarUsuario(usuario.id, { permissoes: novas });
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar permissões.");
    }
  }

  async function alternarLoja(usuario: Usuario, lojaId: number) {
    const novas = usuario.lojas.includes(lojaId)
      ? usuario.lojas.filter((id) => id !== lojaId)
      : [...usuario.lojas, lojaId];
    try {
      await atualizarUsuario(usuario.id, { lojas: novas });
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar lojas.");
    }
  }

  async function alternarTodasLojas(usuario: Usuario) {
    try {
      await atualizarUsuario(usuario.id, { todasLojas: !usuario.todasLojas });
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar lojas.");
    }
  }

  async function alternarClonarTodasLojas(usuario: Usuario) {
    try {
      await atualizarUsuario(usuario.id, { clonarTodasLojas: !usuario.clonarTodasLojas });
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao atualizar lojas.");
    }
  }

  async function handleSalvarSenha(id: number) {
    if (novaSenhaUsuario.length < 6) return;
    try {
      await atualizarUsuario(id, { senha: novaSenhaUsuario });
      setSenhaAbertaId(null);
      setNovaSenhaUsuario("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao trocar senha.");
    }
  }

  async function handleExcluir(id: number) {
    try {
      await excluirUsuario(id);
      setConfirmandoExcluir(null);
      carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao excluir usuário.");
    }
  }

  return (
    <div className="func">
      <div className="func-topo">
        <span className="painel-eyebrow">Conta</span>
        <h1>Usuários</h1>
        <p className="painel-sub">Crie logins para sua equipe e controle o que cada pessoa pode acessar.</p>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      <div className="painel usuarios-novo-painel">
        <span className="painel-eyebrow">Novo usuário</span>
        <form className="usuarios-novo-form" onSubmit={handleCriarUsuario}>
          <div className="usuarios-novo-linha">
            <div className="clonar-campo">
              <label>Usuário (login)</label>
              <input
                className="clonar-input"
                value={novoUsername}
                onChange={(e) => setNovoUsername(e.target.value)}
                placeholder="ex: maria"
              />
            </div>
            <div className="clonar-campo">
              <label>Nome</label>
              <input
                className="clonar-input"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="ex: Maria Silva"
              />
            </div>
            <div className="clonar-campo">
              <label>Senha</label>
              <input
                className="clonar-input"
                type="password"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="mín. 6 caracteres"
              />
            </div>
          </div>

          <div className="usuarios-permissoes-campo">
            <label>Acesso liberado</label>
            <div className="usuarios-permissoes-lista">
              {MODULOS.map((m) => (
                <label key={m.chave} className="usuarios-permissao-item">
                  <input
                    type="checkbox"
                    checked={novasPermissoes.includes(m.chave)}
                    onChange={() => alternarNovaPermissao(m.chave)}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div className="usuarios-permissoes-campo">
            <label>Lojas com acesso</label>
            <label className="usuarios-permissao-item usuarios-todas-lojas">
              <input
                type="checkbox"
                checked={novasTodasLojas}
                onChange={(e) => setNovasTodasLojas(e.target.checked)}
              />
              Todas as lojas (inclusive as que forem cadastradas no futuro)
            </label>
            {!novasTodasLojas && (
              <>
                <div className="usuarios-permissoes-lista">
                  {lojas.map((l) => (
                    <label key={l.id} className="usuarios-permissao-item">
                      <input
                        type="checkbox"
                        checked={novasLojas.includes(l.id)}
                        onChange={() => alternarNovaLoja(l.id)}
                      />
                      {l.nome}
                    </label>
                  ))}
                </div>
                <label className="usuarios-permissao-item usuarios-clonar-todas-lojas">
                  <input
                    type="checkbox"
                    checked={novasClonarTodasLojas}
                    onChange={(e) => setNovasClonarTodasLojas(e.target.checked)}
                  />
                  Mesmo assim, pode clonar de/para qualquer loja (só vale pro Clonar Anúncio)
                </label>
              </>
            )}
          </div>

          <button type="submit" className="btn-responder" disabled={criando}>
            {criando ? "Criando..." : "Criar usuário"}
          </button>
        </form>
      </div>

      {!usuarios && <div className="state-message">Carregando usuários...</div>}

      {usuarios && (
        <div className="usuarios-lista">
          {usuarios.map((u) => (
            <div key={u.id} className="painel usuarios-item">
              <div className="usuarios-item-topo">
                <div>
                  <div className="usuarios-item-nome">
                    {u.nome} <span className="usuarios-item-username">@{u.username}</span>
                  </div>
                  {u.admin && <span className="sidebar-user-badge">ADMIN</span>}
                </div>
                {!u.admin && (
                  <div className="usuarios-item-acoes">
                    <button className="btn-excluir" type="button" onClick={() => setSenhaAbertaId(u.id)}>
                      Trocar senha
                    </button>
                    {confirmandoExcluir === u.id ? (
                      <>
                        <button className="btn-excluir" type="button" onClick={() => handleExcluir(u.id)}>
                          Confirmar exclusão
                        </button>
                        <button className="btn-excluir" type="button" onClick={() => setConfirmandoExcluir(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-excluir"
                        type="button"
                        title="Excluir usuário"
                        onClick={() => setConfirmandoExcluir(u.id)}
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {senhaAbertaId === u.id && (
                <div className="usuarios-senha-form">
                  <input
                    className="clonar-input"
                    type="password"
                    placeholder="Nova senha (mín. 6 caracteres)"
                    value={novaSenhaUsuario}
                    onChange={(e) => setNovaSenhaUsuario(e.target.value)}
                  />
                  <button className="btn-responder" type="button" onClick={() => handleSalvarSenha(u.id)}>
                    Salvar
                  </button>
                  <button
                    className="btn-excluir"
                    type="button"
                    onClick={() => {
                      setSenhaAbertaId(null);
                      setNovaSenhaUsuario("");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {u.admin && (
                <div className="usuarios-lojas-lista">
                  <label className="usuarios-permissao-item usuarios-todas-lojas">Minhas lojas</label>
                  <p className="usuarios-minhas-lojas-dica">
                    Atalho pessoal para o filtro "Minhas lojas" no Painel ao vivo — não afeta permissões, já
                    que sua conta enxerga tudo.
                  </p>
                  <div className="usuarios-permissoes-lista">
                    {lojas.map((l) => (
                      <label key={l.id} className="usuarios-permissao-item">
                        <input type="checkbox" checked={u.lojas.includes(l.id)} onChange={() => alternarLoja(u, l.id)} />
                        {l.nome}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {!u.admin && (
                <>
                  <div className="usuarios-permissoes-lista">
                    {MODULOS.map((m) => (
                      <label key={m.chave} className="usuarios-permissao-item">
                        <input
                          type="checkbox"
                          checked={u.permissoes.includes(m.chave)}
                          onChange={() => alternarPermissao(u, m.chave)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                  <div className="usuarios-lojas-lista">
                    <label className="usuarios-permissao-item usuarios-todas-lojas">
                      <input
                        type="checkbox"
                        checked={u.todasLojas}
                        onChange={() => alternarTodasLojas(u)}
                      />
                      Todas as lojas (inclusive as que forem cadastradas no futuro)
                    </label>
                    {!u.todasLojas && (
                      <>
                        <div className="usuarios-permissoes-lista">
                          {lojas.map((l) => (
                            <label key={l.id} className="usuarios-permissao-item">
                              <input
                                type="checkbox"
                                checked={u.lojas.includes(l.id)}
                                onChange={() => alternarLoja(u, l.id)}
                              />
                              {l.nome}
                            </label>
                          ))}
                        </div>
                        <label className="usuarios-permissao-item usuarios-clonar-todas-lojas">
                          <input
                            type="checkbox"
                            checked={u.clonarTodasLojas}
                            onChange={() => alternarClonarTodasLojas(u)}
                          />
                          Mesmo assim, pode clonar de/para qualquer loja (só vale pro Clonar Anúncio)
                        </label>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
