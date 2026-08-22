import { useEffect, useRef } from "react";

// Caixa sobreposta pra editar sem sair de onde se está.
//
// O formulário de conta abria no topo da página. Quem clicava em Editar numa
// linha lá embaixo via a tela não mudar — o formulário estava fora do campo de
// visão, e não dava pra saber qual conta estava sendo editada.
//
// Fecha no Esc, no clique fora e no X. Não fecha ao clicar dentro: arrastar
// pra selecionar um texto e soltar o mouse fora fecharia a caixa e perderia o
// que foi digitado.

interface Props {
  titulo: string;
  subtitulo?: string;
  onFechar: () => void;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}

export function Modal({ titulo, subtitulo, onFechar, children, rodape }: Props) {
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", tecla);
    // a página atrás não rola junto: rolar dentro da caixa e ver o fundo se
    // mexer é o tipo de coisa que faz perder a linha do que se estava fazendo
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  useEffect(() => {
    // foco no primeiro campo: quem abriu quer digitar, não procurar o cursor
    const primeiro = caixa.current?.querySelector<HTMLElement>(
      "input:not([type=checkbox]), select, textarea"
    );
    primeiro?.focus();
  }, []);

  return (
    <div
      className="modal-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div className="modal-caixa" ref={caixa} role="dialog" aria-modal="true">
        <div className="modal-topo">
          <div>
            <h3 className="modal-titulo">{titulo}</h3>
            {subtitulo && <p className="modal-subtitulo">{subtitulo}</p>}
          </div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}
