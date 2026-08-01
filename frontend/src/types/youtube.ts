export interface CanalYoutube {
  id: number;
  nome: string;
  channelId: string;
  url: string;
}

export interface VideoRecente {
  canalId: number;
  canalNome: string;
  videoId: string;
  titulo: string;
  thumbnail: string;
  publicadoEm: string;
  link: string;
}
