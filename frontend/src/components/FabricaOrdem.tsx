import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrdemFabricacao, FormulaComRoteiro } from "../types/fabricaOrdem";
import { BuscaSelecao } from "./BuscaSelecao";
import type { ItemBusca } from "./BuscaSelecao";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function tratar<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Erro ${res.status}`);
  }
  return res.json();
}

async function fetchFormulas(): Promise<FormulaComRoteiro[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-ordem/formulas`, { credentials: "include" });
  return (await tratar<{ formulas: FormulaComRoteiro[] }>(res)).formulas;
}

interface ResultadoImportacao {
  passos: number;
  instrucoes: number;
  qc: number;
  naoEncontrados: string[];
  ambiguos: string[];
  somaPercentual: number;
}

async function importar(
  formulaId: number,
  texto: string,
  textoQc: string
): Promise<ResultadoImportacao> {
  const res = await fetch(`${API_BASE}/api/fabrica-ordem/${formulaId}/importar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto, textoQc }),
  });
  return tratar<ResultadoImportacao>(res);
}

interface ResultadoLote {
  formulaId: number | null;
  titulo: string;
  erro: string | null;
  resultado: ResultadoImportacao | null;
}

async function importarLote(texto: string): Promise<ResultadoLote[]> {
  const res = await fetch(`${API_BASE}/api/fabrica-ordem/importar-lote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ texto }),
  });
  return (await tratar<{ formulas: ResultadoLote[] }>(res)).formulas;
}

async function fetchOrdem(formulaId: number, peso: number): Promise<OrdemFabricacao> {
  const res = await fetch(`${API_BASE}/api/fabrica-ordem/${formulaId}?peso=${peso}`, {
    credentials: "include",
  });
  return (await tratar<{ ordem: OrdemFabricacao }>(res)).ordem;
}

// aceita "1.400" e "1400,5" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
}

function kg(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function hoje(): string {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function FabricaOrdem() {
  const [formulas, setFormulas] = useState<FormulaComRoteiro[]>([]);
  const [formulaId, setFormulaId] = useState("");
  const [peso, setPeso] = useState("1400");
  const [ordem, setOrdem] = useState<OrdemFabricacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [colado, setColado] = useState("");
  const [coladoQc, setColadoQc] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarLote, setMostrarLote] = useState(false);
  const [coladoLote, setColadoLote] = useState("");
  const [resultadoLote, setResultadoLote] = useState<ResultadoLote[] | null>(null);

  useEffect(() => {
    fetchFormulas()
      .then(setFormulas)
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar fórmulas."));
  }, []);

  const gerar = useCallback(async () => {
    const id = Number(formulaId);
    if (!Number.isInteger(id) || !id) return;
    setCarregando(true);
    try {
      setOrdem(await fetchOrdem(id, num(peso)));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao montar a ordem.");
      setOrdem(null);
    } finally {
      setCarregando(false);
    }
  }, [formulaId, peso]);

  // regera sozinho ao trocar fórmula ou peso: o operador digita 800 e a folha
  // já mostra as massas de 800, sem clicar em nada
  useEffect(() => {
    if (!formulaId) return;
    const t = setTimeout(() => void gerar(), 400);
    return () => clearTimeout(t);
  }, [formulaId, peso, gerar]);

  async function importarColado() {
    const id = Number(formulaId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a fórmula primeiro.");
    try {
      const r = await importar(id, colado, coladoQc);
      const partes = [
        `${r.passos} passos e ${r.instrucoes} instruções importados`,
        `somam ${r.somaPercentual.toFixed(2)}%`,
      ];
      if (r.qc) partes.push(`${r.qc} testes de qualidade`);
      if (r.naoEncontrados.length)
        partes.push(`não achei no cadastro: ${r.naoEncontrados.join(", ")}`);
      if (r.ambiguos.length) partes.push(`nome ambíguo: ${r.ambiguos.join(", ")}`);
      setAviso(partes.join(" · "));
      setErro(null);
      setMostrarImportar(false);
      setColado("");
      setColadoQc("");
      setFormulas(await fetchFormulas());
      await gerar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar.");
    }
  }

  async function importarLoteColado() {
    try {
      const r = await importarLote(coladoLote);
      setResultadoLote(r);
      setErro(null);
      setFormulas(await fetchFormulas());
      if (formulaId) await gerar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao importar o lote.");
    }
  }

  const itens: ItemBusca[] = useMemo(
    () =>
      formulas.map((f) => ({
        id: f.formulaId,
        titulo: f.nome,
        detalhe: f.passos ? `${f.passos} passos no roteiro` : "sem roteiro — sai na ordem do cadastro",
      })),
    [formulas]
  );

  const semRoteiro = useMemo(() => formulas.filter((f) => !f.passos).length, [formulas]);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo ordem-sem-impressao">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Ordem de fabricação</h1>
          <p className="financeiro-td-mudo">
            Escolha a fórmula, digite quanto vai produzir e imprima. A folha sai na ordem exata de
            fazer, com a massa de cada insumo já calculada e os tempos de espera no meio. Fórmula de
            cor traz a base junto — o lote não começa no pigmento, começa no tanque.
          </p>
        </div>
        {semRoteiro > 0 && (
          <div>
            <div className="financeiro-stat-label">SEM ROTEIRO</div>
            <div className="financeiro-stat-valor">{semRoteiro}</div>
          </div>
        )}
      </div>

      <div className="financeiro-filtros ordem-sem-impressao">
        <BuscaSelecao
          itens={itens}
          valor={formulaId ? Number(formulaId) : null}
          placeholder="Buscar a fórmula"
          onEscolher={(id) => setFormulaId(id ? String(id) : "")}
        />
        <input
          className="clonar-input fabricacao-input-pequeno"
          placeholder="Quanto vai produzir (kg)"
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
        />
        <button
          type="button"
          className="btn-responder"
          onClick={() => window.print()}
          disabled={!ordem}
        >
          Imprimir
        </button>
        <button
          type="button"
          className="btn-excluir"
          onClick={() => setMostrarImportar((v) => !v)}
          disabled={!formulaId}
        >
          {mostrarImportar ? "Fechar" : "Colar roteiro da planilha"}
        </button>
        <button
          type="button"
          className="btn-excluir"
          onClick={() => setMostrarLote((v) => !v)}
        >
          {mostrarLote ? "Fechar" : "Colar várias fórmulas"}
        </button>
      </div>

      {mostrarImportar && (
        <div className="ordem-sem-impressao">
          <p className="financeiro-td-mudo">
            Abra a planilha, selecione as linhas da ordem de produção — do primeiro item até o
            último, incluindo as linhas de espera — e cole aqui com Ctrl+V. O Excel copia as colunas
            separadas por tabulação, então não precisa arrumar nada: linha com código, nome e
            percentual vira passo; linha só com texto vira instrução.
          </p>
          <textarea
            className="clonar-input clonar-textarea"
            rows={10}
            placeholder="Cole aqui as linhas da fórmula"
            value={colado}
            onChange={(e) => setColado(e.target.value)}
          />
          <textarea
            className="clonar-input clonar-textarea"
            rows={5}
            placeholder="Cole aqui o controle de qualidade (opcional): teste e especificação"
            value={coladoQc}
            onChange={(e) => setColadoQc(e.target.value)}
          />
          <button type="button" className="btn-responder" onClick={() => void importarColado()}>
            Importar roteiro
          </button>
        </div>
      )}

      {mostrarLote && (
        <div className="ordem-sem-impressao">
          <p className="financeiro-td-mudo">
            Para planilha que tem várias fórmulas numa aba só — a tabela de cores, por exemplo.
            Selecione a aba inteira e cole aqui. Cada bloco precisa começar numa linha só com o
            nome da fórmula, escrito igual ao cadastro; as linhas de ITEM, TOTAL e peso do lote são
            ignoradas sozinhas.
          </p>
          <textarea
            className="clonar-input clonar-textarea"
            rows={12}
            placeholder="Cole aqui a aba inteira, com várias fórmulas"
            value={coladoLote}
            onChange={(e) => setColadoLote(e.target.value)}
          />
          <button type="button" className="btn-responder" onClick={() => void importarLoteColado()}>
            Importar todas
          </button>
        </div>
      )}

      {resultadoLote && (
        <div className="ordem-sem-impressao">
          {resultadoLote.map((l, i) => (
            <p key={i} className="financeiro-td-mudo">
              {l.erro
                ? `✗ ${l.titulo}: ${l.erro}`
                : `✓ ${l.titulo}: ${l.resultado?.passos} passos, ${l.resultado?.instrucoes} instruções, soma ${l.resultado?.somaPercentual.toFixed(2)}%` +
                  (l.resultado?.naoEncontrados.length
                    ? ` — não achei: ${l.resultado.naoEncontrados.join(", ")}`
                    : "") +
                  (l.resultado?.ambiguos.length
                    ? ` — ambíguo: ${l.resultado.ambiguos.join(", ")}`
                    : "")}
            </p>
          ))}
        </div>
      )}

      {erro && <p className="financeiro-td-mudo ordem-sem-impressao">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo ordem-sem-impressao">{aviso}</p>}
      {carregando && <p className="financeiro-td-mudo ordem-sem-impressao">Montando…</p>}

      {ordem && ordem.avisos.length > 0 && (
        <div className="ordem-sem-impressao">
          {ordem.avisos.map((a, i) => (
            <p key={i} className="financeiro-td-mudo">
              ⚠ {a}
            </p>
          ))}
        </div>
      )}

      {ordem && (
        <div className="ordem-folha">
          <div className="ordem-cabecalho">
            <div>
              <div className="ordem-empresa">IMPETRUS — FÁBRICA DISTRIBUIDORA</div>
              <h2>{ordem.formulaNome}</h2>
            </div>
            <div className="ordem-cabecalho-dados">
              <div>
                <strong>LOTE:</strong> ____________
              </div>
              <div>
                <strong>PESO:</strong> {kg(ordem.pesoKg)} kg
              </div>
              <div>
                <strong>DATA:</strong> {hoje()}
              </div>
              <div>
                <strong>OPERADOR:</strong> ____________
              </div>
            </div>
          </div>

          <table className="ordem-tabela">
            <thead>
              <tr>
                <th>ITEM</th>
                <th>CÓDIGO</th>
                <th>MATÉRIA-PRIMA</th>
                <th className="ordem-num">%</th>
                <th className="ordem-num">MASSA (kg)</th>
                <th className="ordem-num">PESADO</th>
              </tr>
            </thead>
            <tbody>
              {ordem.passos.map((p, i) => {
                if (p.tipo === "cabecalho") {
                  return (
                    <tr key={i} className="ordem-linha-base">
                      <td colSpan={6}>{p.descricao}</td>
                    </tr>
                  );
                }
                if (p.tipo === "instrucao") {
                  return (
                    <tr key={i} className="ordem-linha-instrucao">
                      <td colSpan={6}>{p.descricao}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className={p.nivel > 0 ? "ordem-linha-filha" : undefined}>
                    <td>{p.numero}</td>
                    <td>{p.codigo ?? ""}</td>
                    <td>{p.descricao}</td>
                    <td className="ordem-num">{p.percentual?.toFixed(3) ?? ""}</td>
                    <td className="ordem-num">{p.massaKg !== null ? kg(p.massaKg) : ""}</td>
                    {/* espaço em branco de propósito: o operador anota o que a
                        balança marcou, e a diferença aparece na conferência */}
                    <td className="ordem-num ordem-pesado" />
                  </tr>
                );
              })}
            </tbody>
          </table>

          {ordem.qc.length > 0 && (
            <>
              <h3 className="ordem-secao">CONTROLE DE QUALIDADE</h3>
              <table className="ordem-tabela">
                <thead>
                  <tr>
                    <th>TESTE</th>
                    <th>ESPECIFICAÇÃO</th>
                    <th className="ordem-num">MEDIDO</th>
                  </tr>
                </thead>
                <tbody>
                  {ordem.qc.map((l, i) => (
                    <tr key={i}>
                      <td>{l.teste}</td>
                      <td>{l.especificacao ?? ""}</td>
                      <td className="ordem-num ordem-pesado" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="ordem-assinaturas">
            <div>PESO REAL: ____________ kg</div>
            <div>LIBERADO POR: ____________________</div>
          </div>
        </div>
      )}
    </div>
  );
}
