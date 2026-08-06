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
}

export interface PensamentoAds {
  id: number;
  pensamento: string;
  criadoEm: string;
}
