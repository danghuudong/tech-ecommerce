import { ChevronRight } from 'lucide-react'
import { ProductCard } from '@/features/catalog/components/product-card'
import type { Product } from '@/features/catalog/types/product'
import { type SuggestionFilterId, suggestionFilters } from '../home.data'

type SuggestionsSectionProps = {
  visibleProducts: Product[]
  selectedFilter: SuggestionFilterId
  onFilterChange: (filter: SuggestionFilterId) => void
  onAddToCart: (product: Product) => void
  busy?: boolean
}

export function SuggestionsSection({
  visibleProducts,
  selectedFilter,
  onFilterChange,
  onAddToCart,
  busy,
}: SuggestionsSectionProps) {
  return (
    <section
      aria-labelledby="suggestions-title"
      className="suggestion-section"
      id="suggestions"
    >
      <div className="section-heading section-heading--suggestions">
        <div>
          <h2 id="suggestions-title">Gợi ý dành cho bạn</h2>
          <p>Những lựa chọn phù hợp cho học tập, làm việc và giải trí</p>
        </div>
        <fieldset className="suggestion-filters">
          <legend className="visually-hidden">
            Lọc sản phẩm theo danh mục
          </legend>
          {suggestionFilters.map((filter) => (
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
        <a className="section-heading__all" href="/products">
          Xem tất cả <ChevronRight aria-hidden="true" size={15} />
        </a>
      </div>
      {visibleProducts.length > 0 ? (
        <div className="product-grid product-grid--suggestions">
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
        <p className="suggestion-empty" role="status">
          Không tìm thấy sản phẩm phù hợp. Hãy thử từ khóa khác.
        </p>
      )}
    </section>
  )
}
