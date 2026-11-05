import { useQuery } from '@tanstack/react-query'
import { read } from '@/features/commerce/api'
import type { ProductCategoryId } from './types/product'

const FACET_STALE_TIME_MS = 5 * 60_000

type CatalogFacetRow = {
  category: ProductCategoryId | null
  brand: string | null
  minPriceVnd: number
  maxPriceVnd: number
}

export type CategoryFacet = {
  brands: string[]
  minPriceVnd: number
  maxPriceVnd: number
}

function summarizeFacets({ items }: { items: CatalogFacetRow[] }) {
  const facets = new Map<ProductCategoryId, CategoryFacet>()
  for (const { category, brand, minPriceVnd, maxPriceVnd } of items) {
    if (!category) continue
    const facet = facets.get(category)
    if (!facet) {
      facets.set(category, {
        brands: brand ? [brand] : [],
        minPriceVnd,
        maxPriceVnd,
      })
      continue
    }
    if (brand) facet.brands.push(brand)
    facet.minPriceVnd = Math.min(facet.minPriceVnd, minPriceVnd)
    facet.maxPriceVnd = Math.max(facet.maxPriceVnd, maxPriceVnd)
  }
  return facets
}

export function useCatalogFacets(q?: string) {
  return useQuery({
    queryKey: ['catalog', 'facets', q],
    queryFn: ({ signal }) =>
      read<{ items: CatalogFacetRow[] }>('products/facets', {
        signal,
        searchParams: q ? { q } : undefined,
      }),
    select: summarizeFacets,
    staleTime: FACET_STALE_TIME_MS,
  })
}
