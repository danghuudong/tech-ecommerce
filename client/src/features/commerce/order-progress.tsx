import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  History,
  LocateFixed,
  Package,
  RotateCcw,
  Route,
  ShoppingBag,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import {
  Action,
  Badge,
  formatDate,
  formatMoney,
  Notice,
  OrderEventList,
  orderLabels,
} from './components'
import { type OrderStage, orderProgressModel } from './order-progress-model'
import type { OrderDetail } from './types'
import './order-progress.css'
import './order-tracking-timeline.css'

const stages = {
  placed: {
    name: 'Đặt hàng',
    icon: ShoppingBag,
    description: 'Thông tin đơn hàng và các cập nhật trước khi xử lý.',
  },
  confirmed: {
    name: 'Xác nhận',
    icon: ClipboardCheck,
    description: 'Thông tin tiếp nhận và xác nhận đơn hàng.',
  },
  packing: {
    name: 'Đóng gói',
    icon: Package,
    description: 'Thông tin đóng gói và tình trạng giữ hàng hiện tại.',
  },
  shipped: {
    name: 'Vận chuyển',
    icon: Truck,
    description: 'Vận đơn đang có hiệu lực và các lần giao hàng đã ghi nhận.',
  },
  delivered: {
    name: 'Đã giao',
    icon: CircleCheck,
    description: 'Thời điểm giao thành công và xác nhận nhận hàng.',
  },
  completed: {
    name: 'Hoàn tất',
    icon: ClipboardCheck,
    description: 'Mốc hoàn tất xử lý và tình hình thanh toán hiện tại.',
  },
}

const stateLabels = {
  done: 'Đã thực hiện',
  current: 'Bước hiện tại',
  corrected: 'Đã hoàn tác',
  upcoming: 'Chưa đến bước',
}

const staffStageNames: Partial<
  Record<OrderStage, { current: string; done: string }>
> = {
  confirmed: { current: 'Đã xác nhận', done: 'Đã xác nhận' },
  packing: { current: 'Đang đóng gói', done: 'Đã đóng gói' },
  shipped: { current: 'Đang vận chuyển', done: 'Đã vận chuyển' },
}

export function OrderProgress({
  order,
  audience = 'staff',
  actions,
}: {
  order: OrderDetail
  audience?: 'customer' | 'staff'
  actions?: ReactNode
}) {
  return audience === 'staff' ? (
    <OrderTrackingTimeline order={order} actions={actions} />
  ) : (
    <OrderStepProgress order={order} audience={audience} />
  )
}

function OrderStepProgress({
  order,
  audience = 'staff',
}: {
  order: OrderDetail
  audience?: 'customer' | 'staff'
}) {
  const model = orderProgressModel(order, audience)
  const [selection, setSelection] = useState<{
    orderId: string
    stage: OrderStage
  } | null>(null)
  const tabs = useRef<Partial<Record<OrderStage, HTMLButtonElement | null>>>({})
  const id = useId()
  const selected =
    selection?.orderId === order.id && model.canView(selection.stage)
      ? selection.stage
      : model.activeStage
  const selectedIndex = model.visibleStages.indexOf(selected)
  const selectedState = model.state(selected)
  const title = model.cancelled
    ? 'Đơn hàng đã hủy'
    : orderLabels[
        audience === 'customer' && order.status === 'completed'
          ? 'delivered'
          : order.status
      ]

  function select(stage: OrderStage) {
    setSelection({ orderId: order.id, stage })
  }

  function navigate(
    event: KeyboardEvent<HTMLButtonElement>,
    stage: OrderStage,
  ) {
    const available = model.visibleStages.filter(model.canView)
    const index = available.indexOf(stage)
    const target =
      event.key === 'Home'
        ? available[0]
        : event.key === 'End'
          ? available[available.length - 1]
          : event.key === 'ArrowRight'
            ? available[(index + 1) % available.length]
            : event.key === 'ArrowLeft'
              ? available[(index - 1 + available.length) % available.length]
              : null
    if (!target) return
    event.preventDefault()
    select(target)
    tabs.current[target]?.focus()
  }

  return (
    <section
      className={`c-order-tracker c-order-tracker--${audience}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="c-order-tracker__header">
        <div>
          <p className="c-order-tracker__eyebrow">Tiến trình đơn hàng</p>
          <h2 id={`${id}-title`}>{title}</h2>
          <p className="c-order-tracker__hint">
            Chọn một bước đã thực hiện để xem thông tin và lịch sử.
          </p>
        </div>
        <span
          className={`c-order-tracker__status${model.cancelled ? ' is-cancelled' : model.finished ? ' is-finished' : ''}`}
        >
          {model.cancelled
            ? 'Đã dừng xử lý'
            : model.finished
              ? 'Đã hoàn thành'
              : `Bước ${model.activeIndex + 1} / ${model.visibleStages.length}`}
        </span>
      </header>
      <div
        className="c-order-tracker__steps"
        role="tablist"
        aria-label="Các bước xử lý đơn hàng"
      >
        {model.visibleStages.map((stage, index) => {
          const state = model.state(stage)
          const Icon =
            state === 'done'
              ? Check
              : state === 'corrected'
                ? RotateCcw
                : stages[stage].icon
          return (
            <button
              key={stage}
              ref={(element) => {
                tabs.current[stage] = element
              }}
              type="button"
              role="tab"
              id={`${id}-${stage}`}
              aria-controls={`${id}-panel`}
              aria-selected={selected === stage}
              aria-current={
                !model.cancelled && stage === model.activeStage
                  ? 'step'
                  : undefined
              }
              tabIndex={selected === stage ? 0 : -1}
              disabled={!model.canView(stage)}
              className={`c-order-tracker__step is-${state}${selected === stage ? ' is-selected' : ''}`}
              onClick={() => select(stage)}
              onKeyDown={(event) => navigate(event, stage)}
            >
              <span className="c-order-tracker__step-top">
                <span className="c-order-tracker__step-icon">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="c-order-tracker__number">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </span>
              <strong>{stages[stage].name}</strong>
              <span className="c-order-tracker__step-state">
                {stateLabels[state]}
              </span>
            </button>
          )
        })}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${selected}`}
        className="c-order-tracker__panel"
      >
        <div className="c-order-tracker__detail-heading">
          <div>
            <span className="c-order-tracker__eyebrow">
              Chi tiết bước {String(selectedIndex + 1).padStart(2, '0')}
            </span>
            <h3>{stages[selected].name}</h3>
            <p>
              {audience === 'customer' && selected === 'packing'
                ? 'Cửa hàng chuẩn bị sản phẩm và đóng gói đơn hàng.'
                : stages[selected].description}
            </p>
          </div>
          {selected !== model.activeStage && (
            <Action variant="ghost" onClick={() => setSelection(null)}>
              {model.cancelled ? 'Về bước cuối' : 'Về bước hiện tại'}
              <ArrowRight size={15} />
            </Action>
          )}
        </div>
        {selectedState === 'corrected' && (
          <Notice tone="amber">
            Bước này đã được hoàn tác. Lịch sử và tài liệu cũ vẫn được giữ bên
            dưới để tra cứu.
          </Notice>
        )}
        <StepDetails
          key={`${order.id}-${selected}`}
          order={order}
          audience={audience}
          stage={selected}
          milestone={model.recorded.get(selected)}
          history={model.history.get(selected) ?? []}
          review={selected !== model.activeStage}
          corrected={selectedState === 'corrected'}
        />
      </div>
    </section>
  )
}

function OrderTrackingTimeline({
  order,
  actions,
}: {
  order: OrderDetail
  actions?: ReactNode
}) {
  const model = orderProgressModel(order, 'staff')
  const [selection, setSelection] = useState<{
    orderId: string
    revision: number
    stage: OrderStage
  } | null>(null)
  const buttons = useRef<Partial<Record<OrderStage, HTMLButtonElement | null>>>(
    {},
  )
  const viewport = useRef<HTMLDivElement | null>(null)
  const id = useId()
  const selected =
    selection?.orderId === order.id &&
    selection.revision === order.revision &&
    model.canView(selection.stage)
      ? selection.stage
      : model.activeStage
  const selectedIndex = model.visibleStages.indexOf(selected)
  const selectedState = model.state(selected)
  const selectedHistory = model.history.get(selected) ?? []
  const cancellation = model.cancelled
    ? [...order.history]
        .sort(
          (first, second) =>
            Date.parse(second.createdAt) - Date.parse(first.createdAt),
        )
        .find((event) => event.type === 'order_cancelled')
    : undefined

  useEffect(() => {
    const container = viewport.current
    const button = buttons.current[selected]
    if (!container || !button) return
    if (
      button.offsetLeft < container.scrollLeft ||
      button.offsetLeft + button.offsetWidth >
        container.scrollLeft + container.clientWidth
    )
      container.scrollLeft =
        button.offsetLeft - (container.clientWidth - button.offsetWidth) / 2
  }, [selected])

  function navigate(
    event: KeyboardEvent<HTMLButtonElement>,
    stage: OrderStage,
  ) {
    const available = model.visibleStages.filter(model.canView)
    const index = available.indexOf(stage)
    const target =
      event.key === 'Home'
        ? available[0]
        : event.key === 'End'
          ? available[available.length - 1]
          : event.key === 'ArrowRight'
            ? available[(index + 1) % available.length]
            : event.key === 'ArrowLeft'
              ? available[(index - 1 + available.length) % available.length]
              : null
    if (!target) return
    event.preventDefault()
    setSelection({
      orderId: order.id,
      revision: order.revision,
      stage: target,
    })
    buttons.current[target]?.focus({ preventScroll: true })
  }

  function stageName(stage: OrderStage) {
    const names = staffStageNames[stage]
    const state = model.state(stage)
    if (
      names &&
      (state === 'current' || state === 'done') &&
      !(model.cancelled && stage === model.activeStage)
    )
      return names[state]
    return stages[stage].name
  }

  return (
    <section
      className="c-order-tracker c-order-tracker--staff c-order-tracing"
      aria-labelledby={`${id}-title`}
    >
      <header className="c-order-tracing__header">
        <div className="c-order-tracing__heading">
          <span className="c-order-tracing__heading-icon">
            <Route size={23} aria-hidden="true" />
          </span>
          <div>
            <p className="c-order-tracker__eyebrow">Hành trình đơn hàng</p>
            <h2 id={`${id}-title`}>Theo dõi đơn hàng</h2>
            <p>
              Chọn mốc để xem lịch sử.
              {actions &&
                !model.cancelled &&
                ' Thao tác xử lý nằm ở mốc hiện tại.'}
            </p>
          </div>
        </div>
        <div className="c-order-tracing__current">
          <span
            className={`c-order-tracker__status${model.cancelled ? ' is-cancelled' : model.finished ? ' is-finished' : ''}`}
          >
            <span className="c-order-tracing__status-dot" aria-hidden="true" />
            {order.status === 'shipped' &&
            order.shipment?.status === 'delivery_failed'
              ? 'Giao không thành công'
              : orderLabels[order.status]}
          </span>
          <span>
            {model.cancelled
              ? 'Đã dừng xử lý'
              : model.finished
                ? 'Đã hoàn tất xử lý đơn hàng'
                : `Bước ${model.activeIndex + 1} trên ${model.visibleStages.length}`}
          </span>
        </div>
      </header>

      <dl className="c-order-tracing__summary">
        <div>
          <dt>
            <UserRound size={15} aria-hidden="true" />
            Người phụ trách
          </dt>
          <dd>{order.assignedToName ?? 'Chưa phân công'}</dd>
        </div>
        <div>
          <dt>
            <Truck size={15} aria-hidden="true" />
            Đơn vị vận chuyển
          </dt>
          <dd>
            {order.shipment?.carrier?.name ??
              (order.shipment
                ? 'Chưa xác minh đơn vị vận chuyển'
                : 'Chưa bàn giao')}
          </dd>
        </div>
        <div>
          <dt>
            <Wallet size={15} aria-hidden="true" />
            Phương thức thanh toán
          </dt>
          <dd>
            {order.paymentMethod === 'cod'
              ? 'Thanh toán khi nhận hàng (COD)'
              : 'Chuyển khoản ngân hàng'}
          </dd>
        </div>
      </dl>

      <div className="c-order-tracing__toolbar">
        <span>
          <Clock3 size={14} aria-hidden="true" />
          Thời gian ghi nhận theo giờ Việt Nam
        </span>
        <span className="c-order-tracing__scroll-hint">
          <ArrowRight size={14} aria-hidden="true" />
          Cuộn ngang để xem các mốc
        </span>
      </div>
      <div ref={viewport} className="c-order-tracing__scroll">
        <div
          className="c-order-tracing__rail"
          role="tablist"
          aria-label="Các mốc xử lý đơn hàng"
          aria-orientation="horizontal"
        >
          {model.visibleStages.map((stage, index) => {
            const state = model.state(stage)
            const history = model.history.get(stage) ?? []
            const deliverySucceeded =
              stage === 'delivered' &&
              !model.cancelled &&
              (state === 'current' || state === 'done')
            const stateLabel = deliverySucceeded
              ? stateLabels.done
              : stateLabels[state]
            const correction =
              state === 'corrected'
                ? [...history]
                    .reverse()
                    .find((event) => event.type === 'order_step_undone')
                : undefined
            const event = correction ?? model.recorded.get(stage)
            const occurredAt =
              (deliverySucceeded ? order.deliveredAt : null) ??
              event?.createdAt ??
              (stage === 'placed' ? order.createdAt : null)
            const stopped = model.cancelled && stage === model.activeStage
            const Icon = stopped
              ? X
              : state === 'done' || deliverySucceeded
                ? Check
                : state === 'corrected'
                  ? RotateCcw
                  : stages[stage].icon
            const actor =
              event?.details?.actorRole === 'system'
                ? 'Hệ thống'
                : event?.actorName
                  ? `${stage === 'placed' ? 'Khách hàng' : 'Nhân viên'}: ${event.actorName}`
                  : null
            return (
              <button
                key={stage}
                ref={(element) => {
                  buttons.current[stage] = element
                }}
                type="button"
                role="tab"
                id={`${id}-${stage}`}
                aria-controls={`${id}-panel`}
                aria-selected={selected === stage}
                aria-current={
                  !model.cancelled && stage === model.activeStage
                    ? 'step'
                    : undefined
                }
                tabIndex={selected === stage ? 0 : -1}
                disabled={!model.canView(stage)}
                className={`c-order-tracing__step is-${state}${deliverySucceeded ? ' is-delivered' : ''}${selected === stage ? ' is-selected' : ''}${stopped ? ' is-stopped' : ''}`}
                onClick={() =>
                  setSelection({
                    orderId: order.id,
                    revision: order.revision,
                    stage,
                  })
                }
                onKeyDown={(event) => navigate(event, stage)}
              >
                <span className="c-order-tracing__number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="c-order-tracing__node">
                  <Icon size={21} aria-hidden="true" />
                </span>
                <strong className="c-order-tracing__step-label">
                  {stageName(stage)}
                </strong>
                <span className="c-order-tracing__state">
                  {stopped
                    ? 'Dừng tại đây'
                    : model.cancelled && state === 'upcoming'
                      ? 'Không thực hiện'
                      : stateLabel}
                </span>
                <span className="c-order-tracing__timestamp">
                  <TrackingTime
                    value={occurredAt}
                    fallback="Chưa có thời gian"
                  />
                  {state === 'corrected' && <small>Lúc hoàn tác</small>}
                </span>
                {actor && (
                  <span className="c-order-tracing__actor" title={actor}>
                    <UserRound size={11} aria-hidden="true" />
                    <span className="c-order-tracing__actor-name">{actor}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {model.cancelled && (
        <div className="c-order-tracing__cancellation">
          <X size={17} aria-hidden="true" />
          <div>
            <strong>Đơn hàng đã hủy</strong>
            <span>
              {date(cancellation?.createdAt)}
              {cancellation?.actorName && ` · ${cancellation.actorName}`}
            </span>
            {typeof cancellation?.details?.reason === 'string' && (
              <p>Lý do: {cancellation.details.reason}</p>
            )}
          </div>
        </div>
      )}
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${selected}`}
        className="c-order-tracker__panel c-order-tracing__panel"
      >
        <div className="c-order-tracker__detail-heading">
          <div>
            <span className="c-order-tracker__eyebrow">
              Chi tiết mốc {String(selectedIndex + 1).padStart(2, '0')}
            </span>
            <h3>{stageName(selected)}</h3>
            <p>{stages[selected].description}</p>
          </div>
          {selected !== model.activeStage && (
            <Action
              variant="ghost"
              onClick={() => {
                setSelection(null)
                buttons.current[model.activeStage]?.focus({
                  preventScroll: true,
                })
              }}
            >
              <LocateFixed size={15} aria-hidden="true" />
              {model.cancelled ? 'Về bước cuối' : 'Về bước hiện tại'}
            </Action>
          )}
        </div>
        {selectedState === 'corrected' && (
          <Notice tone="amber">
            Mốc này đã được hoàn tác. Các ghi nhận và tài liệu cũ được giữ lại
            để tra cứu.
          </Notice>
        )}
        <StepDetails
          key={`${order.id}-${selected}-${selectedState}`}
          order={order}
          audience="staff"
          stage={selected}
          milestone={model.recorded.get(selected)}
          history={selectedHistory}
          review
          corrected={selectedState === 'corrected'}
        />
        {actions && !model.cancelled && (
          <div className="c-order-tracing__actions">
            {selected === model.activeStage ? (
              <>
                <div className="c-order-tracing__actions-heading">
                  <h4>Thao tác cho trạng thái hiện tại</h4>
                  <Badge status={order.status} />
                </div>
                {actions}
              </>
            ) : (
              <Notice>
                Bạn đang xem mốc “{stageName(selected)}”. Đơn hiện ở trạng thái
                “{orderLabels[order.status]}”. Chọn “Về bước hiện tại” để thực
                hiện thao tác xử lý đơn.
              </Notice>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const trackingTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
})

function TrackingTime({
  value,
  fallback,
}: {
  value: string | null | undefined
  fallback: string
}) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return <span>{fallback}</span>
  return (
    <time dateTime={value}>
      <span>{trackingTimeFormatter.format(new Date(value))}</span>
      <span>{formatDate(value, false)}</span>
    </time>
  )
}

function date(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? formatDate(value)
    : 'Chưa ghi nhận'
}

function StepDetails({
  order,
  audience,
  stage,
  milestone,
  history,
  review,
  corrected,
}: {
  order: OrderDetail
  audience: 'customer' | 'staff'
  stage: OrderStage
  milestone: OrderDetail['history'][number] | undefined
  history: OrderDetail['history']
  review: boolean
  corrected: boolean
}) {
  const [showHistory, setShowHistory] = useState(review)
  const [showAll, setShowAll] = useState(false)
  const historyId = useId()
  const actor =
    milestone?.actorName ??
    (milestone?.details?.actorRole === 'system' ? 'Hệ thống' : 'Chưa ghi nhận')
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0)
  const stockLabels: Record<string, string> = {
    reserved: 'Đang giữ hàng cho đơn',
    committed: 'Đã xuất kho',
    released: 'Đã giải phóng giữ hàng',
  }
  let facts: [string, ReactNode][]
  switch (stage) {
    case 'placed':
      facts = [
        ['Mã đơn hàng', `#${order.code}`],
        ['Thời điểm đặt', date(order.createdAt)],
        ['Giá trị đơn đã đặt', formatMoney(order.prices.totalVnd)],
        ['Sản phẩm', `${order.items.length} loại, ${quantity} sản phẩm`],
      ]
      break
    case 'confirmed':
      facts = [
        ['Thời điểm xác nhận', date(milestone?.createdAt)],
        audience === 'staff'
          ? ['Người xác nhận', actor]
          : [
              'Tình trạng thanh toán hiện tại',
              <Badge key="payment" status={order.payment.status} />,
            ],
        audience === 'staff'
          ? [
              'Người phụ trách hiện tại',
              order.assignedToName ?? 'Chưa phân công',
            ]
          : [
              'Khách còn phải thanh toán',
              formatMoney(order.payment.purchaseAmountDueVnd),
            ],
        [
          'Phương thức thanh toán',
          order.paymentMethod === 'cod'
            ? 'Thanh toán khi nhận hàng (COD)'
            : 'Chuyển khoản ngân hàng',
        ],
      ]
      break
    case 'packing':
      facts = [
        ['Bắt đầu đóng gói', date(milestone?.createdAt)],
        audience === 'staff'
          ? ['Người ghi nhận', actor]
          : [
              'Tình trạng đơn hiện tại',
              <Badge key="order" status={order.status} />,
            ],
        audience === 'staff'
          ? [
              'Tình trạng kho hiện tại',
              stockLabels[order.stockState] ?? 'Chưa xác định',
            ]
          : ['Phí vận chuyển', formatMoney(order.prices.shippingFeeVnd)],
        audience === 'staff'
          ? [
              'Số lượng đang giữ',
              `${order.stockState === 'reserved' ? quantity : 0} sản phẩm`,
            ]
          : ['Số lượng đã đặt', `${quantity} sản phẩm`],
      ]
      break
    case 'shipped':
      facts = [
        [
          'Đơn vị vận chuyển hiện tại',
          order.shipment?.carrier?.name ??
            'Chưa có đơn vị vận chuyển được xác minh',
        ],
        [
          'Mã vận đơn hiện tại',
          order.shipment?.trackingReference ?? 'Chưa có vận đơn',
        ],
        ['Thời điểm bàn giao', date(milestone?.createdAt)],
        [
          'Tình trạng vận chuyển',
          order.shipment ? (
            <Badge key="shipment" status={order.shipment.status} />
          ) : (
            'Chưa có vận đơn có hiệu lực'
          ),
        ],
      ]
      break
    case 'delivered':
      facts = [
        [
          'Giao thành công',
          date(
            corrected
              ? null
              : (order.deliveredAt ?? milestone?.details?.deliveredAt),
          ),
        ],
        audience === 'staff'
          ? ['Người ghi nhận', actor]
          : ['Số lượng đã đặt', `${quantity} sản phẩm`],
        [
          'Khách còn phải thanh toán',
          formatMoney(order.payment.purchaseAmountDueVnd),
        ],
      ]
      break
    case 'completed':
      facts = [
        ['Thời điểm hoàn tất', date(milestone?.createdAt)],
        [
          'Tình trạng thanh toán hiện tại',
          <Badge key="payment" status={order.payment.status} />,
        ],
        [
          'Khách còn phải thanh toán',
          formatMoney(order.payment.purchaseAmountDueVnd),
        ],
        [
          order.paymentMethod === 'cod'
            ? 'Đơn vị vận chuyển còn phải nộp về'
            : 'Còn phải hoàn cho khách',
          formatMoney(
            order.paymentMethod === 'cod'
              ? order.payment.carrierAmountDueVnd
              : order.payment.refundDueVnd,
          ),
        ],
      ]
  }
  const events = [...history].reverse()
  return (
    <>
      <dl className="c-order-tracker__facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {stage === 'confirmed' && order.reservationExpiresAt && (
        <p className="c-order-tracker__note">
          Hạn giữ hàng hiện tại: {date(order.reservationExpiresAt)} (giờ Việt
          Nam).
        </p>
      )}
      {stage === 'shipped' && order.shipment?.failureReason && (
        <Notice tone="amber">
          Đã giao thất bại {order.shipment.failedAttempts} lần.{' '}
          {order.shipment.failureReason}
        </Notice>
      )}
      <div className="c-order-tracker__history">
        <button
          type="button"
          className="c-order-tracker__history-toggle"
          aria-expanded={showHistory}
          aria-controls={historyId}
          onClick={() => setShowHistory((value) => !value)}
        >
          <History size={16} aria-hidden="true" />
          <span>Lịch sử bước này</span>
          <span className="c-order-tracker__count">{events.length}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <div
          id={historyId}
          hidden={!showHistory}
          className="c-order-tracker__history-body"
        >
          {events.length ? (
            <>
              <OrderEventList
                orderId={order.id}
                events={showAll ? events : events.slice(0, 3)}
              />
              {events.length > 3 && (
                <Action
                  variant="ghost"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll
                    ? 'Thu gọn lịch sử'
                    : `Xem thêm ${events.length - 3} ghi nhận`}
                </Action>
              )}
            </>
          ) : (
            <p className="c-order-tracker__note">
              Chưa có lịch sử chi tiết được lưu cho bước này.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
