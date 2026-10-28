import { Link, useLocation } from '@tanstack/react-router'
import {
  CreditCard,
  Headphones,
  Landmark,
  Menu,
  Package,
  RotateCcw,
  Search,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { type ReactNode, useState } from 'react'
import { StoreHeader } from '@/shared/components/store-layout/store-header'
import { useActor, useSession } from './api'
import { Action, ErrorNotice } from './components'
import { canManageOrders, canManagePayments, roleLabels } from './roles'
import { SessionScopeContext } from './session-scope'
import { SignOut } from './sign-out'
import { StaffShiftCard } from './staff-shift-card'

export function Brand({ to = '/' }: { to?: '/' | '/staff/orders' }) {
  return (
    <Link
      to={to}
      className="c-brand"
      aria-label={
        to === '/staff/orders'
          ? 'TechViet - Quản lý đơn hàng'
          : 'TechViet - Trang chủ'
      }
    >
      Tech<strong>Viet</strong>
    </Link>
  )
}

export function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="commerce-app c-customer">
      <StoreHeader />
      <main className="c-container c-customer-main">{children}</main>
      <footer className="c-footer">
        <div className="c-container">
          <div>
            <Brand />
            <p>Công nghệ thật. Cuộc sống tốt hơn.</p>
          </div>
          <div>
            <h3>Hỗ trợ khách hàng</h3>
            <Link to="/orders">Theo dõi đơn hàng</Link>
            <Link to="/cart">Giỏ hàng của bạn</Link>
          </div>
          <div>
            <h3>Mua sắm tại TechViet</h3>
            <Link to="/products">Sản phẩm chính hãng</Link>
            <span>
              <Headphones size={15} />
              Hỗ trợ mua hàng
            </span>
          </div>
          <div>
            <h3>An tâm mua sắm</h3>
            <span>Giao hàng tiêu chuẩn</span>
            <span>COD hoặc chuyển khoản</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

const staffLinks = [
  { to: '/staff/orders', label: 'Đơn hàng', icon: ShoppingCart },
  { to: '/staff/fulfillment', label: 'Giao vận', icon: Truck },
  { to: '/staff/payments', label: 'Thanh toán', icon: CreditCard },
  { to: '/staff/returns', label: 'Trả hàng & hoàn tiền', icon: RotateCcw },
  { to: '/staff/team', label: 'Nhân sự & phân quyền', icon: Users },
  {
    to: '/staff/receiving-accounts',
    label: 'Tài khoản nhận tiền',
    icon: Landmark,
  },
] as const

export function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <SessionScopeContext.Provider value="admin">
      <StaffWorkspace>{children}</StaffWorkspace>
    </SessionScopeContext.Provider>
  )
}

function StaffWorkspace({ children }: { children: ReactNode }) {
  const session = useSession()
  const actor = useActor()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const visibleLinks = staffLinks.filter(({ to }) => {
    if (to === '/staff/payments') return canManagePayments(actor.data?.role)
    if (to === '/staff/fulfillment') return canManageOrders(actor.data?.role)
    if (to === '/staff/team') return actor.data?.role === 'admin'
    if (to === '/staff/receiving-accounts') return actor.data?.role === 'admin'
    return true
  })
  const active = location.pathname.startsWith('/staff/orders/')
    ? staffLinks[1]
    : (staffLinks.find((link) => location.pathname === link.to) ??
      staffLinks[0])
  const name = session.data?.user.name ?? 'Tài khoản'
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(-2)
    .join('')
    .toUpperCase()
  return (
    <div className={`commerce-app c-staff${open ? ' c-staff--menu-open' : ''}`}>
      <aside className="c-sidebar">
        <div>
          <Brand to="/staff/orders" />
          <small className="c-sidebar__caption">VẬN HÀNH</small>
        </div>
        <nav aria-label="Điều hướng vận hành">
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={active.to === to ? 'is-active' : ''}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="c-staff__workspace">
        <header className="c-staff-topbar">
          <Action
            variant="ghost"
            className="c-mobile-menu"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Mở điều hướng"
          >
            <Menu size={21} />
          </Action>
          <span>
            Trang chủ<span className="c-breadcrumb-separator">›</span>
            <strong>{active.label}</strong>
            {location.pathname.startsWith('/staff/orders/') && (
              <span> / Chi tiết đơn hàng</span>
            )}
          </span>
          <form action="/staff/orders" className="c-staff-search">
            <Search size={17} />
            <input
              type="search"
              name="q"
              aria-label="Tìm mã đơn, khách hàng"
              placeholder="Tìm mã đơn, khách hàng, số điện thoại…"
            />
          </form>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="c-staff-account-trigger"
                aria-label={`Mở menu tài khoản của ${name}`}
              >
                <span className="c-avatar" aria-hidden="true">
                  {initials}
                </span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="commerce-app c-staff-account-menu"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                aria-label="Tài khoản"
              >
                <DropdownMenu.Label className="c-staff-account-menu__identity">
                  <strong>{name}</strong>
                  <small>
                    {actor.data ? roleLabels[actor.data.role] : 'Tài khoản'}
                  </small>
                </DropdownMenu.Label>
                <DropdownMenu.Separator className="c-staff-account-menu__separator" />
                <SignOut inMenu />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>
        <main className="c-staff-main">
          {actor.data?.role === 'staff' && (
            <StaffShiftCard key={actor.data.userId} />
          )}
          {children}
        </main>
      </div>
    </div>
  )
}

export function RouteFailure({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  return (
    <div className="commerce-app c-container c-customer-main">
      <Brand />
      <h1>Không thể hiển thị trang</h1>
      <ErrorNotice error={error} />
      <Action onClick={reset}>Thử lại</Action>
    </div>
  )
}

export function NotFound() {
  return (
    <CustomerLayout>
      <div className="c-empty">
        <Package size={48} />
        <h1>Không tìm thấy trang</h1>
        <Link className="c-button c-button--primary" to="/">
          Về trang chủ
        </Link>
      </div>
    </CustomerLayout>
  )
}
