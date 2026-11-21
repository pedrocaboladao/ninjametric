import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";
import { fetchPromocoesRepricing, buscarPromocoes, entrarNasPromocoes, salvarConfigRepricing } from "../api/repricing";
import type { PromocaoRepricing, SituacaoPromocao } from "../types/repricing";
import { formatCurrency } from "../utils/format";
import { IconRefresh } from "./icons";
import { Aviso, Interruptor, Paginacao, Status, type Tom } from "./RepricingPecas";

const ITENS_POR_PAGINA = 50;
const INTERVALO_ACOMPANHAMENTO_MS = 5000;

type Filtro = "vai_entrar" | "participando" | "fora_da_margem" | "outras" | "todas";

interface Mensagem {
  tom: "ok" | "erro" | "aviso";
  texto: string;
}

const percentual = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

const SITUACOES: Record<SituacaoPromocao, { rotulo: string; tom: Tom }> = {
  participando: { rotulo: "Participando", tom: "bom" },
  vai_entrar: { rotulo: "Cabe na margem", tom: "alerta" },
  fora_da_margem: { rotulo: "Fora da margem", tom: "ruim" },
  sem_custo: { rotulo: "Sem custo pra calcular", tom: "neutro" },
  manual: { rotulo: "Só direto no Mercado Livre", tom: "neutro" },
  erro: { rotulo: "O Mercado Livre recusou", tom: "ruim" },
  rejeitada: { rotulo: "Rejeitada por você", tom: "neutro" },
};

const OUTRAS: SituacaoPromocao[] = ["sem_custo", "manual", "erro", "rejeitada"];

export function RepricingPromocoes({ lojaId }: { lojaId: number }) {
  const buscar = useCallback(() => fetchPromocoesRepricing(lojaId), [lojaId]);
  const { dados, erro, carregando, atualizarAgora } = useBuscaComCancelamento(buscar, true);

  const [filtro, setFiltro] = useState<Filtro>("vai_entrar");
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);

  // Mesma ideia da aba de catálogo: enquanto a varredura roda no servidor, a
  // tela recarrega sozinha pra mostrar o andamento.
  const recarregar = useRef(atualizarAgora);
  useEffect(() => {
    recarregar.current = atualizarAgora;
  });
  const buscando = dados?.busca.emAndamento ?? false;
  useEffect(() => {
    if (!buscando) return;
    const id = setInterval(() => recarregar.current(), INTERVALO_ACOMPANHAMENTO_MS);
    return () => clearInterval(id);
  }, [buscando]);

  const promocoes = useMemo(() => dados?.promocoes ?? [], [dados]);
  const grupos = useMemo(
    () => ({
      vai_entrar: promocoes.filter((p) => p.situacao === "vai_entrar"),
      participando: promocoes.filter((p) => p.situacao === "participando"),
      fora_da_margem: promocoes.filter((p) => p.situacao === "fora_da_margem"),
      outras: promocoes.filter((p) => OUTRAS.includes(p.situacao)),
      todas: promocoes,
    }),
    [promocoes]
  );

  const filtradas = grupos[filtro];
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtradas.slice(paginaAtual * ITENS_POR_PAGINA, (paginaAtual + 1) * ITENS_POR_PAGINA);

  async function executar(acao: () => Promise<Mensagem | null>, falha: string) {
    setOcupado(true);
    setMensagem(null);
    try {
      setMensagem(await acao());
    } catch (err) {
      setMensagem({ tom: "erro", texto: err instanceof Error ? err.message : falha });
    } finally {
      setOcupado(false);
      atualizarAgora();
    }
  }

  function alternarAutomaticas(ligar: boolean) {
    if (
      ligar &&
      !window.confirm(
        `Ligar a entrada automática? O robô passa a aceitar sozinho toda promoção do Mercado Livre que mantenha a margem mínima. Hoje ${grupos.vai_entrar.length} promoção(ões) já cabem e seriam aceitas na próxima rodada (até 10 minutos).`
      )
    ) {
      return;
    }
    void executar(async () => {
      await salvarConfigRepricing(lojaId, { promocoesAutomaticas: ligar });
      return {
        tom: "ok",
        texto: ligar
          ? "Entrada automática ligada. A cada 10 minutos o robô aceita as promoções que cabem na margem."
          : "Entrada automática desligada. Nada mais é aceito sozinho; as promoções em que você já está continuam valendo.",
      };
    }, "Falha ao mudar a entrada automática.");
  }

  function entrarAgora() {
    if (
      !window.confirm(
        `Entrar agora em ${grupos.vai_entrar.length} promoção(ões)? O preço desses anúncios passa a ser o promocional no Mercado Livre.`
      )
    ) {
      return;
    }
    void executar(async () => {
      const r = await entrarNasPromocoes(lojaId);
      if (r.falhou === 0) return { tom: "ok", texto: `Entrou em ${r.entrou} promoção(ões).` };
      return {
        tom: "aviso",
        texto: `Entrou em ${r.entrou} promoção(ões); o Mercado Livre recusou ${r.falhou}. Primeiro motivo: ${r.primeiroErro}`,
      };
    }, "Falha ao entrar nas promoções.");
  }

  function buscarAgora() {
    void executar(async () => {
      await buscarPromocoes(lojaId);
      return null;
    }, "Falha ao iniciar a busca de promoções.");
  }

  if (!dados) {
    return <div className="rp-vazio">{erro ?? (carregando ? "Carregando…" : "Sem dados.")}</div>;
  }

  const { busca } = dados;
  const FILTROS: Array<{ chave: Filtro; rotulo: string }> = [
    { chave: "vai_entrar", rotulo: "Cabem na margem" },
    { chave: "participando", rotulo: "Participando" },
    { chave: "fora_da_margem", rotulo: "Fora da margem" },
    { chave: "outras", rotulo: "Outras" },
    { chave: "todas", rotulo: "Todas" },
  ];

  return (
    <>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {dados.roboPausado && (
        <Aviso tom="aviso">O robô está pausado (aba Catálogo e margem): nenhuma promoção é aceita sozinha até você retomar.</Aviso>
      )}

      <section className="rp-cartao rp-margem-padrao">
        <div>
          <h2>Entrar sozinho nas promoções com margem</h2>
          <p>
            O painel varre todo dia, de madrugada, as promoções que o Mercado Livre oferece pros seus anúncios e calcula
            a margem de cada uma no preço promocional (custo, taxa, frete e imposto já descontados). Com isso ligado, o
            robô aceita sozinho as que ficam na margem mínima ou acima — e ignora as que ficam abaixo.
          </p>
        </div>
        <div className="rp-margem-padrao-campo">
          <Interruptor
            ligado={dados.automaticas}
            rotulo="Entrar sozinho nas promoções com margem"
            desabilitado={ocupado}
            onMudar={alternarAutomaticas}
          />
          <b>{dados.automaticas ? "Ligado" : "Desligado"}</b>
        </div>
      </section>

      <section className="rp-tiles" aria-label="Resumo das promoções">
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Cabem na margem</span>
          <strong>{grupos.vai_entrar.length}</strong>
          <small>{dados.automaticas ? "o robô aceita na próxima rodada" : "esperando você entrar"}</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Participando</span>
          <strong>{grupos.participando.length}</strong>
          <small>promoções ativas nos anúncios</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Fora da margem</span>
          <strong>{grupos.fora_da_margem.length}</strong>
          <small>o robô não entra nessas</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Outras</span>
          <strong>{grupos.outras.length}</strong>
          <small>sem custo, recusadas ou só pelo site</small>
        </div>
      </section>

      {busca.emAndamento && (
        <Aviso tom="aviso">
          Varrendo as promoções{busca.lojaAtual ? ` de ${busca.lojaAtual}` : ""}: {busca.itensVerificados} de {busca.totalItens}{" "}
          anúncios conferidos, {busca.candidatasEncontradas} promoção(ões) encontrada(s). Leva vários minutos.
        </Aviso>
      )}
      {busca.erro && !busca.emAndamento && <Aviso tom="erro">A última varredura de promoções falhou: {busca.erro}</Aviso>}
      {mensagem && (
        <Aviso tom={mensagem.tom} onFechar={() => setMensagem(null)}>
          {mensagem.texto}
        </Aviso>
      )}

      <section className="rp-cartao rp-tabela-cartao">
        <div className="rp-barra">
          <div className="rp-filtros" role="tablist" aria-label="Filtrar promoções">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                role="tab"
                aria-selected={filtro === f.chave}
                className={`rp-chip ${filtro === f.chave ? "rp-chip-ativo" : ""}`}
                onClick={() => {
                  setFiltro(f.chave);
                  setPagina(0);
                }}
              >
                {f.rotulo} <span>{grupos[f.chave].length}</span>
              </button>
            ))}
          </div>
          <div className="rp-acoes-massa">
            <button type="button" className="rp-botao" disabled={ocupado || busca.emAndamento} onClick={buscarAgora}>
              <IconRefresh size={14} spinning={busca.emAndamento} />
              Buscar promoções agora
            </button>
            <button
              type="button"
              className="rp-botao rp-botao-primario"
              disabled={ocupado || grupos.vai_entrar.length === 0 || dados.roboPausado}
              onClick={entrarAgora}
            >
              Entrar agora ({grupos.vai_entrar.length})
            </button>
          </div>
        </div>

        {promocoes.length === 0 ? (
          <div className="rp-vazio">
            Nenhuma promoção encontrada ainda. A varredura roda sozinha toda madrugada — ou clique em “Buscar promoções
            agora”.
          </div>
        ) : visiveis.length === 0 ? (
          <div className="rp-vazio">Nenhuma promoção nesse filtro.</div>
        ) : (
          <div className="rp-tabela-rolagem">
            <table className="rp-tabela rp-tabela-promocoes">
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th>Promoção</th>
                  <th className="rp-num">Preço cheio</th>
                  <th className="rp-num">Preço na promoção</th>
                  <th className="rp-num">Margem na promoção</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <LinhaPromocao key={p.id} promocao={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Paginacao pagina={paginaAtual} totalPaginas={totalPaginas} onMudar={setPagina} />
      </section>
    </>
  );
}

function LinhaPromocao({ promocao: p }: { promocao: PromocaoRepricing }) {
  const situacao = SITUACOES[p.situacao];
  const desconto = p.precoOriginal > 0 ? ((p.precoOriginal - p.precoPromocional) / p.precoOriginal) * 100 : 0;
  return (
    <tr>
      <td>
        <div className="rp-anuncio">
          <div>
            {p.permalink ? (
              <a href={p.permalink} target="_blank" rel="noreferrer">
                {p.titulo ?? p.itemId}
              </a>
            ) : (
              <span>{p.titulo ?? p.itemId}</span>
            )}
            <small>
              {p.itemId}
              {p.sku && ` · ${p.sku}`}
            </small>
          </div>
        </div>
      </td>
      <td>
        <div className="rp-celula-dupla">
          <span>{p.nome ?? p.tipo}</span>
          {p.nome && <small>{p.tipo}</small>}
        </div>
      </td>
      <td className="rp-num">{formatCurrency(p.precoOriginal)}</td>
      <td className="rp-num">
        <div className="rp-celula-dupla">
          <b>{formatCurrency(p.precoPromocional)}</b>
          {desconto >= 0.05 && <small>{percentual(desconto)} de desconto</small>}
        </div>
      </td>
      <td className="rp-num">
        {p.margemPercentual !== null ? (
          <div className="rp-celula-dupla">
            <b>{percentual(p.margemPercentual)}</b>
            <small>mínima {percentual(p.margemMinimaPercentual)}</small>
          </div>
        ) : (
          <span className="rp-mudo">—</span>
        )}
      </td>
      <td>
        <div className="rp-celula-dupla rp-celula-robo">
          <Status tom={situacao.tom}>{situacao.rotulo}</Status>
          {p.erro && <small className="rp-texto-ruim">{p.erro}</small>}
        </div>
      </td>
    </tr>
  );
}
