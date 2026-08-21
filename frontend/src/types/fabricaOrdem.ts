// Ordem de fabricação: a folha que vai pro chão de fábrica.
//
// Fórmula de cor imprime a base junto — um lote de Emborrachado Areia não
// começa com "adicione 99,42% de Base A", começa carregando o tanque com água.
// O passo de sub-fórmula expande no roteiro dela, e `nivel` diz de qual
// fórmula aquela linha veio.
export interface PassoImpressao {
  nivel: number;
  origem: string;
  tipo: "cabecalho" | "adicao" | "instrucao";
  numero: string | null;
  codigo: string | null;
  descricao: string;
  percentual: number | null;
  massaKg: number | null;
  etapa: string | null;
}

export interface LinhaQc {
  teste: string;
  especificacao: string | null;
}

export interface OrdemFabricacao {
  formulaId: number;
  formulaNome: string;
  pesoKg: number;
  passos: PassoImpressao[];
  qc: LinhaQc[];
  // roteiro faltando, soma diferente de 100 — aparecem na tela, não na folha
  avisos: string[];
}

export interface FormulaComRoteiro {
  formulaId: number;
  nome: string;
  passos: number;
}
