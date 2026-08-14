import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCategorias,
  criarCategoria,
  excluirCategoria,
  fetchMeses,
  fetchRanking,
  salvarLancamentosDoMes,
  fetchEvolucao,
  importarPlanilha,
  importarAnuncios,
  fetchSnapshotsAnuncios,
  fetchAnuncios,
} from "../api/pesquisa";
import type { PesquisaCategoria, PesquisaEvolucao, ResumoImportacaoPlanilha, PesquisaAnuncio } from "../types/pesquisa";
import { formatCurrency } from "../utils/format";

interface LinhaEditavel {
  vendedor: string;
  qtde: string;
  totalReais: string;
}

function mesAtualPadrao(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

function linhaVazia(): LinhaEditavel {
  return { vendedor: "", qtde: "", totalReais: "" };
}

function formatMesCurto(mesIso: string): string {
  const [ano, mes] = mesIso.split("-");
  const data = new Date(Number(ano), Number(mes) - 1, 1);
  return data.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
}

export function PesquisaMercado() {
  const [categorias, setCategorias] = useState<PesquisaCategoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [mostrarNovaCategoria, setMostrarNovaCategoria] = useState(false);

  const [mes, setMes] = useState(mesAtualPadrao());
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([linhaVazia()]);
  const [carregandoMes, setCarregandoMes] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [evolucao, setEvolucao] = useState<PesquisaEvolucao | null>(null);

  const [importando, setImportando] = useState(false);
  const [resumoImportacao, setResumoImportacao] = useState<ResumoImportacaoPlanilha[] | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  async function handleImportarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setImportando(true);
    setErro(null);
    setResumoImportacao(null);
    try {
      const resumo = await importarPlanilha(arquivo);
      setResumoImportacao(resumo);
      const cats = await fetchCategorias();
      setCategorias(cats);
      if (categoriaId !== null) {
        const [ranking, evo] = await Promise.all([fetchRanking(categoriaId, mes), fetchEvolucao(categoriaId)]);
        setLinhas(
          ranking.length > 0
            ? ranking.map((r) => ({ vendedor: r.vendedor, qtde: String(r.qtde), totalReais: String(r.totalReais) }))
            : [linhaVazia()]
        );
        setEvolucao(evo);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao importar planilha");
    } finally {
      setImportando(false);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    }
  }

  useEffect(() => {
    fetchCategorias()
      .then((cats) => {
        setCategorias(cats);
        if (cats.length > 0) setCategoriaId((atual) => atual ?? cats[0].id);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar categorias"));
  }, []);

  useEffect(() => {
    if (categoriaId === null) return;
    fetchMeses(categoriaId)
      .then((meses) => {
        if (meses.length > 0) setMes(meses[0].slice(0, 7));
      })
      .catch(() => {});
    fetchEvolucao(categoriaId)
      .then(setEvolucao)
      .catch(() => setEvolucao(null));
  }, [categoriaId]);

  useEffect(() => {
    if (categoriaId === null || !mes) return;
    setCarregandoMes(true);
    setErro(null);
    fetchRanking(categoriaId, mes)
      .then((ranking) => {
        setLinhas(
          ranking.length > 0
            ? ranking.map((r) => ({ vendedor: r.vendedor, qtde: String(r.qtde), totalReais: String(r.totalReais) }))
            : [linhaVazia()]
        );
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar lançamentos do mês"))
      .finally(() => setCarregandoMes(false));
  }, [categoriaId, mes]);

  const totalMesDraft = useMemo(
    () => linhas.reduce((soma, l) => soma + (Number(l.totalReais) || 0), 0),
    [linhas]
  );

  function atualizarLinha(index: number, campo: keyof LinhaEditavel, valor: string) {
    setLinhas((atual) => atual.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  }

  function adicionarLinha() {
    setLinhas((atual) => [...atual, linhaVazia()]);
  }

  function removerLinha(index: number) {
    setLinhas((atual) => atual.filter((_, i) => i !== index));
  }

  async function adicionarCategoria() {
    const nome = novaCategoria.trim();
    if (!nome) return;
    try {
      const categoria = await criarCategoria(nome);
      setCategorias((atual) => [...atual, categoria].sort((a, b) => a.nome.localeCompare(b.nome)));
      setCategoriaId(categoria.id);
      setNovaCategoria("");
      setMostrarNovaCategoria(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar categoria");
    }
  }

  async function removerCategoriaAtual() {
    if (categoriaId === null) return;
    const categoria = categorias.find((c) => c.id === categoriaId);
    if (!categoria) return;
    if (
      !confirm(`Excluir a categoria "${categoria.nome}"? Todos os dados lançados nela serão apagados. Não tem como desfazer.`)
    )
      return;
    try {
      await excluirCategoria(categoriaId);
      const restantes = categorias.filter((c) => c.id !== categoriaId);
      setCategorias(restantes);
      setCategoriaId(restantes.length > 0 ? restantes[0].id : null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir categoria");
    }
  }

  async function salvar() {
    if (categoriaId === null) return;
    const validas = linhas
      .filter((l) => l.vendedor.trim())
      .map((l) => ({ vendedor: l.vendedor.trim(), qtde: Number(l.qtde) || 0, totalReais: Number(l.totalReais) || 0 }));
    setSalvando(true);
    setErro(null);
    try {
      await salvarLancamentosDoMes(categoriaId, mes, validas);
      const [ranking, evo] = await Promise.all([fetchRanking(categoriaId, mes), fetchEvolucao(categoriaId)]);
      setLinhas(
        ranking.length > 0
          ? ranking.map((r) => ({ vendedor: r.vendedor, qtde: String(r.qtde), totalReais: String(r.totalReais) }))
          : [linhaVazia()]
      );
      setEvolucao(evo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar lançamentos");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <span className="painel-eyebrow">Pesquisa de Mercado</span>
          <h1>Ranking de vendedores por categoria</h1>
          <p className="painel-sub">
            Lance mês a mês o que os concorrentes venderam em cada categoria — os dados vêm do sistema externo de
            pesquisa de mercado. A participação % é calculada automaticamente a partir do total de cada vendedor no
            mês.
          </p>
        </div>
        <div className="financeiro-filtros">
          <input
            ref={inputArquivoRef}
            type="file"
            accept=".xlsx"
            className="pesquisa-input-arquivo-oculto"
            onChange={handleImportarArquivo}
          />
          <button
            type="button"
            className="btn-responder"
            disabled={importando}
            onClick={() => inputArquivoRef.current?.click()}
          >
            {importando ? "Importando..." : "Importar planilha (.xlsx)"}
          </button>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      {resumoImportacao && (
        <div className="pesquisa-card">
          <h2>Resultado da importação</h2>
          {resumoImportacao.length === 0 ? (
            <p className="painel-sub">Nenhuma aba com dados reconhecíveis foi encontrada nesse arquivo.</p>
          ) : (
            <div className="financeiro-tabela-wrap">
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="financeiro-th-numero">Lançamentos</th>
                    <th className="financeiro-th-numero">Meses</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {resumoImportacao.map((r) => (
                    <tr key={r.categoria}>
                      <td>{r.categoria}</td>
                      <td className="financeiro-th-numero">{r.linhas}</td>
                      <td className="financeiro-th-numero">{r.meses}</td>
                      <td className="financeiro-td-mudo">{r.criada ? "categoria criada" : "atualizada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="pesquisa-categorias-barra">
        <select
          className="dashboard-select"
          value={categoriaId ?? ""}
          onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)}
        >
          {categorias.length === 0 && <option value="">Nenhuma categoria cadastrada</option>}
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>

        {mostrarNovaCategoria ? (
          <>
            <input
              className="clonar-input pesquisa-input-categoria"
              placeholder="Nome da categoria"
              value={novaCategoria}
              onChange={(e) => setNovaCategoria(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && adicionarCategoria()}
              autoFocus
            />
            <button type="button" className="btn-responder" onClick={adicionarCategoria}>
              Adicionar
            </button>
            <button
              type="button"
              className="btn-secundario"
              onClick={() => {
                setMostrarNovaCategoria(false);
                setNovaCategoria("");
              }}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secundario" onClick={() => setMostrarNovaCategoria(true)}>
              + Nova categoria
            </button>
            {categoriaId !== null && (
              <button type="button" className="btn-excluir" onClick={removerCategoriaAtual}>
                Excluir categoria
              </button>
            )}
          </>
        )}
      </div>

      {categorias.length === 0 && (
        <div className="state-message">Cadastre uma categoria (ex: "Tintas a óleo", "Vernizes") pra começar.</div>
      )}

      {categoriaId !== null && (
        <>
          <div className="pesquisa-card">
            <div className="pesquisa-card-topo">
              <h2>Lançamento do mês</h2>
              <input
                type="month"
                className="clonar-input pesquisa-input-mes"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              />
            </div>

            <div className="financeiro-tabela-wrap">
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th className="financeiro-th-numero">Qtde vendida</th>
                    <th className="financeiro-th-numero">Total (R$)</th>
                    <th className="financeiro-th-numero">Participação</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, i) => {
                    const totalNum = Number(linha.totalReais) || 0;
                    const participacao = totalMesDraft > 0 ? (totalNum / totalMesDraft) * 100 : 0;
                    return (
                      <tr key={i}>
                        <td>
                          <input
                            className="clonar-input"
                            value={linha.vendedor}
                            onChange={(e) => atualizarLinha(i, "vendedor", e.target.value)}
                            placeholder="Nome do vendedor/loja"
                          />
                        </td>
                        <td className="financeiro-th-numero">
                          <input
                            type="number"
                            className="clonar-input pesquisa-input-numero"
                            value={linha.qtde}
                            onChange={(e) => atualizarLinha(i, "qtde", e.target.value)}
                            min={0}
                          />
                        </td>
                        <td className="financeiro-th-numero">
                          <input
                            type="number"
                            className="clonar-input pesquisa-input-numero"
                            value={linha.totalReais}
                            onChange={(e) => atualizarLinha(i, "totalReais", e.target.value)}
                            min={0}
                            step="0.01"
                          />
                        </td>
                        <td className="financeiro-th-numero financeiro-td-mudo">{participacao.toFixed(1)}%</td>
                        <td>
                          <button
                            type="button"
                            className="pesquisa-remover-linha"
                            onClick={() => removerLinha(i)}
                            title="Remover linha"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pesquisa-card-acoes">
              <button type="button" className="btn-secundario" onClick={adicionarLinha}>
                + Vendedor
              </button>
              <button type="button" className="btn-responder" onClick={salvar} disabled={salvando || carregandoMes}>
                {salvando ? "Salvando..." : "Salvar mês"}
              </button>
            </div>
          </div>

          {evolucao && evolucao.meses.length > 0 && (
            <div className="pesquisa-card">
              <h2>Evolução por mês</h2>
              <div className="financeiro-tabela-wrap">
                <table className="financeiro-tabela">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      {evolucao.meses.map((m) => (
                        <th key={m} className="financeiro-th-numero">
                          {formatMesCurto(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="financeiro-td-mudo">Total do mercado</td>
                      {evolucao.totalMercadoPorMes.map((v, i) => (
                        <td key={i} className="financeiro-th-numero">
                          {formatCurrency(v)}
                        </td>
                      ))}
                    </tr>
                    {evolucao.series.map((serie) => (
                      <tr key={serie.vendedor}>
                        <td>{serie.vendedor}</td>
                        {serie.valores.map((v, i) => (
                          <td key={i} className="financeiro-th-numero">
                            {v === null ? "—" : formatCurrency(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <AnunciosSecao categoriaId={categoriaId} />
        </>
      )}
    </div>
  );
}

function hojeIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

function formatDataCurta(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function AnunciosSecao({ categoriaId }: { categoriaId: number }) {
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [snapshotSelecionado, setSnapshotSelecionado] = useState<string>("");
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [anuncios, setAnuncios] = useState<PesquisaAnuncio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSnapshotsAnuncios(categoriaId)
      .then((lista) => {
        setSnapshots(lista);
        setSnapshotSelecionado(lista[0] ?? "");
      })
      .catch(() => {});
  }, [categoriaId]);

  useEffect(() => {
    if (!snapshotSelecionado) {
      setAnuncios([]);
      return;
    }
    setCarregando(true);
    setErro(null);
    fetchAnuncios(categoriaId, snapshotSelecionado, vendedorFiltro)
      .then(setAnuncios)
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao buscar anúncios"))
      .finally(() => setCarregando(false));
  }, [categoriaId, snapshotSelecionado, vendedorFiltro]);

  async function handleImportar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setImportando(true);
    setErro(null);
    try {
      const data = hojeIso();
      await importarAnuncios(categoriaId, data, arquivo);
      const lista = await fetchSnapshotsAnuncios(categoriaId);
      setSnapshots(lista);
      setSnapshotSelecionado(data);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao importar anúncios");
    } finally {
      setImportando(false);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    }
  }

  return (
    <div className="pesquisa-card">
      <div className="pesquisa-card-topo">
        <h2>Anúncios</h2>
        <div className="pesquisa-anuncios-acoes">
          {snapshots.length > 0 && (
            <select
              className="dashboard-select"
              value={snapshotSelecionado}
              onChange={(e) => setSnapshotSelecionado(e.target.value)}
            >
              {snapshots.map((s) => (
                <option key={s} value={s}>
                  {formatDataCurta(s)}
                </option>
              ))}
            </select>
          )}
          <input
            ref={inputArquivoRef}
            type="file"
            accept=".xlsx"
            className="pesquisa-input-arquivo-oculto"
            onChange={handleImportar}
          />
          <button
            type="button"
            className="btn-secundario"
            disabled={importando}
            onClick={() => inputArquivoRef.current?.click()}
          >
            {importando ? "Importando..." : "Importar anúncios (.xlsx)"}
          </button>
        </div>
      </div>

      {erro && <div className="state-message state-error">{erro}</div>}

      {snapshots.length === 0 ? (
        <p className="painel-sub">
          Nenhum anúncio importado ainda pra essa categoria — clique em "Importar anúncios" e envie a planilha
          exportada do sistema de pesquisa (uma linha por anúncio, com vendedor, produto, qtde e total).
        </p>
      ) : (
        <>
          <input
            className="clonar-input pesquisa-input-busca-vendedor"
            placeholder="Buscar por vendedor..."
            value={vendedorFiltro}
            onChange={(e) => setVendedorFiltro(e.target.value)}
          />

          {carregando ? (
            <p className="painel-sub">Carregando...</p>
          ) : (
            <div className="financeiro-tabela-wrap">
              <table className="financeiro-tabela">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Produto</th>
                    <th>Marca</th>
                    <th>Modo entrega</th>
                    <th>Frete grátis</th>
                    <th>Catálogo</th>
                    <th className="financeiro-th-numero">Qtde</th>
                    <th className="financeiro-th-numero">Preço unit.</th>
                    <th className="financeiro-th-numero">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {anuncios.map((a) => (
                    <tr key={a.id}>
                      <td>{a.vendedor}</td>
                      <td className="financeiro-td-titulo" title={a.produto}>
                        {a.produto}
                      </td>
                      <td className="financeiro-td-mudo">{a.marca ?? "—"}</td>
                      <td className="financeiro-td-mudo">{a.modoEntrega ?? "—"}</td>
                      <td className="financeiro-td-mudo">{a.freteGratis ? "Sim" : "Não"}</td>
                      <td className="financeiro-td-mudo">{a.catalogo ? "Sim" : "Não"}</td>
                      <td className="financeiro-th-numero">{a.qtde}</td>
                      <td className="financeiro-th-numero">{formatCurrency(a.precoUnitario)}</td>
                      <td className="financeiro-th-numero">{formatCurrency(a.total)}</td>
                    </tr>
                  ))}
                  {anuncios.length === 0 && (
                    <tr>
                      <td colSpan={9} className="financeiro-td-mudo">
                        Nenhum anúncio encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
