import type {
  CatalogProduct,
  StoreAvailabilityStatus,
} from '@/features/commerce/types'
import { apiUrl } from '@/shared/api/client'
import type { ProductArtId } from './types/product'

export const productImageUrl = (imageId: string) =>
  apiUrl(`product-images/${imageId}`)

export const storeAvailabilityOptions: Record<
  StoreAvailabilityStatus,
  { label: string; tone: 'green' | 'amber' | 'red' }
> = {
  in_stock: { label: 'Còn hàng', tone: 'green' },
  low_stock: { label: 'Sắp hết', tone: 'amber' },
  out_of_stock: { label: 'Hết hàng', tone: 'red' },
}

export function productArt({
  name,
  sku,
  category,
}: Pick<CatalogProduct, 'name' | 'sku' | 'category'>): ProductArtId {
  if (category === 'laptop' || category === 'phone' || category === 'monitor')
    return category
  if (category === 'audio') return 'headphones'
  if (category === 'tablet' || category === 'watch') return 'phone'
  if (category === 'television') return 'monitor'
  if (category === 'appliance') return 'tower'
  if (category === 'desktop') return 'tower'
  return /chuột|mouse|g304/.test(`${name} ${sku}`.toLowerCase())
    ? 'mouse'
    : 'keyboard'
}

export function discountPercent({
  priceVnd,
  listPriceVnd,
}: Pick<CatalogProduct, 'priceVnd' | 'listPriceVnd'>) {
  if (!listPriceVnd || listPriceVnd <= priceVnd) return null
  return Math.round((1 - priceVnd / listPriceVnd) * 100) || null
}
