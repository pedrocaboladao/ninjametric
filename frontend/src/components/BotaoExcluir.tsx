import { useEffect, useState } from "react";
import { IconTrash } from "./icons";

// Excluir em dois cliques, no lugar do confirm() do navegador.
//
// O confirm() nativo trava a thread da página inteira enquanto o diálogo está
// aberto, fica fora do visual do sistema, e em alguns navegadores é suprimido
// sem aviso — o clique some e ninguém sabe por quê.
//
// Aqui o primeiro clique arma e o segundo executa. O botão volta sozinho
// depois de alguns segundos: um botão travado em "Confirmar?" vira armadilha
// pra quem clicou sem querer, saiu da linha e voltou depois.

interface Props {
  onConfirmar: () => void | Promise<void>;
  // aparece enquanto está armado — o que a pessoa precisa saber antes de
  // confirmar, tipo "3 fórmulas usam esta embalagem"
  aviso?: string;
  titulo?: string;
}

const SEGUNDOS_ARMADO = 4000;

export function BotaoExcluir({ onConfirmar, aviso, titulo = "Excluir" }: Props) {
  const [armado, setArmado] = useState(false);

  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), SEGUNDOS_ARMADO);
    return () => clearTimeout(t);
  }, [armado]);

  if (!armado) {
    return (
      <button
        type="button"
        className="btn-excluir"
        title={titulo}
        onClick={() => setArmado(true)}
      >
        <IconTrash size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-responder"
      title={aviso ?? "Clique de novo pra confirmar"}
      onClick={() => {
        setArmado(false);
        void onConfirmar();
      }}
    >
      Confirmar?
    </button>
  );
}
