import { Check, type LucideIcon, PackageCheck } from 'lucide-react'
import { formatMoney } from './components'

export function DeliveryOption({
  feeVnd,
  freeShippingThresholdVnd,
}: {
  feeVnd: number
  freeShippingThresholdVnd: number | undefined
}) {
  const isFree = feeVnd === 0
  return (
    <div className="checkout-delivery">
      <span aria-hidden="true" className="checkout-tile">
        <PackageCheck size={21} />
      </span>
      <div className="checkout-option-text">
        <strong>Giao hàng tiêu chuẩn</strong>
        <small>
          {!isFree && freeShippingThresholdVnd
            ? `Miễn phí cho đơn từ ${formatMoney(freeShippingThresholdVnd)}`
            : 'Giao đến địa chỉ người nhận'}
        </small>
      </div>
      {isFree ? (
        <b className="checkout-delivery__fee checkout-delivery__fee--free">
          Miễn phí
        </b>
      ) : (
        <b className="checkout-delivery__fee">{formatMoney(feeVnd)}</b>
      )}
    </div>
  )
}

export function PaymentOption({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onSelect,
}: {
  icon: LucideIcon
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <label className="checkout-payment">
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        name="payment"
        onChange={onSelect}
        type="radio"
      />
      <span aria-hidden="true" className="checkout-tile">
        <Icon size={21} />
      </span>
      <span className="checkout-option-text">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span aria-hidden="true" className="checkout-payment__mark">
        <Check size={13} strokeWidth={3} />
      </span>
    </label>
  )
}
