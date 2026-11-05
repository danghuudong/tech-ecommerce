import { useState } from 'react'
import type { CatalogProductDetail } from '@/features/commerce/types'
import { productArt, productImageUrl } from './product-view'

export function ProductGallery({ product }: { product: CatalogProductDetail }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    product.images.find((image) => image.id === selectedId) ?? product.images[0]
  if (!selected)
    return (
      <div
        aria-label={`${product.name}, ảnh minh họa`}
        className={`product-art product-art--${productArt(product)}`}
        role="img"
      />
    )
  return (
    <>
      <img
        alt={selected.altText}
        className="product-photo pd-gallery__photo"
        fetchPriority="high"
        src={productImageUrl(selected.id)}
      />
      {product.images.length > 1 && (
        <div className="pd-gallery__thumbs">
          {product.images.map((image, index) => (
            <button
              aria-label={`Xem ảnh ${index + 1}`}
              aria-pressed={image.id === selected.id}
              key={image.id}
              onClick={() => setSelectedId(image.id)}
              type="button"
            >
              <img
                alt=""
                className="product-photo"
                loading="lazy"
                src={productImageUrl(image.id)}
              />
            </button>
          ))}
        </div>
      )}
    </>
  )
}
