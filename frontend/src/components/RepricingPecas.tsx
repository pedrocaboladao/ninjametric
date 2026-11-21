// Peças pequenas compartilhadas pelas duas abas do Repricing.

export type Tom = "bom" | "ruim" | "alerta" | "neutro";

// Status nunca é só cor: bolinha + rótulo.
export function Status({ tom, children }: { tom: Tom; children: React.ReactNode }) {
  return (
    <span className={`rp-status rp-status-${tom}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

export function Paginacao({
  pagina,
  totalPaginas,
  onMudar,
}: {
  pagina: number;
  totalPaginas: number;
  onMudar: (pagina: number) => void;
}) {
  if (totalPaginas <= 1) return null;
  return (
    <div className="rp-paginacao">
      <button type="button" className="rp-botao" disabled={pagina === 0} onClick={() => onMudar(pagina - 1)}>
        Anterior
      </button>
      <span className="rp-mudo">
        {pagina + 1} de {totalPaginas}
      </span>
      <button type="button" className="rp-botao" disabled={pagina >= totalPaginas - 1} onClick={() => onMudar(pagina + 1)}>
        Próxima
      </button>
    </div>
  );
}

export function Aviso({
  tom,
  children,
  onFechar,
}: {
  tom: "ok" | "erro" | "aviso";
  children: React.ReactNode;
  onFechar?: () => void;
}) {
  return (
    <div className={`rp-faixa rp-faixa-${tom}`} role={tom === "erro" ? "alert" : "status"}>
      <span>{children}</span>
      {onFechar && (
        <button type="button" className="rp-faixa-fechar" onClick={onFechar} aria-label="Fechar aviso">
          ×
        </button>
      )}
    </div>
  );
}

export function Interruptor({
  ligado,
  rotulo,
  desabilitado,
  onMudar,
}: {
  ligado: boolean;
  rotulo: string;
  desabilitado?: boolean;
  onMudar: (ligado: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      className={`rp-toggle ${ligado ? "rp-toggle-ligado" : ""}`}
      disabled={desabilitado}
      onClick={() => onMudar(!ligado)}
    >
      <span />
    </button>
  );
}
