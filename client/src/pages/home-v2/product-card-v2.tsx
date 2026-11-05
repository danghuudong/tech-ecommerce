import { Link } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import type { Product } from '@/features/catalog/types/product'

type ProductCardProps = {
  product: Product
  variant: 'deal' | 'suggestion'
  onAdd: (product: Product) => void
  busy?: boolean
}

export function ProductCard({
  product,
  variant,
  onAdd,
  busy,
}: ProductCardProps) {
  return (
    <article className={`hv2-product-card hv2-product-card--${variant}`}>
      <div className="hv2-product-card__visual">
        {product.discount && (
          <span className="hv2-product-card__discount">{product.discount}</span>
        )}
        <Link
          to="/products/$productId"
          params={{ productId: product.id }}
          aria-hidden="true"
          className="hv2-product-card__media"
          tabIndex={-1}
        >
          {product.imageUrl ? (
            <img
              alt=""
              className="product-photo"
              loading="lazy"
              src={product.imageUrl}
            />
          ) : (
            <span className={`product-art product-art--${product.art}`} />
          )}
        </Link>
      </div>
      <div className="hv2-product-card__details">
        <h3>
          <Link to="/products/$productId" params={{ productId: product.id }}>
            {product.name}
          </Link>
        </h3>
        <p className="hv2-product-card__specs">{product.specs}</p>
        {product.rating && (
          <div className="hv2-product-card__rating">
            <Star aria-hidden="true" fill="currentColor" size={15} />
            <span>{product.rating}</span>
            <span className="hv2-product-card__rating-count">
              ({product.ratingCount})
            </span>
          </div>
        )}
        <div className="hv2-product-card__prices">
          <strong>{product.price}</strong>
          {product.oldPrice && <del>{product.oldPrice}</del>}
        </div>
        <button
          className="hv2-product-card__add-button"
          onClick={() => onAdd(product)}
          disabled={busy || product.availableQuantity === 0}
          type="button"
        >
          {product.availableQuantity === 0 ? 'Tạm hết hàng' : 'Thêm vào giỏ'}
        </button>
      </div>
    </article>
  )
}
