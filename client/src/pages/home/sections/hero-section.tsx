import { ArrowRight } from 'lucide-react'

export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="showcase-banner">
      <div className="showcase-banner__copy">
        <span className="showcase-banner__eyebrow">GÓC CÔNG NGHỆ CỦA BẠN</span>
        <h1 id="hero-title">
          Mỏng nhẹ.
          <br />
          <span>Mạnh mẽ.</span>
        </h1>
        <p>Khám phá laptop mới cho mọi hành trình.</p>
        <a className="red-action" href="#deals">
          Khám phá ngay <ArrowRight aria-hidden="true" size={16} />
        </a>
      </div>
      <div
        aria-label="Laptop mỏng nhẹ màu bạc"
        className="showcase-banner__product product-art product-art--laptop"
        role="img"
      />
      <div aria-hidden="true" className="showcase-banner__pagination">
        <span className="is-active" />
        <span />
        <span />
      </div>
    </section>
  )
}
