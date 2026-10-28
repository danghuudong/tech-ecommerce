import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  MapPin,
  Search,
  ShoppingBag,
  Truck,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { DropdownMenu, Popover } from 'radix-ui'
import { type FormEvent, useState } from 'react'
import { useActor, useCart, useSession } from '@/features/commerce/api'
import { SignOut } from '@/features/commerce/sign-out'
import { categoryLinks, menuGroups } from './store-header.data'
import './store-layout.css'
import './store-header.css'

export function StoreHeader() {
  const session = useSession()
  const actor = useActor()
  const cart = useCart()
  const navigate = useNavigate()
  const location = useLocation()
  const search = useSearch({ strict: false })
  const query = location.pathname === '/products' ? (search.q ?? '') : ''
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const cartCount =
    cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  const accountName = session.data?.user.name ?? 'Đăng nhập'

  function closeMenus() {
    setIsMenuOpen(false)
    setIsAccountOpen(false)
  }

  function handleSearchSubmit(searchText: string) {
    closeMenus()
    void navigate({ to: '/products', search: { q: searchText.trim() } })
  }

  return (
    <header className="store-header">
      <div className="store-utility-bar">
        <div className="store-container store-utility-bar__inner">
          <p>
            <BadgeCheck aria-hidden="true" size={14} />
            Công nghệ chính hãng, an tâm mua sắm
          </p>
          <div className="store-utility-bar__links">
            <Link to="/orders" onClick={closeMenus}>
              <ShoppingBag aria-hidden="true" size={14} />
              Tra cứu đơn hàng
            </Link>
            <Link to="/" hash="advice" onClick={closeMenus}>
              <CircleHelp aria-hidden="true" size={14} />
              Hỗ trợ
            </Link>
          </div>
        </div>
      </div>

      <div className="store-container store-masthead">
        <Link
          className="store-logo"
          to="/"
          aria-label="TECH VIỆT - Trang chủ"
          onClick={closeMenus}
        >
          <span>TECH</span>
          <strong>VIỆT</strong>
        </Link>

        <StoreSearch
          key={location.href}
          query={query}
          onSubmit={handleSearchSubmit}
        />

        <div className="store-account-actions">
          <Link
            className="store-location"
            to="/"
            hash="footer"
            onClick={closeMenus}
          >
            <MapPin aria-hidden="true" size={19} />
            <span>
              <small>Giao đến</small>
              <strong>Hồ Chí Minh</strong>
            </span>
            <ChevronDown aria-hidden="true" size={13} />
          </Link>
          <DropdownMenu.Root
            modal={false}
            open={isAccountOpen}
            onOpenChange={(open) => {
              setIsAccountOpen(open)
              if (open) setIsMenuOpen(false)
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                className="store-account"
                type="button"
                aria-label={`Tài khoản: ${accountName}`}
              >
                <UserRound aria-hidden="true" size={20} />
                <span className="store-account__text">
                  <small>Tài khoản</small>
                  <strong>{accountName}</strong>
                </span>
                <ChevronDown aria-hidden="true" size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="store-header-popup store-account-menu"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                aria-label="Tài khoản"
              >
                <DropdownMenu.Label className="store-account-menu__identity">
                  {session.data ? session.data.user.name : 'Tài khoản của bạn'}
                </DropdownMenu.Label>
                <DropdownMenu.Item asChild>
                  <Link to="/orders" className="store-account-menu__item">
                    <ShoppingBag aria-hidden="true" size={16} />
                    Đơn hàng của tôi
                  </Link>
                </DropdownMenu.Item>
                {actor.data && actor.data.role !== 'customer' && (
                  <DropdownMenu.Item asChild>
                    <Link
                      to="/staff/orders"
                      className="store-account-menu__item"
                    >
                      Khu vực vận hành
                    </Link>
                  </DropdownMenu.Item>
                )}
                {session.data ? (
                  <SignOut inMenu className="store-account-menu__item" />
                ) : (
                  <DropdownMenu.Item asChild>
                    <Link
                      to="/login"
                      search={{
                        redirect:
                          location.pathname === '/login'
                            ? (search.redirect ?? '/cart')
                            : location.href,
                      }}
                      className="store-account-menu__item"
                    >
                      <UserRound aria-hidden="true" size={16} />
                      Đăng nhập / Đăng ký
                    </Link>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Link
            aria-label={`Giỏ hàng, ${cartCount} sản phẩm`}
            className="store-cart"
            to="/cart"
            onClick={closeMenus}
          >
            <span className="store-cart__icon">
              <ShoppingBag aria-hidden="true" size={21} />
              {cartCount > 0 && (
                <span aria-live="polite" className="store-cart__count">
                  {cartCount}
                </span>
              )}
            </span>
            <span>Giỏ hàng</span>
          </Link>
        </div>
      </div>

      <nav aria-label="Điều hướng chính" className="store-nav">
        <div className="store-container store-nav__inner">
          <Popover.Root
            open={isMenuOpen}
            onOpenChange={(open) => {
              setIsMenuOpen(open)
              if (open) setIsAccountOpen(false)
            }}
          >
            <Popover.Trigger asChild>
              <button className="store-nav__categories" type="button">
                <span className="store-nav__grid-icon" aria-hidden="true">
                  ▦
                </span>
                Danh mục sản phẩm
                <ChevronDown aria-hidden="true" size={15} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="store-header-popup mega-menu"
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                aria-label="Danh mục sản phẩm"
              >
                <div className="mega-menu__toolbar">
                  <strong>Danh mục sản phẩm</strong>
                  <Popover.Close
                    className="mega-menu__close"
                    aria-label="Đóng danh mục sản phẩm"
                  >
                    <X aria-hidden="true" size={20} />
                  </Popover.Close>
                </div>
                <div className="mega-menu__inner">
                  <nav
                    aria-label="Danh mục sản phẩm"
                    className="mega-menu__categories"
                  >
                    {categoryLinks.map(({ id, label, icon: Icon, search }) => (
                      <Link
                        to="/products"
                        search={search}
                        key={id}
                        onClick={closeMenus}
                      >
                        <Icon aria-hidden="true" size={17} />
                        <span>{label}</span>
                        <ChevronRight aria-hidden="true" size={14} />
                      </Link>
                    ))}
                  </nav>
                  {menuGroups.map((group) => (
                    <div className="mega-menu__group" key={group.id}>
                      <p className="mega-menu__heading">{group.title}</p>
                      {group.links.map(({ label, search }) => (
                        <Link
                          to="/products"
                          search={search}
                          key={label}
                          onClick={closeMenus}
                        >
                          {label}
                          <ChevronRight aria-hidden="true" size={13} />
                        </Link>
                      ))}
                      {group.id === 'prices' && (
                        <Link
                          className="mega-menu__all"
                          to="/products"
                          search={{ category: 'laptop' }}
                          onClick={closeMenus}
                        >
                          Xem tất cả laptop{' '}
                          <ArrowRight aria-hidden="true" size={15} />
                        </Link>
                      )}
                    </div>
                  ))}
                  <Link
                    className="mega-menu__promotion"
                    to="/products"
                    search={{ category: 'laptop', q: 'mỏng nhẹ' }}
                    onClick={closeMenus}
                  >
                    <span className="mega-menu__eyebrow">LỰA CHỌN NỔI BẬT</span>
                    <strong>
                      Mỏng nhẹ.
                      <br />
                      Mạnh mẽ.
                    </strong>
                    <span className="mega-menu__cta">
                      Khám phá <ArrowRight aria-hidden="true" size={14} />
                    </span>
                    <span
                      aria-hidden="true"
                      className="mega-menu__laptop product-art product-art--laptop"
                    />
                  </Link>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Link
            className="store-nav__sale"
            to="/"
            hash="deals"
            onClick={closeMenus}
          >
            <Zap aria-hidden="true" size={17} fill="currentColor" />
            Khuyến mãi
          </Link>
          <Link to="/products" search={{}} onClick={closeMenus}>
            Tất cả sản phẩm
          </Link>
          <Link to="/orders" onClick={closeMenus}>
            Tra cứu đơn hàng
          </Link>
          <Link
            className="store-nav__shipping"
            to="/"
            hash="benefits"
            onClick={closeMenus}
          >
            <Truck aria-hidden="true" size={15} />
            Miễn phí giao hàng từ 500K
          </Link>
        </div>
      </nav>
    </header>
  )
}

function StoreSearch({
  query,
  onSubmit,
}: {
  query: string
  onSubmit: (value: string) => void
}) {
  const [searchText, setSearchText] = useState(query)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(searchText)
  }

  return (
    <search className="store-search">
      <form className="store-search__form" onSubmit={handleSubmit}>
        <Search className="store-search__icon" aria-hidden="true" size={19} />
        <input
          aria-label="Tìm laptop, điện thoại, phụ kiện"
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Tìm laptop, điện thoại, phụ kiện..."
          maxLength={120}
          type="search"
          value={searchText}
        />
        <button aria-label="Tìm kiếm" type="submit">
          <Search aria-hidden="true" size={19} />
        </button>
      </form>
    </search>
  )
}
