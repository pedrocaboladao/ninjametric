import { useCallback, useEffect, useRef, useState } from "react";

// Toda tela que busca dado a partir de filtros (loja, período) tem o mesmo
// risco: se o usuário troca o filtro rápido (ex.: muda a data duas vezes
// seguidas), duas buscas ficam em andamento ao mesmo tempo — se a mais
// antiga (mais lenta) responder DEPOIS da mais nova, ela sobrescreve o
// resultado certo com dado de um filtro que já não é mais o selecionado.
// Parece "dado cruzado"/bugado, mas é uma condição de corrida clássica.
//
// Esse hook resolve isso de um jeito centralizado: cada chamada de
// `buscar` ganha um número sequencial, e só a resposta da chamada mais
// recente é aplicada — qualquer resposta que chegue depois de uma busca
// mais nova já ter começado é descartada.
export function useBuscaComCancelamento<T>(buscar: (forcar: boolean) => Promise<T>, ativo: boolean) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const idAtual = useRef(0);

  const executar = useCallback(
    (forcar: boolean) => {
      if (!ativo) return;
      const meuId = ++idAtual.current;
      if (forcar) setAtualizando(true);
      else setCarregando(true);
      setErro(null);
      buscar(forcar)
        .then((resultado) => {
          if (idAtual.current !== meuId) return; // resposta de uma busca antiga — descarta
          setDados(resultado);
        })
        .catch((err) => {
          if (idAtual.current !== meuId) return;
          setErro(err instanceof Error ? err.message : "Falha ao carregar dados.");
        })
        .finally(() => {
          if (idAtual.current !== meuId) return;
          setCarregando(false);
          setAtualizando(false);
        });
    },
    [buscar, ativo]
  );

  useEffect(() => {
    executar(false);
  }, [executar]);

  return { dados, erro, carregando, atualizando, atualizarAgora: () => executar(true) };
}
