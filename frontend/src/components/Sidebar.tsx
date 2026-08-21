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
  IconChimney,
  IconArchiveBox,
  IconBarcode,
  IconTag,
  IconRobot,
  IconSearch,
  IconMenu,
  IconX,
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
  | "fabrica_produtos"
  | "fabrica_clientes"
  | "fabrica_embalagens"
  | "fabrica_estoque"
  | "fabrica_pedidos"
  | "fabrica_financeiro"
  | "fabrica_ordem"
  | "ean"
  | "promocoes"
  | "pesquisa"
  | "agentes"
  | "market_intelligence";

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
  const [fabricaAberta, setFabricaAberta] = useState(true);
  const [financeiroLojasAberto, setFinanceiroLojasAberto] = useState(true);
  const [menuMobileAberto, setMenuMobileAberto] = useState(false);

  function trocarView(v: View) {
    onChangeView(v);
    setMenuMobileAberto(false);
  }

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
  const podeFabricaProdutos = temPermissao(usuario, "fabrica_produtos");
  const podeFabricaClientes = temPermissao(usuario, "fabrica_clientes");
  const podeFabricaEmbalagens = temPermissao(usuario, "fabrica_embalagens");
  const podeFabricaEstoque = temPermissao(usuario, "fabrica_estoque");
  const podeFabricaPedidos = temPermissao(usuario, "fabrica_pedidos");
  const podeFabricaFinanceiro = temPermissao(usuario, "fabrica_financeiro");
  // Financeiro, Contas e DRE das lojas viram um grupo so. Soltos no menu, ao
  // lado do financeiro da Fabrica Distribuidora, davam margem pra lancar
  // despesa da fabrica na conta das lojas — sao duas empresas diferentes.
  const mostrarFinanceiroLojas = podeFinanceiro || podeContas || podeDre;
  const podeEan = temPermissao(usuario, "ean");
  const podePromocoes = temPermissao(usuario, "promocoes");
  const podePesquisa = temPermissao(usuario, "pesquisa");
  const mostrarLojas = podeDashboard || podePerguntas || podeClonar || podeProdutos || podeCorrecoes || podeEan;
  // Fabrica Distribuidora: operacao propria, separada das 20 lojas.
  // Esta lista cresce a cada modulo novo da fabrica (produtos, pedidos, financeiro...).
  const mostrarFabrica = podeFabricacao || podeFabricaProdutos || podeFabricaClientes || podeFabricaEmbalagens || podeFabricaEstoque;

  const iniciais =
    usuario.nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <>
      <button
        type="button"
        className="sidebar-mobile-toggle"
        onClick={() => setMenuMobileAberto((v) => !v)}
        aria-label={menuMobileAberto ? "Fechar menu" : "Abrir menu"}
      >
        {menuMobileAberto ? <IconX size={20} /> : <IconMenu size={20} />}
      </button>

      {menuMobileAberto && <div className="sidebar-mobile-backdrop" onClick={() => setMenuMobileAberto(false)} />}

      <aside className={`sidebar ${menuMobileAberto ? "sidebar-mobile-aberta" : ""}`}>
      <div className="sidebar-brand">
        <img src="/logo-horizontal.png" alt="Impetrus Vision" className="sidebar-logo" />
        <div className="sidebar-brand-sub">4 lojas · Mercado Livre</div>
      </div>

      <nav className="sidebar-nav">
        {podeTarefas && (
          <>
            <button
              className={`sidebar-item ${view === "tarefas" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("tarefas")}
            >
              <IconTasks size={16} />
              <span>Tarefas</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {mostrarFinanceiroLojas && (
          <>
            <button
              className="sidebar-group-toggle"
              onClick={() => setFinanceiroLojasAberto((v) => !v)}
            >
              <IconMoney />
              <span>Financeiro Lojas</span>
              <IconChevron open={financeiroLojasAberto} />
            </button>

            {financeiroLojasAberto && (
              <div className="sidebar-subitems">
                {podeFinanceiro && (
                  <button
                    className={`sidebar-item ${view === "financeiro" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("financeiro")}
                  >
                    <IconMoney size={16} />
                    <span>Feed de vendas</span>
                  </button>
                )}
                {podeContas && (
                  <button
                    className={`sidebar-item ${view === "contas" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("contas")}
                  >
                    <IconWallet size={16} />
                    <span>Contas a pagar e receber</span>
                  </button>
                )}
                {podeDre && (
                  <button
                    className={`sidebar-item ${view === "dre" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("dre")}
                  >
                    <IconReport size={16} />
                    <span>DRE</span>
                  </button>
                )}
              </div>
            )}

            <div className="sidebar-divider" />
          </>
        )}

        {podeAds && (
          <>
            <button
              className={`sidebar-item ${view === "ads" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("ads")}
            >
              <IconMegaphone size={16} />
              <span>Gestão de Ads</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {mostrarFabrica && (
          <>
            <button className="sidebar-group-toggle" onClick={() => setFabricaAberta((v) => !v)}>
              <IconChimney />
              <span>Fábrica Distribuidora</span>
              <IconChevron open={fabricaAberta} />
            </button>

            {fabricaAberta && (
              <div className="sidebar-subitems">
                {podeFabricacao && (
                  <button
                    className={`sidebar-item ${view === "fabrica_ordem" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_ordem")}
                  >
                    <IconReport size={16} />
                    <span>Ordem de fabricação</span>
                  </button>
                )}
                {podeFabricacao && (
                  <button
                    className={`sidebar-item ${view === "fabricacao" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabricacao")}
                  >
                    <IconFlask size={16} />
                    <span>Custo de Fabricação</span>
                  </button>
                )}
                {podeFabricaProdutos && (
                  <button
                    className={`sidebar-item ${view === "fabrica_produtos" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_produtos")}
                  >
                    <IconBox size={16} />
                    <span>Produtos</span>
                  </button>
                )}
                {podeFabricaClientes && (
                  <button
                    className={`sidebar-item ${view === "fabrica_clientes" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_clientes")}
                  >
                    <IconStore size={16} />
                    <span>Clientes</span>
                  </button>
                )}
                {podeFabricaEmbalagens && (
                  <button
                    className={`sidebar-item ${view === "fabrica_embalagens" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_embalagens")}
                  >
                    <IconArchiveBox size={16} />
                    <span>Embalagens</span>
                  </button>
                )}
                {podeFabricaEstoque && (
                  <button
                    className={`sidebar-item ${view === "fabrica_estoque" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_estoque")}
                  >
                    <IconReport size={16} />
                    <span>Estoque</span>
                  </button>
                )}
                {podeFabricaPedidos && (
                  <button
                    className={`sidebar-item ${view === "fabrica_pedidos" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_pedidos")}
                  >
                    <IconBarcode size={16} />
                    <span>Pedidos de venda</span>
                  </button>
                )}
                {podeFabricaFinanceiro && (
                  <button
                    className={`sidebar-item ${view === "fabrica_financeiro" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("fabrica_financeiro")}
                  >
                    <IconWallet size={16} />
                    <span>Financeiro e DRE</span>
                  </button>
                )}
              </div>
            )}

            <div className="sidebar-divider" />
          </>
        )}

        {podePromocoes && (
          <>
            <button
              className={`sidebar-item ${view === "promocoes" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("promocoes")}
            >
              <IconTag size={16} />
              <span>Promoções</span>
            </button>
            <div className="sidebar-divider" />
          </>
        )}

        {podePesquisa && (
          <>
            <button
              className={`sidebar-item ${view === "pesquisa" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("pesquisa")}
            >
              <IconSearch size={16} />
              <span>Pesquisa de Mercado</span>
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
                    onClick={() => trocarView("dashboard")}
                  >
                    <IconChart size={16} />
                    <span>Painel ao vivo</span>
                  </button>
                )}
                {podePerguntas && (
                  <button
                    className={`sidebar-item ${view === "perguntas" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("perguntas")}
                  >
                    <IconQuestion size={16} />
                    <span>Perguntas</span>
                    {perguntasPendentes > 0 && <span className="sidebar-badge">{perguntasPendentes}</span>}
                  </button>
                )}
                {podeClonar && (
                  <button
                    className={`sidebar-item ${view === "clonar" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("clonar")}
                  >
                    <IconCopy size={16} />
                    <span>Clonar Anúncio</span>
                  </button>
                )}
                {podeProdutos && (
                  <button
                    className={`sidebar-item ${view === "produtos" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("produtos")}
                  >
                    <IconBox size={16} />
                    <span>Produtos</span>
                  </button>
                )}
                {podeCorrecoes && (
                  <button
                    className={`sidebar-item ${view === "correcoes" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("correcoes")}
                  >
                    <IconWrench size={16} />
                    <span>Correções</span>
                  </button>
                )}
                {podeEan && (
                  <button
                    className={`sidebar-item ${view === "ean" ? "sidebar-item-ativo" : ""}`}
                    onClick={() => trocarView("ean")}
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
                  onClick={() => trocarView("funcionarios")}
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
              className={`sidebar-item ${view === "agentes" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("agentes")}
            >
              <IconRobot size={16} />
              <span>Agentes IA</span>
            </button>
            <button
              className={`sidebar-item ${view === "market_intelligence" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("market_intelligence")}
            >
              <IconChart size={16} />
              <span>Inteligência de Mercado</span>
            </button>
            <button
              className={`sidebar-item ${view === "usuarios" ? "sidebar-item-ativo" : ""}`}
              onClick={() => trocarView("usuarios")}
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
    </>
  );
}
