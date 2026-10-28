import { ChevronRight, Zap } from 'lucide-react'
import { ProductCard } from '@/features/catalog/components/product-card'
import type { Product } from '@/features/catalog/types/product'

type DealsSectionProps = {
  onAddToCart: (product: Product) => void
  products: Product[]
  busy?: boolean
}

export function DealsSection({
  onAddToCart,
  products,
  busy,
}: DealsSectionProps) {
  return (
    <section aria-labelledby="deals-title" className="deal-section" id="deals">
      <div className="section-heading section-heading--deal">
        <div className="section-heading__intro">
          <Zap
            aria-hidden="true"
            className="section-heading__bolt"
            size={33}
            fill="currentColor"
          />
          <div>
            <h2 id="deals-title">Sản phẩm tại cửa hàng</h2>
            <p>Giá và tồn kho được cập nhật từ TechViet</p>
          </div>
        </div>
        <a className="section-heading__all" href="/products">
          Xem tất cả <ChevronRight aria-hidden="true" size={15} />
        </a>
      </div>
      <div className="product-grid product-grid--deals">
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
    </section>
  )
}
