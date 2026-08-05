import { useEffect, useState } from "react";

// EAN-13 válido: 12 dígitos + dígito verificador (padrão GS1, posições
// ímpares peso 1, pares peso 3, contando da esquerda, 1-indexado).
// Primeiro dígito fixo em "2" — faixa reservada pra uso interno/restrito
// (não é um prefixo de empresa real registrado no GS1), evita gerar um
// código que colida com um EAN de verdade já em circulação.
function calcularDigitoVerificador(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function gerarEan13(): string {
  const corpo = "2" + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");
  return corpo + calcularDigitoVerificador(corpo);
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function GeradorEan() {
  const [ean, setEan] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [historico, setHistorico] = useState<string[]>([]);

  async function gerarNovo() {
    const novo = gerarEan13();
    setEan(novo);
    setHistorico((atual) => [novo, ...atual].slice(0, 10));
    const ok = await copiar(novo);
    setCopiado(ok);
  }

  useEffect(() => {
    gerarNovo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Gerador de EAN</span>
          <h1>Código de barras EAN-13</h1>
          <p className="painel-sub">
            Gera um EAN-13 válido (13 dígitos com dígito verificador correto) e já copia pra área de transferência —
            é só colar direto no cadastro do produto. Cada clique em "Gerar outro" já copia o novo código sozinho.
          </p>
        </div>
      </div>

      <div className="ean-card">
        <span className="ean-codigo">{ean}</span>
        <span className={copiado ? "ean-status ean-status-ok" : "ean-status ean-status-erro"}>
          {copiado ? "Copiado pra área de transferência ✓" : "Não consegui copiar automaticamente — copie manualmente"}
        </span>
        <button type="button" className="btn-responder" onClick={gerarNovo}>
          Gerar outro
        </button>
      </div>

      {historico.length > 1 && (
        <div className="ean-historico">
          <span className="financeiro-stat-label">Gerados nessa sessão</span>
          {historico.slice(1).map((codigo, i) => (
            <div key={i} className="ean-historico-linha">
              <span className="financeiro-td-mudo">{codigo}</span>
              <button
                type="button"
                className="ean-historico-copiar"
                onClick={async () => setCopiado(await copiar(codigo))}
              >
                Copiar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
