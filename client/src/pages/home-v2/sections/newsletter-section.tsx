import { Mail } from 'lucide-react'
import { type FormEvent, useState } from 'react'

export function NewsletterSection() {
  const [newsletterMessage, setNewsletterMessage] = useState('')

  function handleNewsletterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNewsletterMessage('Biểu mẫu hiện chưa được kết nối với dịch vụ đăng ký.')
  }

  return (
    <section aria-label="Đăng ký nhận ưu đãi" className="hv2-newsletter-strip">
      <div className="hv2-newsletter-strip__message">
        <span className="hv2-newsletter-strip__icon">
          <Mail aria-hidden="true" size={24} />
        </span>
        <span>
          <strong>Nhận ưu đãi công nghệ mới tuần</strong>
          <small>Cập nhật sản phẩm mới và chương trình ưu đãi.</small>
        </span>
      </div>
      <form className="hv2-newsletter-form" onSubmit={handleNewsletterSubmit}>
        <label className="visually-hidden" htmlFor="newsletter-email">
          Nhập email của bạn
        </label>
        <input
          id="newsletter-email"
          placeholder="Nhập email của bạn"
          type="email"
          required
        />
        <button type="submit">Đăng ký</button>
      </form>
      {newsletterMessage && (
        <span className="hv2-newsletter-strip__notice" role="status">
          {newsletterMessage}
        </span>
      )}
    </section>
  )
}
