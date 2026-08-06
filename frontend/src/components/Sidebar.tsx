import { useState } from "react";
import {
  IconChart,
  IconQuestion,
  IconCopy,
  IconStore,
  IconTasks,
  IconBox,
  IconWand,
  IconUsers,
  IconGear,
  IconChevron,
  IconLogout,
  IconMoney,
  IconMegaphone,
  IconWallet,
  IconReport,
  IconWrench,
  IconFlask,
  IconBarcode,
  IconTag,
} from "./icons";
import type { Usuario } from "../types/usuarios";
import { temPermissao } from "../constants/modulos";

export type View =
  | "dashboard"
  | "perguntas"
  | "clonar"
  | "produtos"
  | "financeiro"
  | "contas"
  | "dre"
  | "ads"
  | "tarefas"
  | "funcionarios"
  | "usuarios"
  | "correcoes"
  | "fabricacao"
  | "ean"
  | "promocoes";

interface Props {
  view: View;
  onChangeView: (view: View) => void;
  perguntasPendentes: number;
  usuario: Usuario;
  onSair: () => void;
}

const INERTES = [{ label: "Criação", Icon: IconWand }];

export function Sidebar({ view, onChangeView, perguntasPendentes, usuario, onSair }: Props) {
  const [lojasAberta, setLojasAberta] = useState(true);
  const [equipeAberta, setEquipeAberta] = useState(true);

  const podeDashboard = temPermissao(usuario, "dashboard");
  const podePerguntas = temPermissao(usuario, "perguntas");
  const podeClonar = temPermissao(usuario, "clonar");
  const podeProdutos = temPermissao(usuario, "produtos");
  const podeFinanceiro = temPermissao(usuario, "financeiro");
  const podeContas = temPermissao(usuario, "contas");
  const podeDre = temPermissao(usuario, "dre");
  const podeAds = temPermissao(usuario, "ads");
  const podeTarefas = temPermissao(usuario, "tarefas");
  const podeFuncionarios = temPermissao(usuario, "funcionarios");
  const podeCorrecoes = temPermissao(usuario, "correcoes");
  const podeFabricacao = temPermissao(usuario, "fabricacao");
  const podeEan = temPermissao(usuario, "ean");
  const podePromocoes = temPermissao(usuario, "promocoes");
  const mostrarLojas = podeDashboard || podePerguntas || podeClonar || podeProdutos || podeCorrecoes || podeEan;

  const iniciais =
    usuario.nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/logo-horizontal.png" alt="Impetrus Vision" className="sidebar-logo" />
        <div className="sidebar-brand-sub">4 lojas · Mercado Livre</div>
      </div>

      <nav className="sidebar-nav">
        {podeTarefas && (
          <>
            <button
              className={`sidebar-item ${view === "tarefas" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("tarefas")}
            >
              <IconTasks size={16} />
              <span>Tarefas</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podeFinanceiro && (
          <>
            <button
              className={`sidebar-item ${view === "financeiro" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("financeiro")}
            >
              <IconMoney size={16} />
              <span>Financeiro</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podeContas && (
          <>
            <button
              className={`sidebar-item ${view === "contas" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("contas")}
            >
              <IconWallet size={16} />
              <span>Contas a pagar e receber</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podeDre && (
          <>
            <button
              className={`sidebar-item ${view === "dre" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("dre")}
            >
              <IconReport size={16} />
              <span>DRE</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podeAds && (
          <>
            <button
              className={`sidebar-item ${view === "ads" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("ads")}
            >
              <IconMegaphone size={16} />
              <span>Gestão de Ads</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podeFabricacao && (
          <>
            <button
              className={`sidebar-item ${view === "fabricacao" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("fabricacao")}
            >
              <IconFlask size={16} />
              <span>Fabricação</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podePromocoes && (
          <>
            <button
              className={`sidebar-item ${view === "promocoes" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("promocoes")}
            >
              <IconTag size={16} />
              <span>Promoções</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {mostrarLojas && (
          <>
            <button className="sidebar-group-toggle" onClick={() => setLojasAberta((v) => !v)}>
              <IconStore />
              <span>Lojas</span>
              <IconChevron open={lojasAberta} />
            </button>

            {lojasAberta && (
              <div className="sidebar-subitems">
                {podeDashboard && (
                  <button
                    className={`sidebar-item ${view === "dashboard" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("dashboard")}
                  >
                    <IconChart size={16} />
                    <span>Painel ao vivo</span>
                  </button>
                )}
                {podePerguntas && (
                  <button
                    className={`sidebar-item ${view === "perguntas" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("perguntas")}
                  >
                    <IconQuestion size={16} />
                    <span>Perguntas</span>
                    {perguntasPendentes > 0 && <span className="sidebar-badge">{perguntasPendentes}</span>}
                  </button>
                )}
                {podeClonar && (
                  <button
                    className={`sidebar-item ${view === "clonar" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("clonar")}
                  >
                    <IconCopy size={16} />
                    <span>Clonar Anúncio</span>
                  </button>
                )}
                {podeProdutos && (
                  <button
                    className={`sidebar-item ${view === "produtos" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("produtos")}
                  >
                    <IconBox size={16} />
                    <span>Produtos</span>
                  </button>
                )}
                {podeCorrecoes && (
                  <button
                    className={`sidebar-item ${view === "correcoes" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("correcoes")}
                  >
                    <IconWrench size={16} />
                    <span>Correções</span>
                  </button>
                )}
                {podeEan && (
                  <button
                    className={`sidebar-item ${view === "ean" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => onChangeView("ean")}
                  >
                    <IconBarcode size={16} />
                    <span>Gerador de EAN</span>
                  </button>
                )}
              </div>
            )}

            <div className="sidebar-divider" />
          </>
        )}

        {podeFuncionarios && (
          <>
            <button className="sidebar-group-toggle" onClick={() => setEquipeAberta((v) => !v)}>
              <IconUsers />
              <span>Equipe</span>
              <IconChevron open={equipeAberta} />
            </button>

            {equipeAberta && (
              <div className="sidebar-subitems">
                <button
                  className={`sidebar-item ${view === "funcionarios" ? "sidebar-item-ativo" : ""}`}
                  onClick={() => onChangeView("funcionarios")}
                >
                  <IconUsers size={16} />
                  <span>Funcionários</span>
                </button>
              </div>
            )}

            <div className="sidebar-divider" />
          </>
        )}

        {usuario.admin && (
          <>
            <button
              className={`sidebar-item ${view === "usuarios" ? "sidebar-item-ativo" : ""}`}
              onClick={() => onChangeView("usuarios")}
            >
              <IconGear size={16} />
              <span>Usuários</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {INERTES.map(({ label, Icon }) => (
          <div key={label} className="sidebar-group-toggle sidebar-group-inerte">
            <Icon />
            <span>{label}</span>
            <em className="sidebar-em-breve">em breve</em>
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{iniciais}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-nome">{usuario.nome}</div>
          <div className="sidebar-user-email">@{usuario.username}</div>
        </div>
        <span className="sidebar-user-badge">{usuario.admin ? "DIRETOR" : "EQUIPE"}</span>
        <button className="sidebar-sair" onClick={onSair} title="Sair">
          <IconLogout size={15} />
        </button>
      </div>
    </aside>
  );
}
