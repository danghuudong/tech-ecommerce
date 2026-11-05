import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, ChevronRight, LayoutGrid, Tags } from 'lucide-react'
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  type CategoryFacet,
  useCatalogFacets,
} from '@/features/catalog/catalog-facets'
import { brandLabel } from '@/features/catalog/catalog-search'
import type { ProductCategoryId } from '@/features/catalog/types/product'
import { read } from '@/features/commerce/api'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { CategoryMenuProduct } from './category-menu-product'
import { PromotionPanel } from './promotion-panel'
import {
  type MenuCategory,
  menuCategories,
  type PriceBand,
} from './store-header.data'
import './category-menu.css'

const HOVER_DELAY_MS = 40
const FEATURED_LIMIT = 3
const FEATURED_STALE_TIME_MS = 5 * 60_000

type CategoryMenuProps = {
  variant: 'sidebar' | 'popover' | 'hero'
  onNavigate?: () => void
}

type ActiveMenuId = ProductCategoryId | 'promotions'

export function CategoryMenu({ variant, onNavigate }: CategoryMenuProps) {
  const facets = useCatalogFacets()
  const isHero = variant === 'hero'
  const categories = menuCategories.filter(({ id }) => facets.data?.has(id))
  const isPopover = variant === 'popover'
  const [activeId, setActiveId] = useState<ActiveMenuId | null>(null)
  const isPromotionActive = activeId === 'promotions'
  const promotionPanelId = useId()
  const active = isPromotionActive
    ? undefined
    : (categories.find(({ id }) => id === activeId) ??
      (isPopover ? categories[0] : undefined))
  const hoverTimer = useRef<number | undefined>(undefined)
  const isReturningFocus = useRef(false)

  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  function activateAfterDelay(id: ActiveMenuId | null) {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(
      () => setActiveId(id),
      HOVER_DELAY_MS,
    )
  }

  function activateOnFocus(id: ActiveMenuId) {
    if (isReturningFocus.current) return
    window.clearTimeout(hoverTimer.current)
    setActiveId(id)
  }

  function closeOnBlur(event: FocusEvent<HTMLElement>) {
    if (isPopover || event.currentTarget.contains(event.relatedTarget)) return
    window.clearTimeout(hoverTimer.current)
    setActiveId(null)
  }

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (isPopover || event.key !== 'Escape' || (!active && !isPromotionActive))
      return
    window.clearTimeout(hoverTimer.current)
    const row = (event.target as HTMLElement)
      .closest('li')
      ?.querySelector<HTMLElement>('a, button')
    isReturningFocus.current = true
    row?.focus()
    isReturningFocus.current = false
    setActiveId(null)
  }

  return (
    <nav
      aria-label="Danh mục sản phẩm"
      className={`category-menu category-menu--${isHero ? 'sidebar' : variant}${isHero ? ' category-menu--hero' : ''}`}
      onBlur={closeOnBlur}
      onKeyDown={closeOnEscape}
      onMouseLeave={isPopover ? undefined : () => activateAfterDelay(null)}
    >
      {!isPopover && !isHero && (
        <p className="category-menu__title">
          <LayoutGrid aria-hidden="true" size={17} />
          Danh mục sản phẩm
        </p>
      )}
      <ul className="category-menu__list">
        {categories.map((category) => {
          const { id, label, icon: Icon } = category
          const isActive = active?.id === id
          return (
            <li
              key={id}
              onFocus={() => activateOnFocus(id)}
              onMouseEnter={() => activateAfterDelay(id)}
            >
              <Link
                aria-expanded={isActive}
                className={`category-menu__row${isActive ? ' is-active' : ''}`}
                onClick={onNavigate}
                search={{ category: id }}
                to="/products"
              >
                <span className="category-menu__icon">
                  <Icon aria-hidden="true" size={18} />
                </span>
                <span className="category-menu__label">{label}</span>
                <ChevronRight aria-hidden="true" size={15} />
              </Link>
              {isActive && (
                <CategoryPanel
                  category={category}
                  facet={facets.data?.get(id)}
                  onNavigate={onNavigate}
                />
              )}
            </li>
          )
        })}
        {categories.length === 0 && (
          <li className="category-menu__status">
            {facets.isPending ? (
              <span role="status">Đang tải danh mục…</span>
            ) : facets.isError ? (
              <button type="button" onClick={() => void facets.refetch()}>
                Tải lại danh mục
              </button>
            ) : (
              <Link to="/products" onClick={onNavigate}>
                Tất cả sản phẩm
              </Link>
            )}
          </li>
        )}
        <li
          className={`category-menu__promotion-item${isPromotionActive ? ' is-active' : ''}`}
          onFocus={() => activateOnFocus('promotions')}
          onMouseEnter={() => activateAfterDelay('promotions')}
        >
          <button
            type="button"
            className={`category-menu__row${isPromotionActive ? ' is-active' : ''}`}
            aria-expanded={isPromotionActive}
            aria-controls={isPromotionActive ? promotionPanelId : undefined}
            onClick={() => activateOnFocus('promotions')}
          >
            <span className="category-menu__icon">
              <Tags aria-hidden="true" size={18} />
            </span>
            <span className="category-menu__label">Khuyến mãi</span>
            <ChevronRight aria-hidden="true" size={15} />
          </button>
          {isPromotionActive && (
            <PromotionPanel id={promotionPanelId} onNavigate={onNavigate} />
          )}
        </li>
      </ul>
    </nav>
  )
}

function overlapsFacet(band: PriceBand, facet: CategoryFacet) {
  return (
    (band.minPrice ?? 0) <= facet.maxPriceVnd &&
    (band.maxPrice ?? Number.POSITIVE_INFINITY) >= facet.minPriceVnd
  )
}

function CategoryPanel({
  category,
  facet,
  onNavigate,
}: {
  category: MenuCategory
  facet?: CategoryFacet
  onNavigate?: () => void
}) {
  const { id, label } = category
  const featured = useQuery({
    queryKey: ['catalog', 'menu', id],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: {
          category: id,
          limit: FEATURED_LIMIT,
        },
      }),
    staleTime: FEATURED_STALE_TIME_MS,
  })
  const brands = facet?.brands ?? []
  const prices = facet
    ? category.prices.filter((band) => overlapsFacet(band, facet))
    : category.prices
  const products = featured.data?.items ?? []

  return (
    <div className="category-menu__panel">
      <div className="category-menu__card">
        <div className="category-menu__card-heading">
          <strong>{label}</strong>
          <Link onClick={onNavigate} search={{ category: id }} to="/products">
            Xem tất cả <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
        <div className="category-menu__columns">
          {brands.length > 0 && (
            <div>
              <p className="category-menu__group-title">Thương hiệu</p>
              <div className="category-menu__brands">
                {brands.map((brand) => (
                  <Link
                    key={brand}
                    onClick={onNavigate}
                    search={{ category: id, brand }}
                    to="/products"
                  >
                    {brandLabel(brand)}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {prices.length > 0 && (
            <div>
              <p className="category-menu__group-title">Mức giá</p>
              <div className="category-menu__prices">
                {prices.map(({ label: bandLabel, minPrice, maxPrice }) => (
                  <Link
                    key={bandLabel}
                    onClick={onNavigate}
                    search={{ category: id, minPrice, maxPrice }}
                    to="/products"
                  >
                    {bandLabel}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <div className="category-menu__featured">
            <p className="category-menu__group-title">Sản phẩm nổi bật</p>
            {products.map((product) => (
              <CategoryMenuProduct
                key={product.id}
                product={product}
                onNavigate={onNavigate}
              />
            ))}
            {featured.isPending && (
              <span role="status">Đang tải sản phẩm…</span>
            )}
            {featured.isError && (
              <button type="button" onClick={() => void featured.refetch()}>
                Tải lại sản phẩm
              </button>
            )}
            {featured.isSuccess && products.length === 0 && (
              <p>Danh mục chưa có sản phẩm.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
