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
  { chave: "fabricacao", label: "Custo de Fabricação" },
  { chave: "fabrica_produtos", label: "Fábrica — Produtos" },
  { chave: "fabrica_clientes", label: "Fábrica — Clientes" },
  { chave: "fabrica_embalagens", label: "Fábrica — Embalagens" },
  { chave: "fabrica_estoque", label: "Fábrica — Estoque" },
  { chave: "fabrica_pedidos", label: "Fábrica — Pedidos de venda" },
  { chave: "fabrica_financeiro", label: "Fábrica — Contas a pagar/receber" },
  { chave: "promocoes", label: "Promoções" },
  { chave: "pesquisa", label: "Pesquisa de Mercado" },
  { chave: "market_intelligence", label: "Inteligência de Mercado" },
  { chave: "tarefas", label: "Tarefas" },
  { chave: "funcionarios", label: "Funcionários" },
];

export function temPermissao(usuario: { admin: boolean; permissoes: string[] } | null, modulo: string): boolean {
  if (!usuario) return false;
  return usuario.admin || usuario.permissoes.includes(modulo);
}
