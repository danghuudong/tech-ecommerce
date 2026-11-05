import { Link } from '@tanstack/react-router'
import { Check, Trash2 } from 'lucide-react'
import {
  Action,
  Badge,
  formatMoney,
  ProductThumb,
  Quantity,
} from './components'
import type { CartLine, PriceLine } from './types'

function UnitPrice({
  unitPriceVnd,
  listPriceVnd,
}: {
  unitPriceVnd: number
  listPriceVnd: number | null | undefined
}) {
  return (
    <span className="unit-price">
      <b>{formatMoney(unitPriceVnd)}</b>
      {listPriceVnd && listPriceVnd > unitPriceVnd ? (
        <del>{formatMoney(listPriceVnd)}</del>
      ) : null}
    </span>
  )
}

function CartLineStatus({ line }: { line: CartLine }) {
  if (line.eligible)
    return (
      <Badge tone="green">
        <Check aria-hidden="true" size={12} />
        Còn hàng
      </Badge>
    )
  return (
    <Badge tone="red">
      {line.availableQuantity >= line.quantity
        ? 'Sản phẩm không khả dụng'
        : line.availableQuantity > 0
          ? `Chỉ còn ${line.availableQuantity} sản phẩm`
          : 'Sản phẩm tạm hết hàng'}
    </Badge>
  )
}

export function CartLineItem({
  line,
  disabled,
  onQuantityChange,
}: {
  line: CartLine
  disabled: boolean
  onQuantityChange: (quantity: number) => void
}) {
  const link = {
    to: '/products/$productId',
    params: { productId: line.productId },
  } as const
  return (
    <li className="cart-line">
      <Link
        {...link}
        aria-hidden="true"
        className="cart-line__media"
        tabIndex={-1}
      >
        <ProductThumb
          imageId={line.primaryImageId}
          name={line.name}
          sku={line.sku}
        />
      </Link>
      <div className="cart-line__info">
        <Link {...link} className="cart-line__name">
          {line.name}
        </Link>
        <small>
          Đơn giá:{' '}
          <UnitPrice
            listPriceVnd={line.listPriceVnd}
            unitPriceVnd={line.unitPriceVnd}
          />
        </small>
        <CartLineStatus line={line} />
      </div>
      <div className="cart-line__quantity">
        <Quantity
          disabled={disabled || !line.eligible}
          label={`số lượng ${line.name}`}
          max={Math.min(
            99,
            line.availableQuantity,
            line.eligible ? 99 : line.quantity,
          )}
          onChange={onQuantityChange}
          value={line.quantity}
        />
        {line.availableQuantity > 0 &&
          line.quantity > line.availableQuantity && (
            <Action
              aria-label={`Điều chỉnh số lượng ${line.name} còn ${line.availableQuantity}`}
              disabled={disabled}
              onClick={() => onQuantityChange(line.availableQuantity)}
              variant="secondary"
            >
              Điều chỉnh còn {line.availableQuantity}
            </Action>
          )}
      </div>
      <b className="cart-line__total">{formatMoney(line.lineTotalVnd)}</b>
      <Action
        aria-label={`Xóa ${line.name} khỏi giỏ`}
        className="cart-line__remove"
        disabled={disabled}
        onClick={() => onQuantityChange(0)}
        variant="ghost"
      >
        <Trash2 aria-hidden="true" size={18} />
      </Action>
    </li>
  )
}

/** Quote lines carry no image or list price, so those come from the cart. */
export function CheckoutLines({
  lines,
  cartLines,
}: {
  lines: PriceLine[]
  cartLines: CartLine[]
}) {
  const cartLineById = new Map(cartLines.map((line) => [line.productId, line]))
  return (
    <ul className="checkout-lines">
      {lines.map((line) => {
        const cartLine = cartLineById.get(line.productId)
        return (
          <li key={line.productId}>
            <ProductThumb
              imageId={cartLine?.primaryImageId}
              name={line.name}
              sku={line.sku}
            />
            <div>
              <strong>{line.name}</strong>
              <small>
                <UnitPrice
                  listPriceVnd={cartLine?.listPriceVnd}
                  unitPriceVnd={line.unitPriceVnd}
                />{' '}
                × {line.quantity}
              </small>
            </div>
            <b className="checkout-lines__total">
              {formatMoney(line.lineTotalVnd)}
            </b>
          </li>
        )
      })}
    </ul>
  )
}
