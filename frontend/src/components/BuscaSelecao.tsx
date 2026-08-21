import { useEffect, useMemo, useRef, useState } from "react";

// Escolha de item com busca que filtra enquanto digita.
//
// Substitui o <select> em qualquer lista longa: produto (139), cliente (20),
// matéria-prima (32). Num select é preciso saber o nome exato e rolar tudo;
// aqui digitar "areia 18" acha EMBORRACHADO AREIA 18KG, e digitar o código
// acha pelo SKU — quem está com a etiqueta na mão procura pelo código, quem
// está com o pedido do cliente na mão procura pelo nome.
//
// Cada termo é procurado separado e em qualquer ordem, então "18 areia" acha
// o mesmo que "areia 18". Sem acento e sem caixa: "galao" acha "GALÃO".

export interface ItemBusca {
  id: number;
  titulo: string;
  // código secundário (SKU, CNPJ) — entra na busca e aparece à direita
  codigo?: string | null;
  // informação de apoio (saldo, cidade) — só aparece, não entra na busca
  detalhe?: string | null;
  ativo?: boolean;
}

interface Props {
  itens: ItemBusca[];
  valor: number | null;
  onEscolher: (id: number | null) => void;
  placeholder?: string;
  limite?: number;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function BuscaSelecao({
  itens,
  valor,
  onEscolher,
  placeholder = "Buscar",
  limite = 40,
}: Props) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  const escolhido = useMemo(() => itens.find((i) => i.id === valor) ?? null, [itens, valor]);

  const filtrados = useMemo(() => {
    // item inativo some da busca, mas continua visível se já está escolhido —
    // editar um pedido antigo não pode perder a linha porque o produto saiu de linha
    const base = itens.filter((i) => i.ativo !== false || i.id === valor);
    const termos = normalizar(texto).split(/\s+/).filter(Boolean);
    if (!termos.length) return base.slice(0, limite);
    return base
      .filter((i) => {
        const alvo = normalizar(`${i.codigo ?? ""} ${i.titulo}`);
        return termos.every((t) => alvo.includes(t));
      })
      .slice(0, limite);
  }, [itens, texto, valor, limite]);

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

  function escolher(item: ItemBusca) {
    onEscolher(item.id);
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
      const item = filtrados[indice];
      if (aberto && item) {
        e.preventDefault();
        escolher(item);
      }
      return;
    }
    if (e.key === "Escape") {
      setAberto(false);
      setTexto("");
    }
  }

  const rotulo = escolhido
    ? escolhido.codigo
      ? `${escolhido.titulo} — ${escolhido.codigo}`
      : escolhido.titulo
    : "";

  return (
    <div className="busca-selecao" ref={caixa}>
      <input
        className="clonar-input"
        // fechado mostra o que está escolhido; aberto mostra o que está sendo
        // digitado — assim dá pra trocar sem apagar nada primeiro
        value={aberto ? texto : rotulo}
        placeholder={placeholder}
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
          className="busca-selecao-limpar"
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
        <div className="busca-selecao-lista">
          {!filtrados.length && <div className="busca-selecao-vazio">Nada encontrado.</div>}
          {filtrados.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`busca-selecao-item ${i === indice ? "busca-selecao-item-ativo" : ""}`}
              onMouseEnter={() => setIndice(i)}
              // mousedown e não click: o blur do input fecharia a lista antes
              // do clique completar, e o item nunca seria escolhido
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(item);
              }}
            >
              <span className="busca-selecao-titulo">{item.titulo}</span>
              {item.codigo && <span className="busca-selecao-codigo">{item.codigo}</span>}
              {item.detalhe && <span className="busca-selecao-detalhe">{item.detalhe}</span>}
            </button>
          ))}
          {filtrados.length >= limite && (
            <div className="busca-selecao-vazio">
              Mostrando os {limite} primeiros — digite mais pra afinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
