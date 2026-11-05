import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import {
  groupAccessories,
  useAccessories,
} from '@/features/catalog/accessory-groups'
import { useCatalogFacets } from '@/features/catalog/catalog-facets'
import { brandLabel } from '@/features/catalog/catalog-search'
import { StoreProductCard } from '@/features/catalog/components/store-product-card'
import { toHomeProduct } from '@/features/catalog/to-home-product'
import { read } from '@/features/commerce/api'
import { Empty, QueryError } from '@/features/commerce/components'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { useScrollReveal } from '../use-scroll-reveal'
import { homeCatalogSections } from './home-catalog.data'
import type { HomeCatalogSection, HomeCatalogTab } from './home-catalog.types'

const priceBands = [
  { label: 'Tất cả mức giá' },
  { label: 'Dưới 5 triệu', maxPrice: 4_999_999 },
  { label: '5 - 10 triệu', minPrice: 5_000_000, maxPrice: 9_999_999 },
  { label: '10 - 20 triệu', minPrice: 10_000_000, maxPrice: 19_999_999 },
  { label: '20 - 30 triệu', minPrice: 20_000_000, maxPrice: 29_999_999 },
  { label: 'Trên 30 triệu', minPrice: 30_000_000 },
] as const

export function HomeCatalog() {
  const rootRef = useRef<HTMLDivElement>(null)
  useScrollReveal(rootRef)
  return (
    <div className="hv2-catalog" id="suggestions" ref={rootRef}>
      {homeCatalogSections.map((section, index) => (
        <div key={section.id}>
          <CatalogBlock section={section} />
          {index === 0 && <AccessoryRibbon />}
        </div>
      ))}
    </div>
  )
}

function CatalogBlock({ section }: { section: HomeCatalogSection }) {
  const [selected, setSelected] = useState(0)
  const tab = section.tabs[selected] ?? section.tabs[0]
  const headingId = useId()
  const panelId = useId()
  if (!tab) return null
  return (
    <section className="hv2-catalog-block" aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {section.title}
      </h2>
      <Link
        to="/products"
        search={{ category: tab.category, ...(tab.q ? { q: tab.q } : {}) }}
        className="hv2-catalog-banner"
      >
        {tab.banner ? (
          <picture>
            {tab.mobileBanner && (
              <source media="(max-width: 760px)" srcSet={tab.mobileBanner} />
            )}
            <img
              src={tab.banner}
              alt={tab.bannerAlt}
              loading="lazy"
              decoding="async"
              width={240}
              height={720}
            />
          </picture>
        ) : (
          <span className="hv2-catalog-banner__fallback">
            {tab.title}
            <small>
              Khám phá ngay <ChevronRight size={18} />
            </small>
          </span>
        )}
      </Link>
      <div className="hv2-catalog-block__content">
        <fieldset
          className="hv2-catalog-tabs"
          aria-label={`Danh mục ${section.title}`}
        >
          {section.tabs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected === index}
              aria-controls={panelId}
              onClick={() => setSelected(index)}
            >
              {item.title}
            </button>
          ))}
        </fieldset>
        <div id={panelId}>
          <CatalogProducts key={tab.id} tab={tab} />
        </div>
      </div>
    </section>
  )
}

function CatalogProducts({ tab }: { tab: HomeCatalogTab }) {
  const [brand, setBrand] = useState('')
  const [bandIndex, setBandIndex] = useState(0)
  const [page, setPage] = useState(0)
  const facets = useCatalogFacets(tab.q)
  const band = priceBands[bandIndex] ?? priceBands[0]
  const search = {
    category: tab.category,
    ...(tab.q ? { q: tab.q } : {}),
    ...(brand ? { brand } : {}),
    ...('minPrice' in band ? { minPrice: band.minPrice } : {}),
    ...('maxPrice' in band ? { maxPrice: band.maxPrice } : {}),
  }
  const catalog = useQuery({
    queryKey: ['catalog', 'home-v2', search],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { ...search, limit: 100 },
      }),
    staleTime: 60_000,
  })
  const items = [...(catalog.data?.items ?? [])].sort(
    (a, b) => rankProduct(a, tab) - rankProduct(b, tab),
  )
  const pageSize = tab.rows * 4
  const pageCount = Math.ceil(items.length / pageSize)
  const safePage = Math.min(page, Math.max(0, pageCount - 1))
  const visibleItems = items.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  )
  const brands = facets.data?.get(tab.category)?.brands ?? []
  const productsId = useId()
  return (
    <>
      <fieldset
        className="hv2-catalog-needs"
        aria-label={`Khoảng giá ${tab.title}`}
      >
        {priceBands.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={bandIndex === index}
            onClick={() => {
              setBandIndex(index)
              setPage(0)
            }}
          >
            {tab.previews[index % tab.previews.length] && (
              <img
                src={tab.previews[index % tab.previews.length]}
                alt=""
                width={36}
                height={44}
                loading="lazy"
              />
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </fieldset>
      <div className="hv2-catalog-filter-row">
        <fieldset
          className="hv2-catalog-brands"
          aria-label={`Thương hiệu ${tab.title}`}
        >
          <button
            type="button"
            aria-pressed={!brand}
            onClick={() => {
              setBrand('')
              setPage(0)
            }}
          >
            Tất cả
          </button>
          {brands.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={brand === value}
              onClick={() => {
                setBrand(value)
                setPage(0)
              }}
            >
              {brandLabel(value)}
            </button>
          ))}
        </fieldset>
        <Link to="/products" search={search} className="hv2-catalog-all">
          Xem tất cả <ChevronRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <div
        id={productsId}
        className="hv2-catalog-results"
        aria-busy={catalog.isPending}
      >
        {catalog.isPending && (
          <div className="store-product-grid" role="status">
            <span className="sr-only">Đang tải {tab.title.toLowerCase()}…</span>
            {Array.from({ length: pageSize }, (_, index) => (
              <div
                key={`skeleton-${index.toString()}`}
                className="hv2-catalog-skeleton"
              />
            ))}
          </div>
        )}
        {catalog.isError && (
          <div className="commerce-app">
            <QueryError error={catalog.error} retry={() => catalog.refetch()} />
          </div>
        )}
        {catalog.isSuccess && !items.length && (
          <div className="commerce-app hv2-catalog-empty">
            <Empty title="Chưa có sản phẩm phù hợp" />
            {(brand || bandIndex > 0) && (
              <button
                className="hv2-catalog-reset"
                type="button"
                onClick={() => {
                  setBrand('')
                  setBandIndex(0)
                  setPage(0)
                }}
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        )}
        {visibleItems.length > 0 && (
          <div className="store-product-grid">
            {visibleItems.map((item) => (
              <StoreProductCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
      {pageCount > 1 && (
        <nav
          className="hv2-catalog-pagination"
          aria-label={`Trang sản phẩm ${tab.title}`}
        >
          <button
            type="button"
            aria-label="Sản phẩm trước"
            aria-controls={productsId}
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span role="status" aria-atomic="true">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            aria-label="Sản phẩm tiếp theo"
            aria-controls={productsId}
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
    </>
  )
}

function rankProduct(product: CatalogProduct, tab: HomeCatalogTab) {
  const index = tab.featuredSkus.indexOf(product.sku)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function AccessoryRibbon() {
  const id = useId()
  const accessories = useAccessories()
  const groups = groupAccessories(accessories.data ?? [])
  return (
    <section className="hv2-accessories" aria-labelledby={id}>
      <div className="hv2-accessories__heading">
        <h2 id={id}>Sắm thêm phụ kiện chất lượng</h2>
        <Link to="/accessories" search={{}} className="hv2-catalog-all">
          Xem tất cả <ChevronRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <div className="hv2-accessories__grid" aria-busy={accessories.isPending}>
        {groups.map((group) => {
          const cover = toHomeProduct(
            group.products.find((product) => product.primaryImageId) ??
              (group.products[0] as CatalogProduct),
          )
          return (
            <Link
              key={group.id}
              to="/accessories"
              search={{ type: group.id }}
              className="hv2-accessory-tile"
            >
              {cover.imageUrl ? (
                <img
                  src={cover.imageUrl}
                  alt=""
                  loading="lazy"
                  width={72}
                  height={72}
                />
              ) : (
                <span className={`product-art product-art--${cover.art}`} />
              )}
              <span className="hv2-accessory-tile__name">{group.label}</span>
            </Link>
          )
        })}
        {accessories.isPending && (
          <p className="hv2-accessories__status" role="status">
            Đang tải phụ kiện…
          </p>
        )}
      </div>
      {accessories.isError && (
        <div className="commerce-app">
          <QueryError
            error={accessories.error}
            retry={() => accessories.refetch()}
          />
        </div>
      )}
      {accessories.isSuccess && groups.length === 0 && (
        <div className="commerce-app">
          <Empty title="Chưa có phụ kiện" />
        </div>
      )}
    </section>
  )
}
