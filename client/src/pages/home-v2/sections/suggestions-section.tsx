import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { Product } from '@/features/catalog/types/product'
import type { SuggestionFilterId } from '../home-v2.data'
import { ProductCard } from '../product-card-v2'

type SuggestionsSectionProps = {
  filters: { id: SuggestionFilterId; label: string }[]
  visibleProducts: Product[]
  selectedFilter: SuggestionFilterId
  onFilterChange: (filter: SuggestionFilterId) => void
  onAddToCart: (product: Product) => void
  busy?: boolean
}

export function SuggestionsSection({
  filters,
  visibleProducts,
  selectedFilter,
  onFilterChange,
  onAddToCart,
  busy,
}: SuggestionsSectionProps) {
  return (
    <section
      aria-labelledby="suggestions-title"
      className="hv2-suggestion-section"
      id="suggestions"
    >
      <div className="hv2-section-heading">
        <div>
          <h2 id="suggestions-title">Gợi ý dành cho bạn</h2>
          <p>Những lựa chọn phù hợp cho học tập, làm việc và giải trí</p>
        </div>
        <Link className="hv2-section-heading__all" to="/products" search={{}}>
          Xem tất cả <ChevronRight aria-hidden="true" size={16} />
        </Link>
      </div>
      <fieldset className="hv2-suggestion-filters">
        <legend className="visually-hidden">Lọc sản phẩm theo danh mục</legend>
        {filters.map((filter) => (
          <button
            aria-pressed={selectedFilter === filter.id}
            className={selectedFilter === filter.id ? 'is-selected' : ''}
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </fieldset>
      {visibleProducts.length > 0 ? (
        <div className="hv2-product-grid">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              onAdd={onAddToCart}
              product={product}
              variant="suggestion"
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <p className="hv2-suggestion-empty" role="status">
          Chưa có sản phẩm trong danh mục này.
        </p>
      )}
    </section>
  )
}
