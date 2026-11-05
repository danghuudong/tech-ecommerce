import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { adviceArticles } from '../home-v2.data'

export function AdviceSection() {
  return (
    <section
      aria-labelledby="advice-title"
      className="hv2-advice-section"
      id="advice"
    >
      <div className="hv2-section-heading">
        <div>
          <h2 id="advice-title">Tư vấn chọn mua</h2>
          <p>Gợi ý nhanh từ đội ngũ TinovaShop</p>
        </div>
      </div>
      <div className="hv2-advice-grid">
        {adviceArticles.map((article) => (
          <article className="hv2-advice-card" key={article.id}>
            <span
              aria-hidden="true"
              className={`hv2-advice-card__art product-art product-art--${article.art}`}
            />
            <div className="hv2-advice-card__copy">
              <span>{article.label}</span>
              <h3>{article.title}</h3>
              <p>{article.summary}</p>
              <Link to="/products" search={{ category: article.category }}>
                Xem sản phẩm <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
