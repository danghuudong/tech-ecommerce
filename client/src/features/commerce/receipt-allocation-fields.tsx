import { useState } from 'react'
import { useCommerceQuery } from './api'
import {
  Action,
  Empty,
  Field,
  formatDate,
  formatMoney,
  Loading,
  QueryError,
} from './components'
import type { OrderPage } from './types'

export interface ReceiptAllocationDraft {
  orderId: string
  code: string
  amountVnd: number
  paymentDeadlineAt: string | null
}

export function ReceiptAllocationFields({
  value,
  onChange,
  receivedVnd,
  disabled,
}: {
  value: ReceiptAllocationDraft[]
  onChange: (value: ReceiptAllocationDraft[]) => void
  receivedVnd: number
  disabled: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const orders = useCommerceQuery<OrderPage>(
    'staff/orders',
    { q, paymentMethod: 'bank_transfer', limit: 10, deletion: 'all' },
    adding && q.length > 0,
  )
  const candidates = orders.data?.items.filter(
    (order) => !value.some((item) => item.orderId === order.id),
  )
  return (
    <div className="c-form-section">
      {value.map((item, index) => (
        <div className="c-form-grid" key={item.orderId}>
          <Field
            label={`Phân bổ cho #${item.code} (VND) *`}
            hint={`Hạn thanh toán: ${formatDate(item.paymentDeadlineAt)}`}
          >
            <input
              type="number"
              min={1}
              max={
                Number.isFinite(receivedVnd)
                  ? Math.min(receivedVnd, 9999999999)
                  : 9999999999
              }
              step={1}
              required
              value={Number.isFinite(item.amountVnd) ? item.amountVnd : ''}
              onChange={(event) =>
                onChange(
                  value.map((row) =>
                    row.orderId === item.orderId
                      ? { ...row, amountVnd: event.target.valueAsNumber }
                      : row,
                  ),
                )
              }
              disabled={disabled}
            />
          </Field>
          {index > 0 && (
            <Action
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                onChange(value.filter((row) => row.orderId !== item.orderId))
              }
              aria-label={`Bỏ phân bổ cho #${item.code}`}
            >
              Bỏ đơn
            </Action>
          )}
        </div>
      ))}
      <Action
        variant="secondary"
        disabled={disabled || value.length >= 100}
        onClick={() => setAdding(!adding)}
      >
        {adding ? 'Đóng tìm đơn' : 'Phân bổ thêm đơn chuyển khoản'}
      </Action>
      {adding && (
        <div className="c-form-section">
          <Field
            label="Tìm đơn để phân bổ"
            hint="Nhập mã đơn hoặc thông tin khách hàng. Mỗi đơn chỉ có một dòng phân bổ."
          >
            <input
              type="search"
              value={text}
              maxLength={120}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setQ(text.trim())
                }
              }}
            />
          </Field>
          <Action
            variant="secondary"
            disabled={disabled || !text.trim()}
            onClick={() => setQ(text.trim())}
          >
            Tìm đơn
          </Action>
          {q &&
            (orders.isPending ? (
              <Loading />
            ) : orders.isError ? (
              <QueryError error={orders.error} retry={() => orders.refetch()} />
            ) : candidates?.length ? (
              candidates.map((order) => (
                <Action
                  key={order.id}
                  variant="secondary"
                  disabled={disabled || value.length >= 100}
                  onClick={() => {
                    onChange([
                      ...value,
                      {
                        orderId: order.id,
                        code: order.code,
                        paymentDeadlineAt: order.paymentDeadlineAt,
                        amountVnd: Math.max(
                          1,
                          Math.min(
                            order.amountDueVnd ?? 0,
                            receivedVnd -
                              value.reduce(
                                (sum, row) => sum + row.amountVnd,
                                0,
                              ),
                          ),
                        ),
                      },
                    ])
                  }}
                >
                  #{order.code} · {order.recipient.name} · còn{' '}
                  {formatMoney(order.amountDueVnd)}
                </Action>
              ))
            ) : (
              <Empty
                title="Không còn đơn phù hợp trong kết quả"
                description="Thử tìm bằng mã đơn cụ thể."
              />
            ))}
        </div>
      )}
    </div>
  )
}
