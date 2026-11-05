import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { read } from '@/features/commerce/api'
import type { CatalogProduct, Page } from '@/features/commerce/types'

const FETCH_LIMIT = 100
const ACCESSORIES_STALE_TIME_MS = 60_000

// Accessories have no sub-category in the catalog, so names decide the group.
// The first match wins: "Pin sạc" must be tested before plain chargers.
const accessoryGroups = [
  { id: 'mouse', label: 'Chuột', pattern: /chuột/i },
  { id: 'keyboard', label: 'Bàn phím', pattern: /bàn phím/i },
  { id: 'power-bank', label: 'Pin sạc dự phòng', pattern: /dự phòng/i },
  { id: 'charger', label: 'Củ sạc', pattern: /^sạc|củ sạc|bộ sạc/i },
  { id: 'cable', label: 'Cáp & Hub', pattern: /^cáp|^hub\b/i },
  { id: 'storage', label: 'Ổ cứng', pattern: /ổ cứng|\bssd\b/i },
  { id: 'ram', label: 'RAM', pattern: /^ram\b/i },
  { id: 'case', label: 'Ốp lưng', pattern: /ốp lưng/i },
  { id: 'headphones', label: 'Tai nghe', pattern: /tai nghe|airpods/i },
  { id: 'camera', label: 'Camera', pattern: /camera|dji pocket/i },
  { id: 'other', label: 'Phụ kiện khác', pattern: /(?:)/ },
] as const

type AccessoryGroupId = (typeof accessoryGroups)[number]['id']

export type AccessoryGroup = {
  id: AccessoryGroupId
  label: string
  products: CatalogProduct[]
}

const accessorySearchSchema = z.object({
  type: z
    .enum(accessoryGroups.map((group) => group.id) as [AccessoryGroupId])
    .optional()
    .catch(undefined),
})

export function parseAccessorySearch(input: Record<string, unknown>) {
  const { type } = accessorySearchSchema.parse(input)
  return type ? { type } : {}
}

/** Groups that have at least one product, in display order. */
export function groupAccessories(products: CatalogProduct[]): AccessoryGroup[] {
  return accessoryGroups
    .map(({ id, label }) => ({
      id,
      label,
      products: products.filter(
        (product) =>
          accessoryGroups.find(({ pattern }) => pattern.test(product.name))
            ?.id === id,
      ),
    }))
    .filter((group) => group.products.length > 0)
}

export function useAccessories() {
  return useQuery({
    queryKey: ['catalog', 'accessories'],
    queryFn: async ({ signal }) => {
      const items: CatalogProduct[] = []
      let pageLength = FETCH_LIMIT
      while (pageLength === FETCH_LIMIT) {
        const page = await read<Page<CatalogProduct>>('products', {
          signal,
          searchParams: {
            category: 'accessories',
            limit: FETCH_LIMIT,
            offset: items.length,
          },
        })
        items.push(...page.items)
        pageLength = page.items.length
      }
      return items
    },
    staleTime: ACCESSORIES_STALE_TIME_MS,
  })
}
