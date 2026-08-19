// Um resultado de busca normalizado — campos ficam null quando o provider
// não trouxer aquele dado. Nunca inventar valor ausente (ver CLAUDE.md
// deste módulo).
export interface ProductResult {
  position: number;
  itemId: string;
  title: string | null;
  sellerId: string | null;
  sellerName: string | null;
  price: number | null;
  originalPrice: number | null;
  rating: number | null;
  reviewCount: number | null;
  soldQuantity: string | null;
  shippingType: string | null;
  isFull: boolean | null;
  officialStore: boolean | null;
  isCatalog: boolean | null;
  sponsored: boolean | null;
  brand: string | null;
  url: string | null;
  categoryId: string | null;
  domainId: string | null;
}

// Abstração de fornecedor de dados de mercado — permite trocar de provider
// (Gecko, Bright Data, Oxylabs...) sem alterar o resto do sistema. Fase 1
// só precisa de busca; getProduct/getSeller/getReviews ficam pra Fase 2,
// quando houver um caso de uso real pra eles.
export interface MarketProvider {
  readonly name: string;
  searchProducts(keyword: string): Promise<ProductResult[]>;
}
