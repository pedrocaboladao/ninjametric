import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { pool } from "../db/pool";

// Mesmo modelo/padrão dos outros agentes de IA do projeto (ver
// agenteAdsService.ts) — tarefa curta e direta, não precisa de modelo mais
// caro nem de raciocínio estendido.
const MODELO_IA = "claude-sonnet-5";

let clienteAnthropic: Anthropic | null | undefined;
function obterClienteAnthropic(): Anthropic | null {
  if (clienteAnthropic === undefined) {
    clienteAnthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
  }
  return clienteAnthropic;
}

// Quantos exemplos reais recentes da própria loja entram como referência —
// não é "aprendizado" do modelo, é contexto real injetado no prompt a cada
// chamada (ver comentário na tabela perguntas_ia_historico).
const MAX_EXEMPLOS = 8;

interface ExemploHistorico {
  perguntaTexto: string;
  respostaEnviada: string;
}

async function buscarExemplosRecentes(lojaId: number): Promise<ExemploHistorico[]> {
  const { rows } = await pool.query<{ pergunta_texto: string; resposta_enviada: string }>(
    `SELECT pergunta_texto, resposta_enviada FROM perguntas_ia_historico
     WHERE loja_id = $1
     ORDER BY criado_em DESC
     LIMIT $2`,
    [lojaId, MAX_EXEMPLOS]
  );
  return rows.map((r) => ({ perguntaTexto: r.pergunta_texto, respostaEnviada: r.resposta_enviada }));
}

function construirExemplos(exemplos: ExemploHistorico[]): string {
  return exemplos
    .map((e, i) => `Exemplo ${i + 1}:\nPergunta: "${e.perguntaTexto}"\nResposta enviada: "${e.respostaEnviada}"`)
    .join("\n\n");
}

// Sugere uma resposta pra revisão humana — nunca envia nada sozinho (ver
// routes/perguntas.ts). null quando a chave não está configurada ou a IA
// falha, pra o front cair de volta no campo em branco sem travar a tela.
export async function sugerirResposta(
  lojaId: number,
  perguntaTexto: string,
  produtoTitulo: string | null
): Promise<string | null> {
  const client = obterClienteAnthropic();
  if (!client) return null;

  try {
    const exemplos = await buscarExemplosRecentes(lojaId);
    const blocoExemplos =
      exemplos.length > 0
        ? `\n\nExemplos reais de como essa loja já respondeu perguntas antes (use como referência de tom e estilo — não copie literalmente se não fizer sentido pra pergunta atual):\n\n${construirExemplos(exemplos)}`
        : "";

    const resposta = await client.messages.create({
      model: MODELO_IA,
      max_tokens: 500,
      system: `Você ajuda um vendedor de tintas e material de construção do Mercado Livre a rascunhar respostas pra perguntas de compradores em potencial (antes da venda) — um humano sempre revisa antes de enviar.

Regras:
- Responda em português, direto e cordial, sem se apresentar nem se despedir — só o texto da resposta, pronto pra copiar.
- Nunca prometa nem confirme algo que não está claramente no título do produto informado (cor, tamanho, quantidade, compatibilidade) — se a pergunta pedir uma informação que você não tem certeza, seja honesto e sugira que o comprador confira a ficha técnica do anúncio, não invente.
- Seja breve — no máximo 2-3 frases.${blocoExemplos}`,
      messages: [
        {
          role: "user",
          content: `Produto: ${produtoTitulo ?? "não identificado"}\nPergunta do comprador: "${perguntaTexto}"\n\nSugira uma resposta.`,
        },
      ],
    });

    console.log(
      `Sugestão de resposta (IA): ${resposta.usage.input_tokens} tokens de entrada, ${resposta.usage.output_tokens} de saída.`
    );

    const texto = resposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return texto || null;
  } catch (err) {
    console.error("perguntasIAService: falha ao sugerir resposta:", err);
    return null;
  }
}

// Registra toda resposta REAL enviada (aceitando a sugestão, editando ou
// digitando do zero) — vira o histórico usado nas próximas sugestões. Uma
// falha aqui não pode derrubar o envio da resposta em si (ver
// routes/perguntas.ts, chamado depois do answerQuestion já ter dado certo).
export async function registrarRespostaEnviada(
  lojaId: number,
  perguntaTexto: string,
  produtoTitulo: string | null,
  respostaSugerida: string | null,
  respostaEnviada: string
): Promise<void> {
  await pool.query(
    `INSERT INTO perguntas_ia_historico (loja_id, produto_titulo, pergunta_texto, resposta_sugerida, resposta_enviada)
     VALUES ($1, $2, $3, $4, $5)`,
    [lojaId, produtoTitulo, perguntaTexto, respostaSugerida, respostaEnviada]
  );
}
