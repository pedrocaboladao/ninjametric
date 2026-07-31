import { chaveJanelaDoDia } from "./dateUtils";
import { getTopVendidosPromocoes } from "./dashboardService";
import { listarUsuarios } from "./usuariosService";

const HORARIOS_ATUALIZACAO_PROMOCOES = [8, 15];
const INTERVALO_VERIFICACAO_MS = 2 * 60 * 1000;

let ultimaJanelaAquecida: string | null = null;

async function aquecerCache(): Promise<void> {
  try {
    await getTopVendidosPromocoes(undefined, undefined); // Todas as lojas
    const admins = (await listarUsuarios()).filter((u) => u.admin);
    for (const admin of admins) {
      await getTopVendidosPromocoes(undefined, admin.lojas); // Minhas lojas desse admin
    }
    console.log("Pré-aquecimento do diagnóstico de promoções concluído.");
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
