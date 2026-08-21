import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchFabricaEmbalagens,
  criarFabricaEmbalagem,
  atualizarFabricaEmbalagem,
  excluirFabricaEmbalagem,
  fetchVinculosEmbalagem,
  ligarVinculoEmbalagem,
  vincularPorPeso,
  fetchComprasEmbalagem,
  registrarCompraEmbalagem,
  excluirCompraEmbalagem,
  fetchAjustesEmbalagem,
  registrarAjusteEmbalagem,
  excluirAjusteEmbalagem,
} from "../api/fabricaEmbalagens";
import type {
  FabricaEmbalagem,
  FabricaEmbalagemEntrada,
  VinculoEmbalagem,
  MovimentoEmbalagem,
} from "../types/fabricaEmbalagens";
import { formatCurrency } from "../utils/format";
import { IconPlus } from "./icons";
import { BotaoExcluir } from "./BotaoExcluir";

// aceita "8,47" e "8.47" — o operador digita como fala
function num(v: string): number {
  return Number(String(v).replace(",", ".")) || 0;
}

function data(d: string): string {
  return d.split("-").reverse().join("/");
}

const RASCUNHO_VAZIO = {
  nome: "",
  pesoKg: "",
  custoUnitario: "",
  estoqueMinimo: "",
  equivaleAId: "",
  ativo: true,
};

export function FabricaEmbalagens() {
  const [embalagens, setEmbalagens] = useState<FabricaEmbalagem[] | null>(null);
  const [vinculos, setVinculos] = useState<VinculoEmbalagem[]>([]);
  const [compras, setCompras] = useState<MovimentoEmbalagem[]>([]);
  const [ajustes, setAjustes] = useState<MovimentoEmbalagem[]>([]);
  const [rascunho, setRascunho] = useState({ ...RASCUNHO_VAZIO });
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<"cadastro" | "compras" | "ajustes" | "vinculos">("cadastro");

  // compra
  const [compraId, setCompraId] = useState("");
  const [compraQtd, setCompraQtd] = useState("");
  const [compraCusto, setCompraCusto] = useState("");
  const [compraNota, setCompraNota] = useState("");

  // ajuste / inventário
  const [ajusteId, setAjusteId] = useState("");
  const [ajusteTipo, setAjusteTipo] = useState<"inventario" | "ajuste">("inventario");
  const [ajusteQtd, setAjusteQtd] = useState("");
  const [ajusteMotivo, setAjusteMotivo] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [es, vs, cs, as] = await Promise.all([
        fetchFabricaEmbalagens(),
        fetchVinculosEmbalagem(),
        fetchComprasEmbalagem(),
        fetchAjustesEmbalagem(),
      ]);
      setEmbalagens(es);
      setVinculos(vs);
      setCompras(cs);
      setAjustes(as);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      setEmbalagens([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alertas = useMemo(
    // um balde compartilhado aparece uma vez só no alerta: quem se compra é a raiz
    () => (embalagens ?? []).filter((e) => e.abaixoDoMinimo && e.equivaleAId === null),
    [embalagens]
  );
  const semVinculo = useMemo(() => vinculos.filter((v) => v.fabricaEmbalagemId === null).length, [vinculos]);
  const valorTotal = useMemo(
    () =>
      (embalagens ?? [])
        .filter((e) => e.equivaleAId === null)
        .reduce((s, e) => s + Math.max(0, e.estoque) * e.custoUnitario, 0),
    [embalagens]
  );

  function editar(e: FabricaEmbalagem) {
    setAba("cadastro");
    setEditandoId(e.id);
    setRascunho({
      nome: e.nome,
      ativo: e.ativo,
      pesoKg: String(e.pesoKg),
      custoUnitario: String(e.custoUnitario),
      estoqueMinimo: String(e.estoqueMinimo),
      equivaleAId: e.equivaleAId ? String(e.equivaleAId) : "",
    });
    setErro(null);
  }

  function cancelar() {
    setEditandoId(null);
    setRascunho({ ...RASCUNHO_VAZIO });
    setErro(null);
  }

  async function salvar() {
    const entrada: FabricaEmbalagemEntrada = {
      nome: rascunho.nome.trim(),
      pesoKg: num(rascunho.pesoKg),
      custoUnitario: num(rascunho.custoUnitario),
      estoqueMinimo: num(rascunho.estoqueMinimo),
      ativo: rascunho.ativo !== false,
      equivaleAId: rascunho.equivaleAId ? Number(rascunho.equivaleAId) : null,
    };
    if (!entrada.nome) return setErro("Informe o nome da embalagem.");
    if (entrada.pesoKg <= 0) return setErro("Peso deve ser maior que zero.");
    setSalvando(true);
    try {
      if (editandoId) await atualizarFabricaEmbalagem(editandoId, entrada);
      else await criarFabricaEmbalagem(entrada);
      cancelar();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(e: FabricaEmbalagem) {
    try {
      await excluirFabricaEmbalagem(e.id);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  async function autoVincular() {
    try {
      const r = await vincularPorPeso();
      setAviso(
        `${r.ligadas} vínculo(s) feitos pelo peso.` +
          (r.ambiguas ? ` ${r.ambiguas} ficaram sem vínculo — peso repetido ou sem cadastro, escolha à mão.` : "")
      );
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao vincular.");
    }
  }

  async function trocarVinculo(v: VinculoEmbalagem, valor: string) {
    try {
      await ligarVinculoEmbalagem(v.id, valor ? Number(valor) : null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ligar.");
    }
  }

  async function lancarCompra() {
    const id = Number(compraId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a embalagem.");
    const qtd = Math.round(num(compraQtd));
    if (qtd <= 0) return setErro("Quantidade deve ser maior que zero.");
    try {
      await registrarCompraEmbalagem({
        embalagemId: id,
        quantidade: qtd,
        custoUnitario: num(compraCusto),
        observacao: compraNota.trim() || null,
      });
      setAviso(
        num(compraCusto) > 0
          ? "Compra lançada. O custo unitário do cadastro passou a ser o desta compra."
          : "Compra lançada."
      );
      setCompraQtd("");
      setCompraCusto("");
      setCompraNota("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lançar compra.");
    }
  }

  async function lancarAjuste() {
    const id = Number(ajusteId);
    if (!Number.isInteger(id) || !id) return setErro("Escolha a embalagem.");
    const v = Math.round(num(ajusteQtd));
    if (ajusteTipo === "ajuste" && v === 0) {
      return setErro("Informe a quantidade (positiva entra, negativa sai).");
    }
    try {
      const r = await registrarAjusteEmbalagem({
        embalagemId: id,
        tipo: ajusteTipo,
        quantidade: ajusteTipo === "ajuste" ? v : undefined,
        contado: ajusteTipo === "inventario" ? v : undefined,
        motivo: ajusteMotivo.trim() || null,
      });
      setAviso(
        ajusteTipo === "inventario" && r.diferenca !== undefined
          ? `Inventário registrado. Diferença de ${r.diferenca} em relação ao que o sistema tinha.`
          : "Ajuste registrado."
      );
      setAjusteQtd("");
      setAjusteMotivo("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao registrar.");
    }
  }

  async function apagarMovimento(m: MovimentoEmbalagem, tipo: "compra" | "ajuste") {
    try {
      if (tipo === "compra") await excluirCompraEmbalagem(m.id);
      else await excluirAjusteEmbalagem(m.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.");
    }
  }

  const lista = embalagens ?? [];
  const raizes = lista.filter((e) => e.equivaleAId === null);

  return (
    <div className="financeiro-page">
      <div className="financeiro-topo">
        <div>
          <div className="financeiro-stat-label">FÁBRICA DISTRIBUIDORA</div>
          <h1>Embalagens</h1>
          <p className="financeiro-td-mudo">
            O balde, a bombona, o galão. O saldo não é digitado: sai do que foi comprado menos os
            envases que os lotes já consumiram, mais os ajustes. Defina o mínimo para receber
            alerta de compra antes de faltar.
          </p>
        </div>
        <div>
          <div className="financeiro-stat-label">
            {alertas.length ? `${alertas.length} ABAIXO DO MÍNIMO` : "VALOR EM ESTOQUE"}
          </div>
          <div className="financeiro-stat-valor">
            {alertas.length ? alertas.length : formatCurrency(valorTotal)}
          </div>
        </div>
      </div>

      {erro && <p className="financeiro-td-mudo">{erro}</p>}
      {aviso && <p className="financeiro-td-mudo">{aviso}</p>}

      <div className="financeiro-filtros">
        {(["cadastro", "compras", "ajustes", "vinculos"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={aba === a ? "btn-responder" : "btn-excluir"}
            onClick={() => setAba(a)}
          >
            {a === "cadastro"
              ? "Cadastro e saldo"
              : a === "compras"
                ? "Compras"
                : a === "ajustes"
                  ? "Inventário"
                  : `Ligação com fórmulas${semVinculo ? ` (${semVinculo})` : ""}`}
          </button>
        ))}
      </div>

      {aba === "cadastro" && (
        <>
          <div className="financeiro-filtros">
            <input
              className="clonar-input"
              placeholder="Nome (ex: Balde 18kg)"
              value={rascunho.nome}
              onChange={(e) => setRascunho((v) => ({ ...v, nome: e.target.value }))}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Peso (kg)"
              value={rascunho.pesoKg}
              onChange={(e) => setRascunho((v) => ({ ...v, pesoKg: e.target.value }))}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Custo un. (R$)"
              value={rascunho.custoUnitario}
              onChange={(e) => setRascunho((v) => ({ ...v, custoUnitario: e.target.value }))}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Mínimo"
              value={rascunho.estoqueMinimo}
              onChange={(e) => setRascunho((v) => ({ ...v, estoqueMinimo: e.target.value }))}
            />
            <select
              className="clonar-input"
              value={rascunho.equivaleAId}
              onChange={(e) => setRascunho((v) => ({ ...v, equivaleAId: e.target.value }))}
              title="Quando é o mesmo balde físico de outra embalagem"
            >
              <option value="">— balde próprio —</option>
              {raizes
                .filter((e) => e.id !== editandoId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    mesmo balde do {e.nome}
                  </option>
                ))}
            </select>
            <button type="button" className="btn-responder" onClick={() => void salvar()} disabled={salvando}>
              <IconPlus size={14} /> {editandoId ? "Salvar" : "Adicionar"}
            </button>
            {editandoId && (
              <button type="button" className="btn-excluir" onClick={cancelar}>
                Cancelar
              </button>
            )}
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>EMBALAGEM</th>
                  <th className="financeiro-th-numero">PESO</th>
                  <th className="financeiro-th-numero">CUSTO UN.</th>
                  <th className="financeiro-th-numero">COMPRADO</th>
                  <th className="financeiro-th-numero">CONSUMIDO</th>
                  <th className="financeiro-th-numero">SALDO</th>
                  <th className="financeiro-th-numero">MÍNIMO</th>
                  <th>SITUAÇÃO</th>
                  <th className="financeiro-th-numero">FÓRMULAS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {embalagens === null && (
                  <tr>
                    <td colSpan={10}>Carregando…</td>
                  </tr>
                )}
                {embalagens !== null && !lista.length && (
                  <tr>
                    <td colSpan={10}>Nenhuma embalagem cadastrada ainda.</td>
                  </tr>
                )}
                {lista.map((e) => (
                  <tr key={e.id} style={e.ativo ? undefined : { opacity: 0.5 }}>
                    <td>
                      <button type="button" className="fabricacao-envase-nome-editavel" onClick={() => editar(e)}>
                        {e.nome}
                      </button>
                      {e.equivaleAId !== null && (
                        <span className="financeiro-td-mudo"> · mesmo balde</span>
                      )}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.pesoKg}kg</td>
                    <td className="financeiro-th-numero">{formatCurrency(e.custoUnitario)}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.comprado || "—"}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.consumido || "—"}</td>
                    <td className="financeiro-th-numero">{e.estoque}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.estoqueMinimo || "—"}</td>
                    <td className={e.abaixoDoMinimo ? undefined : "financeiro-td-mudo"}>
                      {e.estoqueMinimo <= 0 ? "sem controle" : e.abaixoDoMinimo ? "COMPRAR" : "ok"}
                    </td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{e.formulasLigadas || "—"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void excluir(e)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            Comprado, consumido e saldo são compartilhados entre as embalagens marcadas como o
            mesmo balde — o de 18, 16 e 15 kg é o mesmo balde, muda só quanto se põe dentro.
          </p>
        </>
      )}

      {aba === "compras" && (
        <>
          <div className="financeiro-filtros">
            <select className="clonar-input" value={compraId} onChange={(e) => setCompraId(e.target.value)}>
              <option value="">Embalagem</option>
              {lista.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome} — saldo {e.estoque}
                </option>
              ))}
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Quantidade"
              value={compraQtd}
              onChange={(e) => setCompraQtd(e.target.value)}
            />
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder="Custo un. (R$)"
              value={compraCusto}
              onChange={(e) => setCompraCusto(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Fornecedor / nota (opcional)"
              value={compraNota}
              onChange={(e) => setCompraNota(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancarCompra()}>
              <IconPlus size={14} /> Lançar compra
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>EMBALAGEM</th>
                  <th className="financeiro-th-numero">QUANTIDADE</th>
                  <th className="financeiro-th-numero">CUSTO UN.</th>
                  <th className="financeiro-th-numero">TOTAL</th>
                  <th>FORNECEDOR / NOTA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!compras.length && (
                  <tr>
                    <td colSpan={7}>Nenhuma compra lançada.</td>
                  </tr>
                )}
                {compras.map((c) => (
                  <tr key={c.id}>
                    <td className="financeiro-td-mudo">{data(c.data)}</td>
                    <td>{c.embalagemNome}</td>
                    <td className="financeiro-th-numero">{c.quantidade}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">
                      {formatCurrency(c.custoUnitario ?? 0)}
                    </td>
                    <td className="financeiro-th-numero">
                      {formatCurrency((c.custoUnitario ?? 0) * c.quantidade)}
                    </td>
                    <td className="financeiro-td-mudo">{c.texto ?? "—"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagarMovimento(c, "compra")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            Lançar compra com custo unitário também atualiza o custo do cadastro: o preço que vale
            pro custo do produto é o da última compra, não o que foi digitado uma vez.
          </p>
        </>
      )}

      {aba === "ajustes" && (
        <>
          <div className="financeiro-filtros">
            <select className="clonar-input" value={ajusteId} onChange={(e) => setAjusteId(e.target.value)}>
              <option value="">Embalagem</option>
              {lista.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome} — saldo {e.estoque}
                </option>
              ))}
            </select>
            <select
              className="clonar-input fabricacao-input-pequeno"
              value={ajusteTipo}
              onChange={(e) => setAjusteTipo(e.target.value as "inventario" | "ajuste")}
            >
              <option value="inventario">Inventário (contei)</option>
              <option value="ajuste">Ajuste (entra/sai)</option>
            </select>
            <input
              className="clonar-input fabricacao-input-pequeno"
              placeholder={ajusteTipo === "inventario" ? "Quantos tem" : "± quantidade"}
              value={ajusteQtd}
              onChange={(e) => setAjusteQtd(e.target.value)}
            />
            <input
              className="clonar-input"
              placeholder="Motivo (opcional)"
              value={ajusteMotivo}
              onChange={(e) => setAjusteMotivo(e.target.value)}
            />
            <button type="button" className="btn-responder" onClick={() => void lancarAjuste()}>
              <IconPlus size={14} /> Registrar
            </button>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>EMBALAGEM</th>
                  <th className="financeiro-th-numero">QUANTIDADE</th>
                  <th>MOTIVO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!ajustes.length && (
                  <tr>
                    <td colSpan={5}>Nenhum ajuste registrado.</td>
                  </tr>
                )}
                {ajustes.map((a) => (
                  <tr key={a.id}>
                    <td className="financeiro-td-mudo">{data(a.data)}</td>
                    <td>{a.embalagemNome}</td>
                    <td className="financeiro-th-numero">
                      {a.quantidade > 0 ? "+" : ""}
                      {a.quantidade}
                    </td>
                    <td className="financeiro-td-mudo">{a.texto ?? "—"}</td>
                    <td>
                      <BotaoExcluir onConfirmar={() => void apagarMovimento(a, "ajuste")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="financeiro-td-mudo">
            No inventário você informa quantos tem; o sistema grava a diferença. É a diferença que
            mostra onde está vazando — um número novo sozinho esconde o problema.
          </p>
        </>
      )}

      {aba === "vinculos" && (
        <>
          <div className="financeiro-topo">
            <div>
              <h2>Ligação com as fórmulas</h2>
              <p className="financeiro-td-mudo">
                Cada fórmula tem as embalagens digitadas nela. Ligar ao cadastro é o que permite
                saber quantos baldes cada produção consome.{" "}
                {semVinculo > 0 && `${semVinculo} ainda sem ligação — o consumo delas não é contado.`}
              </p>
            </div>
            <div>
              <button type="button" className="btn-responder" onClick={() => void autoVincular()}>
                Ligar pelo peso
              </button>
            </div>
          </div>

          <div className="financeiro-tabela-wrap">
            <table className="financeiro-tabela">
              <thead>
                <tr>
                  <th>FÓRMULA</th>
                  <th>EMBALAGEM NA FÓRMULA</th>
                  <th className="financeiro-th-numero">PESO</th>
                  <th className="financeiro-th-numero">CUSTO DIGITADO</th>
                  <th>LIGADA A</th>
                </tr>
              </thead>
              <tbody>
                {vinculos.map((v) => (
                  <tr key={v.id}>
                    <td className="financeiro-td-mudo">{v.formulaNome}</td>
                    <td>{v.nome}</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{v.pesoKg}kg</td>
                    <td className="financeiro-th-numero financeiro-td-mudo">{formatCurrency(v.custoDigitado)}</td>
                    <td>
                      <select
                        className="clonar-input fabricacao-input-pequeno"
                        value={v.fabricaEmbalagemId ?? ""}
                        onChange={(e) => void trocarVinculo(v, e.target.value)}
                      >
                        <option value="">— sem ligação —</option>
                        {lista.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nome} ({e.pesoKg}kg)
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
