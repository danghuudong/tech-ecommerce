import { Headphones, Mail } from 'lucide-react'

export function StoreFooter() {
  return (
    <footer className="store-footer" id="footer">
      <div className="store-container store-footer__main">
        <div className="store-footer__brand">
          <a
            className="store-logo"
            href="#top"
            aria-label="TECH VIỆT - Trang chủ"
          >
            <span>TECH</span>
            <strong>VIỆT</strong>
          </a>
          <p>Công nghệ chính hãng, đồng hành cùng bạn mỗi ngày.</p>
          <nav aria-label="Mạng xã hội" className="store-footer__socials">
            <a href="#footer" aria-label="Facebook TECH VIỆT">
              f
            </a>
            <a href="#footer" aria-label="YouTube TECH VIỆT">
              ▶
            </a>
          </nav>
        </div>
        <div className="store-footer__column">
          <h2>Về TECH VIỆT</h2>
          <a href="#footer">Giới thiệu</a>
          <a href="#footer">Hệ thống cửa hàng</a>
          <a href="#footer">Tin công nghệ</a>
        </div>
        <div className="store-footer__column">
          <h2>Hỗ trợ mua hàng</h2>
          <a href="#advice">Hướng dẫn mua hàng</a>
          <a href="#benefits">Giao hàng & thanh toán</a>
          <a href="#benefits">Bảo hành & đổi trả</a>
        </div>
        <div className="store-footer__contact">
          <h2>Liên hệ</h2>
          <a href="tel:1900636888">
            <Headphones aria-hidden="true" size={19} />
            <strong>1900 63 6888</strong>
          </a>
          <a href="mailto:hotro@techviet.vn">
            <Mail aria-hidden="true" size={18} />
            hotro@techviet.vn
          </a>
        </div>
      </div>
      <div className="store-container store-footer__bottom">
        <span>
          © {new Date().getFullYear()} TECH VIỆT. Tất cả quyền được bảo lưu.
        </span>
        <div>
          <a href="#footer">Bảo mật</a>
          <a href="#footer">Điều khoản</a>
        </div>
        <div className="store-footer__payments">
          <b>VISA</b>
          <i className="payment-circles" aria-hidden="true" />
          <b className="payment-momo">MoMo</b>
        </div>
      </div>
    </footer>
  )
}
