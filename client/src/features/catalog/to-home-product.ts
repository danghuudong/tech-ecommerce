import {
  discountPercent,
  productArt,
  productImageUrl,
} from '@/features/catalog/product-view'
import type { Product } from '@/features/catalog/types/product'
import { formatMoney } from '@/features/commerce/components'
import type { CatalogProduct } from '@/features/commerce/types'

export function toHomeProduct(product: CatalogProduct): Product {
  const discount = discountPercent(product)
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    art: productArt(product),
    imageUrl: product.primaryImageId
      ? productImageUrl(product.primaryImageId)
      : undefined,
    rating: product.rating?.average.toFixed(1),
    ratingCount: product.rating?.count,
    specs: product.description || product.sku,
    price: formatMoney(product.priceVnd),
    oldPrice: discount ? formatMoney(product.listPriceVnd) : undefined,
    discount: discount ? `−${discount}%` : undefined,
    availableQuantity: product.availableQuantity,
  }
}
