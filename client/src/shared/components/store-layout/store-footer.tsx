import { Link } from '@tanstack/react-router'
import { Clock3, Mail, MapPin, Phone } from 'lucide-react'
import { PaymentMarks } from './payment-marks'
import { StoreLogo } from './store-logo'
import './store-footer.css'

const footerColumns = [
  {
    title: 'Về TinovaShop',
    links: [
      { label: 'Giới thiệu', href: '#footer' },
      { label: 'Tuyển dụng', href: '#footer' },
      { label: 'Liên hệ', href: '#footer-contact' },
    ],
  },
  {
    title: 'Hỗ trợ khách hàng',
    links: [
      { label: 'Thanh toán', href: '#footer-payments' },
      { label: 'Câu hỏi thường gặp', href: '#footer' },
    ],
  },
  {
    title: 'Chính sách mua sắm',
    links: [
      { label: 'Chính sách bảo hành', href: '#footer' },
      { label: 'Chính sách đổi trả', href: '#footer' },
      { label: 'Chính sách bảo mật', href: '#footer' },
      { label: 'Điều khoản sử dụng', href: '#footer' },
    ],
  },
]

export function StoreFooter() {
  return (
    <footer className="store-footer" id="footer">
      <div className="store-container store-footer__main">
        <div className="store-footer__brand">
          <Link
            aria-label="TinovaShop - Trang chủ"
            className="store-logo"
            hash="top"
            to="/"
          >
            <StoreLogo />
          </Link>
          <p>Công nghệ chính hãng cho mọi nhà.</p>
          <nav aria-label="Mạng xã hội" className="store-footer__socials">
            <a className="store-footer__social--facebook" href="#footer">
              <span className="sr-only">Facebook TinovaShop</span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M14 8.5V6.6c0-.9.6-1.1 1-1.1h2.4V2h-3.3C10.6 2 9.6 4.6 9.6 6.3v2.2H7.2V12h2.4v10H14V12h3l.4-3.5H14Z" />
              </svg>
            </a>
            <a className="store-footer__social--youtube" href="#footer">
              <span className="sr-only">YouTube TinovaShop</span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"
                />
              </svg>
            </a>
            <a className="store-footer__social--tiktok" href="#footer">
              <span className="sr-only">TikTok TinovaShop</span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M19.6 6.7a4.8 4.8 0 0 1-3.8-4.3V2h-3.4v13.7a2.9 2.9 0 1 1-2-2.7V9.5a6.3 6.3 0 1 0 5.4 6.2V8.7a8.2 8.2 0 0 0 4.8 1.5V6.8l-1-.1Z" />
              </svg>
            </a>
            <a
              className="store-footer__social--zalo"
              href="#footer"
              aria-label="Zalo TinovaShop"
            >
              Zalo
            </a>
          </nav>
        </div>

        {footerColumns.map(({ title, links }) => (
          <nav aria-label={title} className="store-footer__column" key={title}>
            <h2>{title}</h2>
            <ul>
              {links.map((link) => (
                <li key={link.label}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="store-footer__column" id="footer-contact">
          <h2>Liên hệ</h2>
          <ul className="store-footer__contact">
            <li>
              <MapPin aria-hidden="true" size={16} />
              TP. Hồ Chí Minh
            </li>
            <li>
              <Phone aria-hidden="true" size={16} />
              <a href="tel:1900636888">1900 63 6888</a>
            </li>
            <li>
              <Mail aria-hidden="true" size={16} />
              <a href="mailto:hotro@techviet.vn">hotro@techviet.vn</a>
            </li>
            <li>
              <Clock3 aria-hidden="true" size={16} />
              Thứ 2 - Chủ nhật: 8:00 - 22:00
            </li>
          </ul>
        </div>
      </div>

      <div className="store-container store-footer__bottom">
        <div className="store-footer__payments" id="footer-payments">
          <span>Phương thức thanh toán</span>
          <PaymentMarks />
        </div>
        <small>
          © {new Date().getFullYear()} TinovaShop. Tất cả quyền được bảo lưu.
        </small>
      </div>
    </footer>
  )
}
