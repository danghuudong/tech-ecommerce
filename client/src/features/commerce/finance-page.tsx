import { Link, useSearch } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  CreditCard,
  Landmark,
  RefreshCw,
  Search,
  Truck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  paymentQueryPaths,
  useActor,
  useCommand,
  useCommerceQuery,
  useOrder,
  write,
} from './api'
import {
  type CarrierRemittanceDraft,
  CarrierRemittanceFields,
  carrierRemittanceOptions,
} from './carrier-remittance-fields'
import { CodCollectionWork } from './cod-collection-work'
import {
  AccessGate,
  Action,
  Badge,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  formatMoney,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  Panel,
  QueryError,
  RecipientCard,
} from './components'
import { inputToIso, vietnamDateInput } from './date-time'
import { BalanceReviews, UnallocatedReceipts } from './finance-admin'
import { StaffLayout } from './layouts'
import {
  type ReceiptAllocationDraft,
  ReceiptAllocationFields,
} from './receipt-allocation-fields'
import { AccountSelect } from './receiving-account-select'
import { ShipmentCarrierForm } from './shipment-carrier-form'
import { Stat } from './staff-pages'
import type { OrderDetail, OrderPage } from './types'

export function FinancePage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['accountant', 'admin']}>
        <FinanceContent />
      </AccessGate>
    </StaffLayout>
  )
}

function FinanceContent() {
  const search = useSearch({ strict: false })
  const selectedFromUrl =
    'orderId' in search && typeof search.orderId === 'string'
      ? search.orderId
      : ''
  const [tab, setTab] = useState('bank')
  const [selected, setSelected] = useState(selectedFromUrl)
  const [q, setQ] = useState('')
  const [text, setText] = useState('')
  const [offset, setOffset] = useState(0)
  const [overdue, setOverdue] = useState(false)
  const actor = useActor()
  useEffect(() => {
    setSelected(selectedFromUrl)
  }, [selectedFromUrl])
  const orders = useCommerceQuery<OrderPage>(
    'staff/orders',
    {
      limit: 10,
      offset,
      paymentMethod: tab === 'cod' ? 'cod' : 'bank_transfer',
      q: q || undefined,
      paymentReviewOverdue: overdue ? true : undefined,
      deletion: 'all',
    },
    ['bank', 'cod'].includes(tab),
  )
  const selectedId = selected || orders.data?.items[0]?.id
  return (
    <>
      <PageHeading
        title="Đối soát thanh toán"
        subtitle="Xác minh khoản tiền thực nhận và theo dõi công nợ thu hộ."
      >
        <Action
          variant="secondary"
          pending={orders.isFetching}
          onClick={() => orders.refetch()}
        >
          <RefreshCw size={15} />
          Làm mới
        </Action>
      </PageHeading>
      {['bank', 'cod'].includes(tab) && (
        <div className="c-stats c-stats--three">
          <Stat
            label="Cần đối soát sau hạn"
            value={orders.data?.stats.paymentReviewRequired}
            icon={<Clock3 size={22} />}
          />
          <Stat
            label="Quá hạn xử lý"
            value={orders.data?.stats.paymentReviewOverdue}
            icon={<AlertTriangle size={22} />}
          />
          <Stat
            label="Đơn theo bộ lọc"
            value={orders.data?.total}
            icon={<CreditCard size={22} />}
          />
        </div>
      )}
      <div className="c-tabs" style={{ marginBottom: 18 }}>
        {[
          ['bank', 'Chuyển khoản'],
          ['cod', 'Thu hộ COD'],
          ...(actor.data?.role === 'admin'
            ? [
                ['unallocated', 'Chưa phân bổ'],
                ['differences', 'Chênh lệch'],
              ]
            : []),
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => {
              setTab(value)
              setSelected('')
              setOffset(0)
              setOverdue(false)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'unallocated' ? (
        <UnallocatedReceipts />
      ) : tab === 'differences' ? (
        <BalanceReviews />
      ) : (
        <div className="c-columns c-columns--balanced">
          <Panel className="c-table-panel">
            <div className="c-filters">
              <h2>
                {tab === 'cod'
                  ? 'Đối soát thu hộ COD'
                  : 'Đơn thanh toán chuyển khoản'}
              </h2>
            </div>
            <form
              className="c-filters"
              onSubmit={(event) => {
                event.preventDefault()
                setQ(text.trim())
                setOffset(0)
                setSelected('')
              }}
            >
              <label className="c-filter-search">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="Tìm đơn đối soát"
                  placeholder="Tìm mã đơn, tên khách hàng…"
                  value={text}
                  maxLength={120}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <Action type="submit" variant="secondary">
                Tìm
              </Action>
              {tab === 'bank' && (
                <label className="c-check">
                  <input
                    type="checkbox"
                    checked={overdue}
                    onChange={(event) => {
                      setOverdue(event.target.checked)
                      setOffset(0)
                      setSelected('')
                    }}
                  />
                  Quá hạn xử lý
                </label>
              )}
            </form>
            {orders.isPending ? (
              <Loading />
            ) : orders.isError ? (
              <QueryError error={orders.error} retry={() => orders.refetch()} />
            ) : (
              <>
                {orders.data.items.length ? (
                  <div className="c-table-wrap">
                    <table className="c-table">
                      <thead>
                        <tr>
                          <th>Mã đơn / khách hàng</th>
                          <th className="c-number">Tổng tiền</th>
                          <th>{tab === 'cod' ? 'Thu hộ' : 'Hạn thanh toán'}</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.data.items.map((order) => (
                          <tr
                            key={order.id}
                            className={
                              order.id === selectedId ? 'is-selected' : ''
                            }
                          >
                            <td>
                              <button
                                className="c-row-select"
                                type="button"
                                onClick={() => setSelected(order.id)}
                              >
                                #{order.code}
                              </button>
                              <small>{order.recipient.name}</small>
                            </td>
                            <td className="c-number">
                              {formatMoney(order.totalVnd)}
                            </td>
                            <td>
                              {tab === 'cod' ? (
                                <>
                                  <small>
                                    Khách đã trả:{' '}
                                    {formatMoney(
                                      order.customerPaidToCarrierVnd,
                                    )}
                                  </small>
                                  <small>
                                    Đã nộp:{' '}
                                    {formatMoney(order.carrierRemittedVnd)}
                                  </small>
                                  <small>
                                    Còn nợ:{' '}
                                    {formatMoney(order.carrierAmountDueVnd)}
                                  </small>
                                </>
                              ) : (
                                formatDate(order.paymentDeadlineAt)
                              )}
                            </td>
                            <td>
                              <Badge status={order.paymentStatus} />
                              {order.paymentReviewOverdue && (
                                <small className="c-red">Quá hạn xử lý</small>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="Không có đơn phù hợp" />
                )}
                <Pagination
                  offset={offset}
                  limit={10}
                  total={orders.data.total}
                  count={orders.data.items.length}
                  onChange={(value) => {
                    setOffset(value)
                    setSelected('')
                  }}
                />
              </>
            )}
          </Panel>
          {selectedId ? (
            <PaymentDetail key={selectedId} id={selectedId} onMethod={setTab} />
          ) : (
            <Panel>
              <Empty title="Chọn đơn hàng để đối soát" />
            </Panel>
          )}
        </div>
      )}
    </>
  )
}

function PaymentDetail({
  id,
  onMethod,
}: {
  id: string
  onMethod: (tab: 'bank' | 'cod') => void
}) {
  const query = useOrder(id)
  const paymentMethod = query.data?.paymentMethod
  useEffect(() => {
    if (paymentMethod) onMethod(paymentMethod === 'cod' ? 'cod' : 'bank')
  }, [paymentMethod, onMethod])
  if (query.isPending)
    return (
      <Panel>
        <Loading />
      </Panel>
    )
  if (query.isError)
    return <QueryError error={query.error} retry={() => query.refetch()} />
  const order = query.data
  return (
    <div className="c-stack">
      <Panel
        title={`Đối soát #${order.code}`}
        aside={<Badge status={order.payment.status} />}
      >
        <RecipientCard recipient={order.recipient} />
        <div className="c-actions">
          <Link
            to="/staff/orders/$orderId"
            params={{ orderId: id }}
            className="c-text-link"
          >
            Chi tiết đơn hàng
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="c-divider" />
        {order.paymentMethod === 'bank_transfer' ? (
          <>
            <div className="c-info-grid">
              <div>
                <small>Hạn thanh toán</small>
                <p>
                  <b>{formatDate(order.paymentDeadlineAt)}</b>
                </p>
              </div>
              <div>
                <small>Tiền nhận đúng hạn</small>
                <p>
                  <b>{formatMoney(order.payment.onTimeReceivedVnd)}</b>
                </p>
              </div>
            </div>
            <div className="c-divider" />
            {order.permittedActions.staff.includes('verify_payment_receipt') ? (
              <BankReceiptForm key={`${id}-${order.revision}`} order={order} />
            ) : (
              <Notice>
                Không có thao tác ghi nhận thanh toán khả dụng cho tài khoản
                này.
              </Notice>
            )}
            {order.payment.bankPaymentApproved && (
              <div className="c-actions">
                <Notice tone="green">
                  <strong>Thanh toán đã được xác minh</strong>Đơn hàng có thể
                  tiếp tục xử lý theo trạng thái hiện tại.
                </Notice>
              </div>
            )}
          </>
        ) : (
          <CodPaymentForms key={`${id}-${order.revision}`} order={order} />
        )}
      </Panel>
      {order.paymentMethod === 'bank_transfer' &&
        (order.permittedActions.staff.includes('reconcile_bank_statement') ||
          order.permittedActions.staff.includes(
            'accept_late_bank_payment',
          )) && (
          <DeadlineReconciliation
            key={`${id}-${order.revision}`}
            order={order}
          />
        )}
      {order.payment.receipts.length > 0 && <RecordedReceipts order={order} />}
    </div>
  )
}

function RecordedReceipts({ order }: { order: OrderDetail }) {
  const receipts = new Map<string, OrderDetail['payment']['receipts'][number]>()
  for (const receipt of order.payment.receipts) {
    const existing = receipts.get(receipt.id)
    if (existing) existing.amountVnd += receipt.amountVnd
    else receipts.set(receipt.id, { ...receipt })
  }
  return (
    <Panel title="Khoản tiền đã ghi nhận">
      <div className="c-stack">
        {[...receipts.values()].map((receipt) => {
          const summary = receipt.allocationSummary
          const otherOrders =
            summary?.orders.filter((item) => item.orderId !== order.id) ?? []
          const otherOrdersVnd = otherOrders.reduce(
            (sum, item) => sum + item.amountVnd,
            0,
          )
          const unallocatedVnd = summary
            ? summary.totalVnd -
              summary.orders.reduce((sum, item) => sum + item.amountVnd, 0)
            : 0
          return (
            <div className="c-form-section c-recorded-receipt" key={receipt.id}>
              <strong>Mã giao dịch: {receipt.reference}</strong>
              <dl className="c-financial-dl">
                {summary && (
                  <div>
                    <dt>Tổng tiền giao dịch</dt>
                    <dd>{formatMoney(summary.totalVnd)}</dd>
                  </div>
                )}
                <div>
                  <dt>Phân bổ cho đơn này #{order.code}</dt>
                  <dd>{formatMoney(receipt.amountVnd)}</dd>
                </div>
                {otherOrders.length > 0 && (
                  <div>
                    <dt>Phân bổ cho {otherOrders.length} đơn khác</dt>
                    <dd>{formatMoney(otherOrdersVnd)}</dd>
                  </div>
                )}
                {unallocatedVnd > 0 && !receipt.duplicate && (
                  <div>
                    <dt>Chưa phân bổ</dt>
                    <dd>{formatMoney(unallocatedVnd)}</dd>
                  </div>
                )}
                <div>
                  <dt>Thời điểm thực nhận</dt>
                  <dd>{formatDate(receipt.receivedAt)}</dd>
                </div>
              </dl>
              {otherOrders.length > 0 && (
                <details className="c-receipt-orders">
                  <summary>Xem {otherOrders.length} đơn khác</summary>
                  <dl className="c-financial-dl">
                    {otherOrders.map((item) => (
                      <div key={item.orderId}>
                        <dt>#{item.orderCode}</dt>
                        <dd>{formatMoney(item.amountVnd)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              {receipt.duplicate ? (
                <Badge tone="red">Bản ghi trùng</Badge>
              ) : (
                receipt.receiptReconciliationRequired && (
                  <Badge tone="amber">Cần đối soát bằng chứng</Badge>
                )
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function BankReceiptForm({ order }: { order: OrderDetail }) {
  const [enteredReceived, setEnteredReceived] = useState<number | null>(null)
  const [allocations, setAllocations] = useState<ReceiptAllocationDraft[]>([
    {
      orderId: order.id,
      code: order.code,
      amountVnd: order.payment.amountDueVnd ?? Number.NaN,
      paymentDeadlineAt: order.paymentDeadlineAt,
    },
  ])
  const allocation = allocations.reduce((sum, row) => sum + row.amountVnd, 0)
  const received = enteredReceived ?? allocation
  const validAllocations =
    allocations.length > 0 &&
    allocations.every(
      (row) =>
        Number.isSafeInteger(row.amountVnd) &&
        row.amountVnd > 0 &&
        row.amountVnd <= 9999999999,
    ) &&
    Number.isSafeInteger(allocation) &&
    allocation <= received
  const [verified, setVerified] = useState(false)
  const [receivedAt, setReceivedAt] = useState(() => vietnamDateInput())
  const beforeDeadline =
    receivedAt && order.paymentDeadlineAt
      ? new Date(inputToIso(receivedAt)).getTime() <=
        new Date(order.paymentDeadlineAt).getTime()
      : null
  const command = useCommand(
    (input: Record<string, unknown>) => write('staff/payment-receipts', input),
    paymentQueryPaths,
  )
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!verified || !validAllocations) return
        const data = new FormData(event.currentTarget)
        await command.run({
          receivingAccountId: String(data.get('account')),
          source: 'customer',
          amountVnd: received,
          currency: 'VND',
          reference: String(data.get('reference')).trim(),
          receivedAt: inputToIso(String(data.get('time'))),
          receiptVerified: true,
          evidenceReference: String(data.get('reference')).trim(),
          evidenceVerified: true,
          reason: String(data.get('reason')).trim(),
          allocations: allocations.map(({ orderId, amountVnd }) => ({
            orderId,
            amountVnd,
          })),
        })
      }}
    >
      <AccountSelect channel="bank_transfer" disabled={command.isPending} />
      <Field label="Mã giao dịch *">
        <input
          name="reference"
          required
          minLength={3}
          maxLength={200}
          disabled={command.isPending}
        />
      </Field>
      <Field
        label="Thời điểm tiền vào (giờ Việt Nam) *"
        hint="Điền sẵn thời điểm mở biểu mẫu. Điều chỉnh theo thời điểm tiền thực sự vào tài khoản."
      >
        <input
          type="datetime-local"
          step={0.001}
          name="time"
          value={receivedAt}
          onChange={(event) => setReceivedAt(event.target.value)}
          required
          max={vietnamDateInput()}
          disabled={command.isPending}
        />
      </Field>
      {beforeDeadline !== null && (
        <Badge tone={beforeDeadline ? 'green' : 'amber'}>
          {beforeDeadline
            ? `Tiền vào trước hoặc đúng hạn của #${order.code}`
            : `Tiền vào sau hạn thanh toán của #${order.code}`}
        </Badge>
      )}
      <div className="c-form-grid">
        <Field
          label="Số tiền thực nhận (VND) *"
          hint="Điền sẵn theo tổng phân bổ. Có thể chỉnh theo số tiền thực nhận."
        >
          <input
            type="number"
            min={1}
            max={9999999999}
            step={1}
            required
            value={Number.isFinite(received) ? received : ''}
            onChange={(event) => setEnteredReceived(event.target.valueAsNumber)}
            disabled={command.isPending}
          />
        </Field>
      </div>
      <ReceiptAllocationFields
        value={allocations}
        onChange={setAllocations}
        receivedVnd={received}
        disabled={command.isPending}
      />
      {Number.isFinite(allocation) && allocation > received && (
        <Notice tone="red">Tổng phân bổ vượt số tiền thực nhận.</Notice>
      )}
      {Number.isFinite(received - allocation) && received > allocation && (
        <Notice tone="amber">
          Phần tiền chưa phân bổ: {formatMoney(received - allocation)}. Quản trị
          viên có thể xử lý trong mục “Chưa phân bổ”.
        </Notice>
      )}
      <label className="c-check">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.target.checked)}
          required
          disabled={command.isPending}
        />
        Đã kiểm tra bằng chứng, tài khoản nhận và số liệu
      </label>
      <Field label="Lý do đối soát *">
        <textarea
          name="reason"
          minLength={3}
          maxLength={1000}
          required
          disabled={command.isPending}
        />
      </Field>
      <div className="c-return-estimate">
        <div>
          <small>Đã ghi nhận thanh toán</small>
          <p>
            <b style={{ fontSize: 16, color: 'inherit' }}>
              {formatMoney(order.payment.paidVnd)}
            </b>
          </p>
        </div>
        <div>
          <small>Tổng phân bổ lần này ({allocations.length} đơn)</small>
          <p>
            <b style={{ fontSize: 16 }}>
              {formatMoney(Number.isFinite(allocation) ? allocation : 0)}
            </b>
          </p>
        </div>
      </div>
      <ErrorNotice error={command.error} />
      {command.isSuccess && (
        <Notice tone="green">
          Đã ghi nhận khoản tiền và cập nhật số dư đơn hàng.
        </Notice>
      )}
      <Action
        type="submit"
        pending={command.isPending}
        disabled={!verified || !Number.isFinite(received) || !validAllocations}
      >
        <Landmark size={16} />
        Xác nhận đối soát
      </Action>
      <small>Chỉ cho phép đóng gói sau khi thanh toán được xác minh.</small>
    </form>
  )
}

function DeadlineReconciliation({ order }: { order: OrderDetail }) {
  const lateAllowed = order.permittedActions.staff.includes(
    'accept_late_bank_payment',
  )
  const [outcome, setOutcome] = useState(
    lateAllowed ? 'accept_late_payment' : 'cancel_unpaid',
  )
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`staff/orders/${order.id}/bank-reconciliation`, input),
    paymentQueryPaths,
  )
  return (
    <Panel title="Đối soát sau hạn thanh toán">
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          await command.run({
            outcome,
            statementReference: String(data.get('reference')).trim(),
            statementCheckedThrough: inputToIso(String(data.get('time'))),
            verifiedOnTimeReceivedVnd: order.payment.onTimeReceivedVnd,
            evidenceVerified: true,
            reason: String(data.get('reason')).trim(),
          })
        }}
      >
        <Notice tone="amber">
          Ghi nhận đủ các khoản tiền thực nhận trước khi kết luận đối soát sau
          hạn.
        </Notice>
        <Field label="Kết luận">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            disabled={command.isPending}
          >
            {lateAllowed && (
              <option value="accept_late_payment">
                Chấp nhận khoản thanh toán vào trễ
              </option>
            )}
            {order.permittedActions.staff.includes(
              'reconcile_bank_statement',
            ) && (
              <option value="cancel_unpaid">
                Hủy đơn chưa thanh toán đúng hạn
              </option>
            )}
          </select>
        </Field>
        <Field label="Mã sao kê / bằng chứng *">
          <input
            name="reference"
            required
            minLength={3}
            maxLength={200}
            disabled={command.isPending}
          />
        </Field>
        <Field label="Đã kiểm tra sao kê đến (giờ Việt Nam) *">
          <input
            name="time"
            type="datetime-local"
            step={0.001}
            required
            min={
              order.paymentDeadlineAt
                ? vietnamDateInput(order.paymentDeadlineAt)
                : undefined
            }
            max={vietnamDateInput()}
            disabled={command.isPending}
          />
        </Field>
        <Field label="Lý do kết luận *">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
          />
        </Field>
        <label className="c-check">
          <input type="checkbox" required disabled={command.isPending} />
          Đã xác minh đầy đủ sao kê và kết luận trên
        </label>
        <ErrorNotice error={command.error} />
        <Action
          type="submit"
          pending={command.isPending}
          variant={outcome === 'cancel_unpaid' ? 'danger' : 'primary'}
        >
          {outcome === 'cancel_unpaid'
            ? 'Xác nhận hủy đơn sau đối soát'
            : 'Chấp nhận thanh toán trễ'}
        </Action>
      </form>
    </Panel>
  )
}

function CodPaymentForms({ order }: { order: OrderDetail }) {
  const actions = order.permittedActions.staff
  const [kind, setKind] = useState('collection')
  const [enteredReceived, setEnteredReceived] = useState<number | null>(null)
  const [receivedAt, setReceivedAt] = useState(() => vietnamDateInput())
  const [allocations, setAllocations] = useState<CarrierRemittanceDraft[]>(() =>
    carrierRemittanceOptions(order).slice(0, 1),
  )
  const allocationTotal = allocations.reduce(
    (sum, row) => sum + row.amountVnd,
    0,
  )
  const command = useCommand(
    (input: { path: string; body: Record<string, unknown> }) =>
      write(input.path, input.body),
    paymentQueryPaths,
  )
  const collectionAllowed = actions.includes('verify_customer_paid_carrier')
  const remittanceAllowed = actions.includes('verify_carrier_remittance')
  const directAllowed = actions.includes('verify_payment_receipt')
  const choices = [
    ...(collectionAllowed
      ? [{ value: 'collection', label: 'Khách trả tiền cho đơn vị vận chuyển' }]
      : []),
    ...(remittanceAllowed
      ? [
          {
            value: 'remittance',
            label: 'Đơn vị vận chuyển nộp tiền về cửa hàng',
          },
        ]
      : []),
    ...(directAllowed
      ? [{ value: 'direct', label: 'Khách trả tiền trực tiếp cho cửa hàng' }]
      : []),
  ]
  const effectiveKind =
    choices.find((choice) => choice.value === kind)?.value ?? choices[0]?.value
  const received =
    enteredReceived ??
    (effectiveKind === 'remittance'
      ? allocations.length
        ? allocationTotal
        : Number.NaN
      : (order.payment.purchaseAmountDueVnd ?? Number.NaN))
  const validAllocations =
    allocations.length > 0 &&
    allocations.every(
      (row) =>
        Number.isSafeInteger(row.amountVnd) &&
        row.amountVnd > 0 &&
        row.amountVnd <= row.remainingVnd,
    ) &&
    Number.isSafeInteger(allocationTotal) &&
    allocationTotal <= received
  const carrierDecision = order.payment.carrierCollection?.currentDecision
  return (
    <div className="c-form-section">
      <ShipmentCarrierForm order={order} />
      {carrierDecision && (
        <Notice>
          Quyết định hiện tại {carrierDecision.reference}: bên chịu trách nhiệm{' '}
          {carrierDecision.responsibleParty}.{' '}
          {carrierDecision.disposition === 'debt'
            ? 'Công nợ còn lại'
            : 'Tổn thất còn lại'}
          :{' '}
          {formatMoney(
            carrierDecision.disposition === 'debt'
              ? order.payment.carrierCollection?.receivableVnd
              : order.payment.carrierCollection?.writtenOffVnd,
          )}
          .
        </Notice>
      )}
      <dl className="c-financial-dl">
        <div>
          <dt>Khách đã trả trực tiếp cho cửa hàng</dt>
          <dd>{formatMoney(order.payment.customerDirectReceivedVnd)}</dd>
        </div>
        <div>
          <dt>Khách còn phải trả</dt>
          <dd>{formatMoney(order.payment.purchaseAmountDueVnd)}</dd>
        </div>
        <div>
          <dt>Khách đã trả cho đơn vị vận chuyển</dt>
          <dd>{formatMoney(order.payment.customerPaidToCarrierVnd)}</dd>
        </div>
        <div>
          <dt>Đơn vị vận chuyển đã nộp</dt>
          <dd>{formatMoney(order.payment.carrierRemittedVnd)}</dd>
        </div>
        <div>
          <dt>Đơn vị vận chuyển còn nợ</dt>
          <dd>{formatMoney(order.payment.carrierAmountDueVnd)}</dd>
        </div>
      </dl>
      {effectiveKind ? (
        <form
          className="c-form-section"
          onSubmit={async (event) => {
            event.preventDefault()
            if (effectiveKind === 'remittance' && !validAllocations) return
            const data = new FormData(event.currentTarget)
            await command.run({
              path: `staff/orders/${order.id}/${effectiveKind === 'collection' ? 'cod-collections' : effectiveKind === 'remittance' ? 'carrier-remittances' : 'payments'}`,
              body: {
                amountVnd: received,
                currency: 'VND',
                reference: String(data.get('reference')).trim(),
                receivedAt: inputToIso(String(data.get('time'))),
                receiptVerified: true,
                ...(effectiveKind === 'collection'
                  ? { carrierId: order.shipment?.carrierId }
                  : {
                      receivingAccountId: String(data.get('account')),
                      ...(effectiveKind === 'remittance'
                        ? {
                            allocations: allocations.map(
                              ({ orderId, collectionId, amountVnd }) => ({
                                orderId,
                                collectionId,
                                amountVnd,
                              }),
                            ),
                          }
                        : { method: 'cod', source: 'customer' }),
                    }),
              },
            })
          }}
        >
          <div className="c-divider" />
          <Field label="Nghiệp vụ">
            <select
              value={effectiveKind}
              onChange={(event) => {
                setKind(event.target.value)
                setEnteredReceived(null)
              }}
              disabled={command.isPending}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
          {effectiveKind === 'direct' && (
            <Notice>
              Khoản tiền này được ghi nhận là khách thanh toán trực tiếp vào tài
              khoản hoặc quỹ tiền mặt của cửa hàng.
            </Notice>
          )}
          {effectiveKind === 'collection' ? (
            <>
              <Field label="Đơn vị vận chuyển *">
                <input readOnly value={order.shipment?.carrier?.name ?? ''} />
              </Field>
              <small>
                Đơn vị vận chuyển đã nhận bàn giao vận đơn{' '}
                {order.shipment?.trackingReference}.
              </small>
            </>
          ) : (
            <AccountSelect disabled={command.isPending} />
          )}
          <Field
            label={
              effectiveKind === 'remittance'
                ? 'Tổng tiền thực nhận (VND) *'
                : 'Số tiền thực nhận (VND) *'
            }
            hint={
              effectiveKind === 'remittance'
                ? undefined
                : 'Điền sẵn số khách còn phải trả. Có thể chỉnh theo số tiền thực nhận.'
            }
          >
            <input
              name="amount"
              type="number"
              min={1}
              max={9999999999}
              step={1}
              required
              value={Number.isFinite(received) ? received : ''}
              onChange={(event) =>
                setEnteredReceived(event.target.valueAsNumber)
              }
              disabled={command.isPending}
            />
          </Field>
          {effectiveKind === 'remittance' && (
            <>
              <CarrierRemittanceFields
                order={order}
                value={allocations}
                onChange={setAllocations}
                disabled={command.isPending}
              />
              <Notice tone={validAllocations ? 'blue' : 'amber'}>
                Tổng tiền nhận cho các khoản thu hộ:{' '}
                {formatMoney(
                  Number.isFinite(allocationTotal) ? allocationTotal : 0,
                )}
                .
                {!validAllocations &&
                  ' Số tiền nhận cho mỗi khoản phải lớn hơn 0 và không vượt số còn phải nhận; tổng không vượt tổng tiền thực nhận.'}
                {validAllocations &&
                  received > allocationTotal &&
                  ` Còn ${formatMoney(received - allocationTotal)} chưa gắn với khoản thu hộ nào, chờ quản trị viên xử lý.`}
              </Notice>
            </>
          )}
          <Field label="Mã giao dịch *">
            <input
              name="reference"
              required
              minLength={3}
              maxLength={200}
              disabled={command.isPending}
            />
          </Field>
          <Field
            label="Thời điểm thực nhận (giờ Việt Nam) *"
            hint="Điền sẵn thời điểm mở biểu mẫu. Điều chỉnh theo thời điểm nhận tiền thực tế."
          >
            <input
              name="time"
              type="datetime-local"
              step={0.001}
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
              required
              min={
                effectiveKind === 'remittance' && allocations.length
                  ? vietnamDateInput(
                      new Date(
                        Math.max(
                          ...allocations.map((row) =>
                            new Date(row.receivedAt).getTime(),
                          ),
                        ),
                      ).toISOString(),
                    )
                  : order.deliveredAt
                    ? vietnamDateInput(order.deliveredAt)
                    : undefined
              }
              max={vietnamDateInput()}
              disabled={command.isPending}
            />
          </Field>
          <label className="c-check">
            <input type="checkbox" required disabled={command.isPending} />
            Đã xác minh bằng chứng nhận tiền thực tế
          </label>
          <ErrorNotice error={command.error} />
          {command.isSuccess && (
            <Notice tone="green">
              Đã ghi nhận khoản thu và cập nhật số dư.
            </Notice>
          )}
          <Action
            type="submit"
            pending={command.isPending}
            disabled={effectiveKind === 'remittance' && !validAllocations}
          >
            <Truck size={16} />
            Xác nhận khoản thu
          </Action>
        </form>
      ) : (
        <Notice>
          Chưa có thao tác thu hộ khả dụng. Chỉ ghi nhận COD sau khi đơn hàng đã
          được xác nhận giao thành công.
        </Notice>
      )}
      <CodCollectionWork key={`${order.id}-${order.revision}`} order={order} />
    </div>
  )
}
