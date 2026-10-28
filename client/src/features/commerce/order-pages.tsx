import { Link } from '@tanstack/react-router'
import {
  CircleCheck,
  CreditCard,
  Landmark,
  MapPin,
  RefreshCw,
  RotateCcw,
  Truck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { orderQueryPaths, useCommand, useOrder, write } from './api'
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
  PageHeading,
  Panel,
  PriceSummary,
  ProductThumb,
  Quantity,
  QueryError,
  RecipientCard,
  shortId,
  useOrderId,
} from './components'
import { RecipientFields, recipientSchema } from './customer-pages'
import { CustomerLayout } from './layouts'
import { OrderProgress } from './order-progress'
import type { OrderDetail, Recipient } from './types'

export function CustomerOrderPage() {
  return (
    <CustomerLayout>
      <AccessGate>
        <OrderContent />
      </AccessGate>
    </CustomerLayout>
  )
}

function OrderContent() {
  const id = useOrderId()
  const query = useOrder(id, true)
  if (!z.uuid().safeParse(id).success)
    return <Empty title="Mã đơn hàng không hợp lệ" />
  if (query.isPending) return <Loading />
  if (query.isError)
    return <QueryError error={query.error} retry={() => query.refetch()} />
  const order = query.data
  return (
    <>
      <div className="c-breadcrumb">
        <Link to="/orders">Tài khoản / Đơn hàng</Link>
        <span>/</span>
        <span>{order.code}</span>
      </div>
      <PageHeading
        title="Chi tiết đơn hàng"
        subtitle={
          <>
            Mã đơn hàng: <strong>#{order.code}</strong> · Đặt ngày:{' '}
            {formatDate(order.createdAt)}
          </>
        }
      >
        <Action
          variant="secondary"
          pending={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={16} />
          Cập nhật
        </Action>
      </PageHeading>
      <div className="c-badges">
        <Badge status={order.status} />
        <Badge status={order.payment.status} />
      </div>
      <OrderProgress order={order} audience="customer" />
      {order.cancellationReason && (
        <Notice tone="red">Lý do hủy: {order.cancellationReason}</Notice>
      )}
      {order.paymentReviewRequired && (
        <div className="c-payment-notice">
          <Notice tone="amber">
            <strong>Đang đối soát thanh toán</strong>Cửa hàng đang kiểm tra
            khoản chuyển đến theo hạn thanh toán. Đơn hàng được tiếp tục xử lý
            sau khi đối soát.
          </Notice>
        </div>
      )}
      <div className="c-columns">
        <div className="c-stack">
          <Panel title="Thông tin nhận hàng" icon={<MapPin size={20} />}>
            <div className="c-info-grid">
              <RecipientCard recipient={order.recipient} />
              <div className="c-form-section">
                <p>
                  <Truck
                    size={18}
                    style={{ display: 'inline', marginRight: 8 }}
                  />
                  Giao hàng tiêu chuẩn
                </p>
                {order.shipment && (
                  <p>
                    <small>Đơn vị vận chuyển</small>
                    <br />
                    <b>{order.shipment.carrier?.name ?? 'Chưa xác định'}</b>
                    <br />
                    <small>Mã vận đơn</small>
                    <br />
                    <b>{order.shipment.trackingReference}</b>
                    <br />
                    <Badge status={order.shipment.status} />
                  </p>
                )}
                {order.deliveredAt && (
                  <p>
                    <small>Giao thành công</small>
                    <br />
                    {formatDate(order.deliveredAt)}
                  </p>
                )}
              </div>
            </div>
          </Panel>
          <Panel title={`Sản phẩm trong đơn (${order.items.length})`}>
            <CompactLines lines={order.items} />
          </Panel>
          <CustomerReturns order={order} />
          <OrderHistory order={order} />
        </div>
        <aside className="c-stack">
          <Panel title="Tóm tắt thanh toán" icon={<CreditCard size={20} />}>
            <PriceSummary
              subtotal={order.prices.subtotalVnd}
              shipping={order.prices.shippingFeeVnd}
              total={order.prices.totalVnd}
            />
            <dl className="c-financial-dl">
              <div>
                <dt>Hình thức thanh toán</dt>
                <dd>
                  {order.paymentMethod === 'cod' ? 'COD' : 'Chuyển khoản'}
                </dd>
              </div>
              <div>
                <dt>Đã thanh toán</dt>
                <dd>{formatMoney(order.payment.paidVnd)}</dd>
              </div>
              {order.prices.returnedGoodsVnd > 0 && (
                <>
                  <div>
                    <dt>Giá trị hàng đã trả</dt>
                    <dd>{formatMoney(order.prices.returnedGoodsVnd)}</dd>
                  </div>
                  <div>
                    <dt>Tổng sau trả hàng</dt>
                    <dd>{formatMoney(order.prices.adjustedTotalVnd)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Đã hoàn tiền (ròng)</dt>
                <dd>{formatMoney(order.payment.netRefundedVnd)}</dd>
              </div>
              <div>
                <dt>Còn phải thanh toán</dt>
                <dd>{formatMoney(order.payment.amountDueVnd)}</dd>
              </div>
            </dl>
            {order.paymentMethod === 'bank_transfer' &&
              order.status !== 'cancelled' && (
                <div className="c-actions">
                  <Link
                    to="/orders/$orderId/payment"
                    params={{ orderId: id }}
                    className="c-button c-button--secondary c-button--block"
                  >
                    <Landmark size={17} />
                    Thông tin chuyển khoản
                  </Link>
                </div>
              )}
            <CustomerOrderActions order={order} />
          </Panel>
          {order.refunds.length > 0 && (
            <Panel title="Theo dõi hoàn tiền">
              {order.refunds.map((refund) => (
                <div className="c-form-section" key={refund.id}>
                  <div className="c-badges">
                    <Badge status={refund.status} />
                    <strong>{formatMoney(refund.amountVnd)}</strong>
                  </div>
                  <small>
                    Đã hoàn: {formatMoney(refund.settledVnd)} · Còn lại:{' '}
                    {formatMoney(refund.remainingVnd)}
                  </small>
                  <div className="c-divider" />
                </div>
              ))}
            </Panel>
          )}
        </aside>
      </div>
    </>
  )
}

export function CustomerOrderActions({ order }: { order: OrderDetail }) {
  const [dialog, setDialog] = useState<'address' | 'cancel' | 'return' | null>(
    null,
  )
  const actions = order.permittedActions.customer
  return (
    <>
      <div className="c-payment-actions">
        {actions.includes('update_recipient') && (
          <Action variant="secondary" onClick={() => setDialog('address')}>
            Sửa địa chỉ
          </Action>
        )}
        {actions.includes('request_return') && (
          <Action variant="secondary" onClick={() => setDialog('return')}>
            <RotateCcw size={16} />
            Yêu cầu trả hàng
          </Action>
        )}
        {actions.includes('cancel') && (
          <Action variant="danger" onClick={() => setDialog('cancel')}>
            Hủy đơn hàng
          </Action>
        )}
      </div>
      {dialog === 'address' && (
        <AddressDrawer order={order} onClose={() => setDialog(null)} />
      )}
      {dialog === 'cancel' && (
        <ReasonDrawer
          title="Hủy đơn hàng"
          description="Đơn hàng sẽ được hủy. Khoản tiền đã nhận, nếu có, được xử lý theo quy trình hoàn tiền của cửa hàng."
          path={`orders/${order.id}/cancel`}
          actionLabel="Xác nhận hủy đơn"
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'return' && (
        <ReturnRequestDrawer order={order} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

export function AddressDrawer({
  order,
  onClose,
  staff = false,
}: {
  order: OrderDetail
  onClose: () => void
  staff?: boolean
}) {
  const form = useForm<Recipient>({ defaultValues: order.recipient })
  const command = useCommand(
    (recipient: Recipient) =>
      write(
        `${staff ? 'staff/' : ''}orders/${order.id}/recipient`,
        { recipient, expectedRevision: order.revision },
        'patch',
      ),
    ['orders', 'staff/orders'],
  )
  return (
    <Drawer
      title="Cập nhật thông tin người nhận"
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={form.handleSubmit(async (values) => {
          const parsed = recipientSchema.safeParse(values)
          if (!parsed.success) {
            for (const issue of parsed.error.issues)
              form.setError(issue.path[0] as keyof Recipient, {
                message: issue.message,
              })
            return
          }
          if (await command.run(parsed.data)) onClose()
        })}
      >
        <RecipientFields form={form} />
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            disabled={command.isPending}
            onClick={onClose}
          >
            Quay lại
          </Action>
          <Action type="submit" pending={command.isPending}>
            Lưu thông tin
          </Action>
        </div>
      </form>
    </Drawer>
  )
}

export function ReasonDrawer({
  title,
  description,
  path,
  actionLabel,
  onClose,
}: {
  title: string
  description: string
  path: string
  actionLabel: string
  onClose: () => void
}) {
  const command = useCommand(
    (reason: string) => write(path, { reason }),
    orderQueryPaths,
  )
  return (
    <Drawer title={title} onClose={onClose} busy={command.isPending}>
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const reason = String(
            new FormData(event.currentTarget).get('reason'),
          ).trim()
          if (reason.length >= 3 && (await command.run(reason))) onClose()
        }}
      >
        <Notice tone="amber">{description}</Notice>
        <Field label="Lý do *">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
          />
        </Field>
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            onClick={onClose}
            disabled={command.isPending}
          >
            Quay lại
          </Action>
          <Action type="submit" pending={command.isPending}>
            {actionLabel}
          </Action>
        </div>
      </form>
    </Drawer>
  )
}

function ReturnRequestDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const selected = order.items.filter((item) => (quantities[item.id] ?? 0) > 0)
  const command = useCommand(
    (input: {
      reason: string
      items: { orderItemId: string; quantity: number }[]
    }) => write(`orders/${order.id}/returns`, input),
    orderQueryPaths,
  )
  return (
    <Drawer title="Yêu cầu trả hàng" onClose={onClose} busy={command.isPending}>
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!selected.length || reason.trim().length < 3) return
          if (
            await command.run({
              reason: reason.trim(),
              items: selected.map((item) => ({
                orderItemId: item.id,
                quantity: quantities[item.id],
              })),
            })
          )
            onClose()
        }}
      >
        <Notice>
          Có thể yêu cầu trả hàng trong <b>7 ngày</b> từ khi giao thành công.
          <br />
          Hạn gửi yêu cầu: {formatDate(order.returnWindowEndsAt)}
        </Notice>
        <h3>Chọn sản phẩm yêu cầu trả</h3>
        {order.items.map((item) => (
          <div className="c-return-product" key={item.id}>
            <input
              type="checkbox"
              aria-label={`Yêu cầu trả ${item.nameSnapshot}`}
              checked={(quantities[item.id] ?? 0) > 0}
              disabled={
                command.isPending || item.remainingReturnableQuantity <= 0
              }
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [item.id]: event.target.checked ? 1 : 0,
                }))
              }
            />
            <ProductThumb name={item.nameSnapshot} sku={item.skuSnapshot} />
            <div>
              <strong>{item.nameSnapshot}</strong>
              <small>{item.skuSnapshot}</small>
              <br />
              <b className="c-red">{formatMoney(item.unitPriceVnd)}</b>
              <br />
              <small>Còn được trả: {item.remainingReturnableQuantity}</small>
            </div>
            {(quantities[item.id] ?? 0) > 0 && (
              <Quantity
                label={`số lượng trả ${item.nameSnapshot}`}
                value={quantities[item.id]}
                max={item.remainingReturnableQuantity}
                disabled={command.isPending}
                onChange={(quantity) =>
                  setQuantities((current) => ({
                    ...current,
                    [item.id]: quantity,
                  }))
                }
              />
            )}
          </div>
        ))}
        <Field label="Lý do trả hàng *" hint={`${reason.length}/1000 ký tự`}>
          <textarea
            value={reason}
            required
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Mô tả vấn đề với sản phẩm…"
          />
        </Field>
        <div className="c-return-estimate">
          <div>
            <strong>Giá trị hàng yêu cầu trả</strong>
            <br />
            <small>
              Số tiền hoàn được xác định sau khi duyệt và nhận hàng.
            </small>
          </div>
          <b>
            {formatMoney(
              selected.reduce(
                (sum, item) => sum + item.unitPriceVnd * quantities[item.id],
                0,
              ),
            )}
          </b>
        </div>
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            onClick={onClose}
            disabled={command.isPending}
          >
            Quay lại
          </Action>
          <Action
            type="submit"
            pending={command.isPending}
            disabled={selected.length === 0 || reason.trim().length < 3}
          >
            Gửi yêu cầu trả hàng
          </Action>
        </div>
      </form>
    </Drawer>
  )
}

function CustomerReturns({ order }: { order: OrderDetail }) {
  const [withdraw, setWithdraw] = useState<string | null>(null)
  if (order.returns.length === 0) return null
  return (
    <Panel title="Yêu cầu trả hàng" icon={<RotateCcw size={19} />}>
      <div className="c-stack">
        {order.returns.map((request) => (
          <div key={request.id}>
            <div className="c-badges">
              <strong>#{shortId(request.id)}</strong>
              <Badge status={request.status} />
            </div>
            <p style={{ marginTop: 10 }}>{request.reason}</p>
            <small>Ngày yêu cầu: {formatDate(request.createdAt)}</small>
            <div className="c-actions">
              {request.permittedActions.includes('withdraw') && (
                <Action
                  variant="secondary"
                  onClick={() => setWithdraw(request.id)}
                >
                  Rút yêu cầu
                </Action>
              )}
            </div>
          </div>
        ))}
      </div>
      {withdraw && (
        <ReasonDrawer
          title="Rút yêu cầu trả hàng"
          description="Yêu cầu này sẽ được rút trước khi cửa hàng nhận hàng."
          path={`returns/${withdraw}/withdraw`}
          actionLabel="Xác nhận rút yêu cầu"
          onClose={() => setWithdraw(null)}
        />
      )}
    </Panel>
  )
}

export function BankTransferPage() {
  return (
    <CustomerLayout>
      <AccessGate>
        <BankTransferContent />
      </AccessGate>
    </CustomerLayout>
  )
}

function BankTransferContent() {
  const id = useOrderId()
  const query = useOrder(id, true)
  const [, updateClock] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => updateClock((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!z.uuid().safeParse(id).success)
    return <Empty title="Mã đơn hàng không hợp lệ" />
  if (query.isPending) return <Loading />
  if (query.isError)
    return <QueryError error={query.error} retry={() => query.refetch()} />
  const order = query.data
  if (order.paymentMethod !== 'bank_transfer')
    return (
      <Empty title="Đơn hàng thanh toán khi nhận hàng">
        <Link
          to="/orders/$orderId"
          params={{ orderId: id }}
          className="c-button c-button--primary"
        >
          Xem chi tiết đơn hàng
        </Link>
      </Empty>
    )
  const paymentDeadline = order.paymentDeadlineAt
    ? new Date(order.paymentDeadlineAt).getTime()
    : null
  const serverNow =
    Date.parse(order.serverTime) +
    Math.max(0, performance.now() - order.clockStartedAt)
  const paymentWindowOpen =
    paymentDeadline !== null && serverNow < paymentDeadline
  const paymentDeadlinePassed =
    paymentDeadline !== null && serverNow >= paymentDeadline
  const showTransfer =
    order.status !== 'cancelled' &&
    !order.paymentReviewRequired &&
    !order.reservationExpired &&
    !order.payment.latePaymentApprovalRequired &&
    order.payment.balancesVerified &&
    paymentWindowOpen &&
    order.payment.amountDueVnd !== null &&
    order.payment.amountDueVnd > 0
  return (
    <>
      <div className="c-page-heading">
        <div className="c-success-heading">
          <span className="c-success-icon">
            <CircleCheck size={39} />
          </span>
          <div>
            <h1>
              {order.status === 'cancelled'
                ? 'Đơn hàng đã hủy'
                : order.payment.bankPaymentApproved
                  ? 'Thanh toán đã được xác minh'
                  : 'Đặt hàng thành công'}
            </h1>
            <p>
              Đơn hàng #{order.code}
              {showTransfer ? ' đang chờ thanh toán.' : '.'}
            </p>
          </div>
        </div>
        <div className="c-badges">
          <Badge status={order.status} />
          <Badge status={order.payment.status} />
        </div>
      </div>
      {showTransfer && order.paymentDeadlineAt && (
        <div className="c-payment-notice">
          <Notice tone="amber">
            <strong>
              Vui lòng chuyển khoản trước {formatDate(order.paymentDeadlineAt)}
            </strong>
            Thanh toán được đối soát theo thời điểm tiền vào tài khoản.
          </Notice>
        </div>
      )}
      <div className="c-columns c-columns--balanced">
        <Panel title="Thông tin chuyển khoản" icon={<Landmark size={21} />}>
          {showTransfer && order.bankInstructions ? (
            <>
              <div className="c-copy-list">
                <CopyValue
                  label="Ngân hàng"
                  value={order.bankInstructions.bankName}
                />
                <CopyValue
                  label="Chủ tài khoản"
                  value={order.bankInstructions.accountHolder}
                />
                <CopyValue
                  label="Số tài khoản"
                  value={order.bankInstructions.accountNumber}
                />
                <CopyValue
                  label="Nội dung chuyển khoản"
                  value={order.bankTransferReference ?? order.id}
                />
                <CopyValue
                  label="Số tiền thanh toán (VND)"
                  value={String(order.payment.amountDueVnd)}
                  highlight
                />
              </div>
              <div className="c-actions">
                <Notice>
                  <strong>
                    Thanh toán được xác nhận sau khi đối soát giao dịch.
                  </strong>
                  Chuyển đúng số tiền và nội dung để cửa hàng xác minh khoản
                  thanh toán.
                </Notice>
              </div>
            </>
          ) : (
            <Notice
              tone={order.payment.bankPaymentApproved ? 'green' : 'amber'}
            >
              {order.payment.bankPaymentApproved
                ? 'Cửa hàng đã xác minh thanh toán cho đơn hàng này.'
                : order.status === 'cancelled'
                  ? 'Vui lòng không chuyển khoản cho đơn hàng đã hủy.'
                  : order.payment.latePaymentApprovalRequired
                    ? 'Khoản thanh toán vào sau hạn đang chờ quản trị viên xem xét. Vui lòng không chuyển thêm tiền.'
                    : order.paymentReviewRequired ||
                        order.reservationExpired ||
                        paymentDeadlinePassed
                      ? 'Đã hết hạn thanh toán. Vui lòng chờ cửa hàng đối soát khoản đã chuyển và không chuyển thêm tiền.'
                      : showTransfer && !order.bankInstructions
                        ? 'Chưa có thông tin tài khoản nhận cho đơn hàng này. Vui lòng liên hệ cửa hàng trước khi chuyển tiền.'
                        : 'Số dư đang được kiểm tra. Vui lòng chờ kết quả đối soát trước khi chuyển thêm tiền.'}
            </Notice>
          )}
          <div className="c-actions">
            <Action
              variant="secondary"
              pending={query.isFetching}
              onClick={() => query.refetch()}
            >
              <RefreshCw size={16} />
              Kiểm tra trạng thái
            </Action>
          </div>
        </Panel>
        <Panel title={`Thông tin đơn hàng #${order.code}`}>
          <small>Đặt lúc {formatDate(order.createdAt)}</small>
          <div className="c-divider" />
          <CompactLines lines={order.items} />
          <PriceSummary
            subtotal={order.prices.subtotalVnd}
            shipping={order.prices.shippingFeeVnd}
            total={order.prices.totalVnd}
          />
          <Panel title="Thông tin nhận hàng">
            <RecipientCard recipient={order.recipient} />
          </Panel>
          <div className="c-actions">
            <Link
              to="/orders/$orderId"
              params={{ orderId: id }}
              className="c-button c-button--primary"
            >
              Xem chi tiết đơn
            </Link>
          </div>
          <CustomerOrderActions order={order} />
        </Panel>
      </div>
      {order.paymentReviewRequired && (
        <div className="c-actions">
          <Notice tone="amber">
            <strong>Đang đối soát sau hạn thanh toán</strong>Cửa hàng đang kiểm
            tra sao kê để xác nhận khoản chuyển đến đúng hạn. Bạn có thể theo
            dõi kết quả trong chi tiết đơn hàng.
          </Notice>
        </div>
      )}
    </>
  )
}
