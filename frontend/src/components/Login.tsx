import { useState } from "react";
import { login } from "../api/session";

interface Props {
  onEntrar: () => void;
}

export function Login({ onEntrar }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await login(username, password);
      onEntrar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao entrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-tela">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/logo-vertical.png" alt="Impetrus Vision" className="login-logo" />
        <h1>Entrar no painel</h1>
        <div className="clonar-campo">
          <label>Usuário</label>
          <input
            className="clonar-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="clonar-campo">
          <label>Senha</label>
          <input
            className="clonar-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {erro && <div className="clonar-erro">{erro}</div>}
        <button className="btn-responder login-botao" type="submit" disabled={enviando}>
          {enviando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
