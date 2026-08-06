import { useCallback, useEffect, useState } from "react";
import { fetchCampanhas, criarCampanha, recriarCampanha } from "../api/promocoes";
import { fetchLojas, type Loja } from "../api/lojas";
import type { Campanha, ResultadoCriarCampanha } from "../types/promocoes";
import { formatCurrency } from "../utils/format";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";

function diasAte(dataISO: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataISO}T00:00:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
}

function statusInfo(c: Campanha): { texto: string; classe: string } {
  if (c.status === "finished") return { texto: "Vencida", classe: "financeiro-margem-negativa" };
  const dias = diasAte(c.dataFim);
  if (dias <= 0) return { texto: "Vencida", classe: "financeiro-margem-negativa" };
  if (dias <= 2) return { texto: `Vence em ${dias} dia${dias > 1 ? "s" : ""}`, classe: "financeiro-margem-alerta" };
  if (c.status === "pending") return { texto: "Aguardando início", classe: "financeiro-td-mudo" };
  return { texto: `Ativa — vence em ${dias} dias`, classe: "financeiro-margem-positiva" };
}

function ResultadoCriacao({ resultado }: { resultado: ResultadoCriarCampanha }) {
  const sucesso = resultado.itens.filter((i) => i.ok);
  const falha = resultado.itens.filter((i) => !i.ok);
  return (
    <div className="promocoes-resultado">
      <div className="financeiro-margem-positiva">
        {sucesso.length} de {resultado.itens.length} itens entraram na campanha "{resultado.nome}".
      </div>
      {sucesso.length > 0 && (
        <div className="promocoes-resultado-falhas">
          {sucesso.map((s) => (
            <div key={s.itemId} className="financeiro-td-mudo">
              {s.itemId}: {formatCurrency(s.precoOriginal ?? 0)} → {formatCurrency(s.dealPrice ?? 0)}
            </div>
          ))}
        </div>
      )}
      {falha.length > 0 && (
        <div className="promocoes-resultado-falhas">
          <span className="financeiro-margem-negativa">Não entraram:</span>
          {falha.map((f) => (
            <div key={f.itemId} className="financeiro-td-mudo">
              {f.itemId}: {f.erro}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NovaCampanhaForm({ lojas, onCriada }: { lojas: Loja[]; onCriada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [lojaId, setLojaId] = useState<number | "">("");
  const [nome, setNome] = useState("");
  const [percentual, setPercentual] = useState("20");
  const [itensTexto, setItensTexto] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCriarCampanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const itemIds = itensTexto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function pedirConfirmacao() {
    setErro(null);
    setResultado(null);
    if (!lojaId) {
      setErro("Escolha a loja.");
      return;
    }
    if (!nome.trim()) {
      setErro("Informe o nome da campanha.");
      return;
    }
    const p = Number(percentual);
    if (!Number.isFinite(p) || p < 10 || p > 70) {
      setErro("Percentual precisa ficar entre 10% e 70% (regra do Mercado Livre).");
      return;
    }
    if (itemIds.length === 0) {
      setErro("Cole ao menos um MLB, um por linha.");
      return;
    }
    setConfirmando(true);
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await criarCampanha(Number(lojaId), nome.trim(), Number(percentual), itemIds);
      setResultado(res);
      setConfirmando(false);
      onCriada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao criar campanha.");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn-responder" onClick={() => setAberto(true)}>
        Nova campanha
      </button>
    );
  }

  return (
    <div className="promocoes-form">
      {erro && <div className="state-message state-error">{erro}</div>}
      {resultado && <ResultadoCriacao resultado={resultado} />}

      {!confirmando && (
        <>
          <div className="fabricacao-editor-topo">
            <select className="dashboard-select" value={lojaId} onChange={(e) => setLojaId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Loja...</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <input className="clonar-input" placeholder="Nome da campanha" value={nome} onChange={(e) => setNome(e.target.value)} />
            <input
              className="clonar-input"
              placeholder="% de desconto (10-70)"
              value={percentual}
              onChange={(e) => setPercentual(e.target.value)}
            />
          </div>
          <textarea
            className="clonar-input promocoes-textarea"
            placeholder="Cole os MLBs dos produtos, um por linha"
            value={itensTexto}
            onChange={(e) => setItensTexto(e.target.value)}
            rows={5}
          />
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" onClick={pedirConfirmacao}>
              Criar campanha
            </button>
            <button type="button" className="btn-excluir" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Confirma criar a campanha <b>"{nome}"</b> na loja <b>{lojas.find((l) => l.id === lojaId)?.nome}</b>, com{" "}
            <b>{percentual}%</b> de desconto em <b>{itemIds.length}</b> item{itemIds.length > 1 ? "ns" : ""}? Isso cria a
            promoção de verdade no Mercado Livre agora.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={confirmar}>
              {enviando ? "Criando..." : "Confirmar e criar"}
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaCampanha({ campanha, onRecriada }: { campanha: Campanha; onRecriada: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCriarCampanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const status = statusInfo(campanha);

  async function recriar() {
    setEnviando(true);
    setErro(null);
    try {
      const res = await recriarCampanha(campanha.id);
      setResultado(res);
      setConfirmando(false);
      onRecriada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao recriar campanha.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="promocoes-linha">
      <div className="promocoes-linha-topo">
        <span className="financeiro-td-titulo">{campanha.nome}</span>
        <span className="financeiro-td-mudo">{campanha.lojaNome}</span>
        <span className="financeiro-td-mudo">{campanha.percentualDesconto}% off</span>
        <span className="financeiro-td-mudo">{campanha.itens.length} itens</span>
        <span className={status.classe}>{status.texto}</span>
        {!confirmando && (
          <button type="button" className="btn-responder" onClick={() => setConfirmando(true)}>
            Recriar
          </button>
        )}
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}
      {resultado && <ResultadoCriacao resultado={resultado} />}

      {confirmando && (
        <div className="promocoes-confirmacao">
          <p>
            Recria com o mesmo nome (+ data), <b>{campanha.percentualDesconto}%</b> de desconto e os mesmos{" "}
            <b>{campanha.itens.length}</b> itens — mas com o preço recalculado em cima do preço ATUAL de cada produto,
            não o preço antigo. Cria uma promoção nova de verdade no Mercado Livre agora.
          </p>
          <div className="fabricacao-editor-acoes">
            <button type="button" className="btn-responder" disabled={enviando} onClick={recriar}>
              {enviando ? "Recriando..." : "Confirmar e recriar"}
            </button>
            <button type="button" className="btn-excluir" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Promocoes() {
  const [lojas, setLojas] = useState<Loja[]>([]);

  useEffect(() => {
    fetchLojas().then(setLojas).catch(() => {});
  }, []);

  const buscar = useCallback(() => fetchCampanhas("todas"), []);
  const { dados, erro, atualizarAgora } = useBuscaComCancelamento<Campanha[]>(buscar, true);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Promoções</span>
          <h1>Campanhas do vendedor — todas as lojas</h1>
          <p className="painel-sub">
            Toda campanha de desconto do Mercado Livre vence em no máximo 14 dias — não existe renovação automática
            nativa da plataforma. Aqui você vê todas as campanhas das 16 lojas numa lista só, as mais urgentes
            primeiro, e recria com um clique quando vencer.
          </p>
        </div>
        <div className="financeiro-filtros">
          <button type="button" className="btn-responder financeiro-btn-hoje" onClick={atualizarAgora}>
            Atualizar
          </button>
        </div>
      </div>

      <NovaCampanhaForm lojas={lojas} onCriada={atualizarAgora} />

      {erro && <div className="state-message state-error">{erro}</div>}
      {!erro && dados === null && <div className="state-message">Carregando...</div>}
      {dados?.length === 0 && <div className="state-message">Nenhuma campanha criada pelo painel ainda.</div>}

      {dados?.map((c) => (
        <LinhaCampanha key={c.id} campanha={c} onRecriada={atualizarAgora} />
      ))}
    </div>
  );
}
