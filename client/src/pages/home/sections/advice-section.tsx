import { ArrowRight, ChevronRight } from 'lucide-react'
import { adviceArticles } from '../home.data'

export function AdviceSection() {
  return (
    <section
      aria-labelledby="advice-title"
      className="advice-section"
      id="advice"
    >
      <div className="section-heading section-heading--advice">
        <div>
          <h2 id="advice-title">Tư vấn chọn mua</h2>
          <p>Gợi ý nhanh từ đội ngũ TECH VIỆT</p>
        </div>
        <a className="section-heading__all" href="#advice">
          Xem tất cả <ChevronRight aria-hidden="true" size={15} />
        </a>
      </div>
      <div className="advice-grid">
        {adviceArticles.map((article) => (
          <article className="advice-card" key={article.id}>
            <div className="advice-card__copy">
              <span>{article.category}</span>
              <h3>{article.title}</h3>
              <p>{article.summary}</p>
              <a href="#suggestions">
                Đọc thêm <ArrowRight aria-hidden="true" size={14} />
              </a>
            </div>
            <div
              aria-hidden="true"
              className={`advice-card__art product-art product-art--${article.art}`}
            />
          </article>
        ))}
      </div>
    </section>
  )
}
