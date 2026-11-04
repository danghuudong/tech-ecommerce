import { Link, useParams } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  LoaderCircle,
  MapPin,
  Minus,
  Package,
  Phone,
  Plus,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  downloadOrderUndoDocument,
  errorMessage,
  useActor,
  useCommand,
  useSession,
} from './api'
import type {
  OrderDetail,
  OrderItem,
  OrderStatus,
  PriceLine,
  Recipient,
  Role,
} from './types'
import './commerce.css'

export const formatMoney = (amount: number | null | undefined) =>
  amount == null
    ? 'Chưa xác minh'
    : `${new Intl.NumberFormat('vi-VN').format(amount)}đ`

export function formatDate(value: string | null | undefined, withTime = true) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    ...(withTime ? { timeStyle: 'medium' as const } : {}),
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
}

export const shortId = (id: string) => id.slice(0, 8).toUpperCase()
export const addressText = (recipient: Recipient) =>
  [
    recipient.addressLine,
    recipient.ward,
    recipient.district,
    recipient.province,
  ]
    .filter(Boolean)
    .join(', ')

export const orderLabels: Record<OrderStatus, string> = {
  placed: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  packing: 'Đang đóng gói',
  shipped: 'Đang vận chuyển',
  delivered: 'Đã giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
}

const labels: Record<string, string> = {
  ...orderLabels,
  unpaid: 'Chưa thanh toán',
  paid: 'Đã thanh toán',
  partially_paid: 'Thanh toán một phần',
  not_due: 'Không cần thu',
  refunded: 'Đã hoàn tiền',
  partially_refunded: 'Đã hoàn một phần',
  overpaid: 'Thanh toán dư',
  needs_reconciliation: 'Cần đối soát',
  needs_allocation_review: 'Cần kiểm tra phân bổ tiền',
  needs_review: 'Cần xem xét',
  awaiting_delivery: 'Chờ giao hàng',
  awaiting_collection: 'Chờ thu tiền',
  debt: 'Đã ghi nhận công nợ',
  written_off: 'Đã ghi nhận tổn thất khoản thu',
  awaiting_late_payment_approval: 'Chờ duyệt tiền vào trễ',
  settled_after_return: 'Đã tất toán sau trả hàng',
  payment_debt: 'Công nợ thanh toán',
  payment_written_off: 'Đã xử lý khoản thiếu',
  refund_debt: 'Công nợ hoàn tiền',
  refund_written_off: 'Đã xử lý chênh lệch hoàn',
  requested: 'Chờ duyệt',
  approved: 'Đã duyệt · Chờ nhận hàng',
  receiving: 'Đang nhận hàng',
  received: 'Đã nhận hàng',
  rejected: 'Đã từ chối',
  withdrawn: 'Đã rút yêu cầu',
  closed: 'Đã đóng',
  awaiting_payment: 'Chờ xác minh thanh toán',
  pending: 'Chờ hoàn tiền',
  processing: 'Đang xử lý',
  unknown: 'Kết quả chưa rõ',
  failed: 'Đã xác minh chưa chuyển',
  settled: 'Đã hoàn tiền',
  partially_settled: 'Đã hoàn một phần',
  voided: 'Đã hủy nghĩa vụ',
  in_transit: 'Đang vận chuyển',
  ready_to_ship: 'Đã chốt vận đơn, chờ bàn giao',
  delivery_failed: 'Giao không thành công',
  returned: 'Đã nhận hàng hoàn',
}

export function Badge({
  status,
  children,
  tone,
}: {
  status?: string
  children?: ReactNode
  tone?: string
}) {
  const color =
    tone ??
    ([
      'paid',
      'completed',
      'delivered',
      'settled',
      'received',
      'settled_after_return',
    ].includes(status ?? '')
      ? 'green'
      : ['packing', 'shipped', 'in_transit'].includes(status ?? '')
        ? 'blue'
        : [
              'cancelled',
              'rejected',
              'needs_review',
              'delivery_failed',
              'needs_reconciliation',
            ].includes(status ?? '')
          ? 'red'
          : 'amber')
  return (
    <span className={`c-badge c-badge--${color}`}>
      {children ?? labels[status ?? ''] ?? status}
    </span>
  )
}

export function PaymentStatusBadge({
  status,
  orderStatus,
  completedOverpaymentRefundVnd,
}: {
  status: string
  orderStatus: OrderStatus
  completedOverpaymentRefundVnd: number | null
}) {
  const cancelledPaymentLabels: Record<string, string> = {
    overpaid: 'Chờ hoàn tiền',
    partially_refunded: 'Chờ hoàn phần còn lại',
  }
  const cancelledLabel =
    orderStatus === 'cancelled' ? cancelledPaymentLabels[status] : undefined
  return (
    <span className="c-payment-status">
      <Badge status={status}>{cancelledLabel}</Badge>
      {status === 'paid' &&
        completedOverpaymentRefundVnd != null &&
        completedOverpaymentRefundVnd > 0 && (
          <small className="c-payment-status__note">
            Đã hoàn đủ tiền dư: {formatMoney(completedOverpaymentRefundVnd)}
          </small>
        )}
    </span>
  )
}

export function Action({
  children,
  pending,
  variant = 'primary',
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || pending}
      className={`c-button c-button--${variant} ${className}`}
    >
      {pending && (
        <LoaderCircle size={16} className="c-spin" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

export function SelectableTableRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <tr
      className={`c-selectable-row${selected ? ' is-selected' : ''}`}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          !(event.target instanceof Element) ||
          event.target.closest(
            'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable]',
          ) ||
          window.getSelection()?.isCollapsed === false
        )
          return
        onSelect()
      }}
    >
      {children}
    </tr>
  )
}

export function Panel({
  title,
  icon,
  children,
  className = '',
  aside,
}: {
  title?: ReactNode
  icon?: ReactNode
  children: ReactNode
  className?: string
  aside?: ReactNode
}) {
  return (
    <section className={`c-panel ${className}`}>
      {title && (
        <div className="c-panel__heading">
          <h2>
            {icon}
            {title}
          </h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({
  label,
  children,
  hint,
  error,
  wide,
}: {
  label: string
  children: ReactNode
  hint?: string
  error?: string
  wide?: boolean
}) {
  const id = useId()
  const descriptionId = `${id}-description`
  return (
    <div className={`c-field${wide ? ' c-field--wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child) =>
        isValidElement<{ id?: string; 'aria-describedby'?: string }>(child) &&
        typeof child.type === 'string' &&
        ['input', 'textarea', 'select'].includes(child.type)
          ? cloneElement(child, {
              id,
              'aria-describedby':
                error || hint ? descriptionId : child.props['aria-describedby'],
            })
          : child,
      )}
      {error ? (
        <small id={descriptionId} className="c-error-text" role="alert">
          {error}
        </small>
      ) : (
        hint && <small id={descriptionId}>{hint}</small>
      )}
    </div>
  )
}

export function Notice({
  children,
  tone = 'blue',
}: {
  children: ReactNode
  tone?: 'blue' | 'amber' | 'red' | 'green'
}) {
  return (
    <div className={`c-notice c-notice--${tone}`}>
      <AlertCircle size={19} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div role="alert">
      <Notice tone="red">{errorMessage(error)}</Notice>
    </div>
  ) : null
}

export function Loading({ text = 'Đang tải dữ liệu…' }: { text?: string }) {
  return (
    <div className="c-loading" role="status">
      <LoaderCircle className="c-spin" size={26} />
      <span>{text}</span>
    </div>
  )
}

export function Empty({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="c-empty">
      <span className="c-empty__icon">
        <ShoppingBag size={34} />
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}

export function QueryError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => unknown
}) {
  return (
    <Panel>
      <ErrorNotice error={error} />
      <div className="c-actions">
        {retry && (
          <Action variant="secondary" onClick={retry}>
            <RefreshCw size={16} />
            Thử lại
          </Action>
        )}
        <Link
          className="c-text-link"
          to={
            window.location.pathname.startsWith('/staff/')
              ? '/admin/login'
              : '/login'
          }
          search={{
            redirect: window.location.pathname + window.location.search,
          }}
        >
          Đăng nhập lại
        </Link>
      </div>
    </Panel>
  )
}

export function AccessGate({
  children,
  staff = false,
  roles = ['staff', 'accountant', 'admin'],
}: {
  children: ReactNode
  staff?: boolean
  roles?: readonly Role[]
}) {
  const scope = staff ? 'admin' : 'customer'
  const session = useSession(scope)
  const actor = useActor(scope)
  if (session.isPending) return <Loading />
  if (session.isError)
    return <QueryError error={session.error} retry={() => session.refetch()} />
  if (!session.data)
    return (
      <Empty
        title={staff ? 'Đăng nhập khu vực quản trị' : 'Đăng nhập để tiếp tục'}
        description={
          staff
            ? 'Sử dụng tài khoản nhân viên, kế toán hoặc quản trị viên đã được cấp quyền.'
            : 'Quản lý giỏ hàng, đặt hàng và theo dõi đơn hàng của bạn.'
        }
      >
        <Link
          className="c-button c-button--primary"
          to={staff ? '/admin/login' : '/login'}
          search={{
            redirect: window.location.pathname + window.location.search,
          }}
        >
          {staff ? 'Đăng nhập quản trị' : 'Đăng nhập / Đăng ký'}
        </Link>
      </Empty>
    )
  if (staff && actor.isPending) return <Loading />
  if (staff && actor.isError)
    return <QueryError error={actor.error} retry={() => actor.refetch()} />
  if (staff && (!actor.data || !roles.includes(actor.data.role)))
    return (
      <Empty
        title="Bạn chưa có quyền truy cập mục này"
        description="Vui lòng sử dụng mục công việc tương ứng với vai trò được cấp."
      >
        <Link to="/staff/orders" className="c-button c-button--secondary">
          Danh sách đơn hàng
        </Link>
        <Link
          to="/admin/login"
          search={{
            redirect: window.location.pathname + window.location.search,
          }}
          className="c-button c-button--primary"
        >
          Đăng nhập tài khoản khác
        </Link>
      </Empty>
    )
  return children
}

export function ProductThumb({
  name,
  sku = '',
}: {
  name: string
  sku?: string
}) {
  const text = `${name} ${sku}`.toLowerCase()
  const kind = /laptop|vivobook|macbook|thinkpad/.test(text)
    ? 'laptop'
    : /chuột|mouse|g304/.test(text)
      ? 'mouse'
      : /tai nghe|headphone|headset/.test(text)
        ? 'headphones'
        : /bàn phím|keyboard/.test(text)
          ? 'keyboard'
          : /màn hình|monitor/.test(text)
            ? 'monitor'
            : /điện thoại|iphone|phone/.test(text)
              ? 'phone'
              : null
  return (
    <span className="c-thumb" aria-hidden="true">
      {kind ? (
        <span className={`product-art product-art--${kind}`} />
      ) : (
        <Package size={32} />
      )}
    </span>
  )
}

export function Quantity({
  value,
  max = 99,
  min = 1,
  disabled,
  onChange,
  label,
}: {
  value: number
  max?: number
  min?: number
  disabled?: boolean
  onChange: (value: number) => void
  label: string
}) {
  return (
    <fieldset className="c-quantity" aria-label={label}>
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label={`Giảm ${label}`}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={13} />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        disabled={disabled || value >= max}
        aria-label={`Tăng ${label}`}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={13} />
      </button>
    </fieldset>
  )
}

export function PriceSummary({
  subtotal,
  shipping,
  total,
  children,
}: {
  subtotal: number
  shipping?: number
  total?: number
  children?: ReactNode
}) {
  return (
    <div className="c-price-summary">
      <dl>
        <div>
          <dt>Tạm tính</dt>
          <dd>{formatMoney(subtotal)}</dd>
        </div>
        <div>
          <dt>Phí giao hàng</dt>
          <dd className={shipping === 0 ? 'c-green' : ''}>
            {shipping == null
              ? 'Tính khi đặt hàng'
              : shipping === 0
                ? 'Miễn phí'
                : formatMoney(shipping)}
          </dd>
        </div>
        <div className="c-price-summary__total">
          <dt>Tổng cộng</dt>
          <dd>{formatMoney(total ?? subtotal)}</dd>
        </div>
      </dl>
      <p className="c-tax-note">Đã bao gồm thuế</p>
      {children}
    </div>
  )
}

export function CompactLines({ lines }: { lines: (PriceLine | OrderItem)[] }) {
  return (
    <div className="c-compact-lines">
      {lines.map((line) => {
        const name = 'nameSnapshot' in line ? line.nameSnapshot : line.name
        const sku = 'skuSnapshot' in line ? line.skuSnapshot : line.sku
        return (
          <div className="c-compact-line" key={line.productId}>
            <ProductThumb name={name} sku={sku} />
            <div>
              <strong>{name}</strong>
              <small>
                {sku} · Số lượng: {line.quantity}
              </small>
            </div>
            <b>{formatMoney(line.lineTotalVnd)}</b>
          </div>
        )
      })}
    </div>
  )
}

export function RecipientCard({ recipient }: { recipient: Recipient }) {
  return (
    <div className="c-recipient">
      <strong>{recipient.name}</strong>
      <p>
        <Phone size={16} />
        {recipient.phone}
      </p>
      <p>
        <MapPin size={17} />
        {addressText(recipient)}
      </p>
    </div>
  )
}

export function CheckoutSteps({ active }: { active: number }) {
  return (
    <ol className="c-checkout-steps" aria-label="Tiến trình đặt hàng">
      {['Giỏ hàng', 'Thông tin giao hàng', 'Đặt hàng'].map((step, index) => (
        <li
          key={step}
          className={index <= active ? 'is-active' : ''}
          aria-current={index === active ? 'step' : undefined}
        >
          <span>{index < active ? <Check size={16} /> : index + 1}</span>
          <small>{step}</small>
        </li>
      ))}
    </ol>
  )
}

const eventLabels: Record<string, string> = {
  order_placed: 'Đặt hàng',
  order_assigned: 'Phân công xử lý',
  order_confirmed: 'Đã xác nhận',
  order_packing: 'Bắt đầu đóng gói',
  shipment_handed_over: 'Đã bàn giao vận chuyển',
  waybill_confirmed: 'Đã lưu vận đơn chốt với hãng',
  waybill_corrected: 'Đã sửa vận đơn trước bàn giao',
  waybill_verified: 'Đã lưu đối chiếu vận đơn',
  carrier_recipient_change_recorded:
    'Đã ghi nhận kết quả đổi người nhận từ hãng',
  shipment_carrier_identified: 'Đã xác minh đơn vị vận chuyển',
  shipment_carrier_corrected: 'Đã hiệu chỉnh đơn vị vận chuyển',
  cod_carrier_corrected:
    'Đã hiệu chỉnh đơn vị vận chuyển trên chứng từ COD liên quan',
  carrier_responsibility_corrected:
    'Đã hiệu chỉnh bên chịu trách nhiệm công nợ',
  cod_collection_adjusted: 'Đã hiệu chỉnh chứng từ COD và phân bổ tiền',
  cod_collection_failed: 'Thu COD không thành công',
  cod_collection_failures_corrected:
    'Đã hiệu chỉnh lần thu COD thất bại do ghi nhầm giao hàng',
  order_delivered: 'Giao hàng thành công',
  shipment_delivered: 'Giao hàng thành công',
  order_completed: 'Hoàn thành đơn hàng',
  order_step_undone: 'Đã quay lại bước trước để sửa thao tác',
  recipient_changed: 'Cập nhật người nhận',
  order_cancelled: 'Đã hủy đơn',
  order_deleted: 'Đã xóa đơn khỏi danh sách quản lý',
  order_restored: 'Đã khôi phục đơn hàng',
  return_requested: 'Yêu cầu trả hàng',
  return_approved: 'Đã duyệt trả hàng',
  return_received: 'Đã nhận hàng trả',
  return_receipt_recorded: 'Ghi nhận hàng trả',
  return_closed: 'Đóng yêu cầu trả hàng',
  return_rejected: 'Từ chối trả hàng',
  return_withdrawn: 'Rút yêu cầu trả hàng',
  payment_recorded: 'Ghi nhận thanh toán',
  payment_receipt_recorded: 'Ghi nhận khoản tiền nhận',
  payment_received: 'Đã xác minh khoản tiền khách trả',
  bank_transfer_reported: 'Khách báo đã chuyển khoản',
  bank_transfer_demo_completed: 'Chuyển khoản thành công',
  bank_transfer_report_reviewed: 'Đã đối chiếu thông báo chuyển khoản',
  refund_required: 'Phát sinh khoản cần hoàn',
  bank_deadline_reconciled: 'Đối soát hạn thanh toán',
  delivery_failed: 'Giao hàng không thành công',
  delivery_retried: 'Giao lại',
  delivery_retry_started: 'Giao lại',
  delivery_retry_requested: 'Đã ghi nhận yêu cầu giao lại',
  undelivered_shipment_received: 'Đã nhận hàng hoàn từ đơn vị vận chuyển',
  customer_paid_carrier: 'Khách đã thanh toán cho đơn vị vận chuyển',
  carrier_remittance_reverted: 'Đã hoàn tác ghi nhận hãng nộp tiền',
  cod_collection_resolved: 'Ghi nhận phương án xử lý khoản thu COD',
  refund_attempt_started: 'Bắt đầu xử lý hoàn tiền',
  refund_outcome_recorded: 'Ghi nhận kết quả hoàn tiền',
}

const HISTORY_PREVIEW_LIMIT = 5
const HISTORY_PAGE_SIZE = 20

export function OrderHistory({ order }: { order: OrderDetail }) {
  return <OrderHistoryPanel key={order.id} order={order} />
}

function OrderHistoryPanel({ order }: { order: OrderDetail }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const events = useMemo(
    () =>
      [...order.history]
        .reverse()
        .sort(
          (first, second) =>
            Date.parse(second.createdAt) - Date.parse(first.createdAt),
        ),
    [order.history],
  )
  return (
    <>
      <Panel title="Lịch sử hoạt động" icon={<Clock3 size={19} />}>
        {events.length ? (
          <OrderEventList
            orderId={order.id}
            events={events.slice(0, HISTORY_PREVIEW_LIMIT)}
            collapsibleDetails
          />
        ) : (
          <p>Chưa có hoạt động được ghi nhận.</p>
        )}
        {events.length > 0 && (
          <div className="c-history-footer">
            <Action variant="secondary" onClick={() => setHistoryOpen(true)}>
              Xem toàn bộ lịch sử ({events.length} hoạt động)
            </Action>
          </div>
        )}
      </Panel>
      {historyOpen && (
        <OrderHistoryDrawer
          key={order.id}
          orderId={order.id}
          events={events}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  )
}

function OrderHistoryDrawer({
  orderId,
  events,
  onClose,
}: {
  orderId: string
  events: OrderDetail['history']
  onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const listRef = useRef<HTMLElement>(null)
  const lastOffset =
    Math.max(0, Math.ceil(events.length / HISTORY_PAGE_SIZE) - 1) *
    HISTORY_PAGE_SIZE
  const pageOffset = Math.min(offset, lastOffset)
  const page = events.slice(pageOffset, pageOffset + HISTORY_PAGE_SIZE)
  return (
    <Drawer title="Toàn bộ lịch sử hoạt động" onClose={onClose} wide>
      <div className="c-history-browser">
        <p role="status">
          {page.length
            ? `Hoạt động ${pageOffset + 1}–${pageOffset + page.length} trong ${events.length}. Mới nhất ở trên.`
            : 'Chưa có hoạt động được ghi nhận.'}
        </p>
        <section
          ref={listRef}
          className="c-history-browser__list"
          aria-label="Danh sách lịch sử hoạt động"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable history region needs focus for keyboard scrolling.
          tabIndex={0}
        >
          <OrderEventList
            key={pageOffset}
            orderId={orderId}
            events={page}
            collapsibleDetails
          />
        </section>
        <Pagination
          offset={pageOffset}
          limit={HISTORY_PAGE_SIZE}
          total={events.length}
          count={page.length}
          onChange={(nextOffset) => {
            setOffset(nextOffset)
            if (listRef.current) listRef.current.scrollTop = 0
          }}
        />
      </div>
    </Drawer>
  )
}

function OrderEventDetails({
  collapsible,
  children,
}: {
  collapsible: boolean
  children: ReactNode
}) {
  if (!collapsible) return <>{children}</>
  return (
    <details className="c-history-details">
      <summary>Chi tiết</summary>
      <div className="c-history-details__content">{children}</div>
    </details>
  )
}

export function OrderEventList({
  orderId,
  events,
  collapsibleDetails = false,
}: {
  orderId: string
  events: OrderDetail['history']
  collapsibleDetails?: boolean
}) {
  return (
    <ol
      className={`c-timeline${collapsibleDetails ? ' c-timeline--compact' : ''}`}
    >
      {events.map((event) => (
        <li key={event.id}>
          <CircleCheck size={15} />
          <div>
            <small>
              {event.type === 'shipment_delivered' && 'Ghi nhận lúc: '}
              {formatDate(event.createdAt)}
            </small>
            <strong>{eventLabels[event.type] ?? 'Cập nhật đơn hàng'}</strong>
            {collapsibleDetails && event.actorName && (
              <small>Bởi {event.actorName}</small>
            )}
            <OrderEventDetails collapsible={collapsibleDetails}>
              {[
                'bank_transfer_reported',
                'bank_transfer_demo_completed',
                'payment_received',
                'refund_required',
              ].includes(event.type) && (
                <>
                  {typeof event.details?.amountVnd === 'number' && (
                    <small>
                      {event.type === 'bank_transfer_reported'
                        ? 'Số tiền khách khai báo'
                        : event.type === 'refund_required'
                          ? 'Số tiền cần hoàn'
                          : 'Số tiền thực nhận phân bổ'}
                      : {formatMoney(event.details.amountVnd)}
                    </small>
                  )}
                  {typeof event.details?.reference === 'string' && (
                    <small>
                      Mã giao dịch / nội dung: {event.details.reference}
                    </small>
                  )}
                  {typeof event.details?.transferredAt === 'string' && (
                    <small>
                      Khách chuyển lúc:{' '}
                      {formatDate(event.details.transferredAt)}
                    </small>
                  )}
                  {typeof event.details?.receivedAt === 'string' && (
                    <small>
                      Tiền vào lúc: {formatDate(event.details.receivedAt)}
                    </small>
                  )}
                  {typeof event.details?.evidenceReference === 'string' && (
                    <small>
                      Tham chiếu bằng chứng: {event.details.evidenceReference}
                    </small>
                  )}
                  {typeof event.details?.note === 'string' && (
                    <small>Ghi chú: {event.details.note}</small>
                  )}
                </>
              )}
              {event.type === 'bank_transfer_report_reviewed' && (
                <BankTransferReviewHistory details={event.details} />
              )}
              {event.type === 'carrier_remittance_reverted' && (
                <>
                  {typeof event.details?.reference === 'string' && (
                    <small>Mã giao dịch: {event.details.reference}</small>
                  )}
                  {typeof event.details?.amountVnd === 'number' && (
                    <small>
                      Số tiền đã hoàn tác:{' '}
                      {formatMoney(event.details.amountVnd)}
                    </small>
                  )}
                  {typeof event.details?.reason === 'string' && (
                    <small>Lý do: {event.details.reason}</small>
                  )}
                </>
              )}
              {event.type === 'order_assigned' && (
                <>
                  <small>
                    {event.details?.source === 'automatic'
                      ? 'Hệ thống tự phân công'
                      : 'Phân công thủ công'}
                  </small>
                  {typeof event.details?.assignedToName === 'string' && (
                    <small>
                      Người phụ trách: {event.details.assignedToName}
                    </small>
                  )}
                  {typeof event.details?.previousAssigneeName === 'string' && (
                    <small>
                      Bàn giao từ: {event.details.previousAssigneeName}
                    </small>
                  )}
                  {typeof event.details?.reason === 'string' && (
                    <small>Lý do: {event.details.reason}</small>
                  )}
                </>
              )}
              {event.type === 'order_step_undone' && (
                <OrderUndoHistory orderId={orderId} details={event.details} />
              )}
              {event.type === 'cod_collection_failed' && (
                <>
                  <small>
                    {event.details?.party === 'carrier'
                      ? 'Thu từ đơn vị vận chuyển'
                      : 'Thu từ khách hàng'}
                    {typeof event.details?.failureCount === 'number' &&
                      ` · Lần ${event.details.failureCount}`}
                  </small>
                  {typeof event.details?.reason === 'string' && (
                    <small>Lý do: {event.details.reason}</small>
                  )}
                </>
              )}
              {event.type === 'cod_collection_failures_corrected' && (
                <CollectionFailureCorrectionHistory
                  orderId={orderId}
                  details={event.details}
                />
              )}
              {[
                'shipment_handed_over',
                'waybill_confirmed',
                'waybill_corrected',
                'waybill_verified',
                'carrier_recipient_change_recorded',
                'delivery_retry_requested',
              ].includes(event.type) &&
                typeof event.details?.trackingReference === 'string' && (
                  <small>Mã vận đơn: {event.details.trackingReference}</small>
                )}
              {[
                'waybill_confirmed',
                'waybill_corrected',
                'waybill_verified',
              ].includes(event.type) && (
                <>
                  {event.actorName && (
                    <small>Người xác nhận: {event.actorName}</small>
                  )}
                  {event.details?.recipientVerified === true && (
                    <small>Đã đối chiếu người nhận</small>
                  )}
                  {event.details?.paymentVerified === true && (
                    <small>Đã đối chiếu thanh toán/COD</small>
                  )}
                  {event.type === 'waybill_corrected' && (
                    <>
                      {typeof event.details?.previousTrackingReference ===
                        'string' && (
                        <small>
                          Mã vận đơn cũ:{' '}
                          {event.details.previousTrackingReference}
                        </small>
                      )}
                      {typeof event.details?.carrierName === 'string' && (
                        <small>
                          Hãng vận chuyển:{' '}
                          {typeof event.details.previousCarrierName === 'string'
                            ? event.details.previousCarrierName
                            : 'Chưa xác định'}
                          {' → '}
                          {event.details.carrierName}
                        </small>
                      )}
                      {typeof event.details?.reason === 'string' && (
                        <small>Lý do sửa: {event.details.reason}</small>
                      )}
                    </>
                  )}
                </>
              )}
              {event.type === 'carrier_recipient_change_recorded' && (
                <>
                  <small>
                    {event.details?.outcome === 'accepted'
                      ? 'Hãng đã chấp thuận và người nhận đã được cập nhật.'
                      : 'Hãng từ chối; thông tin người nhận giữ nguyên.'}
                  </small>
                  {typeof event.details?.reference === 'string' && (
                    <small>
                      Tham chiếu phản hồi: {event.details.reference}
                    </small>
                  )}
                  {typeof event.details?.confirmedAt === 'string' && (
                    <small>
                      Hãng phản hồi lúc: {formatDate(event.details.confirmedAt)}
                    </small>
                  )}
                  {typeof event.details?.reason === 'string' && (
                    <small>Nội dung: {event.details.reason}</small>
                  )}
                </>
              )}
              {event.type === 'shipment_delivered' && (
                <>
                  {typeof event.details?.deliveredAt === 'string' && (
                    <small>
                      Giao lúc: {formatDate(event.details.deliveredAt)}
                    </small>
                  )}
                  {typeof event.details?.proofReference === 'string' && (
                    <small>Xác nhận giao: {event.details.proofReference}</small>
                  )}
                </>
              )}
              {event.type === 'delivery_retry_requested' && (
                <>
                  {typeof event.details?.retryNumber === 'number' && (
                    <small>Lần giao lại: {event.details.retryNumber}</small>
                  )}
                  {typeof event.details?.reason === 'string' && (
                    <small>Lý do yêu cầu: {event.details.reason}</small>
                  )}
                  {typeof event.details?.reference === 'string' && (
                    <small>Tham chiếu yêu cầu: {event.details.reference}</small>
                  )}
                  {typeof event.details?.previousFailureReason === 'string' && (
                    <small>
                      Lý do giao thất bại trước đó:{' '}
                      {event.details.previousFailureReason}
                    </small>
                  )}
                </>
              )}
              {event.type === 'delivery_failed' &&
                typeof event.details?.failedAttempts === 'number' && (
                  <small>
                    Lần giao thất bại: {event.details.failedAttempts}
                  </small>
                )}
              {[
                'delivery_failed',
                'order_cancelled',
                'undelivered_shipment_received',
              ].includes(event.type) &&
                typeof event.details?.reason === 'string' && (
                  <small>Lý do: {event.details.reason}</small>
                )}
              {['order_deleted', 'order_restored'].includes(event.type) &&
                typeof event.details?.reason === 'string' && (
                  <small>Lý do: {event.details.reason}</small>
                )}
              {[
                'shipment_carrier_identified',
                'shipment_carrier_corrected',
                'cod_carrier_corrected',
              ].includes(event.type) && (
                <ShipmentCarrierHistory details={event.details} />
              )}
              {event.type === 'carrier_responsibility_corrected' &&
                typeof event.details?.responsibleParty === 'string' && (
                  <>
                    <small>
                      {String(event.details.previousResponsibleParty)} →{' '}
                      {event.details.responsibleParty}
                    </small>
                    <small>
                      Quyết định {String(event.details.reference)} thay{' '}
                      {String(event.details.previousReference)}
                    </small>
                    <small>
                      Hồ sơ: {String(event.details.evidenceReference)} ·{' '}
                      {String(event.details.reason)}
                    </small>
                  </>
                )}
              {event.type === 'cod_collection_adjusted' &&
                typeof event.details?.evidenceReference === 'string' && (
                  <>
                    {Boolean(event.details.crossCarrierMerge) && (
                      <small>
                        Đã xác minh, gộp chứng từ trùng giữa các đơn vị vận
                        chuyển và đối soát phân bổ.
                      </small>
                    )}
                    <small>Hồ sơ: {event.details.evidenceReference}</small>
                    {typeof event.details.reason === 'string' && (
                      <small>{event.details.reason}</small>
                    )}
                  </>
                )}
            </OrderEventDetails>
            {!collapsibleDetails && event.actorName && (
              <small>Bởi {event.actorName}</small>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function CollectionFailureCorrectionHistory({
  orderId,
  details,
}: {
  orderId: string
  details: Record<string, unknown> | undefined
}) {
  const before =
    details?.before &&
    typeof details.before === 'object' &&
    !Array.isArray(details.before)
      ? (details.before as Record<string, unknown>)
      : null
  const after =
    details?.after &&
    typeof details.after === 'object' &&
    !Array.isArray(details.after)
      ? (details.after as Record<string, unknown>)
      : null
  return (
    <>
      {typeof before?.customerFailureCount === 'number' &&
        typeof after?.customerFailureCount === 'number' && (
          <small>
            Bộ đếm thu từ khách: {before.customerFailureCount} →{' '}
            {after.customerFailureCount}
          </small>
        )}
      {typeof before?.customerIssueReason === 'string' && (
        <small>Lý do thu từ khách đã ghi: {before.customerIssueReason}</small>
      )}
      {typeof before?.carrierFailureCount === 'number' &&
        typeof after?.carrierFailureCount === 'number' && (
          <small>
            Bộ đếm thu từ đơn vị vận chuyển: {before.carrierFailureCount} →{' '}
            {after.carrierFailureCount}
          </small>
        )}
      {typeof before?.carrierIssueReason === 'string' && (
        <small>
          Lý do thu từ đơn vị vận chuyển đã ghi: {before.carrierIssueReason}
        </small>
      )}
      {typeof details?.reason === 'string' && (
        <small>Lý do hiệu chỉnh: {details.reason}</small>
      )}
      <OrderUndoDocumentHistory orderId={orderId} details={details} />
    </>
  )
}

function BankTransferReviewHistory({
  details,
}: {
  details: Record<string, unknown> | undefined
}) {
  const value = details?.review
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const review = value as Record<string, unknown>
  return (
    <>
      <small>
        {review.outcome === 'recorded'
          ? 'Đã đối chiếu với khoản thực nhận của đơn'
          : 'Chưa tìm thấy khoản chuyển trên sao kê'}
      </small>
      {typeof review.statementCheckedThrough === 'string' && (
        <small>
          Đã kiểm tra đến: {formatDate(review.statementCheckedThrough)}
        </small>
      )}
      {typeof review.reason === 'string' && (
        <small>Kết luận: {review.reason}</small>
      )}
      {typeof review.evidenceReference === 'string' && (
        <small>Bằng chứng: {review.evidenceReference}</small>
      )}
    </>
  )
}

function OrderUndoHistory({
  orderId,
  details,
}: {
  orderId: string
  details: Record<string, unknown> | undefined
}) {
  const shipment =
    details?.previousShipment &&
    typeof details.previousShipment === 'object' &&
    !Array.isArray(details.previousShipment)
      ? (details.previousShipment as Record<string, unknown>)
      : null
  const renewal =
    details?.confirmationRenewal &&
    typeof details.confirmationRenewal === 'object' &&
    !Array.isArray(details.confirmationRenewal)
      ? (details.confirmationRenewal as Record<string, unknown>)
      : null
  return (
    <>
      {typeof details?.previousStatus === 'string' &&
        typeof details.nextStatus === 'string' && (
          <small>
            {orderLabels[details.previousStatus as OrderStatus]} →{' '}
            {orderLabels[details.nextStatus as OrderStatus]}
          </small>
        )}
      {typeof details?.reason === 'string' && (
        <small>Lý do: {details.reason}</small>
      )}
      <OrderUndoDocumentHistory orderId={orderId} details={details} />
      {typeof renewal?.previousExpiresAt === 'string' &&
        typeof renewal.expiresAt === 'string' && (
          <small>
            Admin duyệt gia hạn xác nhận COD:{' '}
            {formatDate(renewal.previousExpiresAt)} →{' '}
            {formatDate(renewal.expiresAt)}.
          </small>
        )}
      {renewal &&
        typeof details?.originalConfirmationExpiresAt === 'string' && (
          <small>
            Hạn xác nhận ban đầu:{' '}
            {formatDate(details.originalConfirmationExpiresAt)}.
          </small>
        )}
      {typeof shipment?.trackingReference === 'string' && (
        <small>Vận đơn trước khi sửa: {shipment.trackingReference}</small>
      )}
      {typeof shipment?.proofReference === 'string' && (
        <small>
          Bằng chứng đã ghi trước khi sửa: {shipment.proofReference}
        </small>
      )}
      {typeof details?.previousDeliveredAt === 'string' && (
        <small>
          Thời điểm giao đã ghi trước khi sửa:{' '}
          {formatDate(details.previousDeliveredAt)}
        </small>
      )}
    </>
  )
}

function OrderUndoDocumentHistory({
  orderId,
  details,
}: {
  orderId: string
  details: Record<string, unknown> | undefined
}) {
  const evidence =
    details?.evidenceDocument &&
    typeof details.evidenceDocument === 'object' &&
    !Array.isArray(details.evidenceDocument)
      ? (details.evidenceDocument as Record<string, unknown>)
      : null
  const download = useCommand(
    async ({ id, fileName }: { id: string; fileName: string }) => {
      const blob = await downloadOrderUndoDocument(orderId, id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return {}
    },
    [],
  )
  if (
    typeof evidence?.id === 'string' &&
    typeof evidence.fileName === 'string'
  ) {
    const id = evidence.id
    const fileName = evidence.fileName
    return (
      <div>
        <small>Tài liệu đã lưu; nội dung do quản trị viên xác minh.</small>
        <Action
          variant="ghost"
          pending={download.isPending}
          onClick={() => void download.run({ id, fileName })}
        >
          Tải tài liệu: {fileName}
        </Action>
        <ErrorNotice error={download.error} />
      </div>
    )
  }
  return typeof details?.evidenceReference === 'string' ? (
    <small>Tham chiếu cũ (chưa có tệp lưu): {details.evidenceReference}</small>
  ) : null
}

function ShipmentCarrierHistory({
  details,
}: {
  details: Record<string, unknown> | undefined
}) {
  if (typeof details?.carrierName !== 'string') return null
  const corrections = Array.isArray(details.collectionCorrections)
    ? details.collectionCorrections.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row),
      )
    : []
  return (
    <>
      <small>
        {typeof details.previousCarrierName === 'string'
          ? details.previousCarrierName
          : 'Chưa xác định'}
        {' → '}
        {details.carrierName}
      </small>
      {typeof details.evidenceReference === 'string' && (
        <small>Chứng từ: {details.evidenceReference}</small>
      )}
      {typeof details.reason === 'string' && (
        <small>Lý do: {details.reason}</small>
      )}
      {typeof details.codEvidenceReference === 'string' && (
        <small>Hồ sơ đối soát COD: {details.codEvidenceReference}</small>
      )}
      {corrections.map((row) =>
        typeof row.id === 'string' &&
        typeof row.reference === 'string' &&
        typeof row.previousCarrierName === 'string' &&
        typeof row.carrierName === 'string' ? (
          <small key={row.id}>
            Chứng từ {row.reference}: {row.previousCarrierName}
            {' → '}
            {row.carrierName}
          </small>
        ) : null,
      )}
    </>
  )
}

export function Drawer({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`commerce-app c-drawer${wide ? ' c-drawer--wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <div className="c-drawer__heading">
        <h2 id={titleId}>{title}</h2>
        <Action
          variant="ghost"
          disabled={busy}
          onClick={onClose}
          aria-label="Đóng"
        >
          <X size={21} />
        </Action>
      </div>
      <div className="c-drawer__body">{children}</div>
    </dialog>
  )
}

export function CopyValue({
  value,
  label,
  highlight = false,
}: {
  value: string
  label: string
  highlight?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timeout)
  }, [copied])
  return (
    <div className={`c-copy-row${highlight ? ' c-copy-row--highlight' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <Action
        variant="ghost"
        aria-label={`Sao chép ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setFailed(false)
          } catch {
            setFailed(true)
          }
        }}
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}
      </Action>
      {failed && (
        <small className="c-error-text">
          Vui lòng chọn và sao chép nội dung.
        </small>
      )}
    </div>
  )
}

export function Pagination({
  offset,
  limit,
  total,
  count,
  onChange,
  disabled = false,
}: {
  offset: number
  limit: number
  total?: number
  count: number
  onChange: (offset: number) => void
  disabled?: boolean
}) {
  return (
    <div className="c-pagination">
      <small>
        {count ? `${offset + 1}–${offset + count}` : '0'}
        {total == null ? ' kết quả' : ` trong ${total} kết quả`}
      </small>
      <div>
        <Action
          variant="secondary"
          aria-label="Trang trước"
          disabled={disabled || offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={16} />
        </Action>
        <span>{Math.floor(offset / limit) + 1}</span>
        <Action
          variant="secondary"
          aria-label="Trang sau"
          disabled={
            disabled ||
            (total == null ? count < limit : offset + limit >= total)
          }
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={16} />
        </Action>
      </div>
    </div>
  )
}

export function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="c-page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function BackToShop() {
  return (
    <Link to="/products" className="c-text-link">
      <ArrowLeft size={16} />
      Tiếp tục mua sắm
    </Link>
  )
}

export function useOrderId() {
  return useParams({ strict: false }).orderId ?? ''
}
