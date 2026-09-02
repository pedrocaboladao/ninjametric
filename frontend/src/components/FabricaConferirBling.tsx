import { useCallback, useEffect, useState } from "react";
import { conferirContraBling, trazerValorDoBling } from "../api/fabricaContas";
import type { ConferenciaContas, ContaConferida } from "../api/fabricaContas";
import { formatCurrency } from "../utils/format";

function data(d: string): string {
  return d && d.includes("-") ? d.split("-").reverse().join("/") : d || "—";
}

function hoje(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function primeiroDoMes(): string {
  return `${hoje().slice(0, 7)}-01`;
}

// Conferência de contas a pagar contra o Bling.
//
// O sentido é sempre o mesmo: o site cria a conta recorrente como previsão,
// repetindo o valor do mês anterior; quando o boleto chega, quem corrige é a
// funcionária, no Bling. Então numa divergência de valor ou data quem manda é
// o Bling — e o botão só existe nesse sentido, de propósito.
export function FabricaConferirBling() {
  const [de, setDe] = useState(primeiroDoMes);
  const [ate, setAte] = useState(hoje);
  const [dados, setDados] = useState<ConferenciaContas | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<number | null>(null);
  const [aplicados, setAplicados] = useState<Set<number>>(new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await conferirContraBling(de, ate));
      setAplicados(new Set());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao conferir.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function trazer(c: ContaConferida) {
    if (!c.siteId || c.blingValor === undefined) return;
    setAplicando(c.siteId);
    setErro(null);
    setAviso(null);
    try {
      const r = await trazerValorDoBling(c.siteId, c.blingValor, c.blingVencimento);
      setAplicados((s) => new Set(s).add(c.siteId as number));
      setAviso(
        `${c.contraparte || c.documento}: ${formatCurrency(r.valorAnterior)} → ` +
          `${formatCurrency(c.blingValor)} — anotado na observação da conta.`
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao trazer o valor.");
    } finally {
      setAplicando(null);
    }
  }

  const linhas = (lista: ContaConferida[], comBotao: boolean) =>
    lista.map((c, i) => {
      const feito = c.siteId !== undefined && aplicados.has(c.siteId);
      return (
        <tr key={`${c.blingId ?? "b"}-${c.siteId ?? "s"}-${i}`}>
          <td>{c.contraparte || "—"}</td>
          <td className="financeiro-td-mudo">{c.documento || "—"}</td>
          <td className="financeiro-td-mudo">{c.categoria}</td>
          <td className="financeiro-td-mudo">{data(c.vencimento)}</td>
          <td className="financeiro-th-numero">{formatCurrency(c.valor)}</td>
          <td className="financeiro-td-mudo">
            {c.diferenca ?? "—"}
            {c.parEncontradoPor === "valor" && (
              <span className="financeiro-td-mudo"> · casada por valor</span>
            )}
          </td>
          {comBotao && (
            <td className="contas-acoes">
              {feito ? (
                <span className="financeiro-td-mudo">trazido ✓</span>
              ) : c.siteId && c.blingValor !== undefined ? (
                <button
                  type="button"
                  className="btn-responder"
                  disabled={aplicando === c.siteId}
                  onClick={() => void trazer(c)}
                >
                  {aplicando === c.siteId ? "trazendo…" : "trazer o valor do Bling"}
                </button>
              ) : (
                <span className="financeiro-td-mudo">—</span>
              )}
            </td>
          )}
        </tr>
      );
    });

  const tabela = (
    titulo: string,
    ajuda: string,
    lista: ContaConferida[],
    comBotao: boolean
  ) => (
    <div className="conferir-bling-bloco">
      <p className="financeiro-td-mudo">
        <strong>
          {titulo} ({lista.length})
        </strong>
        {" · "}
        {ajuda}
      </p>
      {lista.length > 0 && (
        <div className="financeiro-tabela-wrap">
          <table className="financeiro-tabela">
            <thead>
              <tr>
                <th>CONTRAPARTE</th>
                <th>DOCUMENTO</th>
                <th>CATEGORIA</th>
                <th>VENCIMENTO</th>
                <th className="financeiro-th-numero">VALOR</th>
                <th>DIFERENÇA</th>
                {comBotao && <th>AÇÃO</th>}
              </tr>
            </thead>
            <tbody>{linhas(lista, comBotao)}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="financeiro-filtros">
        <label className="financeiro-td-mudo">
          de{" "}
          <input
            type="date"
            className="clonar-input fabricacao-input-pequeno"
            value={de}
            onChange={(e) => setDe(e.target.value)}
          />
        </label>
        <label className="financeiro-td-mudo">
          até{" "}
          <input
            type="date"
            className="clonar-input fabricacao-input-pequeno"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-responder"
          disabled={carregando}
          onClick={() => void carregar()}
        >
          {carregando ? "conferindo…" : "conferir"}
        </button>
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      {carregando && !dados && <p className="financeiro-td-mudo">Lendo o Bling…</p>}

      {dados && (
        <>
          <p className="financeiro-td-mudo">
            {dados.noBling} contas no Bling · {dados.noSite} no site ·{" "}
            <strong>{dados.conferem} conferem</strong> · {dados.divergentes.length} divergentes ·{" "}
            {dados.soNoBling.length} só no Bling · {dados.soNoSite.length} só no site
          </p>
          <p className="financeiro-td-mudo">
            O Bling é a referência: é lá que o provisionamento vira o valor do boleto. Trazer o
            valor sobrescreve a conta do site e anota na observação de onde veio e qual era o
            valor antes.
          </p>

          {tabela(
            "Divergentes",
            "mesma conta dos dois lados, com valor, data ou nome diferente",
            dados.divergentes,
            true
          )}
          {tabela(
            "Só no Bling",
            "existe no Bling e não no site — lançar à mão na aba de contas",
            dados.soNoBling,
            false
          )}
          {tabela(
            "Só no site",
            "existe no site e não no Bling — conferir se foi paga ou se nunca existiu",
            dados.soNoSite,
            false
          )}
        </>
      )}
    </div>
  );
}
