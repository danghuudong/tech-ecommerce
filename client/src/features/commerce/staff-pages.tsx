import { Link, useLocation, useSearch } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Truck,
  UserRound,
  Wallet,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { z } from 'zod'
import {
  orderDeletionMessages,
  orderQueryPaths,
  useActor,
  useCommand,
  useCommerceQuery,
  useOrder,
  write,
} from './api'
import { CarrierPicker } from './carrier-picker'
import {
  AccessGate,
  Action,
  Badge,
  CompactLines,
  CopyValue,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  formatMoney,
  Loading,
  Notice,
  OrderHistory,
  orderLabels,
  PageHeading,
  Pagination,
  Panel,
  PriceSummary,
  ProductThumb,
  QueryError,
  RecipientCard,
  shortId,
  useOrderId,
} from './components'
import { inputToIso, serverClockNow, vietnamDateInput } from './date-time'
import { StaffLayout } from './layouts'
import { OrderAssignmentOverview } from './order-assignment-settings'
import { OrderDeletionButton } from './order-deletion'
import { AddressDrawer, ReasonDrawer } from './order-pages'
import { OrderProgress } from './order-progress'
import { OrderUndoControl } from './order-undo'
import { canManagePayments } from './roles'
import { ShipmentCarrierForm } from './shipment-carrier-form'
import type { OrderDetail, OrderPage, Page, StaffOrderSettings } from './types'

export function Stat({
  label,
  value,
  icon,
  onClick,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  onClick?: () => void
}) {
  const content = (
    <>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <b>{value ?? '—'}</b>
      </div>
    </>
  )
  return onClick ? (
    <button className="c-stat" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="c-stat">{content}</div>
  )
}

export function StaffOrdersPage() {
  return (
    <StaffLayout>
      <AccessGate staff>
        <StaffOrdersContent />
      </AccessGate>
    </StaffLayout>
  )
}

function StaffOrdersContent() {
  const location = useLocation()
  const search = useSearch({ strict: false })
  const initialQ = 'q' in search && typeof search.q === 'string' ? search.q : ''
  const fulfillment = location.pathname === '/staff/fulfillment'
  const [tab, setTab] = useState('all')
  const [status, setStatus] = useState(fulfillment ? 'packing' : '')
  const [method, setMethod] = useState('')
  const [date, setDate] = useState('')
  const [text, setText] = useState(initialQ)
  const [q, setQ] = useState(initialQ)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const actor = useActor()
  useEffect(() => {
    setQ(initialQ)
    setText(initialQ)
    setOffset(0)
  }, [initialQ])
  useEffect(() => {
    setStatus(fulfillment ? 'packing' : '')
    setOffset(0)
  }, [fulfillment])
  const orders = useCommerceQuery<OrderPage>(
    'staff/orders',
    {
      limit: 10,
      offset,
      q: q || undefined,
      status: status || undefined,
      paymentMethod: method || undefined,
      placedOn: date || undefined,
      assignment:
        actor.data?.role === 'staff' || tab === 'mine'
          ? 'mine'
          : tab === 'unassigned'
            ? 'unassigned'
            : undefined,
      assignmentOverdue: tab === 'assignment-overdue' ? true : undefined,
      assignmentWaitingOverdue: tab === 'waiting-overdue' ? true : undefined,
      assignmentDeadlineSoon: tab === 'deadline-soon' ? true : undefined,
      assignmentHandoverReview: tab === 'handover-review' ? true : undefined,
      paymentReviewRequired: tab === 'attention' ? true : undefined,
      deletion:
        tab === 'deleted' && actor.data?.role === 'admin'
          ? 'deleted'
          : 'active',
    },
    Boolean(actor.data),
    15_000,
  )
  const stats = orders.data?.stats
  const setFilter = (value: string) => {
    setStatus(value)
    setOffset(0)
  }
  const selectStatusStat = (value: string) => {
    setTab('all')
    setFilter(value)
  }
  const selectedId = orders.data?.items.some((order) => order.id === selected)
    ? selected
    : orders.data?.items[0]?.id
  return (
    <>
      <PageHeading
        title={
          fulfillment
            ? 'Giao vận & đóng gói'
            : actor.data?.role === 'staff'
              ? 'Đơn được giao cho tôi'
              : 'Quản lý đơn hàng'
        }
        subtitle={
          actor.data?.role === 'staff'
            ? 'Hệ thống tự phân công đơn; danh sách được giao tự cập nhật.'
            : 'Theo dõi và xử lý đơn hàng theo trạng thái.'
        }
      />
      {actor.data?.role === 'admin' && <OrderAssignmentOverview />}
      <div className="c-stats">
        <Stat
          label="Chờ xác nhận"
          value={stats?.placed}
          icon={<Clock3 size={23} />}
          onClick={() => selectStatusStat('placed')}
        />
        <Stat
          label="Đang đóng gói"
          value={stats?.packing}
          icon={<Package size={23} />}
          onClick={() => selectStatusStat('packing')}
        />
        <Stat
          label="Đang giao"
          value={stats?.shipped}
          icon={<Truck size={23} />}
          onClick={() => selectStatusStat('shipped')}
        />
        <Stat
          label="Cần đối soát"
          value={stats?.paymentReviewRequired}
          icon={<AlertTriangle size={23} />}
          onClick={() => {
            setTab('attention')
            setFilter('')
          }}
        />
      </div>
      {Boolean(stats?.paymentReviewRequired) && (
        <div className="c-payment-notice">
          <Notice tone="red">
            <strong>
              {stats?.paymentReviewRequired} đơn chuyển khoản cần đối soát sau
              hạn thanh toán
            </strong>
            {canManagePayments(actor.data?.role) ? (
              <Link to="/staff/payments" className="c-text-link">
                Xem danh sách
                <ArrowRight size={14} />
              </Link>
            ) : (
              <span>Kế toán hoặc quản trị viên cần đối soát các đơn này.</span>
            )}
          </Notice>
        </div>
      )}
      <Panel className="c-table-panel">
        <div className="c-tabs">
          {[
            [
              'all',
              `${actor.data?.role === 'staff' ? 'Được giao cho tôi' : 'Tất cả'} (${stats?.total ?? '—'})`,
            ],
            ...(actor.data?.role !== 'staff'
              ? [
                  [
                    'unassigned',
                    `Chờ phân công / bàn giao (${stats?.unassigned ?? '—'})`,
                  ],
                  ['mine', `Của tôi (${stats?.mine ?? '—'})`],
                ]
              : []),
            [
              'assignment-overdue',
              `Chậm xác nhận (${stats?.assignmentOverdue ?? '—'})`,
            ],
            [
              'waiting-overdue',
              `Chờ phân công quá lâu (${stats?.assignmentWaitingOverdue ?? '—'})`,
            ],
            [
              'deadline-soon',
              `Nguy cơ hết hạn (${stats?.assignmentDeadlineSoon ?? '—'})`,
            ],
            [
              'attention',
              `Cần đối soát (${stats?.paymentReviewRequired ?? '—'})`,
            ],
            ...(actor.data?.role === 'admin'
              ? [
                  [
                    'handover-review',
                    `Giữ lại sau ca (${stats?.assignmentHandoverReview ?? '—'})`,
                  ],
                  ['deleted', `Đã xóa (${stats?.deleted ?? '—'})`],
                ]
              : []),
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={tab === value ? 'is-active' : ''}
              onClick={() => {
                setTab(value)
                setStatus('')
                setOffset(0)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="c-filters"
          onSubmit={(event) => {
            event.preventDefault()
            setQ(text.trim())
            setOffset(0)
          }}
        >
          <label className="c-filter-search">
            <Search size={16} />
            <input
              type="search"
              value={text}
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
              placeholder="Tìm mã đơn, khách hàng, số điện thoại"
              aria-label="Tìm đơn hàng"
            />
          </label>
          <Action type="submit" variant="secondary">
            Tìm
          </Action>
          <select
            aria-label="Trạng thái đơn hàng"
            value={status}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(orderLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Phương thức thanh toán"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">Thanh toán</option>
            <option value="cod">COD</option>
            <option value="bank_transfer">Chuyển khoản</option>
          </select>
          <input
            type="date"
            aria-label="Ngày đặt hàng (giờ Việt Nam)"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setOffset(0)
            }}
          />
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
                      <th>Mã đơn</th>
                      <th>Khách hàng</th>
                      <th className="c-number">Tổng tiền</th>
                      <th>Thanh toán</th>
                      <th>Trạng thái đơn</th>
                      <th>Phụ trách</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.data.items.map((order) => (
                      <tr
                        key={order.id}
                        className={order.id === selectedId ? 'is-selected' : ''}
                      >
                        <td>
                          <button
                            type="button"
                            className="c-row-select"
                            onClick={() => setSelected(order.id)}
                          >
                            #{order.code}
                          </button>
                          <small>{formatDate(order.createdAt)}</small>
                        </td>
                        <td>
                          <strong>{order.recipient.name}</strong>
                          <small>{order.recipient.phone}</small>
                        </td>
                        <td className="c-number">
                          <b>{formatMoney(order.totalVnd)}</b>
                        </td>
                        <td>
                          <div className="c-badges">
                            <Badge
                              tone={
                                order.paymentMethod === 'cod'
                                  ? 'neutral'
                                  : 'amber'
                              }
                            >
                              {order.paymentMethod === 'cod'
                                ? 'COD'
                                : 'Chuyển khoản'}
                            </Badge>
                            <Badge status={order.paymentStatus} />
                          </div>
                        </td>
                        <td>
                          <Badge status={order.status} />
                          {order.assignmentOverdue && (
                            <Badge tone="amber">Chậm xác nhận</Badge>
                          )}
                          {order.assignmentWaitingOverdue && (
                            <Badge tone="amber">Chờ phân công quá lâu</Badge>
                          )}
                          {order.assignmentDeadlineSoon && (
                            <Badge tone="red">Nguy cơ hết hạn</Badge>
                          )}
                          {order.assignmentHandoverReview && (
                            <Badge tone="amber">Admin kiểm tra sau ca</Badge>
                          )}
                          {order.assignmentNeedsRebalance && (
                            <Badge tone="amber">
                              Chờ điều phối do vượt tải
                            </Badge>
                          )}
                          {order.deletedAt && <Badge tone="red">Đã xóa</Badge>}
                        </td>
                        <td>
                          {order.assignedToName ??
                            (order.assignedTo
                              ? shortId(order.assignedTo)
                              : 'Chưa phân công')}
                          {order.assignmentWaitingSince && (
                            <small>
                              {order.assignmentNeedsHandover
                                ? 'Chờ bàn giao'
                                : order.assignmentNeedsRebalance
                                  ? 'Chờ điều phối'
                                  : 'Chờ phân công'}{' '}
                              từ {formatDate(order.assignmentWaitingSince)}
                            </small>
                          )}
                          {order.assignmentDeadlineSoon && (
                            <small>
                              Hạn giữ hàng:{' '}
                              {formatDate(order.reservationExpiresAt)}
                            </small>
                          )}
                        </td>
                        <td>
                          <div className="c-actions">
                            <Link
                              className="c-text-link"
                              to="/staff/orders/$orderId"
                              params={{ orderId: order.id }}
                            >
                              Xem chi tiết
                              <ArrowRight size={15} />
                            </Link>
                            {actor.data?.role === 'admin' &&
                              (order.deletedAt ||
                                ['cancelled', 'completed'].includes(
                                  order.status,
                                )) && (
                                <OrderDeletionButton
                                  orderId={order.id}
                                  deleted={Boolean(order.deletedAt)}
                                  onSuccess={() => setOffset(0)}
                                />
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Không có đơn hàng phù hợp"
                description="Thay đổi bộ lọc để xem các đơn hàng khác."
              />
            )}
            <Pagination
              offset={offset}
              limit={10}
              total={orders.data.total}
              count={orders.data.items.length}
              onChange={setOffset}
            />
          </>
        )}
      </Panel>
      {selectedId && (
        <div style={{ marginTop: 16 }}>
          <OrderQueuePreview key={selectedId} id={selectedId} />
        </div>
      )}
    </>
  )
}

function OrderQueuePreview({ id }: { id: string }) {
  const order = useOrder(id, true)
  const advance = useCommand(
    (action: 'confirm' | 'pack') =>
      write(`staff/orders/${id}/${action}`, {
        expectedRevision: order.data?.revision,
      }),
    orderQueryPaths,
  )
  if (order.isPending)
    return (
      <Panel>
        <Loading />
      </Panel>
    )
  if (order.isError)
    return <QueryError error={order.error} retry={() => order.refetch()} />
  const data = order.data
  const action = data.permittedActions.staff.includes('confirm')
    ? 'confirm'
    : data.permittedActions.staff.includes('pack')
      ? 'pack'
      : null
  return (
    <Panel>
      <div className="c-queue-preview">
        <div>
          <div className="c-badges">
            <Badge tone="red">#{data.code}</Badge>
            <Badge status={data.status} />
          </div>
          <div className="c-divider" />
          <RecipientCard recipient={data.recipient} />
        </div>
        <div>
          <strong>Sản phẩm ({data.items.length})</strong>
          <CompactLines lines={data.items} />
        </div>
        <div>
          <PriceSummary
            subtotal={data.prices.subtotalVnd}
            shipping={data.prices.shippingFeeVnd}
            total={data.prices.totalVnd}
          />
          <ErrorNotice error={advance.error} />
          {action ? (
            <Action
              className="c-button--block"
              pending={advance.isPending}
              onClick={() => {
                void advance.run(action)
              }}
            >
              {action === 'confirm' ? 'Xác nhận đơn hàng' : 'Tiếp tục đóng gói'}
            </Action>
          ) : (
            <Link
              to="/staff/orders/$orderId"
              params={{ orderId: id }}
              className="c-button c-button--secondary c-button--block"
            >
              Xem chi tiết đơn
            </Link>
          )}
          {data.paymentMethod === 'bank_transfer' &&
            !data.payment.bankPaymentApproved &&
            ['placed', 'confirmed'].includes(data.status) && (
              <small>Cần xác minh thanh toán trước khi đóng gói.</small>
            )}
        </div>
      </div>
    </Panel>
  )
}

export function StaffFulfillmentPage() {
  return (
    <StaffLayout>
      <AccessGate staff>
        <FulfillmentContent />
      </AccessGate>
    </StaffLayout>
  )
}

function FulfillmentContent() {
  const id = useOrderId()
  const query = useOrder(id, true)
  const actor = useActor()
  const [dialog, setDialog] = useState<
    'failure' | 'returned' | 'cancel' | 'address' | null
  >(null)
  const command = useCommand(
    (action: string) =>
      write(
        `staff/orders/${id}/${action}`,
        action === 'confirm' || action === 'pack'
          ? { expectedRevision: query.data?.revision }
          : {},
      ),
    orderQueryPaths,
  )
  if (!z.uuid().safeParse(id).success)
    return <Empty title="Mã đơn hàng không hợp lệ" />
  if (query.isPending) return <Loading />
  if (query.isError)
    return <QueryError error={query.error} retry={() => query.refetch()} />
  const order = query.data
  const actions = order.permittedActions.staff
  const awaitingBankPayment =
    ['placed', 'confirmed'].includes(order.status) &&
    order.paymentMethod === 'bank_transfer' &&
    !order.payment.bankPaymentApproved
  const hasWorkflowActions = [
    'confirm',
    'pack',
    'dispatch',
    'record_delivery_failure',
    'retry_delivery',
    'receive_undelivered_shipment',
    'acknowledge_delivery',
  ].some((action) => actions.includes(action))
  return (
    <>
      <div className="c-breadcrumb">
        <Link to="/staff/orders">Đơn hàng</Link> / {order.code}
      </div>
      <PageHeading
        title={`Đơn hàng #${order.code}`}
        subtitle={
          <>
            <CalendarDays
              size={15}
              style={{ display: 'inline', marginRight: 7 }}
            />
            Đặt hàng: {formatDate(order.createdAt)}
          </>
        }
      >
        <div className="c-badges">
          <Badge status={order.status} />
          <Badge status={order.payment.status} />
          <Badge tone="neutral">
            {order.paymentMethod === 'cod' ? 'COD' : 'Chuyển khoản'}
          </Badge>
        </div>
      </PageHeading>
      <OrderProgress
        order={order}
        actions={
          (hasWorkflowActions ||
            Boolean(order.undo) ||
            awaitingBankPayment) && (
            <>
              {(actions.includes('confirm') || actions.includes('pack')) && (
                <div className="c-actions">
                  {actions.includes('confirm') && (
                    <Action
                      pending={command.isPending}
                      onClick={() => {
                        void command.run('confirm')
                      }}
                    >
                      <Check size={17} />
                      Xác nhận đơn hàng
                    </Action>
                  )}
                  {actions.includes('pack') && (
                    <Action
                      pending={command.isPending}
                      onClick={() => {
                        void command.run('pack')
                      }}
                    >
                      <Package size={17} />
                      Tiếp tục đóng gói
                    </Action>
                  )}
                </div>
              )}
              {awaitingBankPayment && (
                <Notice tone="amber">
                  Cần đối soát thanh toán trước khi xác nhận và đóng gói.
                </Notice>
              )}
              {actions.includes('dispatch') && (
                <DispatchForm key={`dispatch-${order.id}`} order={order} />
              )}
              {order.shipment?.status === 'delivery_failed' && (
                <Notice tone="amber">
                  <strong>
                    Lần giao thất bại {order.shipment.failedAttempts}/3
                  </strong>
                  {order.shipment.failureReason}
                  <br />
                  Dưới 3 lần thất bại: có thể giao lại hoặc nhận hàng hoàn. Đủ 3
                  lần: chỉ nhận hàng hoàn.
                </Notice>
              )}
              {(actions.includes('record_delivery_failure') ||
                actions.includes('retry_delivery') ||
                actions.includes('receive_undelivered_shipment')) && (
                <div className="c-actions">
                  {actions.includes('record_delivery_failure') && (
                    <Action
                      variant="secondary"
                      disabled={command.isPending}
                      onClick={() => setDialog('failure')}
                    >
                      <AlertTriangle size={16} />
                      Giao không thành công
                    </Action>
                  )}
                  {actions.includes('retry_delivery') && (
                    <Action
                      variant="secondary"
                      pending={command.isPending}
                      onClick={() => {
                        void command.run('retry-delivery')
                      }}
                    >
                      <RefreshCw size={16} />
                      Giao lại
                    </Action>
                  )}
                  {actions.includes('receive_undelivered_shipment') && (
                    <Action
                      variant="secondary"
                      disabled={command.isPending}
                      onClick={() => setDialog('returned')}
                    >
                      <RotateCcw size={16} />
                      Nhận hàng hoàn
                    </Action>
                  )}
                </div>
              )}
              {actions.includes('acknowledge_delivery') && order.shipment && (
                <DeliveryForm
                  key={`delivery-${order.id}-${order.shipment.id}`}
                  order={order}
                  handedOverAt={order.shipment.createdAt}
                  clockReceivedAt={order.clockReceivedAt}
                />
              )}
              <OrderUndoControl
                key={`undo-${order.id}`}
                order={order}
                disabled={command.isPending}
              />
            </>
          )
        }
      />
      {actor.data?.role === 'admin' && order.deletion?.deletedAt && (
        <Notice tone="amber">
          Đơn đã được xóa khỏi danh sách quản lý lúc{' '}
          {formatDate(order.deletion.deletedAt)}.
          {order.deletion.reason && <p>Lý do: {order.deletion.reason}</p>}
        </Notice>
      )}
      <ErrorNotice error={command.error} />
      {order.paymentReviewRequired && (
        <div className="c-payment-notice">
          <Notice tone="amber">
            <strong>Đơn hàng cần đối soát thanh toán</strong>
            {canManagePayments(actor.data?.role) ? (
              <Link
                to="/staff/payments"
                search={{ orderId: order.id }}
                className="c-text-link"
              >
                Mở đối soát thanh toán
              </Link>
            ) : (
              <span>Chờ kế toán hoặc quản trị viên đối soát thanh toán.</span>
            )}
          </Notice>
        </div>
      )}
      <div className="c-columns">
        <div className="c-stack">
          <Panel
            title={`Sản phẩm cần giao (${order.items.length})`}
            icon={<Truck size={20} />}
          >
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>SKU</th>
                    <th>Đã đặt</th>
                    <th>Đang giữ</th>
                    <th className="c-number">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="c-product-cell">
                          <ProductThumb
                            name={item.nameSnapshot}
                            sku={item.skuSnapshot}
                          />
                          <strong>{item.nameSnapshot}</strong>
                        </div>
                      </td>
                      <td>{item.skuSnapshot}</td>
                      <td>{item.quantity}</td>
                      <td>
                        {order.stockState === 'reserved' ? item.quantity : 0}
                      </td>
                      <td className="c-number">
                        <b>{formatMoney(item.lineTotalVnd)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {order.shipment && (
            <Panel title="Vận chuyển" icon={<Truck size={20} />}>
              <div className="c-detail-meta">
                <span>
                  Đơn vị vận chuyển:{' '}
                  <b>{order.shipment.carrier?.name ?? 'Chưa xác định'}</b>
                </span>
                <span>
                  Mã vận đơn: <b>{order.shipment.trackingReference}</b>
                </span>
                <Badge status={order.shipment.status} />
              </div>
              <ShipmentCarrierForm order={order} />
            </Panel>
          )}
        </div>
        <aside className="c-stack">
          <Panel title="Thông tin người nhận" icon={<UserRound size={19} />}>
            <RecipientCard recipient={order.recipient} />
            {actions.includes('update_recipient') && (
              <div className="c-actions">
                <Action
                  variant="secondary"
                  onClick={() => setDialog('address')}
                >
                  Sửa thông tin người nhận
                </Action>
              </div>
            )}
          </Panel>
          <Panel title="Tổng quan đơn hàng">
            <CopyValue label="Mã đơn đầy đủ" value={order.id} />
            <PriceSummary
              subtotal={order.prices.subtotalVnd}
              shipping={order.prices.shippingFeeVnd}
              total={order.prices.totalVnd}
            />
            {order.paymentMethod === 'cod' && order.status !== 'cancelled' && (
              <Notice tone="amber">
                <strong>
                  Còn cần thu COD {formatMoney(order.payment.amountDueVnd)}
                </strong>
                Đã thu từ khách: {formatMoney(order.payment.paidVnd)}
              </Notice>
            )}
            {canManagePayments(actor.data?.role) && (
              <div className="c-actions">
                <Link
                  to="/staff/payments"
                  search={{ orderId: id }}
                  className="c-text-link"
                >
                  <Wallet size={16} />
                  Thanh toán & đối soát
                </Link>
              </div>
            )}
          </Panel>
          <AssignmentControl order={order} />
          <OrderHistory order={order} />
          {actor.data?.role === 'admin' && (
            <Panel title="Quản lý hiển thị đơn hàng">
              {order.deletion?.blockedReason && (
                <Notice tone="amber">
                  {orderDeletionMessages[order.deletion.blockedReason]}
                </Notice>
              )}
              {(actions.includes('delete') || actions.includes('restore')) && (
                <OrderDeletionButton
                  orderId={order.id}
                  deleted={Boolean(order.deletion?.deletedAt)}
                />
              )}
            </Panel>
          )}
          {actions.includes('cancel') && (
            <Action variant="danger" onClick={() => setDialog('cancel')}>
              Hủy đơn hàng
            </Action>
          )}
        </aside>
      </div>
      {dialog === 'address' && actions.includes('update_recipient') && (
        <AddressDrawer
          key={`${order.id}-${order.revision}`}
          order={order}
          staff
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'failure' && (
        <ReasonDrawer
          title="Ghi nhận giao hàng không thành công"
          description="Chỉ ghi nhận khi đã xác minh lần giao không thành công. Mỗi lần ghi nhận được tính vào giới hạn 3 lần."
          path={`staff/orders/${id}/delivery-failure`}
          actionLabel="Ghi nhận thất bại"
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDrawer
          title="Hủy đơn hàng"
          description="Xác nhận lý do trước khi hủy đơn và giải phóng hàng đang giữ."
          path={`staff/orders/${id}/cancel`}
          actionLabel="Xác nhận hủy đơn"
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'returned' && (
        <ReturnedShipmentDrawer order={order} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

function AssignmentQueueNotice({ order }: { order: OrderDetail }) {
  return (
    <>
      {order.assignmentWaitingSince && (
        <Notice tone={order.assignmentWaitingOverdue ? 'amber' : 'blue'}>
          {order.assignmentNeedsHandover
            ? 'Đang chờ bàn giao sang nhân viên trong ca còn tải'
            : order.assignmentNeedsRebalance
              ? 'Công việc mới quay lại vượt hạn mức, đang chờ điều phối sang người trong ca còn tải'
              : 'Đang chờ hệ thống phân công'}{' '}
          từ {formatDate(order.assignmentWaitingSince)}.
          {order.assignmentWaitingOverdue &&
            ' Đã chờ quá thời gian phân công cho phép.'}
        </Notice>
      )}
      {order.assignmentDeadlineSoon && (
        <Notice tone="red">
          Đơn trong hàng chờ sắp hết hoặc đã hết hạn giữ hàng:{' '}
          {formatDate(order.reservationExpiresAt)}.
        </Notice>
      )}
      {order.assignmentHandoverReview && (
        <Notice tone="amber">
          Người phụ trách đã dừng nhận đơn hoặc hết ca. Đơn đang đóng gói hoặc
          chờ đơn vị vận chuyển/kế toán được giữ nguyên để admin kiểm tra trước
          khi bàn giao.
        </Notice>
      )}
    </>
  )
}

function AssignmentConfirmationNotice({ order }: { order: OrderDetail }) {
  if (order.status !== 'placed' || !order.reservationExpiresAt) return null
  return order.assignmentOverdue ? (
    <Notice tone="amber">
      Đơn chưa được xác nhận khi hết hạn chờ lúc{' '}
      {formatDate(order.reservationExpiresAt)}. Cần kiểm tra trạng thái hủy hoặc
      đối soát thanh toán.
    </Notice>
  ) : (
    <small>
      Hạn xác nhận: {formatDate(order.reservationExpiresAt)} (theo hạn chờ của
      đơn).
    </small>
  )
}

export function AssignmentControl({ order }: { order: OrderDetail }) {
  const actor = useActor()
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [reason, setReason] = useState('')
  const allowed = order.permittedActions.staff.includes('assign')
  const users = useCommerceQuery<
    Page<{
      id: string
      name: string
      email: string
      role: string
      orderAssignment: StaffOrderSettings
    }>
  >(
    'admin/users',
    { limit: 20, offset, q: q || undefined, assignable: true },
    actor.data?.role === 'admin' && allowed,
  )
  const selectedTarget = users.data?.items.some((user) => user.id === target)
    ? target
    : ''
  const assign = useCommand(
    (input: { userId: string; reason: string }) =>
      write(`staff/orders/${order.id}/assignment`, {
        ...input,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  if (!allowed)
    return (
      <Panel title="Phụ trách xử lý">
        <p>
          {order.assignedToName ??
            (order.assignedTo
              ? shortId(order.assignedTo)
              : 'Đang chờ hệ thống phân công')}
        </p>
        {order.assignedTo === actor.data?.userId && (
          <Badge tone="blue">Bạn đang phụ trách đơn hàng này</Badge>
        )}
        <AssignmentQueueNotice order={order} />
        {order.assignedAt && (
          <small>Được giao lúc {formatDate(order.assignedAt)}</small>
        )}
        <AssignmentConfirmationNotice order={order} />
      </Panel>
    )
  return (
    <Panel title="Phụ trách xử lý">
      <p>
        Hiện tại:{' '}
        {order.assignedToName ??
          (order.assignedTo ? shortId(order.assignedTo) : 'Chưa phân công')}
      </p>
      {order.assignedAt && (
        <small>
          Được giao lúc {formatDate(order.assignedAt)} ·{' '}
          {order.assignmentSource === 'automatic'
            ? 'Hệ thống tự phân công'
            : 'Phân công thủ công'}
        </small>
      )}
      <AssignmentConfirmationNotice order={order} />
      <AssignmentQueueNotice order={order} />
      <ErrorNotice error={assign.error} />
      {actor.data?.role === 'admin' ? (
        <div className="c-form-section">
          <form
            className="c-filters"
            onSubmit={(event) => {
              event.preventDefault()
              setQ(text.trim())
              setOffset(0)
              setTarget('')
            }}
          >
            <Field label="Tìm nhân viên theo tên hoặc email">
              <input
                type="search"
                value={text}
                maxLength={120}
                disabled={assign.isPending}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <Action
              type="submit"
              variant="secondary"
              disabled={assign.isPending}
            >
              Tìm nhân viên
            </Action>
          </form>
          <Field label="Phân công nhân viên">
            <select
              value={selectedTarget}
              onChange={(event) => setTarget(event.target.value)}
              disabled={assign.isPending || users.isFetching || users.isError}
            >
              <option value="">Chọn nhân viên</option>
              {users.data?.items.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.email}
                  {' · '}
                  {user.orderAssignment.activeOrders}
                  {user.role === 'staff'
                    ? `/${user.orderAssignment.maxActiveOrders}`
                    : ''}{' '}
                  đơn đang xử lý
                  {user.id === order.assignedTo ? ' (đang phụ trách)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <small>
            Phân công thủ công có thể vượt giới hạn hoặc giao cho người ngoài
            ca. Chọn lại người đang phụ trách để xác nhận giữ đơn đang chờ bàn
            giao hoặc điều phối do vượt tải.
          </small>
          <Field label="Lý do phân công / chuyển người phụ trách *">
            <textarea
              value={reason}
              minLength={3}
              maxLength={1000}
              required
              disabled={assign.isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <ErrorNotice error={users.error} />
          {users.isError && (
            <Action variant="secondary" onClick={() => users.refetch()}>
              Tải lại danh sách nhân viên
            </Action>
          )}
          {users.data && (
            <>
              {!users.data.items.length && (
                <small>Không tìm thấy nhân viên phù hợp.</small>
              )}
              <Pagination
                offset={offset}
                limit={20}
                total={users.data.total}
                count={users.data.items.length}
                onChange={(next) => {
                  if (assign.isPending) return
                  setOffset(next)
                  setTarget('')
                }}
              />
            </>
          )}
          <Action
            variant="secondary"
            disabled={
              !selectedTarget ||
              (selectedTarget === order.assignedTo &&
                !order.assignmentNeedsHandover &&
                !order.assignmentNeedsRebalance &&
                !order.assignmentHandoverReview) ||
              reason.trim().length < 3 ||
              users.isFetching ||
              users.isError
            }
            pending={assign.isPending}
            onClick={() => {
              if (selectedTarget)
                void assign.run({
                  userId: selectedTarget,
                  reason: reason.trim(),
                })
            }}
          >
            Lưu phân công
          </Action>
        </div>
      ) : null}
    </Panel>
  )
}

function DispatchForm({ order }: { order: OrderDetail }) {
  const [checked, setChecked] = useState<boolean[]>([false, false, false])
  const [carrierId, setCarrierId] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const dispatch = useCommand(
    (input: { carrierId: string; trackingReference: string }) =>
      write(`staff/orders/${order.id}/dispatch`, {
        ...input,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  return (
    <form
      className="c-form-section"
      style={{ marginTop: 18 }}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault()
        if (dispatch.isPending) return
        const reference = String(
          new FormData(event.currentTarget).get('tracking') ?? '',
        ).trim()
        const error = !checked.every(Boolean)
          ? 'Vui lòng tích đủ 3 mục kiểm tra đóng gói trước khi bàn giao.'
          : !carrierId
            ? 'Vui lòng chọn đơn vị vận chuyển trước khi bàn giao.'
            : reference.length < 3 || reference.length > 200
              ? 'Mã vận đơn cần từ 3 đến 200 ký tự, không tính khoảng trắng ở đầu và cuối.'
              : null
        setValidationError(error)
        if (error) return
        await dispatch.run({ carrierId, trackingReference: reference })
      }}
    >
      <div className="c-packing-checks">
        <h3>Kiểm tra và đóng gói</h3>
        {[
          'Đúng sản phẩm, đủ số lượng',
          'Hàng không hư hỏng, đủ phụ kiện',
          'Đã bọc bảo vệ và đóng kín kiện hàng',
        ].map((label, index) => (
          <label className="c-check" key={label}>
            <input
              type="checkbox"
              checked={checked[index]}
              disabled={dispatch.isPending}
              onChange={(event) => {
                const isChecked = event.currentTarget.checked
                setChecked((current) =>
                  current.map((value, position) =>
                    position === index ? isChecked : value,
                  ),
                )
                setValidationError(null)
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <h3>Bàn giao vận chuyển</h3>
      <CarrierPicker
        value={carrierId}
        onChange={(value) => {
          setCarrierId(value)
          setValidationError(null)
        }}
        disabled={dispatch.isPending}
      />
      <Field
        label="Mã vận đơn *"
        hint="Nhập mã vận đơn do đơn vị vận chuyển cấp."
      >
        <input
          name="tracking"
          required
          minLength={3}
          maxLength={200}
          disabled={dispatch.isPending}
          placeholder="Nhập mã vận đơn thực tế"
          onChange={() => setValidationError(null)}
        />
      </Field>
      {validationError && (
        <Notice tone="red">
          <span role="alert">{validationError}</span>
        </Notice>
      )}
      <ErrorNotice error={dispatch.error} />
      <div className="c-actions c-actions--end">
        <Action type="submit" pending={dispatch.isPending}>
          <Send size={16} />
          Xác nhận bàn giao
        </Action>
      </div>
    </form>
  )
}

function DeliveryForm({
  order,
  handedOverAt,
  clockReceivedAt,
}: {
  order: OrderDetail
  handedOverAt: string
  clockReceivedAt: number
}) {
  const [maximumTime, setMaximumTime] = useState(() =>
    vietnamDateInput(serverClockNow(order.serverTime, clockReceivedAt)),
  )
  const [deliveryTime, setDeliveryTime] = useState(() => maximumTime)
  const [validationError, setValidationError] = useState<string | null>(null)
  useEffect(() => {
    const updateMaximum = () => {
      setMaximumTime(
        vietnamDateInput(serverClockNow(order.serverTime, clockReceivedAt)),
      )
    }
    updateMaximum()
    const timer = window.setInterval(updateMaximum, 1000)
    return () => window.clearInterval(timer)
  }, [order.serverTime, clockReceivedAt])
  const command = useCommand(
    (input: { deliveredAt: string }) =>
      write(`staff/orders/${order.id}/delivery`, {
        ...input,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  return (
    <form
      className="c-form-section"
      style={{ marginTop: 20 }}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault()
        if (command.isPending) return
        const timestamp = Date.parse(`${deliveryTime}+07:00`)
        const now = serverClockNow(order.serverTime, clockReceivedAt)
        const error = !Number.isFinite(timestamp)
          ? 'Vui lòng nhập thời điểm khách thực sự nhận hàng hợp lệ.'
          : timestamp < Date.parse(handedOverAt)
            ? 'Thời điểm giao thành công không được trước lúc bàn giao vận chuyển.'
            : timestamp > now.getTime()
              ? 'Thời điểm giao thành công không được ở tương lai (giờ Việt Nam).'
              : null
        setValidationError(error)
        setMaximumTime(vietnamDateInput(now))
        if (error) return
        await command.run({
          deliveredAt: inputToIso(deliveryTime),
        })
      }}
    >
      <h3>Xác nhận giao thành công</h3>
      <Field
        label="Thời điểm giao thành công (giờ Việt Nam) *"
        hint={`Thời điểm khách thực sự nhận hàng, từ lúc bàn giao ${formatDate(handedOverAt)} đến hiện tại. Có thể chỉnh lại trước khi xác nhận.`}
      >
        <input
          type="datetime-local"
          step={0.001}
          name="time"
          required
          value={deliveryTime}
          min={vietnamDateInput(handedOverAt)}
          max={maximumTime}
          aria-invalid={Boolean(validationError)}
          disabled={command.isPending}
          onChange={(event) => {
            setDeliveryTime(event.currentTarget.value)
            setValidationError(null)
          }}
        />
      </Field>
      <small>Hệ thống tự lưu thời điểm ghi nhận khi bạn xác nhận.</small>
      {validationError && (
        <Notice tone="red">
          <span role="alert">{validationError}</span>
        </Notice>
      )}
      <ErrorNotice error={command.error} />
      <Action type="submit" pending={command.isPending}>
        Ghi nhận giao thành công
      </Action>
    </form>
  )
}

function ReturnedShipmentDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const actor = useActor()
  const [items, setItems] = useState(() =>
    order.items.map((item) => ({
      orderItemId: item.id,
      quantity: String(item.quantity),
      resellableQuantity: String(item.quantity),
      resellableEdited: false,
    })),
  )
  const command = useCommand(
    (input: {
      reason: string
      items: {
        orderItemId: string
        quantity: number
        resellableQuantity: number
      }[]
    }) => write(`staff/orders/${order.id}/returned-shipment`, input),
    orderQueryPaths,
  )
  return (
    <Drawer
      title="Nhận lại đơn giao không thành công"
      onClose={onClose}
      busy={command.isPending}
      wide
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          if (
            await command.run({
              reason: String(data.get('reason')).trim(),
              items: items.map((item) => ({
                orderItemId: item.orderItemId,
                quantity: Number(item.quantity),
                resellableQuantity: Number(item.resellableQuantity),
              })),
            })
          )
            onClose()
        }}
      >
        <Notice tone="amber">
          Kiểm đếm số lượng nhận thực tế. Đơn hàng sẽ được đóng và các khoản
          tiền đã nhận được chuyển sang xử lý hoàn tiền khi có nghĩa vụ hoàn.
        </Notice>
        <small>
          Có thể bán lại được điền sẵn bằng số lượng thực nhận. Giảm số lượng
          nếu có hàng hỏng hoặc không đủ điều kiện bán lại.
        </small>
        <div className="c-table-wrap">
          <table className="c-table">
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Đã giao vận chuyển</th>
                <th>Thực nhận</th>
                <th>Có thể bán lại</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => (
                <tr key={item.id}>
                  <td>{item.nameSnapshot}</td>
                  <td>{item.quantity}</td>
                  <td>
                    <input
                      className="c-receive-input"
                      type="number"
                      aria-label={`Thực nhận ${item.nameSnapshot}`}
                      value={items[index].quantity}
                      min={actor.data?.role === 'admin' ? 0 : item.quantity}
                      max={item.quantity}
                      required
                      disabled={command.isPending}
                      onChange={(event) => {
                        const quantity = event.currentTarget.value
                        setItems((current) =>
                          current.map((line, position) => {
                            if (position !== index) return line
                            let resellableQuantity = line.resellableQuantity
                            if (!line.resellableEdited) {
                              resellableQuantity = quantity
                            } else if (
                              quantity !== '' &&
                              resellableQuantity !== ''
                            ) {
                              resellableQuantity = String(
                                Math.min(
                                  Number(resellableQuantity),
                                  Number(quantity),
                                ),
                              )
                            }
                            return { ...line, quantity, resellableQuantity }
                          }),
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="c-receive-input"
                      type="number"
                      aria-label={`Có thể bán lại ${item.nameSnapshot}`}
                      value={items[index].resellableQuantity}
                      min={0}
                      max={items[index].quantity}
                      required
                      disabled={command.isPending}
                      onChange={(event) => {
                        const quantity = event.currentTarget.value
                        setItems((current) =>
                          current.map((line, position) =>
                            position === index
                              ? {
                                  ...line,
                                  resellableQuantity: quantity,
                                  resellableEdited: true,
                                }
                              : line,
                          ),
                        )
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="Lý do / kết quả kiểm đếm *">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
          />
        </Field>
        <ErrorNotice error={command.error} />
        <Action type="submit" pending={command.isPending}>
          Xác nhận nhận hàng hoàn
        </Action>
      </form>
    </Drawer>
  )
}
