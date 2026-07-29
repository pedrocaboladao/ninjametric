import type { PerguntaPendente } from "../types/perguntas";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchPerguntas(): Promise<PerguntaPendente[]> {
  const res = await fetch(`${API_BASE}/api/perguntas`);
  if (!res.ok) throw new Error(`Falha ao buscar perguntas: ${res.status}`);
  const data = await res.json();
  return data.perguntas;
}

export async function responderPergunta(lojaId: number, questionId: number, texto: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/perguntas/${lojaId}/${questionId}/responder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto }),
  });
  if (!res.ok) throw new Error(`Falha ao responder pergunta: ${res.status}`);
}

export async function excluirPergunta(lojaId: number, questionId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/perguntas/${lojaId}/${questionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Falha ao excluir pergunta: ${res.status}`);
}
