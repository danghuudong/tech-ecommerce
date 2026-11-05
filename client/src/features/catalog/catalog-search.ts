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
  tablet: 'Máy tính bảng',
  watch: 'Đồng hồ',
  television: 'Tivi',
  appliance: 'Điện máy, gia dụng',
} as const

export const productCategoryIds = [
  'laptop',
  'phone',
  'desktop',
  'monitor',
  'audio',
  'accessories',
  'gaming',
  'office',
  'tablet',
  'watch',
  'television',
  'appliance',
] as const

export const catalogBrandLabels = {
  apple: 'Apple',
  asus: 'ASUS',
  dell: 'Dell',
  lenovo: 'Lenovo',
  hp: 'HP',
  lg: 'LG',
  logitech: 'Logitech',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
  oppo: 'OPPO',
  acer: 'Acer',
  msi: 'MSI',
  huawei: 'HUAWEI',
  honor: 'HONOR',
  sony: 'Sony',
  jbl: 'JBL',
  anker: 'Anker',
  ugreen: 'UGREEN',
  tcl: 'TCL',
  aqua: 'AQUA',
  toshiba: 'Toshiba',
  panasonic: 'Panasonic',
  sharp: 'Sharp',
  dreame: 'Dreame',
  roborock: 'Roborock',
  pny: 'PNY',
  kingston: 'Kingston',
  sandisk: 'SanDisk',
  transcend: 'Transcend',
  baseus: 'Baseus',
  cuktech: 'CUKTECH',
  belkin: 'Belkin',
  dji: 'DJI',
  spigen: 'Spigen',
} as const

export function brandLabel(code: string) {
  return (
    Object.entries(catalogBrandLabels).find(([brand]) => brand === code)?.[1] ??
    code
  )
}

const price = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(9_999_999_999))
  .optional()
  .catch(undefined)

const catalogSearchSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  category: z
    .enum([...productCategoryIds, 'computing'])
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
  discounted: z
    .union([z.literal(true), z.literal('true')])
    .optional()
    .catch(undefined),
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
    ...(search.discounted ? { discounted: true } : {}),
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
  return [
    search.category && catalogCategoryLabels[search.category],
    search.brand && brandLabel(search.brand),
    search.discounted && 'Đang giảm giá',
    search.minPrice !== undefined && `Từ ${money(search.minPrice)}`,
    search.maxPrice !== undefined && `Đến ${money(search.maxPrice)}`,
    search.q && `“${search.q}”`,
  ]
    .filter(Boolean)
    .join(' · ')
}
