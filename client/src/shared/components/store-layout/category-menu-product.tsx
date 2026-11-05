import { Link } from '@tanstack/react-router'
import { Package } from 'lucide-react'
import { useState } from 'react'
import { productImageUrl } from '@/features/catalog/product-view'
import { formatMoney } from '@/features/commerce/components'
import type { CatalogProduct } from '@/features/commerce/types'

export function CategoryMenuProduct({
  product,
  discount,
  onNavigate,
}: {
  product: CatalogProduct
  discount?: number | null
  onNavigate?: () => void
}) {
  const imageId = product.primaryImageId
  const [failedImage, setFailedImage] = useState<string | null>(null)

  return (
    <Link
      className="category-menu__product"
      onClick={onNavigate}
      params={{ productId: product.id }}
      to="/products/$productId"
    >
      <span className="category-menu__product-media" aria-hidden="true">
        {imageId && imageId !== failedImage ? (
          <img
            alt=""
            src={productImageUrl(imageId)}
            decoding="sync"
            onError={() => setFailedImage(imageId)}
          />
        ) : (
          <Package size={24} />
        )}
      </span>
      <span className="category-menu__product-text">
        <span>{product.name}</span>
        <strong>{formatMoney(product.priceVnd)}</strong>
        {discount && (
          <span className="category-menu__promotion-discount">
            Giảm {discount}%
          </span>
        )}
      </span>
    </Link>
  )
}
