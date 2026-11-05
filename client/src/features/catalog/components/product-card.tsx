import { Link } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import type { Product } from '../types/product'

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
    <article className={`product-card product-card--${variant}`}>
      <div className="product-card__visual">
        {product.discount && (
          <span className="product-card__discount">{product.discount}</span>
        )}
        <Link
          to="/products/$productId"
          params={{ productId: product.id }}
          aria-hidden="true"
          className="product-card__media"
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
        <button
          aria-label={`Thêm ${product.name} vào giỏ hàng`}
          className="product-card__quick-add"
          onClick={() => onAdd(product)}
          disabled={busy || product.availableQuantity === 0}
          type="button"
        >
          +
        </button>
      </div>
      <div className="product-card__details">
        <h3>
          <Link to="/products/$productId" params={{ productId: product.id }}>
            {product.name}
          </Link>
        </h3>
        <p className="product-card__specs">{product.specs}</p>
        {product.rating && (
          <div className="product-card__rating">
            <Star aria-hidden="true" fill="currentColor" size={15} />
            <span>{product.rating}</span>
            <span className="product-card__rating-count">
              ({product.ratingCount})
            </span>
          </div>
        )}
        <div className="product-card__prices">
          <strong>{product.price}</strong>
          {product.oldPrice && <del>{product.oldPrice}</del>}
        </div>
        <button
          className="product-card__add-button"
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
