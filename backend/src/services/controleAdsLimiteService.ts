// O plano de ação por IA custa caro (Opus + thinking) — e, por pedido
// explícito do dono, é de uso exclusivo dele. Ninguém mais pode gerar,
// nem com limite semanal: o botão fica bloqueado pra todo o resto da
// equipe, não só limitado.
const USUARIO_DONO = "pedroca";

export function planoSemLimite(usuario: { username: string }): boolean {
  return usuario.username === USUARIO_DONO;
}

export interface StatusPlanoAds {
  // false pra todo mundo que não é o dono — o front usa isso pra esconder o
  // botão de vez, não pra mostrar "limite atingido".
  permitido: boolean;
}

export async function obterStatusPlano(usuario: { username: string }): Promise<StatusPlanoAds> {
  return { permitido: planoSemLimite(usuario) };
}
