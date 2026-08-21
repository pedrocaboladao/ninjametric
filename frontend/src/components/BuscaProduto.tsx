import { useEffect, useMemo, useRef, useState } from "react";
import type { FabricaProduto } from "../types/fabricaProdutos";

// Busca de produto que filtra enquanto digita, por SKU ou por nome.
//
// Um <select> comum obriga a saber o nome exato e a rolar uma lista de 139
// itens. Aqui digitar "areia 18" acha EMBORRACHADA AREIA 18KG, e digitar
// "EMB-AR-18" acha pelo código — quem está com a etiqueta na mão procura pelo
// SKU, quem está com o pedido do cliente na mão procura pelo nome.
//
// Cada termo digitado é procurado separadamente e em qualquer ordem, então
// "18 areia" acha a mesma coisa que "areia 18".

interface Props {
  produtos: FabricaProduto[];
  valor: number | null;
  saldoDe?: (produtoId: number) => number | undefined;
  onEscolher: (produtoId: number | null) => void;
}

// tira acento e caixa: quem digita "galao" tem que achar "GALÃO"
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const LIMITE = 40;

export function BuscaProduto({ produtos, valor, saldoDe, onEscolher }: Props) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  const escolhido = useMemo(
    () => produtos.find((p) => p.id === valor) ?? null,
    [produtos, valor]
  );

  const filtrados = useMemo(() => {
    // produto inativo some da busca, mas continua visível se já está no pedido
    const base = produtos.filter((p) => p.ativo || p.id === valor);
    const termos = normalizar(texto).split(/\s+/).filter(Boolean);
    if (!termos.length) return base.slice(0, LIMITE);
    return base
      .filter((p) => {
        const alvo = normalizar(`${p.sku} ${p.nome}`);
        return termos.every((t) => alvo.includes(t));
      })
      .slice(0, LIMITE);
  }, [produtos, texto, valor]);

  useEffect(() => {
    setIndice(0);
  }, [texto]);

  // clicar fora fecha sem escolher nada
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function escolher(p: FabricaProduto) {
    onEscolher(p.id);
    setTexto("");
    setAberto(false);
  }

  function teclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!aberto) return setAberto(true);
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => Math.min(filtrados.length - 1, Math.max(0, i + passo)));
      return;
    }
    if (e.key === "Enter") {
      const p = filtrados[indice];
      if (aberto && p) {
        e.preventDefault();
        escolher(p);
      }
      return;
    }
    if (e.key === "Escape") {
      setAberto(false);
      setTexto("");
    }
  }

  return (
    <div className="busca-produto" ref={caixa}>
      <input
        className="clonar-input"
        // fechado mostra o produto escolhido; aberto mostra o que está sendo digitado
        value={aberto ? texto : escolhido ? `${escolhido.nome} — ${escolhido.sku}` : ""}
        placeholder="Buscar por nome ou SKU"
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
        }}
        onFocus={() => {
          setTexto("");
          setAberto(true);
        }}
        onKeyDown={teclado}
      />
      {escolhido && !aberto && (
        <button
          type="button"
          className="busca-produto-limpar"
          title="Limpar"
          onClick={() => {
            onEscolher(null);
            setTexto("");
          }}
        >
          ×
        </button>
      )}
      {aberto && (
        <div className="busca-produto-lista">
          {!filtrados.length && <div className="busca-produto-vazio">Nenhum produto encontrado.</div>}
          {filtrados.map((p, i) => {
            const saldo = saldoDe?.(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`busca-produto-item ${i === indice ? "busca-produto-item-ativo" : ""}`}
                onMouseEnter={() => setIndice(i)}
                // mousedown e não click: o blur do input fecharia a lista antes do clique
                onMouseDown={(e) => {
                  e.preventDefault();
                  escolher(p);
                }}
              >
                <span className="busca-produto-nome">{p.nome}</span>
                <span className="busca-produto-sku">{p.sku}</span>
                {saldo !== undefined && (
                  <span className="busca-produto-saldo">{saldo} em estoque</span>
                )}
              </button>
            );
          })}
          {filtrados.length >= LIMITE && (
            <div className="busca-produto-vazio">
              Mostrando os {LIMITE} primeiros — digite mais pra afinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
