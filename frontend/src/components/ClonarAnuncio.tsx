import { useEffect, useState } from "react";
import type { Loja, PreviewAnuncio, ResultadoClone } from "../types/clonarAnuncio";
import { TIPOS_ANUNCIO } from "../types/clonarAnuncio";
import { fetchLojas, buscarPreview, publicarClone } from "../api/clonarAnuncio";
import { formatCurrency } from "../utils/format";

const CONDICAO_LABEL: Record<string, string> = { new: "Novo", used: "Usado" };

function passosLabel(step: number) {
  return ["Link", "Título", "Confirmação"][step - 1];
}

export function ClonarAnuncio() {
  const [step, setStep] = useState(1);
  const [lojas, setLojas] = useState<Loja[]>([]);

  const [url, setUrl] = useState("");
  const [lojaDestinoId, setLojaDestinoId] = useState<number | "">("");
  const [listingType, setListingType] = useState<string>(TIPOS_ANUNCIO[0].value);
  const [ativarFlex, setAtivarFlex] = useState(false);
  const [usarImagensPersonalizadas, setUsarImagensPersonalizadas] = useState(false);
  const [imagensTexto, setImagensTexto] = useState("");

  const [tituloFinal, setTituloFinal] = useState("");
  const [preview, setPreview] = useState<PreviewAnuncio | null>(null);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoClone | null>(null);

  useEffect(() => {
    fetchLojas()
      .then(setLojas)
      .catch(() => setErro("Não foi possível carregar a lista de lojas."));
  }, []);

  function resetar() {
    setStep(1);
    setUrl("");
    setLojaDestinoId("");
    setListingType(TIPOS_ANUNCIO[0].value);
    setAtivarFlex(false);
    setUsarImagensPersonalizadas(false);
    setImagensTexto("");
    setTituloFinal("");
    setPreview(null);
    setErro(null);
    setConfirmado(false);
    setResultado(null);
  }

  async function handleBuscarAnuncio() {
    if (!url.trim() || lojaDestinoId === "") {
      setErro("Cole a URL do anúncio e escolha a loja de destino.");
      return;
    }
    setLoadingPreview(true);
    setErro(null);
    try {
      const dados = await buscarPreview(url.trim(), Number(lojaDestinoId));
      setPreview(dados);
      setTituloFinal(dados.tituloOriginal);
      setStep(2);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao buscar anúncio.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handlePublicar() {
    if (!preview || lojaDestinoId === "") return;
    setPublicando(true);
    setErro(null);
    try {
      const imagensPersonalizadas = usarImagensPersonalizadas
        ? imagensTexto
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const resultado = await publicarClone({
        url: url.trim(),
        lojaDestinoId: Number(lojaDestinoId),
        tituloFinal: tituloFinal.trim(),
        listingType,
        ativarFlex,
        imagensPersonalizadas,
      });
      setResultado(resultado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao publicar anúncio.");
    } finally {
      setPublicando(false);
    }
  }

  if (resultado) {
    return (
      <div className="clonar">
        <div className="painel clonar-sucesso">
          <span className="painel-eyebrow">Anúncio criado</span>
          <h2>Publicado com sucesso!</h2>
          <p className="painel-sub">O novo anúncio já está ativo no Mercado Livre.</p>
          <a className="btn-responder" href={resultado.permalink} target="_blank" rel="noreferrer">
            Abrir anúncio no Mercado Livre
          </a>
          <button className="btn-excluir" style={{ marginTop: 10 }} onClick={resetar}>
            Clonar outro anúncio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="clonar">
      <div className="clonar-header">
        <div>
          <h1>Clonar Anúncio</h1>
          <p className="painel-sub">Recria um anúncio existente em outra loja das 4.</p>
        </div>
        <div className="clonar-passos">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`clonar-passo ${step === n ? "clonar-passo-ativo" : ""} ${step > n ? "clonar-passo-feito" : ""}`}>
              {n}. {passosLabel(n)}
            </span>
          ))}
        </div>
      </div>

      {erro && <div className="clonar-erro">{erro}</div>}

      {step === 1 && (
        <div className="painel">
          <h2>1. Link do anúncio</h2>
          <p className="painel-sub">
            Só é possível clonar anúncios que já pertencem a uma das suas 4 lojas — o Mercado Livre não deixa ler os
            detalhes completos de anúncios de outras contas.
          </p>
          <div className="clonar-campo">
            <label>URL do anúncio original</label>
            <input
              className="clonar-input"
              placeholder="https://produto.mercadolivre.com.br/MLB-..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="clonar-linha">
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
                    {l.nome}
                  </option>
                ))}
              </select>
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
          </div>
          <div className="clonar-checkbox-linha">
            <label className="clonar-checkbox">
              <input type="checkbox" checked={ativarFlex} onChange={(e) => setAtivarFlex(e.target.checked)} />
              Ativar Mercado Envios Flex
            </label>
            <label className="clonar-checkbox">
              <input
                type="checkbox"
                checked={usarImagensPersonalizadas}
                onChange={(e) => setUsarImagensPersonalizadas(e.target.checked)}
              />
              Usar imagens personalizadas
            </label>
          </div>
          {usarImagensPersonalizadas && (
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
            <button className="btn-responder" onClick={handleBuscarAnuncio} disabled={loadingPreview}>
              {loadingPreview ? "Buscando..." : "Buscar anúncio"}
            </button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="painel">
          <h2>2. Ajustar título</h2>
          <p className="painel-sub">Título original: {preview.tituloOriginal}</p>
          <div className="clonar-campo">
            <label>Título do novo anúncio</label>
            <input className="clonar-input" value={tituloFinal} onChange={(e) => setTituloFinal(e.target.value)} />
          </div>
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
          <h2>3. Confirmação</h2>
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

          {preview.numVariacoes > 0 && (
            <p className="clonar-aviso">
              Este anúncio tem variações — elas serão recriadas com preço e estoque, mas usando as fotos gerais do
              anúncio (não é possível reaproveitar uma foto específica por variação).
            </p>
          )}

          <div className="clonar-fotos">
            {(usarImagensPersonalizadas
              ? imagensTexto.split("\n").map((s) => s.trim()).filter(Boolean)
              : preview.fotos
            )
              .slice(0, 6)
              .map((src) => (
                <img key={src} src={src} alt="" className="clonar-foto" />
              ))}
          </div>

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
