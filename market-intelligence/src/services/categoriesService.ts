// API pública de categorias do Mercado Livre — sem token, sem login, sem
// nenhuma relação com as contas conectadas do ml-core (confirmado ao vivo:
// GET https://api.mercadolibre.com/categories/MLB277663 devolveu
// {"name":"Proteção de Superfícies", ...} sem autenticação nenhuma). Cache
// em memória por categoryId porque nome de categoria não muda.
const cache = new Map<string, string | null>();

export async function resolverNomeCategoria(categoryId: string): Promise<string | null> {
  if (cache.has(categoryId)) return cache.get(categoryId)!;

  try {
    const res = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      cache.set(categoryId, null);
      return null;
    }
    const json = (await res.json()) as { name?: unknown };
    const nome = typeof json.name === "string" ? json.name : null;
    cache.set(categoryId, nome);
    return nome;
  } catch (err) {
    console.error(`Falha ao resolver nome da categoria ${categoryId}:`, err);
    cache.set(categoryId, null);
    return null;
  }
}

export async function resolverNomesCategorias(categoryIds: string[]): Promise<Map<string, string | null>> {
  const unicos = [...new Set(categoryIds)];
  const nomes = await Promise.all(unicos.map((id) => resolverNomeCategoria(id)));
  return new Map(unicos.map((id, i) => [id, nomes[i]]));
}
