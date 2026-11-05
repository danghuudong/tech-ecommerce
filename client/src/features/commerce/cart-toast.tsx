import { Link } from '@tanstack/react-router'
import { CircleCheck, X } from 'lucide-react'
import { Portal, Toast } from 'radix-ui'
import './cart-toast.css'

const TOAST_DURATION_MS = 4000

/** Give each add a new `key` so repeating it restarts the toast's timer. */
export function CartToast({ productName }: { productName: string }) {
  return (
    <Portal.Root>
      <Toast.Provider duration={TOAST_DURATION_MS} label="Thông báo">
        <Toast.Root className="cart-toast">
          <CircleCheck
            aria-hidden="true"
            className="cart-toast__icon"
            size={22}
          />
          <div className="cart-toast__body">
            <Toast.Title className="cart-toast__title">
              Đã thêm vào giỏ hàng
            </Toast.Title>
            <Toast.Description className="cart-toast__name">
              {productName}
            </Toast.Description>
            <Toast.Action altText="Xem giỏ hàng" asChild>
              <Link className="cart-toast__link" to="/cart">
                Xem giỏ hàng
              </Link>
            </Toast.Action>
          </div>
          <Toast.Close
            aria-label="Đóng thông báo"
            className="cart-toast__close"
          >
            <X aria-hidden="true" size={16} />
          </Toast.Close>
        </Toast.Root>
        <Toast.Viewport
          className="cart-toast-viewport"
          label="Thông báo ({hotkey})"
        />
      </Toast.Provider>
    </Portal.Root>
  )
}
