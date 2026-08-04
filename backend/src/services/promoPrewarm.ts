import { chaveJanelaDoDia } from "./dateUtils";
import { getTopVendidosPromocoes } from "./dashboardService";
import { listarUsuarios } from "./usuariosService";

const HORARIOS_ATUALIZACAO_PROMOCOES = [8, 15];
const INTERVALO_VERIFICACAO_MS = 2 * 60 * 1000;

let ultimaJanelaAquecida: string | null = null;

async function aquecerCache(): Promise<void> {
  try {
    await getTopVendidosPromocoes(undefined, undefined); // Todas as lojas

    // "Minhas lojas" usa sempre o array bruto usuario.lojas (ver
    // resolverLojaFiltro em routes/dashboard.ts), independente de admin —
    // então aquece pra QUALQUER usuário com acesso ao Dashboard, não só
    // admins. Agrupa por subconjunto único de lojas (várias pessoas podem
    // ter exatamente o mesmo conjunto) pra não repetir a mesma busca lenta
    // à toa.
    const usuarios = await listarUsuarios();
    const podeVerDashboard = usuarios.filter((u) => u.admin || u.permissoes.includes("dashboard"));
    const subconjuntosUnicos = new Map<string, number[]>();
    for (const u of podeVerDashboard) {
      const chave = [...u.lojas].sort((a, b) => a - b).join(",");
      if (!subconjuntosUnicos.has(chave)) subconjuntosUnicos.set(chave, u.lojas);
    }
    for (const lojas of subconjuntosUnicos.values()) {
      await getTopVendidosPromocoes(undefined, lojas);
    }
    console.log(
      `Pré-aquecimento do diagnóstico de promoções concluído (${subconjuntosUnicos.size} subconjuntos de "minhas lojas").`
    );
  } catch (err) {
    console.error("Falha ao pré-aquecer diagnóstico de promoções:", err);
  }
}

// Roda em segundo plano desde a inicialização do servidor, verificando
// periodicamente se cruzamos um horário-âncora (8h/15h). Quando cruza,
// recalcula o diagnóstico de promoções ("Todas as lojas" e "Minhas lojas" de
// cada admin) proativamente, antes de qualquer usuário pedir — assim ninguém
// paga o custo da primeira busca lenta do dia.
export function iniciarPrewarmPromocoes(): void {
  async function verificar() {
    const janelaAtual = chaveJanelaDoDia(HORARIOS_ATUALIZACAO_PROMOCOES);
    if (janelaAtual !== ultimaJanelaAquecida) {
      ultimaJanelaAquecida = janelaAtual;
      await aquecerCache();
    }
  }

  verificar();
  setInterval(verificar, INTERVALO_VERIFICACAO_MS);
}
