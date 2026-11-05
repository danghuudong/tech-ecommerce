import { Link } from '@tanstack/react-router'
import { ChevronRight, Star } from 'lucide-react'
import type { CatalogProduct } from '@/features/commerce/types'
import { brandLabel } from '../catalog-search'
import { toHomeProduct } from '../to-home-product'
import './store-product-card.css'

export function StoreProductCard({ item }: { item: CatalogProduct }) {
  const product = toHomeProduct(item)
  const link = {
    to: '/products/$productId',
    params: { productId: product.id },
  } as const
  const inStock = item.availableQuantity > 0
  return (
    <article className="store-product-card">
      {product.discount && (
        <span className="store-product-card__discount">
          Giảm {product.discount.slice(1)}
        </span>
      )}
      {item.brand && item.brand !== 'hang-khac' && (
        <span className="store-product-card__brand">
          {brandLabel(item.brand)}
        </span>
      )}
      <Link
        {...link}
        className="store-product-card__media"
        tabIndex={-1}
        aria-hidden="true"
      >
        {product.imageUrl ? (
          <img
            alt=""
            src={product.imageUrl}
            loading="lazy"
            decoding="async"
            width={240}
            height={240}
          />
        ) : (
          <span className={`product-art product-art--${product.art}`} />
        )}
      </Link>
      <h3>
        <Link {...link}>{product.name}</Link>
      </h3>
      <div className="store-product-card__prices">
        <strong>{product.price}</strong>
        {product.oldPrice && <del>{product.oldPrice}</del>}
      </div>
      {item.listPriceVnd && item.listPriceVnd > item.priceVnd && (
        <p className="store-product-card__saving">
          Tiết kiệm{' '}
          {(item.listPriceVnd - item.priceVnd).toLocaleString('vi-VN')}đ
        </p>
      )}
      <p className="store-product-card__description">{product.specs}</p>
      <div className="store-product-card__footer">
        <div className="store-product-card__status">
          {product.rating && (
            <span className="store-product-card__rating">
              <Star size={13} fill="currentColor" aria-hidden="true" />
              {product.rating}
              <small>({product.ratingCount})</small>
            </span>
          )}
          <span
            className={`store-product-card__stock${inStock ? ' is-available' : ''}`}
          >
            {inStock ? 'Còn hàng' : 'Tạm hết hàng'}
          </span>
        </div>
        <Link {...link} className="store-product-card__detail">
          Chi tiết <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
