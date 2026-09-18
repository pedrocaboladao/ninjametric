export interface UsuarioBasico {
  id: number;
  nome: string;
  online: boolean;
}

export interface Conversa {
  usuario: UsuarioBasico;
  ultimaMensagem: string;
  ultimaMensagemEm: string;
  enviadaPorMim: boolean;
  naoLidas: number;
}

export interface Mensagem {
  id: number;
  remetenteId: number;
  destinatarioId: number;
  texto: string;
  lida: boolean;
  criadoEm: string;
}
