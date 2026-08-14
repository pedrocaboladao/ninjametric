import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "./pool";
import { criarCategoria, salvarLancamentosDoMes } from "../services/pesquisaService";

interface LinhaHistorico {
  mes: string;
  vendedor: string;
  qtde: number;
  totalReais: number;
}

async function obterOuCriarCategoriaId(nome: string): Promise<number> {
  const { rows } = await pool.query("SELECT id FROM pesquisa_categorias WHERE nome = $1", [nome]);
  if (rows.length > 0) return rows[0].id;
  const categoria = await criarCategoria(nome);
  return categoria.id;
}

async function importar() {
  const caminho = join(__dirname, "data", "pesquisa-mercado-historico.json");
  const dados: Record<string, LinhaHistorico[]> = JSON.parse(readFileSync(caminho, "utf-8"));

  for (const [nomeCategoria, linhas] of Object.entries(dados)) {
    const categoriaId = await obterOuCriarCategoriaId(nomeCategoria);

    const porMes = new Map<string, LinhaHistorico[]>();
    for (const linha of linhas) {
      if (!porMes.has(linha.mes)) porMes.set(linha.mes, []);
      porMes.get(linha.mes)!.push(linha);
    }

    for (const [mes, linhasDoMes] of porMes) {
      await salvarLancamentosDoMes(
        categoriaId,
        mes,
        linhasDoMes.map((l) => ({ vendedor: l.vendedor, qtde: l.qtde, totalReais: l.totalReais }))
      );
    }
    console.log(`${nomeCategoria}: ${linhas.length} lançamentos em ${porMes.size} meses`);
  }

  console.log("Importação do histórico de Pesquisa de Mercado concluída.");
  await pool.end();
}

importar().catch((err) => {
  console.error("Falha ao importar histórico de Pesquisa de Mercado:", err);
  process.exit(1);
});
