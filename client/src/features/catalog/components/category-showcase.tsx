import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Star } from 'lucide-react'
import { useState } from 'react'
import {
  type CategoryFacet,
  useCatalogFacets,
} from '@/features/catalog/catalog-facets'
import {
  brandLabel,
  catalogCategoryLabels,
} from '@/features/catalog/catalog-search'
import { read } from '@/features/commerce/api'
import {
  formatMoney,
  Loading,
  QueryError,
} from '@/features/commerce/components'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { menuCategories } from '@/shared/components/store-layout/store-header.data'
import { toHomeProduct } from '../to-home-product'
import type { Product } from '../types/product'
import { type ShowcaseBlock, showcaseBlocks } from './category-showcase.data'
import './category-showcase.css'

const PRODUCTS_PER_BLOCK = 8

type ShowcaseActions = {
  onAddToCart: (product: Product) => void
  busy?: boolean
}

export function CategoryShowcaseSection(actions: ShowcaseActions) {
  const facets = useCatalogFacets()
  if (!facets.data) return <div id="suggestions" />
  return (
    <div className="category-showcase-list" id="suggestions">
      {showcaseBlocks.map((block) => (
        <ShowcaseBlockView
          {...actions}
          block={block}
          facets={facets.data}
          key={block.id}
        />
      ))}
    </div>
  )
}

function ShowcaseBlockView({
  block,
  facets,
  onAddToCart,
  busy,
}: ShowcaseActions & {
  block: ShowcaseBlock
  facets: Map<string, CategoryFacet>
}) {
  const tabs = block.tabs.filter(({ category }) => facets.has(category))
  const [selected, setSelected] = useState(tabs[0]?.category)
  const tab = tabs.find(({ category }) => category === selected) ?? tabs[0]
  const products = useQuery({
    queryKey: ['catalog', 'showcase', tab?.category],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: {
          limit: PRODUCTS_PER_BLOCK,
          category: tab?.category ?? '',
        },
      }),
    enabled: Boolean(tab),
  })
  const facet = tab && facets.get(tab.category)
  if (!tab || !facet) return null
  const items = (products.data?.items ?? []).map(toHomeProduct)
  const priceBands = (
    menuCategories.find(({ id }) => id === tab.category)?.prices ?? []
  ).filter(
    ({ minPrice = 0, maxPrice = Number.MAX_SAFE_INTEGER }) =>
      minPrice <= facet.maxPriceVnd && maxPrice >= facet.minPriceVnd,
  )
  const brands = [...new Set(facet.brands)]
  const photo = items.find((item) => item.imageUrl)?.imageUrl
  return (
    <section aria-label={block.label} className="category-showcase">
      <aside
        className={`category-showcase-banner category-showcase-banner--${block.tone}`}
      >
        <div className="category-showcase-banner__copy">
          <h2>{tab.title}</h2>
          <p>
            Giá từ{' '}
            <strong className="category-showcase-banner__price">
              {formatMoney(facet.minPriceVnd)}
            </strong>
          </p>
          <Link
            className="category-showcase-banner__action"
            search={{ category: tab.category }}
            to="/products"
          >
            Mua ngay
          </Link>
        </div>
        <div className="category-showcase-banner__visual">
          {photo ? (
            <img alt="" className="product-photo" src={photo} />
          ) : (
            <span className={`product-art product-art--${tab.art}`} />
          )}
        </div>
      </aside>
      <div className="category-showcase__main">
        <nav
          aria-label={`Danh mục ${block.label}`}
          className="category-showcase-tabs"
        >
          {tabs.map(({ category }) => (
            <button
              aria-pressed={category === tab.category}
              className={category === tab.category ? 'is-active' : ''}
              key={category}
              onClick={() => setSelected(category)}
              type="button"
            >
              {catalogCategoryLabels[category]}
            </button>
          ))}
        </nav>
        {priceBands.length > 1 && (
          <nav aria-label="Lọc theo giá" className="category-showcase-bands">
            {priceBands.map(({ label, minPrice, maxPrice }) => (
              <Link
                key={label}
                search={{
                  category: tab.category,
                  ...(minPrice === undefined ? {} : { minPrice }),
                  ...(maxPrice === undefined ? {} : { maxPrice }),
                }}
                to="/products"
              >
                <span
                  aria-hidden="true"
                  className={`product-art product-art--${tab.art}`}
                />
                {label}
              </Link>
            ))}
          </nav>
        )}
        <nav
          aria-label="Lọc theo thương hiệu"
          className="category-showcase-brands"
        >
          {brands.map((brand) => (
            <Link
              key={brand}
              search={{ category: tab.category, brand }}
              to="/products"
            >
              {brandLabel(brand)}
            </Link>
          ))}
          <Link
            className="category-showcase-brands__all"
            search={{ category: tab.category }}
            to="/products"
          >
            Xem tất cả <ChevronRight aria-hidden="true" size={15} />
          </Link>
        </nav>
        {products.isPending ? (
          <div className="commerce-app">
            <Loading />
          </div>
        ) : products.isError ? (
          <div className="commerce-app">
            <QueryError
              error={products.error}
              retry={() => products.refetch()}
            />
          </div>
        ) : (
          <div className="category-showcase-grid">
            {items.map((product) => (
              <ShowcaseCard
                busy={busy}
                key={product.id}
                onAddToCart={onAddToCart}
                product={product}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ShowcaseCard({
  product,
  onAddToCart,
  busy,
}: ShowcaseActions & { product: Product }) {
  const soldOut = product.availableQuantity === 0
  const link = {
    to: '/products/$productId',
    params: { productId: product.id },
  } as const
  return (
    <article className="category-showcase-card">
      {product.discount && (
        <span className="category-showcase-card__discount">
          Giảm {product.discount.slice(1)}
        </span>
      )}
      <Link
        {...link}
        aria-hidden="true"
        className="category-showcase-card__media"
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
      <h3>
        <Link {...link}>{product.name}</Link>
      </h3>
      {soldOut && (
        <span className="category-showcase-card__status">Tạm hết hàng</span>
      )}
      <div className="category-showcase-card__prices">
        <strong>{product.price}</strong>
        {product.oldPrice && <del>{product.oldPrice}</del>}
      </div>
      {product.rating && (
        <div className="category-showcase-card__rating">
          <Star aria-hidden="true" fill="currentColor" size={14} />
          {product.rating} ({product.ratingCount})
        </div>
      )}
      <p className="category-showcase-card__note">{product.specs}</p>
      <button
        disabled={busy || soldOut}
        onClick={() => onAddToCart(product)}
        type="button"
      >
        Thêm vào giỏ
      </button>
    </article>
  )
}
