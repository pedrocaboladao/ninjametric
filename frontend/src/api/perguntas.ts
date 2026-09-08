import type { PerguntaPendente } from "../types/perguntas";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchPerguntas(): Promise<PerguntaPendente[]> {
  const res = await fetch(`${API_BASE}/api/perguntas`, { credentials: "include" });
  if (!res.ok) throw new Error(`Falha ao buscar perguntas: ${res.status}`);
  const data = await res.json();
  return data.perguntas;
}

export async function responderPergunta(
  lojaId: number,
  questionId: number,
  texto: string,
  contexto?: { perguntaTexto: string; produtoTitulo: string | null; respostaSugerida: string | null }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/perguntas/${lojaId}/${questionId}/responder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto, ...contexto }),
  });
  if (!res.ok) throw new Error(`Falha ao responder pergunta: ${res.status}`);
}

// null quando a IA não está configurada ou falhou — o front cai de volta
// no campo em branco, sem travar a tela.
export async function sugerirRespostaPergunta(
  lojaId: number,
  perguntaTexto: string,
  produtoTitulo: string | null
): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/perguntas/${lojaId}/sugestao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ perguntaTexto, produtoTitulo }),
  });
  if (!res.ok) throw new Error(`Falha ao sugerir resposta: ${res.status}`);
  const data = await res.json();
  return data.sugestao ?? null;
}

export async function excluirPergunta(lojaId: number, questionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/perguntas/${lojaId}/${questionId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Falha ao excluir pergunta: ${res.status}`);
}
