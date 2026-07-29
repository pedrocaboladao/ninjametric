export interface Modulo {
  chave: string;
  label: string;
}

export const MODULOS: Modulo[] = [
  { chave: "dashboard", label: "Dashboard (Painel ao vivo)" },
  { chave: "perguntas", label: "Perguntas" },
  { chave: "clonar", label: "Clonar Anúncio" },
  { chave: "tarefas", label: "Tarefas" },
  { chave: "funcionarios", label: "Funcionários" },
];

export function temPermissao(usuario: { admin: boolean; permissoes: string[] } | null, modulo: string): boolean {
  if (!usuario) return false;
  return usuario.admin || usuario.permissoes.includes(modulo);
}
