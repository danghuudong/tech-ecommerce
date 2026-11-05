import { Link } from '@tanstack/react-router'
import { ChevronRight, ShoppingCart, Star } from 'lucide-react'
import { brandLabel } from '@/features/catalog/catalog-search'
import { toHomeProduct } from '@/features/catalog/to-home-product'
import type { Product } from '@/features/catalog/types/product'
import type { CatalogProduct } from '@/features/commerce/types'

export type CatalogActions = {
  onAddToCart: (product: Product) => void
  busy?: boolean
}

export function HomeCatalogCard({
  item,
  onAddToCart,
  busy,
}: CatalogActions & { item: CatalogProduct }) {
  const product = toHomeProduct(item)
  const link = {
    to: '/products/$productId',
    params: { productId: product.id },
  } as const
  const inStock = item.availableQuantity > 0
  return (
    <article className="hv2-catalog-card">
      {product.discount && (
        <span className="hv2-catalog-card__discount">
          Giảm {product.discount.slice(1)}
        </span>
      )}
      {item.brand && (
        <span className="hv2-catalog-card__brand">
          {brandLabel(item.brand)}
        </span>
      )}
      <Link
        {...link}
        className="hv2-catalog-card__media"
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
      <div className="hv2-catalog-card__prices">
        <strong>{product.price}</strong>
        {product.oldPrice && <del>{product.oldPrice}</del>}
      </div>
      {item.listPriceVnd && item.listPriceVnd > item.priceVnd && (
        <p className="hv2-catalog-card__saving">
          Tiết kiệm{' '}
          {(item.listPriceVnd - item.priceVnd).toLocaleString('vi-VN')}đ
        </p>
      )}
      <p className="hv2-catalog-card__description">{product.specs}</p>
      <div className="hv2-catalog-card__footer">
        {product.rating ? (
          <span className="hv2-catalog-card__rating">
            <Star size={13} fill="currentColor" aria-hidden="true" />
            {product.rating}
            <small>({product.ratingCount})</small>
          </span>
        ) : (
          <span
            className={`hv2-catalog-card__stock${inStock ? ' is-available' : ''}`}
          >
            {inStock ? 'Còn hàng' : 'Tạm hết hàng'}
          </span>
        )}
        {inStock ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`Thêm ${product.name} vào giỏ hàng`}
            onClick={() => onAddToCart(product)}
          >
            <ShoppingCart size={17} aria-hidden="true" />
          </button>
        ) : (
          <Link {...link} className="hv2-catalog-card__detail">
            Chi tiết <ChevronRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>
    </article>
  )
}
