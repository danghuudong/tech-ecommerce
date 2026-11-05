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
  ShoppingCart,
  X,
} from 'lucide-react'
import { DropdownMenu, Popover } from 'radix-ui'
import { useEffect, useState } from 'react'
import {
  cartItemCount,
  useActor,
  useCart,
  useSession,
} from '@/features/commerce/api'
import { CATEGORY_MENU_ID, CategoryMenu } from './category-menu'
import { StoreAccountMenu } from './store-account-menu'
import { storePromises } from './store-header.data'
import { StoreLocationMenu } from './store-location-menu'
import { StoreLogo } from './store-logo'
import { StoreSearch } from './store-search'
import './store-layout.css'
import './store-header.css'

// Narrower screens hide the home page menu, so they keep the popover.
const HOME_MENU_VISIBLE = '(min-width: 1101px)'

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
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const homePath = location.pathname === '/home-v2' ? '/home-v2' : '/'
  const isOnHome = location.pathname === homePath
  const isCategorySpotlit = isOnHome && location.hash === CATEGORY_MENU_ID
  const isHeaderDimmed = isMenuOpen || isCategorySpotlit
  const cartCount = cartItemCount(cart.data)

  function closeMenus() {
    setIsMenuOpen(false)
    setIsAccountOpen(false)
    setIsLocationOpen(false)
  }

  function setCategorySpotlight(isOn: boolean) {
    void navigate({
      to: homePath,
      hash: isOn ? CATEGORY_MENU_ID : '',
      replace: isOnHome,
      resetScroll: false,
    })
  }

  useEffect(() => {
    if (!isCategorySpotlit) return
    function close() {
      setCategorySpotlight(false)
    }
    function closeOutside(event: PointerEvent) {
      const target = event.target as Element
      if (!target.closest(`#${CATEGORY_MENU_ID}, .store-categories-button`)) {
        close()
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('wheel', close)
    }
  })

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
              if (open && window.matchMedia(HOME_MENU_VISIBLE).matches) {
                closeMenus()
                setCategorySpotlight(!isCategorySpotlit)
                return
              }
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
            onNavigate={closeMenus}
            onOpenChange={setIsSearchOpen}
            onSubmit={handleSearchSubmit}
          />

          <div className="store-actions">
            {session.data ? (
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
                    aria-label={`Tài khoản: ${session.data.user.name}`}
                  >
                    <CircleUserRound aria-hidden="true" size={20} />
                    <span className="store-action__text">
                      {session.data.user.name}
                    </span>
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
                    <StoreAccountMenu
                      isStaff={Boolean(
                        actor.data && actor.data.role !== 'customer',
                      )}
                      user={session.data.user}
                    />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : (
              <Link
                aria-label="Đăng nhập"
                className="store-action store-action--account"
                onClick={closeMenus}
                search={{
                  redirect:
                    location.pathname === '/login'
                      ? (search.redirect ?? '/cart')
                      : location.href,
                }}
                to="/login"
              >
                <CircleUserRound aria-hidden="true" size={20} />
                <span className="store-action__text">Đăng nhập</span>
              </Link>
            )}
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
      <div
        aria-hidden="true"
        className="store-header-backdrop"
        data-category-spotlight={isCategorySpotlit || undefined}
        data-covers-header={isHeaderDimmed || undefined}
        data-visible={isHeaderDimmed || isSearchOpen || undefined}
      />
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
