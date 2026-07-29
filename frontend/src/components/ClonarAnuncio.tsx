import { useEffect, useRef, useState } from "react";
import type { Loja, PreviewAnuncio, ResultadoClone } from "../types/clonarAnuncio";
import { TIPOS_ANUNCIO } from "../types/clonarAnuncio";
import { fetchLojas, buscarPreview, publicarClone } from "../api/clonarAnuncio";
import { formatCurrency } from "../utils/format";

const CONDICAO_LABEL: Record<string, string> = { new: "Novo", used: "Usado" };
const PASSOS = ["Link", "Título", "Confirmação"];

export function ClonarAnuncio() {
  const [step, setStep] = useState(1);
  const [lojas, setLojas] = useState<Loja[]>([]);

  const [url, setUrl] = useState("");
  const [lojaDestinoId, setLojaDestinoId] = useState<number | "">("");
  const [quantidadeClones, setQuantidadeClones] = useState(1);
  const [listingType, setListingType] = useState<string>(TIPOS_ANUNCIO[0].value);
  const [ativarFlex, setAtivarFlex] = useState(false);
  const [usarImagensPersonalizadas, setUsarImagensPersonalizadas] = useState(false);
  const [imagensTexto, setImagensTexto] = useState("");
  const [imagensPorVariacaoTexto, setImagensPorVariacaoTexto] = useState<Record<number, string>>({});

  const [tituloFinal, setTituloFinal] = useState("");
  const [preview, setPreview] = useState<PreviewAnuncio | null>(null);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoClone[] | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => setErro("Não foi possível carregar a lista de lojas."));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreview(null);

    if (url.trim().length < 15 || lojaDestinoId === "") return;

    debounceRef.current = setTimeout(async () => {
      setLoadingPreview(true);
      setErro(null);
      try {
        const dados = await buscarPreview(url.trim(), Number(lojaDestinoId));
        setPreview(dados);
        setTituloFinal(dados.tituloOriginal);
      } catch (err) {
        setErro(err instanceof Error ? err.message : "Erro ao buscar anúncio.");
      } finally {
        setLoadingPreview(false);
      }
    }, 700);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, lojaDestinoId]);

  function resetar() {
    setStep(1);
    setUrl("");
    setLojaDestinoId("");
    setQuantidadeClones(1);
    setListingType(TIPOS_ANUNCIO[0].value);
    setAtivarFlex(false);
    setUsarImagensPersonalizadas(false);
    setImagensTexto("");
    setImagensPorVariacaoTexto({});
    setTituloFinal("");
    setPreview(null);
    setErro(null);
    setConfirmado(false);
    setResultados(null);
  }

  function textoParaLista(texto: string): string[] {
    return texto
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handlePublicar() {
    if (!preview || lojaDestinoId === "") return;
    setPublicando(true);
    setErro(null);
    try {
      const temFotosPorVariacao = usarImagensPersonalizadas && preview.numVariacoes > 0;
      const imagensPorVariacao = temFotosPorVariacao
        ? Object.fromEntries(
            Object.entries(imagensPorVariacaoTexto)
              .map(([idx, texto]) => [Number(idx), textoParaLista(texto)])
              .filter(([, lista]) => (lista as string[]).length > 0)
          )
        : undefined;

      const imagensPersonalizadas =
        usarImagensPersonalizadas && preview.numVariacoes === 0 ? textoParaLista(imagensTexto) : undefined;

      const resultado = await publicarClone({
        url: url.trim(),
        lojaDestinoId: Number(lojaDestinoId),
        tituloFinal: tituloFinal.trim(),
        listingType,
        ativarFlex,
        quantidadeClones,
        imagensPersonalizadas,
        imagensPorVariacao,
      });
      setResultados(resultado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao publicar anúncio.");
    } finally {
      setPublicando(false);
    }
  }

  if (resultados) {
    return (
      <div className="clonar">
        <div className="painel clonar-sucesso">
          <span className="painel-eyebrow">Anúncio criado</span>
          <h2>{resultados.length > 1 ? `${resultados.length} anúncios publicados!` : "Publicado com sucesso!"}</h2>
          <p className="painel-sub">
            {resultados.length > 1 ? "Os novos anúncios já estão ativos" : "O novo anúncio já está ativo"} no Mercado
            Livre.
          </p>
          <div className="clonar-lista-resultados">
            {resultados.map((r, i) => (
              <a key={r.novoItemId} className="btn-responder" href={r.permalink} target="_blank" rel="noreferrer">
                Abrir anúncio {resultados.length > 1 ? `#${i + 1}` : ""} no Mercado Livre
              </a>
            ))}
          </div>
          <button className="btn-excluir" style={{ marginTop: 10 }} onClick={resetar}>
            Clonar outro anúncio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="clonar">
      <div className="clonar-topo">
        <div className="clonar-breadcrumb">
          <span className="clonar-breadcrumb-linha" />
          Criação
        </div>
        <h1>Clonar Anúncio</h1>
        <p className="painel-sub">
          Cole o link de um anúncio do Mercado Livre e clone-o para a loja de destino com fotos, atributos e preço
          originais.
        </p>
      </div>

      <div className="clonar-passos-novo">
        {PASSOS.map((label, i) => {
          const n = i + 1;
          return (
            <div className="clonar-passo-item" key={n}>
              <span
                className={`clonar-passo-circulo ${step === n ? "clonar-passo-circulo-ativo" : ""} ${
                  step > n ? "clonar-passo-circulo-feito" : ""
                }`}
              >
                {n}
              </span>
              <span className={`clonar-passo-texto ${step === n ? "clonar-passo-texto-ativo" : ""}`}>{label}</span>
              {n < PASSOS.length && <span className="clonar-passo-linha" />}
            </div>
          );
        })}
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      {step === 1 && (
        <div className="painel">
          <div className="clonar-campo">
            <label>Loja de destino</label>
            <select
              className="clonar-input"
              value={lojaDestinoId}
              onChange={(e) => setLojaDestinoId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Selecione...</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="clonar-campo">
            <label>Link do anúncio</label>
            <input
              className="clonar-input"
              placeholder="https://www.mercadolivre.com.br/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          {loadingPreview && <div className="clonar-preview-carregando">Buscando anúncio...</div>}

          {preview && !loadingPreview && (
            <div className="clonar-preview-inline">
              {preview.fotos[0] && <img src={preview.fotos[0]} alt="" className="clonar-preview-foto" />}
              <div className="clonar-preview-info">
                <div className="clonar-preview-titulo">{preview.tituloOriginal}</div>
                <div className="clonar-preview-meta">
                  {formatCurrency(preview.preco)} · {preview.categoriaNome}
                  {preview.numVariacoes > 0 ? ` · ${preview.numVariacoes} variações` : ""}
                </div>
              </div>
            </div>
          )}

          <div className="clonar-campo">
            <label>Quantidade de clones</label>
            <input
              className="clonar-input"
              type="number"
              min={1}
              max={20}
              value={quantidadeClones}
              onChange={(e) => setQuantidadeClones(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </div>

          <div className="clonar-campo">
            <label>Tipo de anúncio</label>
            <select className="clonar-input" value={listingType} onChange={(e) => setListingType(e.target.value)}>
              {TIPOS_ANUNCIO.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <label className="clonar-checkbox-bloco">
            <input type="checkbox" checked={ativarFlex} onChange={(e) => setAtivarFlex(e.target.checked)} />
            <div>
              <div className="clonar-checkbox-titulo">Ativar Envio Flex</div>
              <div className="clonar-checkbox-desc">
                Marque pra publicar com Flex ativo no Mercado Livre. Desmarcado, o anúncio sai sem tag de Flex.
              </div>
            </div>
          </label>

          <label className="clonar-checkbox-bloco">
            <input
              type="checkbox"
              checked={usarImagensPersonalizadas}
              onChange={(e) => setUsarImagensPersonalizadas(e.target.checked)}
            />
            <div>
              <div className="clonar-checkbox-titulo">Usar imagens personalizadas</div>
              <div className="clonar-checkbox-desc">
                Clona toda a estrutura do anúncio (título, atributos, variações, preço, frete, descrição), mas
                substitui as fotos pelas que você subir — 1 conjunto por variação.
              </div>
            </div>
          </label>

          {usarImagensPersonalizadas && (!preview || preview.numVariacoes === 0) && (
            <div className="clonar-campo">
              <label>URLs das imagens (uma por linha)</label>
              <textarea
                className="clonar-input clonar-textarea"
                rows={3}
                value={imagensTexto}
                onChange={(e) => setImagensTexto(e.target.value)}
                placeholder={"https://...\nhttps://..."}
              />
            </div>
          )}

          <div className="clonar-acoes">
            <button className="btn-responder" onClick={() => setStep(2)} disabled={!preview}>
              Continuar →
            </button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="painel">
          <h2>Ajustar título</h2>
          <p className="painel-sub">Título original: {preview.tituloOriginal}</p>
          <div className="clonar-campo">
            <label>Título do novo anúncio</label>
            <input className="clonar-input" value={tituloFinal} onChange={(e) => setTituloFinal(e.target.value)} />
          </div>

          {usarImagensPersonalizadas && preview.numVariacoes > 0 && (
            <div className="clonar-campo">
              <label>Fotos por variação (uma URL por linha, em cada campo)</label>
              {preview.variacoes.map((v) => (
                <div key={v.index} className="clonar-variacao-foto">
                  <span className="clonar-variacao-nome">{v.resumo}</span>
                  <textarea
                    className="clonar-input clonar-textarea"
                    rows={2}
                    placeholder={"https://...\nhttps://..."}
                    value={imagensPorVariacaoTexto[v.index] ?? ""}
                    onChange={(e) =>
                      setImagensPorVariacaoTexto((atual) => ({ ...atual, [v.index]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="clonar-acoes">
            <button className="btn-excluir" onClick={() => setStep(1)}>
              Voltar
            </button>
            <button className="btn-responder" onClick={() => setStep(3)} disabled={!tituloFinal.trim()}>
              Avançar
            </button>
          </div>
        </div>
      )}

      {step === 3 && preview && (
        <div className="painel">
          <h2>Confirmação</h2>
          <div className="clonar-resumo">
            <div className="clonar-resumo-linha">
              <span>Título</span>
              <b>{tituloFinal}</b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Loja de origem → destino</span>
              <b>
                {lojas.find((l) => l.id === preview.lojaOrigemId)?.nome ?? preview.lojaOrigemId} →{" "}
                {lojas.find((l) => l.id === lojaDestinoId)?.nome}
              </b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Quantidade de clones</span>
              <b>{quantidadeClones}</b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Categoria</span>
              <b>{preview.categoriaNome}</b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Preço</span>
              <b>{formatCurrency(preview.preco)}</b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Condição / Estoque</span>
              <b>
                {CONDICAO_LABEL[preview.condicao] ?? preview.condicao} · {preview.quantidadeDisponivel} un.
              </b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Tipo de anúncio</span>
              <b>{TIPOS_ANUNCIO.find((t) => t.value === listingType)?.label}</b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Frete</span>
              <b>
                {preview.frete.freteGratis ? "Grátis" : "Pago pelo comprador"}
                {preview.frete.retiradaLocal ? " · Retirada local" : ""}
                {ativarFlex ? " · Flex ativado" : ""}
              </b>
            </div>
            <div className="clonar-resumo-linha">
              <span>Atributos / Variações</span>
              <b>
                {preview.numAtributos} atributos · {preview.numVariacoes} variações
              </b>
            </div>
          </div>

          {preview.numVariacoes > 0 && !usarImagensPersonalizadas && (
            <p className="clonar-aviso">
              Este anúncio tem variações — elas serão recriadas com preço e estoque, usando as fotos gerais do
              anúncio original.
            </p>
          )}
          {preview.numVariacoes > 0 && usarImagensPersonalizadas && (
            <p className="clonar-aviso">
              Cada variação vai usar as fotos personalizadas que você definiu (ou as fotos originais, para as
              variações que você deixou em branco).
            </p>
          )}

          {!usarImagensPersonalizadas && (
            <div className="clonar-fotos">
              {preview.fotos.slice(0, 6).map((src) => (
                <img key={src} src={src} alt="" className="clonar-foto" />
              ))}
            </div>
          )}

          {preview.descricao && <p className="clonar-descricao">{preview.descricao.slice(0, 300)}...</p>}

          <a className="clonar-link-original" href={preview.linkOriginal} target="_blank" rel="noreferrer">
            Abrir anúncio original no Mercado Livre
          </a>

          <label className="clonar-checkbox clonar-confirmacao">
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            Revisei todos os dados acima e quero publicar este anúncio de verdade no Mercado Livre.
          </label>

          <div className="clonar-acoes">
            <button className="btn-excluir" onClick={() => setStep(2)}>
              Voltar
            </button>
            <button className="btn-responder" onClick={handlePublicar} disabled={!confirmado || publicando}>
              {publicando ? "Publicando..." : "Publicar anúncio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
