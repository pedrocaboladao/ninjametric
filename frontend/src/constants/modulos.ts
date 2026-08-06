export interface Modulo {
  chave: string;
  label: string;
}

export const MODULOS: Modulo[] = [
  { chave: "dashboard", label: "Dashboard (Painel ao vivo)" },
  { chave: "perguntas", label: "Perguntas" },
  { chave: "clonar", label: "Clonar Anúncio" },
  { chave: "produtos", label: "Produtos" },
  { chave: "correcoes", label: "Correções" },
  { chave: "ean", label: "Gerador de EAN" },
  { chave: "financeiro", label: "Financeiro" },
  { chave: "contas", label: "Contas a pagar e receber" },
  { chave: "dre", label: "DRE" },
  { chave: "ads", label: "Gestão de Ads" },
  { chave: "fabricacao", label: "Fabricação" },
  { chave: "promocoes", label: "Promoções" },
  { chave: "tarefas", label: "Tarefas" },
  { chave: "funcionarios", label: "Funcionários" },
];

export function temPermissao(usuario: { admin: boolean; permissoes: string[] } | null, modulo: string): boolean {
  if (!usuario) return false;
  return usuario.admin || usuario.permissoes.includes(modulo);
}
