import { Link } from '@tanstack/react-router'
import { ChevronRight, Zap } from 'lucide-react'
import type { Product } from '@/features/catalog/types/product'
import { ProductCard } from '../product-card-v2'

type DealsSectionProps = {
  onAddToCart: (product: Product) => void
  products: Product[]
  busy?: boolean
  catalogStatus?: 'pending' | 'error' | 'success'
}

export function DealsSection({
  onAddToCart,
  products,
  busy,
  catalogStatus = 'success',
}: DealsSectionProps) {
  return (
    <section
      aria-labelledby="deals-title"
      className="hv2-deal-section"
      id="deals"
    >
      <div className="hv2-section-heading">
        <div className="hv2-section-heading__intro">
          <span className="hv2-section-heading__bolt">
            <Zap aria-hidden="true" size={20} fill="currentColor" />
          </span>
          <div>
            <h2 id="deals-title">Ưu đãi nổi bật</h2>
            <p>Những sản phẩm đang giảm nhiều nhất tại TinovaShop</p>
          </div>
        </div>
        <Link className="hv2-section-heading__all" to="/products" search={{}}>
          Xem tất cả <ChevronRight aria-hidden="true" size={16} />
        </Link>
      </div>
      {products.length > 0 ? (
        <div className="hv2-product-grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              onAdd={onAddToCart}
              product={product}
              variant="deal"
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <p className="hv2-deal-section__status" role="status">
          {catalogStatus === 'pending'
            ? 'Đang tải ưu đãi…'
            : catalogStatus === 'error'
              ? 'Chưa tải được ưu đãi. Vui lòng thử tải lại sản phẩm.'
              : 'Hiện chưa có ưu đãi để hiển thị. Bạn có thể khám phá thêm sản phẩm tại cửa hàng.'}
        </p>
      )}
    </section>
  )
}
