import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBuscaComCancelamento } from "../hooks/useBuscaComCancelamento";
import {
  fetchLojasRepricing,
  fetchPainelRepricing,
  salvarConfigRepricing,
  pedirSincronizacao,
  salvarAjustesItem,
  alternarRobo,
  alternarRoboEmMassa,
} from "../api/repricing";
import type { EventoHistoricoRepricing, ItemRepricing, LojaRepricing } from "../types/repricing";
import { formatCurrency, formatDataHora } from "../utils/format";
import { IconRefresh, IconSearch } from "./icons";
import { Aviso, Interruptor, Paginacao, Status, type Tom } from "./RepricingPecas";
import { RepricingPromocoes } from "./RepricingPromocoes";
import "./Repricing.css";

const ITENS_POR_PAGINA = 50;
const MAX_EM_MASSA = 200;
const INTERVALO_ACOMPANHAMENTO_MS = 5000;

type Filtro = "catalogo" | "robo" | "perdendo" | "abaixo" | "sem_custo" | "todos";
type Aba = "catalogo" | "promocoes";

interface Mensagem {
  tom: "ok" | "erro" | "aviso";
  texto: string;
}

const percentual = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

const STATUS_CATALOGO: Record<string, { rotulo: string; tom: Tom }> = {
  winning: { rotulo: "Ganhando", tom: "bom" },
  competing: { rotulo: "Perdendo", tom: "ruim" },
  sharing_first_place: { rotulo: "Dividindo o 1º lugar", tom: "alerta" },
  listed: { rotulo: "Fora da disputa", tom: "neutro" },
};

const MOTIVOS_FORA_DA_DISPUTA: Record<string, string> = {
  non_trusted_seller: "vendedor marcado como não confiável",
  reputation_below_threshold: "reputação abaixo do exigido",
  winner_has_better_reputation: "o vencedor tem reputação melhor",
  manufacturing_time: "anúncio com prazo de fabricação",
  item_paused: "anúncio pausado",
  item_not_opted_in: "anúncio não participa do catálogo",
  shipping_mode: "modo de envio inferior ao do vencedor",
  newbie_program_seller: "limite de vendas do programa Decola",
};

// Campo que só salva ao sair (ou Enter) e só se o valor mudou. Quem usa passa
// uma `key` com o valor atual, pra o texto se realinhar quando o dado recarrega.
function CampoNumero({
  valor,
  casas,
  placeholder,
  rotulo,
  prefixo,
  sufixo,
  desabilitado,
  onSalvar,
}: {
  valor: number | null;
  casas: number;
  placeholder: string;
  rotulo: string;
  prefixo?: string;
  sufixo?: string;
  desabilitado: boolean;
  onSalvar: (valor: number | null) => void;
}) {
  const inicial = valor === null ? "" : valor.toFixed(casas).replace(".", ",");
  const [texto, setTexto] = useState(inicial);

  function confirmar() {
    const limpo = texto.trim();
    if (limpo === inicial) return;
    if (limpo === "") {
      onSalvar(null);
      return;
    }
    const numero = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
    if (!Number.isFinite(numero) || numero < 0) {
      setTexto(inicial);
      return;
    }
    onSalvar(numero);
  }

  return (
    <span className="rp-campo">
      {prefixo && <span className="rp-campo-afixo">{prefixo}</span>}
      <input
        inputMode="decimal"
        aria-label={rotulo}
        value={texto}
        placeholder={placeholder}
        disabled={desabilitado}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {sufixo && <span className="rp-campo-afixo">{sufixo}</span>}
    </span>
  );
}

function CelulaCatalogo({ item }: { item: ItemRepricing }) {
  if (!item.catalogo) return <span className="rp-mudo">Não é catálogo</span>;
  const status = STATUS_CATALOGO[item.catalogoStatus ?? ""];
  if (!status) return <span className="rp-mudo">Sem leitura</span>;

  const precisaBaixar = item.catalogoStatus === "competing" && item.priceToWin !== null && item.priceToWin < item.precoAtual;

  return (
    <div className="rp-celula-dupla">
      <Status tom={status.tom}>{status.rotulo}</Status>
      {precisaBaixar && (
        <small>
          Pra ganhar: {formatCurrency(item.priceToWin as number)}
          {item.precoPiso !== null &&
            ((item.priceToWin as number) >= item.precoPiso ? " · cabe na sua margem" : " · abaixo do seu mínimo")}
        </small>
      )}
      {item.catalogoStatus === "listed" && item.catalogoMotivos && (
        <small>
          {item.catalogoMotivos
            .split(",")
            .map((m) => MOTIVOS_FORA_DA_DISPUTA[m] ?? m)
            .join("; ")}
        </small>
      )}
    </div>
  );
}

// Por que o robô não pode ser ligado nesse anúncio (null = pode).
function impedimentoDoRobo(item: ItemRepricing): string | null {
  if (!item.catalogo) return "Só monitoramento (não é catálogo)";
  if (item.automacaoMl) return "Automatização do Mercado Livre ligada";
  if (item.custoUnitario === null) return item.sku ? "Sem custo na planilha" : "Sem SKU";
  if (item.precoPiso === null) return "Sem preço mínimo calculável";
  return null;
}

function CelulaRobo({ item, pausado }: { item: ItemRepricing; pausado: boolean }) {
  const impedimento = impedimentoDoRobo(item);
  return (
    <div className="rp-celula-dupla rp-celula-robo">
      {item.roboLigado ? (
        <Status tom={pausado ? "alerta" : "bom"}>{pausado ? "Ligado (robô pausado)" : "Ligado"}</Status>
      ) : (
        <Status tom="neutro">{impedimento ?? "Desligado"}</Status>
      )}
      {item.roboLigado && item.ultimaAcao && (
        <small>
          {item.ultimaAcao}
          {item.ultimaAcaoEm && ` (desde ${formatDataHora(item.ultimaAcaoEm)})`}
        </small>
      )}
      {item.aviso && <small className="rp-texto-ruim">{item.aviso}</small>}
    </div>
  );
}

function descreverEvento(e: EventoHistoricoRepricing): { titulo: string; tom: Tom } {
  const margem = e.margemPercentual !== null ? ` · margem ${percentual(e.margemPercentual)}` : "";
  if (e.tipo === "preco" && e.precoAnterior !== null && e.precoNovo !== null) {
    return {
      titulo: `${e.origem === "robo" ? "Robô: " : ""}${formatCurrency(e.precoAnterior)} → ${formatCurrency(e.precoNovo)}${margem}`,
      tom: e.origem === "robo" ? "bom" : "neutro",
    };
  }
  if (e.tipo === "promocao_entrou" && e.precoNovo !== null) {
    return { titulo: `Entrou em promoção a ${formatCurrency(e.precoNovo)}${margem}`, tom: "bom" };
  }
  if (e.tipo === "robo_ligado") return { titulo: "Robô ligado", tom: "bom" };
  return { titulo: "Robô desligado", tom: "neutro" };
}

function PainelCatalogo({ lojaId }: { lojaId: number }) {
  const buscar = useCallback(() => fetchPainelRepricing(lojaId), [lojaId]);
  const { dados, erro, carregando, atualizarAgora } = useBuscaComCancelamento(buscar, true);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("catalogo");
  const [pagina, setPagina] = useState(0);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());
  const [emMassa, setEmMassa] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [margemEmEdicao, setMargemEmEdicao] = useState<string | null>(null);

  // Enquanto o servidor sincroniza, recarrega de tempos em tempos pra a tela
  // ir se preenchendo sozinha. A ref guarda a função mais recente sem fazer o
  // efeito reiniciar o relógio a cada render.
  const recarregar = useRef(atualizarAgora);
  useEffect(() => {
    recarregar.current = atualizarAgora;
  });
  const sincronizando = dados?.sincronizando ?? false;
  useEffect(() => {
    if (!sincronizando) return;
    const id = setInterval(() => recarregar.current(), INTERVALO_ACOMPANHAMENTO_MS);
    return () => clearInterval(id);
  }, [sincronizando]);

  const margemPadrao = dados?.config.margemMinimaPercentual ?? 0;
  const pausado = dados?.config.roboPausado ?? false;
  const itens = useMemo(() => dados?.itens ?? [], [dados]);

  const margemMinimaDe = useCallback((i: ItemRepricing) => i.margemMinimaPercentual ?? margemPadrao, [margemPadrao]);
  const abaixoDaMargem = useCallback(
    (i: ItemRepricing) => i.margemPercentual !== null && i.margemPercentual < margemMinimaDe(i) - 0.05,
    [margemMinimaDe]
  );

  const grupos = useMemo(
    () => ({
      catalogo: itens.filter((i) => i.catalogo),
      robo: itens.filter((i) => i.roboLigado),
      perdendo: itens.filter((i) => i.catalogoStatus === "competing"),
      abaixo: itens.filter(abaixoDaMargem),
      sem_custo: itens.filter((i) => i.custoUnitario === null),
      todos: itens,
    }),
    [itens, abaixoDaMargem]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return grupos[filtro];
    return grupos[filtro].filter(
      (i) => i.titulo.toLowerCase().includes(termo) || i.itemId.toLowerCase().includes(termo) || (i.sku ?? "").toLowerCase().includes(termo)
    );
  }, [grupos, filtro, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtrados.slice(paginaAtual * ITENS_POR_PAGINA, (paginaAtual + 1) * ITENS_POR_PAGINA);

  const resumo = useMemo(() => {
    const comMargem = itens.filter((i) => i.margemPercentual !== null);
    return {
      ganhando: grupos.catalogo.filter((i) => i.catalogoStatus === "winning" || i.catalogoStatus === "sharing_first_place").length,
      margemMedia:
        comMargem.length > 0 ? comMargem.reduce((s, i) => s + (i.margemPercentual as number), 0) / comMargem.length : null,
      comMargem: comMargem.length,
    };
  }, [itens, grupos]);

  function marcarOcupado(itemId: string, ocupado: boolean) {
    setOcupados((atual) => {
      const novo = new Set(atual);
      if (ocupado) novo.add(itemId);
      else novo.delete(itemId);
      return novo;
    });
  }

  async function executarNoItem(item: ItemRepricing, acao: () => Promise<Mensagem | null>) {
    marcarOcupado(item.itemId, true);
    setMensagem(null);
    try {
      setMensagem(await acao());
    } catch (err) {
      setMensagem({ tom: "erro", texto: `${item.titulo}: ${err instanceof Error ? err.message : "falha."}` });
    } finally {
      marcarOcupado(item.itemId, false);
      atualizarAgora();
    }
  }

  function alternar(item: ItemRepricing, ligar: boolean) {
    return executarNoItem(item, async () => {
      await alternarRobo(lojaId, item.itemId, ligar);
      return {
        tom: "ok",
        texto: ligar
          ? `Robô ligado em "${item.titulo}". Ele já fez a primeira checagem e segue conferindo a disputa a cada 10 minutos.`
          : `Robô desligado em "${item.titulo}". O preço fica como está.`,
      };
    });
  }

  function ajustar(item: ItemRepricing, ajustes: { margemMinimaPercentual?: number | null; precoMaximo?: number | null }) {
    return executarNoItem(item, async () => {
      await salvarAjustesItem(lojaId, item.itemId, ajustes);
      return null;
    });
  }

  const paraLigar = filtrados.filter((i) => !i.roboLigado && impedimentoDoRobo(i) === null).slice(0, MAX_EM_MASSA);
  const paraDesligar = filtrados.filter((i) => i.roboLigado).slice(0, MAX_EM_MASSA);

  async function executarEmMassa(alvos: ItemRepricing[], ligar: boolean) {
    const pergunta = ligar
      ? `Ligar o robô em ${alvos.length} anúncio(s)? Ele passa a mudar o preço deles sozinho pra ganhar a disputa de catálogo, sempre entre o preço mínimo (sua margem) e o máximo de cada um.`
      : `Desligar o robô de ${alvos.length} anúncio(s)? Os preços ficam como estão.`;
    if (!window.confirm(pergunta)) return;
    setEmMassa(true);
    setMensagem(null);
    try {
      const resultados = await alternarRoboEmMassa(
        lojaId,
        alvos.map((i) => i.itemId),
        ligar
      );
      const falhas = resultados.filter((r) => !r.ok);
      const feitos = resultados.length - falhas.length;
      const verbo = ligar ? "ligado" : "desligado";
      setMensagem(
        falhas.length === 0
          ? { tom: "ok", texto: `Robô ${verbo} em ${feitos} anúncio(s).` }
          : { tom: "aviso", texto: `Robô ${verbo} em ${feitos} anúncio(s); ${falhas.length} recusado(s). Primeiro motivo: ${falhas[0].erro}` }
      );
    } catch (err) {
      setMensagem({ tom: "erro", texto: err instanceof Error ? err.message : "Falha na alteração em massa." });
    } finally {
      setEmMassa(false);
      atualizarAgora();
    }
  }

  async function executarGeral(acao: () => Promise<void>, sucesso: Mensagem | null, falha: string) {
    setMensagem(null);
    try {
      await acao();
      setMensagem(sucesso);
    } catch (err) {
      setMensagem({ tom: "erro", texto: err instanceof Error ? err.message : falha });
    }
    atualizarAgora();
  }

  function salvarMargem() {
    if (margemEmEdicao === null) return;
    const numero = Number(margemEmEdicao.replace(",", "."));
    if (!Number.isFinite(numero) || numero < 0 || numero > 80) {
      setMensagem({ tom: "erro", texto: "Informe a margem mínima entre 0% e 80%." });
      return;
    }
    void executarGeral(
      async () => {
        await salvarConfigRepricing(lojaId, { margemMinimaPercentual: numero });
        setMargemEmEdicao(null);
      },
      { tom: "ok", texto: `Margem mínima padrão em ${percentual(numero)}. Recalculando o preço mínimo de cada anúncio…` },
      "Falha ao salvar a margem mínima."
    );
  }

  function alternarPausa() {
    void executarGeral(
      () => salvarConfigRepricing(lojaId, { roboPausado: !pausado }),
      pausado
        ? { tom: "ok", texto: "Robô retomado. Ele volta a agir na próxima rodada (até 10 minutos)." }
        : { tom: "aviso", texto: "Robô pausado: nenhum preço muda e nenhuma promoção é aceita sozinha até você retomar." },
      "Falha ao mudar a pausa do robô."
    );
  }

  if (!dados) {
    return <div className="rp-vazio">{erro ?? (carregando ? "Carregando…" : "Sem dados.")}</div>;
  }

  const { config } = dados;
  const FILTROS: Array<{ chave: Filtro; rotulo: string }> = [
    { chave: "catalogo", rotulo: "Catálogo" },
    { chave: "robo", rotulo: "Robô ligado" },
    { chave: "perdendo", rotulo: "Perdendo catálogo" },
    { chave: "abaixo", rotulo: "Abaixo da margem mínima" },
    { chave: "sem_custo", rotulo: "Sem custo" },
    { chave: "todos", rotulo: "Todos" },
  ];

  return (
    <>
      <div className="rp-linha-acoes">
        <span className="rp-atualizado">
          {sincronizando
            ? "Lendo os anúncios no Mercado Livre…"
            : config.ultimaSincronizacao
              ? `Anúncios lidos em ${formatDataHora(config.ultimaSincronizacao)}`
              : "Ainda não sincronizado"}
        </span>
        <button
          type="button"
          className="rp-botao"
          disabled={sincronizando}
          onClick={() => executarGeral(() => pedirSincronizacao(lojaId), null, "Falha ao pedir a atualização.")}
        >
          <IconRefresh size={14} spinning={sincronizando} />
          Atualizar agora
        </button>
        <button type="button" className={`rp-botao ${pausado ? "rp-botao-primario" : ""}`} onClick={alternarPausa}>
          {pausado ? "Retomar robô" : "Pausar robô"}
        </button>
      </div>

      {pausado && (
        <Aviso tom="aviso">
          O robô está pausado: nenhum preço muda e nenhuma promoção é aceita sozinha. Os anúncios marcados continuam marcados.
        </Aviso>
      )}
      {(config.ultimoErro || erro) && <Aviso tom="erro">{erro ?? `A última leitura dos anúncios falhou: ${config.ultimoErro}`}</Aviso>}

      <section className="rp-tiles" aria-label="Resumo">
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Anúncios monitorados</span>
          <strong>{itens.length}</strong>
          <small>{grupos.catalogo.length} de catálogo</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Robô ligado</span>
          <strong>{grupos.robo.length}</strong>
          <small>{pausado ? "pausado agora" : "anúncio(s) com preço automático"}</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Catálogo</span>
          <strong>
            {resumo.ganhando}
            <span className="rp-tile-de"> / {grupos.catalogo.length}</span>
          </strong>
          <small>ganhando · {grupos.perdendo.length} perdendo</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Margem média</span>
          <strong>{resumo.margemMedia !== null ? percentual(resumo.margemMedia) : "—"}</strong>
          <small>{resumo.comMargem} anúncio(s) com custo</small>
        </div>
        <div className="rp-tile">
          <span className="rp-tile-rotulo">Abaixo da margem mínima</span>
          <strong>{grupos.abaixo.length}</strong>
          <small>vendendo abaixo do seu piso</small>
        </div>
      </section>

      <section className="rp-cartao rp-margem-padrao">
        <div>
          <h2>Margem mínima padrão</h2>
          <p>
            O preço mínimo de cada anúncio é o menor preço que ainda deixa essa margem depois de custo, taxa do Mercado
            Livre, frete e imposto. O robô nunca vende abaixo dele, e só entra em promoção que fique acima. Dá pra
            definir uma margem diferente por anúncio na tabela.
          </p>
        </div>
        <div className="rp-margem-padrao-campo">
          <span className="rp-campo rp-campo-grande">
            <input
              inputMode="decimal"
              aria-label="Margem mínima padrão em porcentagem"
              value={margemEmEdicao ?? String(margemPadrao).replace(".", ",")}
              onChange={(e) => setMargemEmEdicao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvarMargem();
              }}
            />
            <span className="rp-campo-afixo">%</span>
          </span>
          <button type="button" className="rp-botao rp-botao-primario" onClick={salvarMargem} disabled={margemEmEdicao === null}>
            Salvar
          </button>
        </div>
      </section>

      {mensagem && (
        <Aviso tom={mensagem.tom} onFechar={() => setMensagem(null)}>
          {mensagem.texto}
        </Aviso>
      )}

      <section className="rp-cartao rp-tabela-cartao">
        <div className="rp-barra">
          <div className="rp-filtros" role="tablist" aria-label="Filtrar anúncios">
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
          <label className="rp-busca">
            <IconSearch size={15} />
            <input
              type="search"
              placeholder="Buscar por título, MLB ou SKU"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(0);
              }}
            />
          </label>
        </div>

        <div className="rp-barra rp-barra-massa">
          <span className="rp-mudo">
            {filtrados.length} anúncio(s) nesse filtro
            {filtrados.length > ITENS_POR_PAGINA && ` · página ${paginaAtual + 1} de ${totalPaginas}`}
          </span>
          <div className="rp-acoes-massa">
            <button
              type="button"
              className="rp-botao rp-botao-primario"
              disabled={emMassa || paraLigar.length === 0}
              onClick={() => executarEmMassa(paraLigar, true)}
            >
              Ligar robô ({paraLigar.length})
            </button>
            <button
              type="button"
              className="rp-botao"
              disabled={emMassa || paraDesligar.length === 0}
              onClick={() => executarEmMassa(paraDesligar, false)}
            >
              Desligar robô ({paraDesligar.length})
            </button>
          </div>
        </div>

        {itens.length === 0 ? (
          <div className="rp-vazio">
            {sincronizando
              ? "Primeira leitura dos anúncios em andamento — leva alguns minutos e a tela vai se preenchendo sozinha."
              : "Nenhum anúncio lido ainda. Clique em “Atualizar agora”."}
          </div>
        ) : visiveis.length === 0 ? (
          <div className="rp-vazio">Nenhum anúncio nesse filtro.</div>
        ) : (
          <div className="rp-tabela-rolagem">
            <table className="rp-tabela">
              <thead>
                <tr>
                  <th>Robô</th>
                  <th>Anúncio</th>
                  <th className="rp-num">Preço</th>
                  <th>Catálogo</th>
                  <th className="rp-num">Margem</th>
                  <th>Margem mín.</th>
                  <th>Faixa de preço</th>
                  <th>O que o robô está fazendo</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((item) => {
                  const ocupado = ocupados.has(item.itemId) || emMassa;
                  const podeLigar = impedimentoDoRobo(item) === null;
                  return (
                    <tr key={item.itemId} className={ocupado ? "rp-linha-ocupada" : undefined}>
                      <td>
                        <Interruptor
                          ligado={item.roboLigado}
                          rotulo={`Robô de ${item.titulo}`}
                          desabilitado={ocupado || (!item.roboLigado && !podeLigar)}
                          onMudar={(ligar) => alternar(item, ligar)}
                        />
                      </td>
                      <td>
                        <div className="rp-anuncio">
                          {item.thumbnail ? (
                            <img src={item.thumbnail.replace(/^http:/, "https:")} alt="" loading="lazy" />
                          ) : (
                            <div className="rp-thumb-vazia" />
                          )}
                          <div>
                            {item.permalink ? (
                              <a href={item.permalink} target="_blank" rel="noreferrer">
                                {item.titulo}
                              </a>
                            ) : (
                              <span>{item.titulo}</span>
                            )}
                            <small>
                              {item.itemId}
                              {item.sku && ` · ${item.sku}`}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="rp-num">
                        <div className="rp-celula-dupla">
                          <b>{formatCurrency(item.precoAtual)}</b>
                          {item.emPromocao && <small>em promoção</small>}
                        </div>
                      </td>
                      <td>
                        <CelulaCatalogo item={item} />
                      </td>
                      <td className="rp-num">
                        {item.margemPercentual !== null && item.margemValor !== null ? (
                          <div className="rp-celula-dupla">
                            <b>{percentual(item.margemPercentual)}</b>
                            <small>{formatCurrency(item.margemValor)}</small>
                            {abaixoDaMargem(item) && <small className="rp-texto-ruim">abaixo do mínimo</small>}
                          </div>
                        ) : (
                          <span className="rp-mudo">—</span>
                        )}
                      </td>
                      <td>
                        <CampoNumero
                          key={`margem-${item.margemMinimaPercentual}`}
                          valor={item.margemMinimaPercentual}
                          casas={1}
                          placeholder={String(margemPadrao).replace(".", ",")}
                          rotulo={`Margem mínima de ${item.titulo}`}
                          sufixo="%"
                          desabilitado={ocupado}
                          onSalvar={(valor) => ajustar(item, { margemMinimaPercentual: valor })}
                        />
                      </td>
                      <td>
                        <div className="rp-faixa-preco">
                          <span>
                            <small>Mín.</small>
                            <b>{item.precoPiso !== null ? formatCurrency(item.precoPiso) : "—"}</b>
                          </span>
                          <span>
                            <small>Máx.</small>
                            <CampoNumero
                              key={`maximo-${item.precoMaximo}`}
                              valor={item.precoMaximo}
                              casas={2}
                              placeholder={item.precoAtual.toFixed(2).replace(".", ",")}
                              rotulo={`Preço máximo de ${item.titulo}`}
                              prefixo="R$"
                              desabilitado={ocupado}
                              onSalvar={(valor) => ajustar(item, { precoMaximo: valor })}
                            />
                          </span>
                        </div>
                      </td>
                      <td>
                        <CelulaRobo item={item} pausado={pausado} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Paginacao pagina={paginaAtual} totalPaginas={totalPaginas} onMudar={setPagina} />
      </section>

      <section className="rp-cartao">
        <h2>Últimas movimentações</h2>
        {dados.historico.length === 0 ? (
          <p className="rp-mudo">
            Nada ainda. Mudanças de preço, entradas em promoção e ligar/desligar do robô aparecem aqui conforme forem
            acontecendo.
          </p>
        ) : (
          <ul className="rp-historico">
            {dados.historico.map((e) => {
              const { titulo, tom } = descreverEvento(e);
              return (
                <li key={e.id}>
                  <time dateTime={e.criadoEm}>{formatDataHora(e.criadoEm)}</time>
                  <div>
                    <Status tom={tom}>{titulo}</Status>
                    <span className="rp-historico-anuncio">{e.titulo}</span>
                    {(e.detalhe || e.usuarioNome) && (
                      <small>
                        {e.detalhe}
                        {e.usuarioNome && ` · por ${e.usuarioNome}`}
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export function Repricing() {
  const [lojas, setLojas] = useState<LojaRepricing[] | null>(null);
  const [lojaId, setLojaId] = useState<number | null>(null);
  const [aba, setAba] = useState<Aba>("catalogo");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchLojasRepricing()
      .then((lista) => {
        setLojas(lista);
        setLojaId(lista[0]?.id ?? null);
      })
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar as lojas."));
  }, []);

  return (
    <div className="rp">
      <header className="rp-cabecalho">
        <div>
          <span className="rp-eyebrow">Precificação automática · Mercado Livre</span>
          <h1>Repricing</h1>
          <p>
            Você define a margem mínima. O robô disputa o catálogo ajustando o preço e entra nas promoções que cabem —
            sem nunca vender abaixo do seu piso.
          </p>
        </div>
        {lojas && lojas.length === 1 && <span className="rp-loja-unica">{lojas[0].nome}</span>}
        {lojas && lojas.length > 1 && (
          <select className="rp-seletor" aria-label="Loja" value={lojaId ?? ""} onChange={(e) => setLojaId(Number(e.target.value))}>
            {lojas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
        )}
      </header>

      {lojaId === null ? (
        <div className="rp-vazio">{erro ?? (lojas === null ? "Carregando…" : "Nenhuma loja liberada pro Repricing no seu acesso.")}</div>
      ) : (
        <>
          <nav className="rp-abas" role="tablist" aria-label="Seções do Repricing">
            <button type="button" role="tab" aria-selected={aba === "catalogo"} className={aba === "catalogo" ? "rp-aba-ativa" : ""} onClick={() => setAba("catalogo")}>
              Catálogo e margem
            </button>
            <button type="button" role="tab" aria-selected={aba === "promocoes"} className={aba === "promocoes" ? "rp-aba-ativa" : ""} onClick={() => setAba("promocoes")}>
              Promoções
            </button>
          </nav>
          {aba === "catalogo" ? <PainelCatalogo key={lojaId} lojaId={lojaId} /> : <RepricingPromocoes key={lojaId} lojaId={lojaId} />}
        </>
      )}
    </div>
  );
}
