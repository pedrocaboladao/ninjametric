export interface PensamentoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
  janela: string;
}

export interface MensagemChat {
  papel: "usuario" | "agente";
  texto: string;
}

export interface BriefingGrowthHacker {
  id: number;
  pensamento: string;
  criadoEm: string;
}

export interface VendaRecente {
  chave: string;
  lojaId: number;
  lojaNome: string;
  titulo: string;
  quantidade: number;
  valor: number;
  dataCriacao: string;
  negativa: boolean;
}

export interface Oportunidade {
  id: number;
  sku: string;
  titulo: string;
  quantidadeGrupo: number;
  quantidadeMinhasLojas: number;
  contexto: string;
  criadoEm: string;
}

export interface PensamentoConversao {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
}

export interface PensamentoCatalogo {
  id: number;
  pensamento: string;
  criadoEm: string;
  lojaId: number | null;
  lojaNome: string | null;
}

export interface ItemPlanoDiario {
  id: number;
  descricao: string;
  concluido: boolean;
  concluidoEm: string | null;
}

export interface PlanoDiario {
  id: number;
  pensamento: string;
  criadoEm: string;
  itens: ItemPlanoDiario[];
}

export interface ResumoEscritorio {
  vendasHoje: number;
  conversaoMediaHoje: number | null;
  lucroAdsHoje: number | null;
}

export interface PerfilImagens {
  id: number;
  nome: string;
  cores: string;
  imagemReferenciaBase64: string | null;
  beneficiosPadrao: string;
  ondeAplicarPadrao: string;
  criadoEm: string;
}
