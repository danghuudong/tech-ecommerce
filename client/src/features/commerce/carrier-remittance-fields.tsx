import { ChevronUp, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useCommerceQuery, useOrder } from './api'
import {
  Action,
  Empty,
  Field,
  formatDate,
  formatMoney,
  Loading,
  QueryError,
} from './components'
import type { OrderDetail, OrderPage } from './types'

export interface CarrierRemittanceDraft {
  orderId: string
  code: string
  collectionId: string
  carrierId: string
  reference: string
  receivedAt: string
  remainingVnd: number
  amountVnd: number
}

export function carrierRemittanceOptions(
  order: OrderDetail,
): CarrierRemittanceDraft[] {
  return (
    order.payment.carrierCollection?.collections.flatMap((collection) =>
      collection.active &&
      collection.remainingVnd !== null &&
      collection.remainingVnd > 0
        ? [
            {
              orderId: order.id,
              code: order.code,
              collectionId: collection.id,
              carrierId: collection.carrierId,
              reference: collection.reference,
              receivedAt: collection.receivedAt,
              remainingVnd: collection.remainingVnd,
              amountVnd: collection.remainingVnd,
            },
          ]
        : [],
    ) ?? []
  )
}

export function CarrierRemittanceFields({
  order,
  value,
  onChange,
  disabled,
}: {
  order: OrderDetail
  value: CarrierRemittanceDraft[]
  onChange: (value: CarrierRemittanceDraft[]) => void
  disabled: boolean
}) {
  const pickerId = useId()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState(order.id)
  const orders = useCommerceQuery<OrderPage>(
    'staff/orders',
    { q, paymentMethod: 'cod', limit: 10, deletion: 'all' },
    adding && q.length > 0,
  )
  const detail = useOrder(adding && selectedId !== order.id ? selectedId : '')
  const selected = selectedId === order.id ? order : detail.data
  const anchorOptions = carrierRemittanceOptions(order)
  const carrierId = value[0]?.carrierId
  const options = selected?.permittedActions.staff.includes(
    'verify_carrier_remittance',
  )
    ? carrierRemittanceOptions(selected).filter(
        (row) =>
          row.carrierId === carrierId &&
          !value.some((item) => item.collectionId === row.collectionId),
      )
    : []
  const candidates = orders.data?.items.filter((item) =>
    ['delivered', 'completed'].includes(item.status),
  )
  return (
    <div className="c-form-section">
      <Field
        label="Khoản thu hộ (COD) *"
        hint={
          value.length > 1
            ? 'Để chọn khoản thu hộ của đơn vị vận chuyển khác, hãy bỏ các khoản đã thêm trước.'
            : 'Chọn khoản thu hộ của đơn hàng đang xem.'
        }
      >
        <select
          required
          value={value[0]?.collectionId ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const next = anchorOptions.find(
              (row) => row.collectionId === event.target.value,
            )
            if (next) onChange([next, ...value.slice(1)])
          }}
        >
          <option value="">Chọn khoản thu hộ</option>
          {anchorOptions.map((row) => (
            <option
              key={row.collectionId}
              value={row.collectionId}
              disabled={
                value
                  .slice(1)
                  .some((item) => item.collectionId === row.collectionId) ||
                (value.length > 1 && row.carrierId !== carrierId)
              }
            >
              {row.reference} · Còn phải nhận: {formatMoney(row.remainingVnd)}
            </option>
          ))}
        </select>
      </Field>
      {value.map((item, index) => (
        <section
          className="c-form-section"
          key={item.collectionId}
          aria-label={`Khoản thu hộ ${item.reference} của đơn #${item.code}`}
        >
          <strong>
            Đơn #{item.code} · Khoản thu hộ {item.reference}
          </strong>
          <div className="c-form-grid">
            <Field
              label="Số tiền nhận lần này (VND) *"
              hint={`Còn phải nhận: ${formatMoney(item.remainingVnd)} · Khách đã trả cho đơn vị vận chuyển lúc ${formatDate(item.receivedAt)}`}
            >
              <input
                type="number"
                min={1}
                max={item.remainingVnd}
                step={1}
                required
                value={Number.isFinite(item.amountVnd) ? item.amountVnd : ''}
                onChange={(event) =>
                  onChange(
                    value.map((row) =>
                      row.collectionId === item.collectionId
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
                  onChange(
                    value.filter(
                      (row) => row.collectionId !== item.collectionId,
                    ),
                  )
                }
              >
                Bỏ khoản thu hộ
              </Action>
            )}
          </div>
        </section>
      ))}
      <div className="c-remittance-picker__heading">
        {adding && <strong>Thêm khoản thu hộ</strong>}
        <Action
          variant={adding ? 'ghost' : 'secondary'}
          disabled={
            disabled || (!adding && (!carrierId || value.length >= 100))
          }
          aria-expanded={adding}
          aria-controls={pickerId}
          aria-label={adding ? 'Thu gọn phần thêm khoản thu hộ' : undefined}
          onClick={() => setAdding((open) => !open)}
        >
          {adding ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {adding ? 'Thu gọn' : 'Thêm khoản thu hộ'}
        </Action>
      </div>
      <div id={pickerId} hidden={!adding}>
        {adding && (
          <div className="c-form-section">
            <Field
              label="Tìm đơn COD"
              hint="Nhập mã đơn hoặc thông tin khách hàng để tìm khoản thu hộ cùng đơn vị vận chuyển."
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
            <div className="c-actions">
              <Action
                variant="secondary"
                disabled={disabled || !text.trim()}
                onClick={() => setQ(text.trim())}
              >
                Tìm đơn
              </Action>
              <Action
                variant="secondary"
                disabled={disabled}
                onClick={() => setSelectedId(order.id)}
              >
                Khoản thu của #{order.code}
              </Action>
            </div>
            {q &&
              (orders.isPending ? (
                <Loading />
              ) : orders.isError ? (
                <QueryError
                  error={orders.error}
                  retry={() => orders.refetch()}
                />
              ) : candidates?.length ? (
                candidates.map((item) => (
                  <Action
                    key={item.id}
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => setSelectedId(item.id)}
                  >
                    #{item.code} · {item.recipient.name} · đơn vị vận chuyển còn
                    nợ {formatMoney(item.carrierAmountDueVnd)}
                  </Action>
                ))
              ) : (
                <Empty
                  title="Không có đơn COD đã giao phù hợp"
                  description="Thử tìm bằng mã đơn cụ thể."
                />
              ))}
            {selectedId !== order.id && detail.isPending ? (
              <Loading />
            ) : selectedId !== order.id && detail.isError ? (
              <QueryError error={detail.error} retry={() => detail.refetch()} />
            ) : (
              selected && (
                <>
                  <h3>Khoản thu hộ của #{selected.code}</h3>
                  {options.map((item) => (
                    <Action
                      key={item.collectionId}
                      variant="secondary"
                      disabled={disabled || value.length >= 100}
                      onClick={() => onChange([...value, item])}
                    >
                      Thêm {item.reference} · còn{' '}
                      {formatMoney(item.remainingVnd)}
                    </Action>
                  ))}
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
