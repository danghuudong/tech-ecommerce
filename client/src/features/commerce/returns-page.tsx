import { Link } from '@tanstack/react-router'
import { Check, LockKeyhole, Package, RotateCcw, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  orderQueryPaths,
  paymentQueryPaths,
  useActor,
  useCommand,
  useCommerceQuery,
  useOrder,
  write,
} from './api'
import {
  AccessGate,
  Action,
  Badge,
  CopyValue,
  Drawer,
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
  ProductThumb,
  QueryError,
  RecipientCard,
  shortId,
} from './components'
import { inputToIso, vietnamDateInput } from './date-time'
import { StaffLayout } from './layouts'
import { ReasonDrawer } from './order-pages'
import { canManageOrders, canManagePayments } from './roles'
import { AssignmentControl } from './staff-pages'
import type {
  OrderDetail,
  OrderReturn,
  Page,
  Refund,
  ReturnRecord,
} from './types'

export function StaffReturnsPage() {
  return (
    <StaffLayout>
      <AccessGate staff>
        <ReturnsContent />
      </AccessGate>
    </StaffLayout>
  )
}

function ReturnsContent() {
  const actor = useActor()
  const canReturns = canManageOrders(actor.data?.role)
  const canRefunds = canManagePayments(actor.data?.role)
  const [selectedTab, setTab] = useState<'returns' | 'refunds'>(
    canReturns ? 'returns' : 'refunds',
  )
  const tab =
    canReturns && selectedTab === 'returns'
      ? 'returns'
      : canRefunds
        ? 'refunds'
        : 'returns'
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<{
    orderId: string
    id: string
  } | null>(null)
  const requests = useCommerceQuery<
    Page<{
      request: ReturnRecord
      orderCode: string
      assignedTo: string | null
    }>
  >(
    'staff/returns',
    { limit: 10, offset },
    canReturns && tab === 'returns',
    15_000,
  )
  const refunds = useCommerceQuery<
    Page<{
      refund: Omit<Refund, 'attempts' | 'permittedActions'>
      orderCode: string
      assignedTo: string | null
    }>
  >(
    'staff/refunds',
    { limit: 10, offset },
    canRefunds && tab === 'refunds',
    15_000,
  )
  const active = tab === 'returns' ? requests : refunds
  const visible =
    tab === 'returns'
      ? requests.data?.items.map(({ request }) => request)
      : refunds.data?.items.map(({ refund }) => refund)
  const selectedVisible = visible?.find(
    (item) => item.id === selected?.id && item.orderId === selected.orderId,
  )
  const selection = active.isSuccess
    ? (selectedVisible ?? visible?.[0] ?? null)
    : null
  useEffect(() => {
    if (selected && active.isSuccess && !selectedVisible) setSelected(null)
  }, [selected, active.isSuccess, selectedVisible])
  return (
    <>
      <PageHeading
        title="Trả hàng & hoàn tiền"
        subtitle="Duyệt yêu cầu, nhận hàng thực tế và theo dõi kết quả hoàn tiền."
      />
      <div className="c-tabs" style={{ marginBottom: 18 }}>
        {canReturns && (
          <button
            type="button"
            className={tab === 'returns' ? 'is-active' : ''}
            onClick={() => {
              setTab('returns')
              setOffset(0)
              setSelected(null)
            }}
          >
            Yêu cầu trả hàng
          </button>
        )}
        {canRefunds && (
          <button
            type="button"
            className={tab === 'refunds' ? 'is-active' : ''}
            onClick={() => {
              setTab('refunds')
              setOffset(0)
              setSelected(null)
            }}
          >
            Hoàn tiền
          </button>
        )}
      </div>
      <Panel className="c-table-panel">
        {active.isPending ? (
          <Loading />
        ) : active.isError ? (
          <QueryError error={active.error} retry={() => active.refetch()} />
        ) : (
          <>
            {tab === 'returns' ? (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>Mã yêu cầu</th>
                      <th>Đơn hàng</th>
                      <th>Ngày yêu cầu</th>
                      <th>Lý do</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.data?.items.map(({ request, orderCode }) => (
                      <tr
                        key={request.id}
                        className={
                          selection?.id === request.id ? 'is-selected' : ''
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="c-row-select"
                            onClick={() =>
                              setSelected({
                                orderId: request.orderId,
                                id: request.id,
                              })
                            }
                          >
                            #{shortId(request.id)}
                          </button>
                        </td>
                        <td>#{orderCode}</td>
                        <td>{formatDate(request.createdAt)}</td>
                        <td>{request.reason}</td>
                        <td>
                          <Badge status={request.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>Mã hoàn tiền</th>
                      <th>Đơn hàng</th>
                      <th className="c-number">Nghĩa vụ hoàn</th>
                      <th className="c-number">Còn phải hoàn</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.data?.items.map(({ refund, orderCode }) => (
                      <tr
                        key={refund.id}
                        className={
                          selection?.id === refund.id ? 'is-selected' : ''
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="c-row-select"
                            onClick={() =>
                              setSelected({
                                orderId: refund.orderId,
                                id: refund.id,
                              })
                            }
                          >
                            #{shortId(refund.id)}
                          </button>
                        </td>
                        <td>#{orderCode}</td>
                        <td className="c-number">
                          {formatMoney(refund.amountVnd)}
                        </td>
                        <td className="c-number">
                          {formatMoney(refund.remainingVnd)}
                        </td>
                        <td>
                          <Badge status={refund.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {active.data.items.length === 0 && (
              <Empty
                title={
                  tab === 'returns'
                    ? 'Không có yêu cầu trả hàng cần xử lý'
                    : 'Không có khoản hoàn tiền cần xử lý'
                }
              />
            )}
            <Pagination
              offset={offset}
              limit={10}
              count={active.data.items.length}
              onChange={(value) => {
                setOffset(value)
                setSelected(null)
              }}
            />
          </>
        )}
      </Panel>
      {selection && (
        <div style={{ marginTop: 22 }}>
          <AfterSaleDetail
            key={`${tab}-${selection.id}`}
            orderId={selection.orderId}
            id={selection.id}
            mode={tab}
          />
        </div>
      )}
    </>
  )
}

function AfterSaleDetail({
  orderId,
  id,
  mode,
}: {
  orderId: string
  id: string
  mode: 'returns' | 'refunds'
}) {
  const query = useOrder(orderId, true)
  if (query.isPending) return <Loading />
  if (query.isError)
    return <QueryError error={query.error} retry={() => query.refetch()} />
  const order = query.data
  const request = order.returns.find((record) => record.id === id)
  if (mode === 'refunds') {
    const refund = order.refunds.find((record) => record.id === id)
    return (
      <div className="c-columns">
        <div>
          {refund ? (
            <RefundCard refund={refund} />
          ) : (
            <Empty title="Không tìm thấy khoản hoàn tiền" />
          )}
        </div>
        <div className="c-stack">
          <Panel title={`Đơn hàng #${order.code}`}>
            <RecipientCard recipient={order.recipient} />
            <div className="c-actions">
              <Link
                to="/staff/orders/$orderId"
                params={{ orderId }}
                className="c-text-link"
              >
                Chi tiết đơn hàng
              </Link>
            </div>
          </Panel>
          <AssignmentControl order={order} />
        </div>
      </div>
    )
  }
  if (!request) return <Empty title="Không tìm thấy yêu cầu trả hàng" />
  return (
    <ReturnWorkspace
      key={`${request.id}-${request.updatedAt}`}
      order={order}
      request={request}
    />
  )
}

function ReturnWorkspace({
  order,
  request,
}: {
  order: OrderDetail
  request: OrderReturn
}) {
  const [decision, setDecision] = useState<'reject' | 'close' | null>(null)
  const [lines, setLines] = useState(
    request.lines.map((line) => ({
      orderItemId: line.orderItemId,
      quantity: line.quantity - line.receivedQuantity,
      resellableQuantity: 0,
    })),
  )
  const receive = useCommand(
    (input: Record<string, unknown>) =>
      write(`staff/returns/${request.id}/receipts`, input),
    orderQueryPaths,
  )
  const approve = useCommand(
    (input: Record<string, unknown>) =>
      write(`staff/returns/${request.id}/approve`, input),
    orderQueryPaths,
  )
  const receiving = request.permittedActions.includes('receive_items')
  const receiptValid = lines.every(
    (line, index) =>
      Number.isInteger(line.quantity) &&
      line.quantity >= 0 &&
      line.quantity <=
        request.lines[index].quantity - request.lines[index].receivedQuantity &&
      Number.isInteger(line.resellableQuantity) &&
      line.resellableQuantity >= 0 &&
      line.resellableQuantity <= line.quantity,
  )
  const goods = receiving
    ? lines.reduce(
        (sum, line) =>
          sum +
          (order.items.find((item) => item.id === line.orderItemId)
            ?.unitPriceVnd ?? 0) *
            line.quantity,
        0,
      )
    : 0
  const fullReturn =
    order.prices.returnedGoodsVnd + goods === order.prices.subtotalVnd
  const shippingRefundable =
    fullReturn &&
    request.responsibility !== 'customer' &&
    order.returns.every(
      (record) =>
        record.responsibility !== 'customer' ||
        record.lines.every((line) => line.receivedQuantity === 0),
    )
  const shipping = shippingRefundable
    ? order.prices.shippingFeeVnd - order.prices.shippingCreditVnd
    : 0
  const projectedCharge = Math.max(
    0,
    order.prices.adjustedTotalVnd - goods - shipping,
  )
  const expected =
    order.payment.balancesVerified && receiptValid
      ? Math.max(
          0,
          order.payment.paidVnd -
            projectedCharge -
            order.payment.netRefundedVnd,
        )
      : null
  const relatedRefunds = order.refunds.filter(
    (refund) => refund.returnId === request.id,
  )
  const decisionEvent = order.history.findLast(
    (event) =>
      event.details?.returnId === request.id &&
      ['return_approved', 'return_rejected', 'return_closed'].includes(
        event.type,
      ),
  )
  const step =
    request.status === 'requested'
      ? 0
      : ['approved', 'receiving'].includes(request.status)
        ? 1
        : request.lines.some((line) => line.receivedQuantity > 0)
          ? 2
          : -1
  return (
    <>
      <div className="c-detail-meta">
        <strong>Yêu cầu #{shortId(request.id)}</strong>
        <Link
          to="/staff/orders/$orderId"
          params={{ orderId: order.id }}
          className="c-text-link"
        >
          Đơn hàng #{order.code}
        </Link>
        <Badge status={request.status} />
      </div>
      <ol className="c-order-progress" aria-label="Tiến trình trả hàng">
        {['Yêu cầu', 'Nhận hàng', 'Hoàn tiền'].map((stage, index) => (
          <li
            key={stage}
            className={index === step ? 'is-active' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            <small>{stage}</small>
          </li>
        ))}
      </ol>
      <div className="c-columns">
        <div className="c-stack">
          <Panel title="Thông tin yêu cầu" icon={<RotateCcw size={20} />}>
            <div className="c-info-grid">
              <RecipientCard recipient={order.recipient} />
              <div className="c-form-section">
                <div>
                  <small>Ngày yêu cầu</small>
                  <p>{formatDate(request.createdAt)}</p>
                </div>
                <div>
                  <small>Lý do trả hàng</small>
                  <p>{request.reason}</p>
                </div>
                <div>
                  <small>Trách nhiệm</small>
                  <p>
                    {request.responsibility === 'store'
                      ? 'Cửa hàng'
                      : request.responsibility === 'carrier'
                        ? 'Đơn vị vận chuyển'
                        : 'Khách hàng'}
                  </p>
                </div>
                {request.decisionReason && (
                  <div>
                    <small>Quyết định xử lý</small>
                    <p>{request.decisionReason}</p>
                    {request.decidedByName && (
                      <small>
                        Bởi {request.decidedByName}
                        {decisionEvent
                          ? ` · ${formatDate(decisionEvent.createdAt)}`
                          : ''}
                      </small>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="c-divider" />
            <h3>Sản phẩm trả hàng</h3>
            <form
              className="c-form-section"
              onSubmit={async (event) => {
                event.preventDefault()
                const items = lines.filter((line) => line.quantity > 0)
                if (!items.length) return
                const data = new FormData(event.currentTarget)
                await receive.run({
                  proofReference: String(data.get('proof')).trim(),
                  items,
                })
              }}
            >
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Yêu cầu</th>
                      <th>Đã duyệt</th>
                      <th>Đã nhận</th>
                      {receiving && (
                        <>
                          <th>Nhận lần này</th>
                          <th>Có thể bán lại</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {request.lines.map((line, index) => {
                      const item = order.items.find(
                        (record) => record.id === line.orderItemId,
                      )
                      const remaining = line.quantity - line.receivedQuantity
                      return (
                        <tr key={line.id}>
                          <td>
                            <div className="c-product-cell">
                              <ProductThumb
                                name={item?.nameSnapshot ?? 'Sản phẩm'}
                                sku={item?.skuSnapshot}
                              />
                              <div>
                                <strong>{item?.nameSnapshot}</strong>
                                <small>{item?.skuSnapshot}</small>
                              </div>
                            </div>
                          </td>
                          <td>{line.quantity}</td>
                          <td>
                            {request.status === 'requested'
                              ? 'Chưa duyệt'
                              : line.quantity}
                          </td>
                          <td>{line.receivedQuantity}</td>
                          {receiving && (
                            <>
                              <td>
                                <input
                                  type="number"
                                  className="c-receive-input"
                                  aria-label={`Nhận lần này ${item?.nameSnapshot}`}
                                  value={lines[index].quantity}
                                  min={0}
                                  max={remaining}
                                  step={1}
                                  required
                                  disabled={
                                    receive.isPending || remaining === 0
                                  }
                                  onChange={(event) => {
                                    const quantity = Number(event.target.value)
                                    setLines((current) =>
                                      current.map((record, position) =>
                                        position === index
                                          ? {
                                              ...record,
                                              quantity,
                                              resellableQuantity: Math.min(
                                                record.resellableQuantity,
                                                quantity,
                                              ),
                                            }
                                          : record,
                                      ),
                                    )
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className="c-receive-input"
                                  aria-label={`Có thể bán lại ${item?.nameSnapshot}`}
                                  value={lines[index].resellableQuantity}
                                  min={0}
                                  max={lines[index].quantity}
                                  step={1}
                                  required
                                  disabled={
                                    receive.isPending || remaining === 0
                                  }
                                  onChange={(event) => {
                                    const quantity = Number(event.target.value)
                                    setLines((current) =>
                                      current.map((record, position) =>
                                        position === index
                                          ? {
                                              ...record,
                                              resellableQuantity: quantity,
                                            }
                                          : record,
                                      ),
                                    )
                                  }}
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {receiving && (
                <>
                  <Field
                    label="Mã biên nhận / bằng chứng *"
                    hint="Nhập mã biên nhận kho hoặc mã vận đơn hoàn hàng đã xác minh."
                  >
                    <input
                      name="proof"
                      minLength={3}
                      maxLength={200}
                      required
                      disabled={receive.isPending}
                    />
                  </Field>
                  <ErrorNotice error={receive.error} />
                  <div className="c-actions c-actions--end">
                    <Action
                      type="submit"
                      pending={receive.isPending}
                      disabled={
                        !receiptValid ||
                        !lines.some((line) => line.quantity > 0)
                      }
                    >
                      <Package size={16} />
                      Xác nhận nhận hàng
                    </Action>
                  </div>
                </>
              )}
            </form>
            {request.permittedActions.includes('approve') && (
              <form
                className="c-form-section"
                style={{ marginTop: 20 }}
                onSubmit={async (event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  await approve.run({
                    responsibility: String(data.get('responsibility')),
                    reason: String(data.get('reason')).trim(),
                  })
                }}
              >
                <Field label="Trách nhiệm *">
                  <select
                    name="responsibility"
                    required
                    defaultValue=""
                    disabled={approve.isPending}
                  >
                    <option value="">Chọn bên chịu trách nhiệm</option>
                    <option value="store">Cửa hàng</option>
                    <option value="carrier">Đơn vị vận chuyển</option>
                    <option value="customer">Khách hàng</option>
                  </select>
                </Field>
                <Field label="Lý do phê duyệt *">
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                    disabled={approve.isPending}
                  />
                </Field>
                <ErrorNotice error={approve.error} />
                <Action type="submit" pending={approve.isPending}>
                  <Check size={16} />
                  Duyệt yêu cầu trả hàng
                </Action>
              </form>
            )}
            <div className="c-actions">
              {request.permittedActions.includes('reject') && (
                <Action variant="danger" onClick={() => setDecision('reject')}>
                  Từ chối yêu cầu
                </Action>
              )}
              {request.permittedActions.includes('close') && (
                <Action
                  variant="secondary"
                  onClick={() => setDecision('close')}
                >
                  Đóng yêu cầu
                </Action>
              )}
            </div>
            {request.receipts.length > 0 && (
              <>
                <div className="c-divider" />
                <h3>Biên nhận đã ghi nhận</h3>
                {request.receipts.map((receipt) => (
                  <p key={receipt.id}>
                    {receipt.proofReference} ·{' '}
                    <small>{formatDate(receipt.createdAt)}</small>
                  </p>
                ))}
              </>
            )}
          </Panel>
          <AssignmentControl order={order} />
        </div>
        <aside className="c-stack">
          <Panel
            title={
              receiving ? 'Dự kiến sau khi nhận hàng' : 'Tổng quan tài chính'
            }
          >
            <dl className="c-financial-dl">
              <div>
                <dt>Giá trị hàng nhận lần này</dt>
                <dd>{formatMoney(goods)}</dd>
              </div>
              <div>
                <dt>Hoàn phí giao hàng thêm</dt>
                <dd>{formatMoney(shipping)}</dd>
              </div>
              <div>
                <dt>Đã thanh toán cho đơn hàng</dt>
                <dd>{formatMoney(order.payment.paidVnd)}</dd>
              </div>
              <div>
                <dt>Đã hoàn trước đó (ròng)</dt>
                <dd>{formatMoney(order.payment.netRefundedVnd)}</dd>
              </div>
              <div className="c-financial-dl__total">
                <dt>Dự kiến còn phải hoàn</dt>
                <dd>{formatMoney(expected)}</dd>
              </div>
            </dl>
            <div className="c-actions">
              <Notice>
                {shipping > 0
                  ? 'Trả toàn bộ hàng thuộc trách nhiệm cửa hàng / vận chuyển: có hoàn phí giao hàng.'
                  : 'Phí giao hàng chỉ được hoàn khi trả toàn bộ hàng do lỗi cửa hàng hoặc đơn vị vận chuyển.'}
              </Notice>
            </div>
          </Panel>
          {relatedRefunds.length ? (
            relatedRefunds.map((refund) => (
              <RefundCard
                key={`${refund.id}-${refund.attemptCount}-${refund.status}`}
                refund={refund}
              />
            ))
          ) : (
            <Panel title="Hoàn tiền">
              <Notice tone="amber">
                Nghĩa vụ hoàn tiền được xác định sau khi ghi nhận hàng trả và
                đối soát khoản thanh toán thực tế.
              </Notice>
              <div className="c-actions">
                <Action disabled className="c-button--block">
                  <Send size={16} />
                  Bắt đầu hoàn tiền
                </Action>
              </div>
            </Panel>
          )}
        </aside>
      </div>
      {decision && (
        <ReasonDrawer
          title={
            decision === 'reject' ? 'Từ chối trả hàng' : 'Đóng yêu cầu trả hàng'
          }
          description={
            decision === 'reject'
              ? 'Ghi rõ lý do từ chối để khách hàng theo dõi.'
              : 'Phần hàng chưa nhận sẽ được kết thúc theo yêu cầu này. Các hàng đã nhận và khoản hoàn tiền tiếp tục được giữ lại.'
          }
          path={`staff/returns/${request.id}/${decision}`}
          actionLabel={
            decision === 'reject' ? 'Xác nhận từ chối' : 'Xác nhận đóng yêu cầu'
          }
          onClose={() => setDecision(null)}
        />
      )}
    </>
  )
}

export function RefundCard({ refund }: { refund: Refund }) {
  const [showOutcome, setShowOutcome] = useState(false)
  const actor = useActor()
  const latest = refund.attempts.find(
    (attempt) => attempt.number === refund.attemptCount,
  )
  const manual = refund.permittedActions.includes('start_manual_attempt')
  const start = useCommand(
    (reason?: string) =>
      write(
        `${manual ? 'admin' : 'staff'}/refunds/${refund.id}/attempts`,
        manual ? { reason: reason ?? '' } : {},
      ),
    paymentQueryPaths,
  )
  const actions = refund.permittedActions
  return (
    <Panel title={`Hoàn tiền #${shortId(refund.id)}`} icon={<CreditCardIcon />}>
      <div className="c-form-section">
        <Badge status={refund.status} />
        <dl className="c-financial-dl">
          <div>
            <dt>Nghĩa vụ hoàn</dt>
            <dd>{formatMoney(refund.amountVnd)}</dd>
          </div>
          <div>
            <dt>Đã hoàn</dt>
            <dd>{formatMoney(refund.settledVnd)}</dd>
          </div>
          <div className="c-financial-dl__total">
            <dt>Còn phải hoàn</dt>
            <dd>{formatMoney(refund.remainingVnd)}</dd>
          </div>
          <div>
            <dt>Số lần xử lý</dt>
            <dd>
              {refund.attemptCount} / 3
              {refund.attemptCount > 3 ? ' · Quản trị viên' : ''}
            </dd>
          </div>
        </dl>
        <ErrorNotice error={start.error} />
        {refund.startBlockedReason === 'REFUND_CHECKER_UNAVAILABLE' && (
          <Notice tone="amber">
            Chưa thể mở lần hoàn tiền vì thiếu quản trị viên khác người mở để
            xác minh kết quả. Cần bổ sung người có quyền phù hợp trước khi xử
            lý.
            {actor.data?.role === 'admin' &&
              (refund.status === 'needs_review'
                ? ' Lần hoàn thủ công cần ít nhất hai quản trị viên.'
                : ' Có thể giao kế toán mở lần hoàn tiêu chuẩn để bạn xác minh, hoặc bổ sung một quản trị viên khác nếu bạn trực tiếp mở.')}
            {actor.data?.role === 'admin' && (
              <Link to="/staff/team" className="c-text-link">
                Quản lý nhân sự và phân quyền
              </Link>
            )}
          </Notice>
        )}
        {actions.includes('start_attempt') && (
          <>
            <small>
              Mở lần xử lý và thực hiện hoàn tiền. Quản trị viên khác người mở
              sẽ xác minh kết quả từ bằng chứng thực tế.
            </small>
            <Action
              pending={start.isPending}
              onClick={() => {
                void start.run(undefined)
              }}
            >
              <Send size={16} />
              {refund.attemptCount === 0
                ? 'Bắt đầu hoàn tiền'
                : 'Bắt đầu lần xử lý tiếp theo'}
            </Action>
          </>
        )}
        {actions.includes('start_manual_attempt') && (
          <form
            className="c-form-section"
            onSubmit={async (event) => {
              event.preventDefault()
              const reason = String(
                new FormData(event.currentTarget).get('reason'),
              ).trim()
              if (reason.length >= 3) await start.run(reason)
            }}
          >
            <Notice tone="amber">
              Đã hết số lần xử lý tiêu chuẩn. Quản trị viên cần xác nhận lý do
              xử lý tiếp. Một quản trị viên khác phải xác minh kết quả.
            </Notice>
            <Field label="Lý do xử lý của quản trị viên *">
              <textarea
                name="reason"
                minLength={3}
                maxLength={1000}
                required
                disabled={start.isPending}
              />
            </Field>
            <Action type="submit" pending={start.isPending}>
              <LockKeyhole size={16} />
              Mở lần xử lý quản trị viên
            </Action>
          </form>
        )}
        {actions.includes('reconcile_latest_attempt') && latest && (
          <>
            <Notice tone="amber">
              <strong>
                {latest.status === 'unknown'
                  ? 'Kết quả chuyển tiền chưa rõ'
                  : 'Lần xử lý đang chờ xác minh'}
              </strong>
              Đối soát lần chuyển trước khi thử lại.
            </Notice>
            <CopyValue label="Mã lần xử lý" value={latest.id} />
            <p>
              <small>
                Số tiền của lần xử lý: {formatMoney(latest.requestedAmountVnd)}
              </small>
            </p>
            <Action variant="secondary" onClick={() => setShowOutcome(true)}>
              Ghi nhận kết quả thực tế
            </Action>
            <Action disabled variant="secondary">
              Thử lại chuyển tiền
            </Action>
          </>
        )}
        {latest &&
          !latest.remainderNotSentVerified &&
          latest.settledAmountVnd < latest.requestedAmountVnd &&
          !actions.includes('reconcile_latest_attempt') && (
            <Notice tone="amber">
              Lần xử lý do {latest.recordedByName ?? latest.recordedBy} mở đang
              chờ một quản trị viên khác người mở xác minh kết quả.
            </Notice>
          )}
        {refund.status === 'needs_review' && actor.data?.role !== 'admin' && (
          <Notice tone="amber">
            <LockKeyhole
              size={14}
              style={{ display: 'inline', marginRight: 6 }}
            />
            Cần quản trị viên xử lý sau khi đã hết số lần thử.
          </Notice>
        )}
        {refund.status === 'awaiting_payment' && (
          <Notice>
            Đang chờ xác minh khoản thanh toán trước khi xác định số tiền có thể
            hoàn.
          </Notice>
        )}
        {refund.attempts.length > 0 && (
          <div>
            <h3>Lịch sử xử lý hoàn tiền</h3>
            {refund.attempts.map((attempt) => (
              <div key={attempt.id} className="c-detail-meta">
                <span>
                  Lần {attempt.number} · {formatDate(attempt.createdAt)}
                  <br />
                  Thực tế đã hoàn: {formatMoney(attempt.actualSettledVnd)}
                  <br />
                  Người mở: {attempt.recordedByName ?? attempt.recordedBy}
                  {attempt.resolvedBy && (
                    <>
                      <br />
                      Người xác minh:{' '}
                      {attempt.resolvedByName ?? attempt.resolvedBy}
                    </>
                  )}
                </span>
                <Badge status={attempt.status} />
              </div>
            ))}
          </div>
        )}
      </div>
      {showOutcome &&
        latest &&
        actions.includes('reconcile_latest_attempt') && (
          <RefundOutcomeDrawer
            refund={refund}
            onClose={() => setShowOutcome(false)}
          />
        )}
    </Panel>
  )
}

function CreditCardIcon() {
  return <RotateCcw size={19} />
}

function RefundOutcomeDrawer({
  refund,
  onClose,
}: {
  refund: Refund
  onClose: () => void
}) {
  const latest = refund.attempts.find(
    (attempt) => attempt.number === refund.attemptCount,
  )
  const [outcome, setOutcome] = useState('unknown')
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`staff/refunds/${refund.id}/attempts/${latest?.id}/outcome`, input),
    paymentQueryPaths,
  )
  if (!latest) return null
  const maxAmount = Math.max(
    0,
    Math.min(
      refund.remainingVnd,
      latest.requestedAmountVnd - latest.settledAmountVnd,
    ),
  )
  return (
    <Drawer
      title="Đối soát kết quả hoàn tiền"
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const input =
            outcome === 'settled'
              ? {
                  outcome,
                  amountVnd: Number(data.get('amount')),
                  currency: 'VND',
                  method: String(data.get('method')),
                  reference: String(data.get('reference')).trim(),
                  settledAt: inputToIso(String(data.get('time'))),
                  receiptVerified: true,
                  ...(data.get('remainder') === 'on'
                    ? { remainderNotSentVerified: true }
                    : {}),
                }
              : {
                  outcome,
                  reason: String(data.get('reason')).trim(),
                  ...(outcome === 'not_sent'
                    ? { nonSettlementVerified: true }
                    : {}),
                }
          if (await command.run(input)) onClose()
        }}
      >
        <Notice tone="amber">
          Kết quả phải do quản trị viên khác người mở lần xử lý xác minh. Chỉ
          ghi nhận bằng chứng đã kiểm tra thực tế. Nếu chưa rõ tiền đã chuyển
          hay chưa, giữ trạng thái “Chưa rõ kết quả”.
        </Notice>
        <Field label="Kết quả">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            disabled={command.isPending}
          >
            <option value="unknown">Chưa rõ kết quả</option>
            <option value="not_sent">Đã xác minh tiền chưa chuyển</option>
            <option value="settled">Đã xác minh tiền đã hoàn</option>
          </select>
        </Field>
        {outcome === 'settled' ? (
          <>
            <Field label="Số tiền thực tế đã hoàn (VND) *">
              <input
                name="amount"
                type="number"
                min={1}
                max={maxAmount}
                step={1}
                required
                disabled={command.isPending}
              />
            </Field>
            <Field label="Phương thức hoàn tiền">
              <select name="method" disabled={command.isPending}>
                <option value="bank_transfer">Chuyển khoản</option>
                <option value="cash">Tiền mặt</option>
              </select>
            </Field>
            <Field label="Mã giao dịch / bằng chứng thực tế *">
              <input
                name="reference"
                minLength={3}
                maxLength={200}
                required
                disabled={command.isPending}
              />
            </Field>
            <Field label="Thời điểm hoàn tiền (giờ Việt Nam) *">
              <input
                type="datetime-local"
                step={0.001}
                name="time"
                required
                min={vietnamDateInput(latest.createdAt)}
                max={vietnamDateInput()}
                disabled={command.isPending}
              />
            </Field>
            <label className="c-check">
              <input type="checkbox" required disabled={command.isPending} />
              Đã xác minh bằng chứng tiền thực tế được hoàn
            </label>
            <label className="c-check">
              <input
                type="checkbox"
                name="remainder"
                disabled={command.isPending}
              />
              Nếu chỉ hoàn một phần, đã xác minh phần còn lại của lần này chưa
              được chuyển
            </label>
          </>
        ) : (
          <>
            <Field label="Lý do / kết quả kiểm tra *">
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                disabled={command.isPending}
              />
            </Field>
            {outcome === 'not_sent' && (
              <label className="c-check">
                <input type="checkbox" required disabled={command.isPending} />
                Đã xác minh khoản tiền còn lại chưa được chuyển
              </label>
            )}
          </>
        )}
        <ErrorNotice error={command.error} />
        <Action type="submit" pending={command.isPending}>
          Lưu kết quả đối soát
        </Action>
      </form>
    </Drawer>
  )
}
