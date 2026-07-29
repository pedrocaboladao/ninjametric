export interface Usuario {
  id: number;
  username: string;
  nome: string;
  admin: boolean;
  permissoes: string[];
  lojas: number[];
  todasLojas: boolean;
}
