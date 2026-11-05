import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import {
  CircleUserRound,
  LayoutGrid,
  PackageSearch,
  PhoneCall,
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
} from 'lucide-react'
import { DropdownMenu, Popover } from 'radix-ui'
import { type FormEvent, useState } from 'react'
import { useActor, useCart, useSession } from '@/features/commerce/api'
import { SignOut } from '@/features/commerce/sign-out'
import { CategoryMenu } from './category-menu'
import { storePromises } from './store-header.data'
import { StoreLocationMenu } from './store-location-menu'
import { StoreLogo } from './store-logo'
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
  const [isLocationOpen, setIsLocationOpen] = useState(false)
  const cartCount =
    cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  const accountName = session.data?.user.name ?? 'Đăng nhập'

  function closeMenus() {
    setIsMenuOpen(false)
    setIsAccountOpen(false)
    setIsLocationOpen(false)
  }

  function handleSearchSubmit(searchText: string) {
    closeMenus()
    void navigate({ to: '/products', search: { q: searchText.trim() } })
  }

  return (
    <header className="store-header">
      <div className="store-topbar">
        <div className="store-container store-topbar__inner">
          <StoreTicker />
          <Link
            aria-label="Tra cứu đơn hàng"
            className="store-topbar__link"
            to="/orders"
            onClick={closeMenus}
          >
            <PackageSearch aria-hidden="true" size={15} />
            <span className="store-topbar__label">Tra cứu đơn hàng</span>
          </Link>
          <a
            aria-label="Gọi mua hàng: 1900 63 6888"
            className="store-topbar__link"
            href="tel:1900636888"
          >
            <PhoneCall aria-hidden="true" size={15} />
            <span className="store-topbar__label">1900 63 6888</span>
          </a>
        </div>
      </div>
      <div className="store-masthead">
        <div className="store-container store-masthead__inner">
          <Link
            className="store-logo"
            to="/"
            aria-label="TinovaShop - Trang chủ"
            onClick={closeMenus}
          >
            <StoreLogo />
          </Link>

          <Popover.Root
            open={isMenuOpen}
            onOpenChange={(open) => {
              setIsMenuOpen(open)
              if (open) {
                setIsAccountOpen(false)
                setIsLocationOpen(false)
              }
            }}
          >
            <Popover.Trigger asChild>
              <button
                aria-label="Danh mục sản phẩm"
                className="store-categories-button"
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={20} />
                <span>Danh mục</span>
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="store-header-popup category-popover"
                align="start"
                side="bottom"
                sideOffset={10}
                collisionPadding={12}
                aria-label="Danh mục sản phẩm"
              >
                <div className="category-popover__toolbar">
                  <strong>Danh mục sản phẩm</strong>
                  <Popover.Close
                    className="category-popover__close"
                    aria-label="Đóng danh mục sản phẩm"
                  >
                    <X aria-hidden="true" size={20} />
                  </Popover.Close>
                </div>
                <CategoryMenu variant="popover" onNavigate={closeMenus} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <StoreLocationMenu
            open={isLocationOpen}
            onOpenChange={(open) => {
              setIsLocationOpen(open)
              if (open) {
                setIsMenuOpen(false)
                setIsAccountOpen(false)
              }
            }}
          />

          <StoreSearch
            key={location.href}
            query={query}
            onSubmit={handleSearchSubmit}
          />

          <div className="store-actions">
            <DropdownMenu.Root
              modal={false}
              open={isAccountOpen}
              onOpenChange={(open) => {
                setIsAccountOpen(open)
                if (open) {
                  setIsMenuOpen(false)
                  setIsLocationOpen(false)
                }
              }}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  className="store-action store-action--account"
                  type="button"
                  aria-label={`Tài khoản: ${accountName}`}
                >
                  <CircleUserRound aria-hidden="true" size={20} />
                  <span className="store-action__text">{accountName}</span>
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
                    {session.data
                      ? session.data.user.name
                      : 'Tài khoản của bạn'}
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
                        <CircleUserRound aria-hidden="true" size={16} />
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
                <ShoppingCart aria-hidden="true" size={20} />
                {cartCount > 0 && (
                  <span aria-live="polite" className="store-cart__count">
                    {cartCount}
                  </span>
                )}
              </span>
              <span className="store-cart__label">Giỏ hàng</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}

function StoreTicker() {
  const items = storePromises.map(({ text, icon: Icon }) => (
    <li key={text}>
      <Icon aria-hidden="true" size={15} />
      {text}
    </li>
  ))

  return (
    <div className="store-ticker">
      <ul aria-label="Cam kết của cửa hàng" className="store-ticker__group">
        {items}
      </ul>
      <ul aria-hidden="true" className="store-ticker__group">
        {items}
      </ul>
    </div>
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
        <input
          aria-label="Tìm laptop, điện thoại, phụ kiện"
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Bạn muốn tìm gì hôm nay?"
          maxLength={120}
          type="search"
          value={searchText}
        />
        <button
          aria-label="Tìm kiếm"
          className="store-search__submit"
          type="submit"
        >
          <Search aria-hidden="true" size={20} />
        </button>
      </form>
    </search>
  )
}
