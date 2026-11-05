import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { discountPercent } from '@/features/catalog/product-view'
import { read } from '@/features/commerce/api'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { CategoryMenuProduct } from './category-menu-product'

export function PromotionPanel({
  id,
  onNavigate,
}: {
  id: string
  onNavigate?: () => void
}) {
  const catalog = useQuery({
    queryKey: ['catalog', 'menu', 'promotions'],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { discounted: true, limit: 3 },
      }),
    staleTime: 30_000,
  })
  const products = catalog.data?.items ?? []

  return (
    <div
      className="category-menu__panel category-menu__panel--promotion"
      id={id}
    >
      <section className="category-menu__card" aria-label="Khuyến mãi">
        <div className="category-menu__card-heading">
          <strong>Khuyến mãi</strong>
          <Link
            to="/products"
            search={{ discounted: true }}
            onClick={onNavigate}
          >
            Xem ưu đãi <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
        <p className="category-menu__group-title">Sản phẩm đang giảm giá</p>
        {products.length > 0 ? (
          <div className="category-menu__promotion-products">
            {products.map((product) => (
              <CategoryMenuProduct
                key={product.id}
                product={product}
                discount={discountPercent(product)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : catalog.isPending ? (
          <p className="category-menu__promotion-status" role="status">
            Đang tải ưu đãi…
          </p>
        ) : catalog.isError ? (
          <div className="category-menu__promotion-status" role="alert">
            <p>Chưa tải được ưu đãi.</p>
            <button
              type="button"
              onClick={() => void catalog.refetch()}
              disabled={catalog.isFetching}
            >
              {catalog.isFetching ? 'Đang tải…' : 'Thử lại'}
            </button>
          </div>
        ) : (
          <p className="category-menu__promotion-status" role="status">
            Ưu đãi mới sẽ được cập nhật tại đây.
          </p>
        )}
      </section>
    </div>
  )
}
