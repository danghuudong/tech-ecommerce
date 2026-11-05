import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

const sideTiles = [
  { category: 'phone', title: 'Điện thoại', art: 'phone' },
  { category: 'audio', title: 'Tai nghe', art: 'headphones' },
] as const

export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="showcase-banner">
      <div className="showcase-banner__main">
        <div className="showcase-banner__copy">
          <span className="showcase-banner__eyebrow">
            Góc công nghệ của bạn
          </span>
          <h1 id="hero-title">
            Mỏng nhẹ.
            <br />
            <span>Mạnh mẽ.</span>
          </h1>
          <p>Khám phá laptop mới cho mọi hành trình.</p>
          <div className="showcase-banner__actions">
            <Link
              className="red-action"
              search={{ category: 'laptop' }}
              to="/products"
            >
              Khám phá ngay <ArrowRight aria-hidden="true" size={16} />
            </Link>
            <a className="showcase-banner__link" href="#deals">
              Xem ưu đãi
            </a>
          </div>
        </div>
        <div
          aria-label="Laptop mỏng nhẹ màu bạc"
          className="showcase-banner__art product-art product-art--laptop"
          role="img"
        />
      </div>
      {sideTiles.map(({ category, title, art }) => (
        <Link
          className={`showcase-tile showcase-tile--${art}`}
          key={category}
          search={{ category }}
          to="/products"
        >
          <span className="showcase-tile__copy">
            <strong>{title}</strong>
            <span className="showcase-tile__action">
              Xem ngay <ArrowRight aria-hidden="true" size={14} />
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`showcase-tile__art product-art product-art--${art}`}
          />
        </Link>
      ))}
    </section>
  )
}
