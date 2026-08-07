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
