import { pool } from "../db/pool";

// Perfis de marca salvos pro Kit de Fotos — não é a IA "aprendendo", é só
// lembrar as configurações que se repetem entre produtos da mesma marca
// (cores, foto de referência, benefícios/locais padrão) pra não re-digitar
// tudo a cada anúncio novo. Benefícios/locais ficam salvos como texto com
// quebra de linha, no mesmo formato que o formulário já usa.

export interface PerfilImagens {
  id: number;
  nome: string;
  cores: string;
  imagemReferenciaBase64: string | null;
  beneficiosPadrao: string;
  ondeAplicarPadrao: string;
  criadoEm: string;
}

export async function listarPerfis(): Promise<PerfilImagens[]> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    cores: string;
    imagem_referencia_base64: string | null;
    beneficios_padrao: string;
    onde_aplicar_padrao: string;
    criado_em: string;
  }>(
    `SELECT id, nome, cores, imagem_referencia_base64, beneficios_padrao, onde_aplicar_padrao, criado_em
     FROM agente_imagens_perfis
     ORDER BY nome ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    cores: r.cores,
    imagemReferenciaBase64: r.imagem_referencia_base64,
    beneficiosPadrao: r.beneficios_padrao,
    ondeAplicarPadrao: r.onde_aplicar_padrao,
    criadoEm: r.criado_em,
  }));
}

export interface DadosNovoPerfil {
  nome: string;
  cores: string;
  imagemReferenciaBase64: string | null;
  beneficiosPadrao: string;
  ondeAplicarPadrao: string;
}

export async function criarPerfil(dados: DadosNovoPerfil): Promise<PerfilImagens> {
  const { rows } = await pool.query<{
    id: number;
    nome: string;
    cores: string;
    imagem_referencia_base64: string | null;
    beneficios_padrao: string;
    onde_aplicar_padrao: string;
    criado_em: string;
  }>(
    `INSERT INTO agente_imagens_perfis (nome, cores, imagem_referencia_base64, beneficios_padrao, onde_aplicar_padrao)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nome, cores, imagem_referencia_base64, beneficios_padrao, onde_aplicar_padrao, criado_em`,
    [dados.nome, dados.cores, dados.imagemReferenciaBase64, dados.beneficiosPadrao, dados.ondeAplicarPadrao]
  );
  const r = rows[0];
  return {
    id: r.id,
    nome: r.nome,
    cores: r.cores,
    imagemReferenciaBase64: r.imagem_referencia_base64,
    beneficiosPadrao: r.beneficios_padrao,
    ondeAplicarPadrao: r.onde_aplicar_padrao,
    criadoEm: r.criado_em,
  };
}

export async function excluirPerfil(id: number): Promise<void> {
  const { rowCount } = await pool.query("DELETE FROM agente_imagens_perfis WHERE id = $1", [id]);
  if (!rowCount) {
    throw new Error("Perfil não encontrado.");
  }
}

// Galeria de referências visuais do perfil — cresce conforme o dono
// "favorita" resultados que gostou. Guarda só as mais recentes (as antigas
// somem sozinhas) pra não crescer sem limite; quem gera o kit usa até 3
// dessas como exemplo real de estilo.
const MAX_REFERENCIAS_POR_PERFIL = 6;

export async function adicionarReferencia(perfilId: number, imagemBase64: string): Promise<void> {
  await pool.query("INSERT INTO agente_imagens_perfil_referencias (perfil_id, imagem_base64) VALUES ($1, $2)", [
    perfilId,
    imagemBase64,
  ]);
  await pool.query(
    `DELETE FROM agente_imagens_perfil_referencias
     WHERE perfil_id = $1
       AND id NOT IN (
         SELECT id FROM agente_imagens_perfil_referencias WHERE perfil_id = $1 ORDER BY criado_em DESC LIMIT $2
       )`,
    [perfilId, MAX_REFERENCIAS_POR_PERFIL]
  );
}

export async function listarReferencias(perfilId: number, limite = 3): Promise<string[]> {
  const { rows } = await pool.query<{ imagem_base64: string }>(
    "SELECT imagem_base64 FROM agente_imagens_perfil_referencias WHERE perfil_id = $1 ORDER BY criado_em DESC LIMIT $2",
    [perfilId, limite]
  );
  return rows.map((r) => r.imagem_base64);
}
