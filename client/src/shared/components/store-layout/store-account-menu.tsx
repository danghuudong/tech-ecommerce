import { Link } from '@tanstack/react-router'
import { LayoutDashboard, ShoppingBag } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { SignOut } from '@/features/commerce/sign-out'
import './store-account-menu.css'

export function StoreAccountMenu({
  user,
  isStaff,
}: {
  user: { name: string; email: string }
  isStaff: boolean
}) {
  return (
    <>
      <DropdownMenu.Label className="store-account-menu__identity">
        <span aria-hidden="true" className="store-account-menu__avatar">
          {[...user.name][0]?.toUpperCase()}
        </span>
        <span className="store-account-menu__person">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
      </DropdownMenu.Label>
      <DropdownMenu.Item asChild>
        <Link className="store-account-menu__item" to="/orders">
          <span aria-hidden="true" className="store-account-menu__icon">
            <ShoppingBag size={16} />
          </span>
          Đơn hàng của tôi
        </Link>
      </DropdownMenu.Item>
      {isStaff && (
        <DropdownMenu.Item asChild>
          <Link className="store-account-menu__item" to="/staff/orders">
            <span aria-hidden="true" className="store-account-menu__icon">
              <LayoutDashboard size={16} />
            </span>
            Khu vực vận hành
          </Link>
        </DropdownMenu.Item>
      )}
      <DropdownMenu.Separator className="store-account-menu__separator" />
      <SignOut
        className="store-account-menu__item store-account-menu__item--danger"
        inMenu
      />
    </>
  )
}
