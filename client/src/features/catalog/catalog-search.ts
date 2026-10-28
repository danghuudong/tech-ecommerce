import { z } from 'zod'

export const catalogCategoryLabels = {
  laptop: 'Laptop',
  phone: 'Điện thoại',
  desktop: 'Máy tính bàn',
  monitor: 'Màn hình',
  audio: 'Tai nghe',
  computing: 'PC & Màn hình',
  accessories: 'Phụ kiện',
  gaming: 'Gaming gear',
  office: 'Thiết bị văn phòng',
} as const

export const catalogBrandLabels = {
  apple: 'Apple',
  asus: 'ASUS',
  dell: 'Dell',
  lenovo: 'Lenovo',
  hp: 'HP',
} as const

const price = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(9_999_999_999))
  .optional()
  .catch(undefined)

const catalogSearchSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  category: z
    .enum([
      'laptop',
      'phone',
      'desktop',
      'monitor',
      'audio',
      'computing',
      'accessories',
      'gaming',
      'office',
    ])
    .optional()
    .catch(undefined),
  brand: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional()
    .catch(undefined),
  minPrice: price,
  maxPrice: price,
})

export type CatalogSearch = z.infer<typeof catalogSearchSchema>

export function parseCatalogSearch(
  input: Record<string, unknown>,
): CatalogSearch {
  const search = catalogSearchSchema.parse(input)
  const validRange =
    search.minPrice === undefined ||
    search.maxPrice === undefined ||
    search.minPrice <= search.maxPrice

  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.category ? { category: search.category } : {}),
    ...(search.brand ? { brand: search.brand } : {}),
    ...(validRange && search.minPrice !== undefined
      ? { minPrice: search.minPrice }
      : {}),
    ...(validRange && search.maxPrice !== undefined
      ? { maxPrice: search.maxPrice }
      : {}),
  }
}

export function describeCatalogSearch(search: CatalogSearch) {
  const money = (value: number) =>
    `${new Intl.NumberFormat('vi-VN').format(value)}đ`
  const brandLabel =
    Object.entries(catalogBrandLabels).find(
      ([code]) => code === search.brand,
    )?.[1] ?? search.brand
  return [
    search.category && catalogCategoryLabels[search.category],
    brandLabel,
    search.minPrice !== undefined && `Từ ${money(search.minPrice)}`,
    search.maxPrice !== undefined && `Đến ${money(search.maxPrice)}`,
    search.q && `“${search.q}”`,
  ]
    .filter(Boolean)
    .join(' · ')
}
