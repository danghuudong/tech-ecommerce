import { ChevronRight } from 'lucide-react'
import type { ProductCategoryId } from '@/features/catalog/types/product'
import { categoryTiles } from '../home.data'

type CategoriesSectionProps = {
  onCategorySelect: (category: ProductCategoryId) => void
}

export function CategoriesSection({
  onCategorySelect,
}: CategoriesSectionProps) {
  return (
    <section aria-label="Mua sắm theo danh mục" className="category-rail">
      {categoryTiles.map(({ id, label, art }) => (
        <button
          className="category-tile"
          key={label}
          onClick={() => onCategorySelect(id)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`product-art product-art--${art}`}
          />
          <strong>{label}</strong>
          <span aria-hidden="true" className="category-tile__arrow">
            <ChevronRight size={14} />
          </span>
        </button>
      ))}
    </section>
  )
}
