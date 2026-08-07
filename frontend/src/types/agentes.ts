export interface ObservacaoAds {
  id: number;
  lojaId: number;
  lojaNome: string;
  campanhaId: string;
  campanhaNome: string;
  tipo: string;
  contexto: string;
  acao: string;
  status: "pendente" | "resolvida";
  resolvidoPor: "usuario" | "sistema" | null;
  criadoEm: string;
  resolvidoEm: string | null;
  janela: string;
}

export interface PensamentoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
}

export interface MensagemChat {
  papel: "usuario" | "agente";
  texto: string;
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

export interface PerfilImagens {
  id: number;
  nome: string;
  cores: string;
  imagemReferenciaBase64: string | null;
  beneficiosPadrao: string;
  ondeAplicarPadrao: string;
  criadoEm: string;
}
