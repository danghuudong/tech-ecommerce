import { Link } from '@tanstack/react-router'
import { categoryTiles } from '../home-v2.data'

export function CategoriesSection() {
  return (
    <section
      aria-labelledby="categories-title"
      className="hv2-category-section"
    >
      <div className="hv2-section-heading">
        <div>
          <h2 id="categories-title">Mua sắm theo danh mục</h2>
        </div>
      </div>
      <div className="hv2-category-rail">
        {categoryTiles.map(({ id, label, art }) => (
          <Link
            className="hv2-category-tile"
            key={id}
            search={{ category: id }}
            to="/products"
          >
            <span
              aria-hidden="true"
              className={`product-art product-art--${art}`}
            />
            <strong>{label}</strong>
          </Link>
        ))}
      </div>
    </section>
  )
}
