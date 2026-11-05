import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CircleCheck,
  CreditCard,
  QrCode,
  ShoppingCart,
  Truck,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  describeCatalogSearch,
  parseCatalogSearch,
} from '@/features/catalog/catalog-search'
import { StoreProductCard } from '@/features/catalog/components/store-product-card'
import { ApiError } from '@/shared/api/client'
import {
  readStoreProvince,
  storeProvinces,
} from '@/shared/components/store-layout/store-location.data'
import {
  cartItemCount,
  commerceKey,
  orderQueryPaths,
  read,
  useCart,
  useCommand,
  useCommerceQuery,
  useSession,
  write,
} from './api'
import { CartLineItem, CheckoutLines } from './cart-line-item'
import { CheckoutAddressFields } from './checkout-address-fields'
import { DeliveryOption, PaymentOption } from './checkout-options'
import {
  AccessGate,
  Action,
  BackToShop,
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
  PaymentStatusBadge,
  PriceSummary,
  QueryError,
} from './components'
import { CustomerLayout } from './layouts'
import './checkout.css'
import type {
  CatalogProduct,
  CheckoutPolicy,
  OrderPage,
  Page,
  PaymentMethod,
  Quote,
  Recipient,
} from './types'

export const recipientSchema = z.object({
  name: z.string().trim().min(2, 'Nhập họ tên từ 2 ký tự.').max(120),
  phone: z
    .string()
    .trim()
    .regex(
      /^\+?[0-9]{8,15}$/,
      'Nhập số điện thoại từ 8–15 chữ số, không có khoảng trắng.',
    ),
  province: z.string().trim().min(1, 'Nhập tỉnh / thành phố.').max(100),
  district: z.string().trim().max(100).default(''),
  ward: z.string().trim().min(1, 'Nhập phường / xã.').max(100),
  addressLine: z
    .string()
    .trim()
    .min(5, 'Nhập địa chỉ cụ thể từ 5 ký tự.')
    .max(300),
})

const emptyRecipient: Recipient = {
  name: '',
  phone: '',
  province: '',
  district: '',
  ward: '',
  addressLine: '',
}

export function CatalogPage() {
  const search = parseCatalogSearch(useSearch({ from: '/products' }))
  const query = JSON.stringify(search)
  const filterLabel = describeCatalogSearch(search)
  const [pagination, setPagination] = useState({ query, offset: 0 })
  const offset = pagination.query === query ? pagination.offset : 0
  const setOffset = (value: number) => setPagination({ query, offset: value })
  const cart = useCart()
  const products = useQuery({
    queryKey: ['catalog', offset, search],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { limit: 20, offset, ...search },
      }),
  })

  return (
    <CustomerLayout>
      <PageHeading
        title="Khám phá sản phẩm"
        subtitle={
          filterLabel ||
          'Sản phẩm chính hãng, giá và tồn kho được cập nhật từ cửa hàng.'
        }
      >
        <Link to="/cart" className="c-button c-button--secondary">
          <ShoppingCart size={17} />
          Giỏ hàng ({cartItemCount(cart.data)})
        </Link>
      </PageHeading>
      {filterLabel && (
        <Link
          to="/products"
          search={{}}
          className="c-button c-button--secondary"
        >
          Xóa bộ lọc
        </Link>
      )}
      {products.isPending ? (
        <Loading />
      ) : products.isError ? (
        <QueryError error={products.error} retry={() => products.refetch()} />
      ) : (
        <>
          {products.data.items.length === 0 ? (
            <Empty
              title="Chưa có sản phẩm phù hợp"
              description="Thử một từ khóa khác hoặc quay lại danh mục sản phẩm."
            >
              <Link
                to="/products"
                search={{}}
                className="c-button c-button--secondary"
              >
                Tất cả sản phẩm
              </Link>
            </Empty>
          ) : (
            <div className="store-product-grid store-product-grid--wide">
              {products.data.items.map((product) => (
                <StoreProductCard item={product} key={product.id} />
              ))}
            </div>
          )}
          <Pagination
            offset={offset}
            limit={20}
            total={products.data.total}
            count={products.data.items.length}
            onChange={setOffset}
          />
        </>
      )}
    </CustomerLayout>
  )
}

function FreeShippingProgress({
  subtotal,
  threshold,
}: {
  subtotal: number
  threshold: number
}) {
  return (
    <div className="free-shipping">
      <p>
        Mua thêm <strong>{formatMoney(threshold - subtotal)}</strong> để được
        miễn phí giao hàng
      </p>
      <span aria-hidden="true" className="free-shipping__bar">
        <span style={{ width: `${(subtotal / threshold) * 100}%` }} />
      </span>
    </div>
  )
}

export function CartPage() {
  return (
    <CustomerLayout>
      <AccessGate>
        <CartContent />
      </AccessGate>
    </CustomerLayout>
  )
}

function CartContent() {
  const cart = useCart()
  const policy = useCommerceQuery<CheckoutPolicy>('checkout/policy')
  const update = useCommand(
    async ({ productId, quantity }: { productId: string; quantity: number }) =>
      write(
        `cart/items/${productId}`,
        { quantity, expectedVersion: cart.data?.version },
        'put',
      ),
    ['cart'],
  )
  if (cart.isPending) return <Loading />
  if (cart.isError)
    return <QueryError error={cart.error} retry={() => cart.refetch()} />
  const data = cart.data
  const delivery = policy.data?.deliveryMethods[0]
  const shipping = delivery
    ? data.subtotalVnd >= delivery.freeShippingThresholdVnd
      ? 0
      : delivery.shippingFeeVnd
    : undefined
  return (
    <>
      <PageHeading
        title="Giỏ hàng của bạn"
        subtitle={`${cartItemCount(data)} sản phẩm`}
      >
        <BackToShop />
      </PageHeading>
      <ErrorNotice error={update.error} />
      {data.items.length === 0 ? (
        <Panel>
          <Empty
            title="Giỏ hàng của bạn đang trống"
            description="Khám phá sản phẩm công nghệ và chọn sản phẩm bạn yêu thích."
          >
            <Link to="/products" className="c-button c-button--primary">
              Khám phá sản phẩm
              <ArrowRight size={17} />
            </Link>
          </Empty>
        </Panel>
      ) : (
        <div className="checkout-layout">
          <Panel className="cart-panel">
            <ul className="cart-lines">
              {data.items.map((line) => (
                <CartLineItem
                  disabled={update.isPending}
                  key={line.productId}
                  line={line}
                  onQuantityChange={(quantity) => {
                    void update.run({ productId: line.productId, quantity })
                  }}
                />
              ))}
            </ul>
            <p className="c-cart-note">
              <CircleCheck aria-hidden="true" size={16} />
              Giá và tồn kho sẽ được kiểm tra lại khi đặt hàng.
            </p>
          </Panel>
          <aside className="checkout-aside">
            <Panel title="Thông tin đơn hàng">
              {delivery && shipping ? (
                <FreeShippingProgress
                  subtotal={data.subtotalVnd}
                  threshold={delivery.freeShippingThresholdVnd}
                />
              ) : null}
              <PriceSummary
                subtotal={data.subtotalVnd}
                shipping={shipping}
                total={data.subtotalVnd + (shipping ?? 0)}
              >
                {data.checkoutEligible ? (
                  <Link
                    to="/checkout"
                    className={`c-button c-button--primary c-button--block c-button--large${update.isPending ? ' c-link-disabled' : ''}`}
                    aria-disabled={update.isPending}
                    onClick={(event) => {
                      if (update.isPending) event.preventDefault()
                    }}
                  >
                    Tiếp tục đặt hàng
                  </Link>
                ) : (
                  <>
                    <Action
                      disabled
                      className="c-button--block c-button--large"
                    >
                      Tiếp tục đặt hàng
                    </Action>
                    <div className="c-actions">
                      <Notice tone="amber">
                        {data.items.every((line) => line.eligible)
                          ? 'Giá trị giỏ hàng vượt mức được hỗ trợ. Vui lòng giảm số lượng hoặc tách đơn hàng.'
                          : 'Điều chỉnh số lượng hoặc xóa sản phẩm không còn hàng để tiếp tục.'}
                      </Notice>
                    </div>
                  </>
                )}
                {delivery && shipping === 0 && (
                  <Notice tone="green">
                    <strong>Đơn hàng đủ điều kiện miễn phí giao hàng</strong>
                    Miễn phí giao hàng cho đơn từ{' '}
                    {formatMoney(delivery.freeShippingThresholdVnd)}.
                  </Notice>
                )}
              </PriceSummary>
              {policy.isError && <ErrorNotice error={policy.error} />}
            </Panel>
          </aside>
        </div>
      )}
    </>
  )
}

export function CheckoutPage() {
  return (
    <CustomerLayout>
      <AccessGate>
        <CheckoutContent />
      </AccessGate>
    </CustomerLayout>
  )
}

function quoteMatches(
  quote: Quote,
  recipient: Recipient,
  method: PaymentMethod,
  version: number,
) {
  return (
    quote.cartVersion === version &&
    quote.paymentMethod === method &&
    Object.entries(quote.recipient).every(
      ([key, value]) => recipient[key as keyof Recipient] === value,
    )
  )
}

function CheckoutContent() {
  const session = useSession()
  const client = useQueryClient()
  const cart = useCart()
  const policy = useCommerceQuery<CheckoutPolicy>('checkout/policy')
  const navigate = useNavigate()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [now, setNow] = useState(Date.now())
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState<unknown>(null)
  const [forceRefresh, setForceRefresh] = useState(false)
  const [priceChanged, setPriceChanged] = useState(false)
  const checkoutLock = useRef(false)
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null)
  const [placedOrder, setPlacedOrder] = useState<{
    orderId: string
    paymentMethod: PaymentMethod
  } | null>(null)
  const form = useForm<Recipient>({
    defaultValues: {
      ...emptyRecipient,
      name: session.data?.user.name ?? '',
      province: readStoreProvince() ?? '',
    },
  })
  const { reset } = form
  const isFormDirty = form.formState.isDirty
  const lastOrder = useCommerceQuery<OrderPage>('orders', { limit: 1 })
  const savedRecipient = lastOrder.data?.items[0]?.recipient
  const prefillSettled = useRef(false)
  const values = form.watch()
  const parsed = recipientSchema.safeParse(values)
  const restoreKey = `techviet:quote:${session.data?.user.id}`
  const pendingKey = `techviet:pending-order:${session.data?.user.id}`
  const quoteRequest = useCommand(
    async (recipient: Recipient) => {
      const result = await write<{ quoteId: string }>('checkout/quotes', {
        source: 'cart',
        cartVersion: cart.data?.version,
        recipient,
        deliveryMethod: 'standard',
        paymentMethod,
      })
      const fresh = await read<Quote>(`checkout/quotes/${result.quoteId}`)
      return fresh
    },
    ['cart', 'checkout/policy'],
  )
  const placement = useCommand(
    async (quoteId: string) => {
      const alreadyPending = pendingQuoteId === quoteId
      setPendingQuoteId(quoteId)
      try {
        sessionStorage.setItem(pendingKey, quoteId)
      } catch {
        /* In-page recovery remains available without storage. */
      }
      try {
        return await write<{
          orderId: string
          paymentMethod: PaymentMethod
        }>('orders', { quoteId })
      } catch (error) {
        // A refusal of a retry does not resolve an earlier unknown outcome.
        if (
          !alreadyPending &&
          error instanceof ApiError &&
          error.status < 500 &&
          ![408, 429].includes(error.status)
        ) {
          setPendingQuoteId(null)
          try {
            sessionStorage.removeItem(pendingKey)
          } catch {
            /* The in-page outcome has already been resolved. */
          }
        }
        throw error
      }
    },
    ['cart', ...orderQueryPaths],
  )
  const recovery = useQuery({
    queryKey: [
      ...commerceKey,
      session.data?.user.id,
      'checkout/placement',
      pendingQuoteId,
    ],
    queryFn: ({ signal }) =>
      read<Quote>(`checkout/quotes/${pendingQuoteId}`, { signal }),
    enabled: Boolean(
      pendingQuoteId && !restoring && !placement.isPending && !placedOrder,
    ),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (query) => {
      if (query.state.data?.acceptedOrderId || query.state.data?.expired)
        return false
      const error = query.state.error
      if (error instanceof ApiError && error.status < 500) {
        if (error.status !== 429) return false
        return Math.max(30_000, (error.retryAt ?? 0) - Date.now())
      }
      return 30_000
    },
    retry: (count, error) =>
      !(error instanceof ApiError && error.status < 500) && count < 1,
  })
  const acceptedOrderId = placedOrder?.orderId ?? recovery.data?.acceptedOrderId
  const acceptedPaymentMethod =
    placedOrder?.paymentMethod ?? recovery.data?.paymentMethod
  useEffect(() => {
    if (!acceptedOrderId) return
    try {
      sessionStorage.removeItem(restoreKey)
      sessionStorage.removeItem(pendingKey)
    } catch {
      /* Storage failures must not prevent opening the recovered order. */
    }
    void client.invalidateQueries({
      queryKey: [...commerceKey, session.data?.user.id],
      predicate: ({ queryKey }) =>
        queryKey[3] === 'cart' ||
        orderQueryPaths.some((path) => queryKey[3] === path),
    })
    void navigate({
      to:
        acceptedPaymentMethod === 'bank_transfer'
          ? '/orders/$orderId/payment'
          : '/orders/$orderId',
      params: { orderId: acceptedOrderId },
    })
  }, [
    acceptedOrderId,
    acceptedPaymentMethod,
    restoreKey,
    pendingKey,
    navigate,
    client,
    session.data?.user.id,
  ])
  useEffect(() => {
    const previous = recovery.data
    if (
      !pendingQuoteId ||
      placement.isPending ||
      !previous?.expired ||
      previous.acceptedOrderId
    )
      return
    // The server waits for any placement holding this quote before reading it.
    // An expired, unaccepted quote cannot subsequently create an order.
    setQuote(previous)
    setPaymentMethod(previous.paymentMethod)
    reset(previous.recipient)
    setForceRefresh(true)
    setPendingQuoteId(null)
    try {
      sessionStorage.removeItem(pendingKey)
    } catch {
      /* Recovery can repeat safely on the next visit. */
    }
  }, [recovery.data, pendingQuoteId, placement.isPending, pendingKey, reset])
  useEffect(() => {
    if (
      placement.error instanceof ApiError &&
      ['QUOTE_EXPIRED', 'PRICE_CHANGED', 'CHECKOUT_CHANGED'].includes(
        placement.error.code,
      )
    )
      setForceRefresh(true)
  }, [placement.error])
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const pendingId = sessionStorage.getItem(pendingKey)
        if (pendingId && z.uuid().safeParse(pendingId).success) {
          setPendingQuoteId(pendingId)
          return
        }
        const id = sessionStorage.getItem(restoreKey)
        if (id && z.uuid().safeParse(id).success) {
          const previous = await read<Quote>(`checkout/quotes/${id}`)
          if (cancelled) return
          if (previous.acceptedOrderId) {
            setPlacedOrder({
              orderId: previous.acceptedOrderId,
              paymentMethod: previous.paymentMethod,
            })
            return
          }
          setQuote(previous)
          setPaymentMethod(previous.paymentMethod)
          reset(previous.recipient)
        }
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 404))
          setRestoreError(error)
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
  }, [restoreKey, pendingKey, reset])
  useEffect(() => {
    if (prefillSettled.current || restoring || lastOrder.isPending) return
    prefillSettled.current = true
    // A restored quote or the customer's own typing always wins.
    if (!savedRecipient || quote || isFormDirty) return
    reset(savedRecipient)
  }, [
    restoring,
    lastOrder.isPending,
    savedRecipient,
    quote,
    isFormDirty,
    reset,
  ])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const validQuote = Boolean(
    quote &&
      !forceRefresh &&
      parsed.success &&
      quoteMatches(
        quote,
        parsed.data,
        paymentMethod,
        cart.data?.version ?? -1,
      ) &&
      quote.status === 'open' &&
      !quote.expired &&
      new Date(quote.expiresAt).getTime() > now,
  )
  const busy =
    form.formState.isSubmitting || quoteRequest.isPending || placement.isPending
  if (restoring) return <Loading text="Đang chuẩn bị thông tin đặt hàng…" />
  if (acceptedOrderId)
    return <Loading text="Đơn hàng đã được tạo. Đang mở thông tin đơn hàng…" />
  if (pendingQuoteId)
    return (
      <Panel title="Đang xác minh kết quả đặt hàng">
        <Notice tone="amber">
          Chưa xác định được kết quả yêu cầu đặt hàng. Vui lòng kiểm tra kết quả
          hoặc thử lại yêu cầu này trước khi bắt đầu lần mua khác.
        </Notice>
        <ErrorNotice error={recovery.error || placement.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            pending={recovery.isFetching}
            disabled={placement.isPending}
            onClick={() => recovery.refetch()}
          >
            Kiểm tra kết quả
          </Action>
          <Action
            pending={placement.isPending}
            disabled={recovery.isFetching}
            onClick={async () => {
              const result = await placement.run(pendingQuoteId)
              if (result) setPlacedOrder(result)
            }}
          >
            Thử lại yêu cầu đặt hàng
          </Action>
          <Link to="/orders" className="c-text-link">
            Xem đơn hàng của tôi
          </Link>
        </div>
      </Panel>
    )
  if (cart.isPending || policy.isPending)
    return <Loading text="Đang chuẩn bị thông tin đặt hàng…" />
  if (cart.isError)
    return <QueryError error={cart.error} retry={() => cart.refetch()} />
  if (policy.isError)
    return <QueryError error={policy.error} retry={() => policy.refetch()} />
  if (!cart.data?.checkoutEligible)
    return (
      <Panel>
        <Empty
          title="Giỏ hàng chưa sẵn sàng để đặt hàng"
          description="Vui lòng kiểm tra số lượng và tình trạng sản phẩm trong giỏ."
        >
          <Link to="/cart" className="c-button c-button--primary">
            Quay lại giỏ hàng
          </Link>
        </Empty>
      </Panel>
    )
  const data = cart.data
  const delivery = policy.data?.deliveryMethods[0]
  const shipping = delivery
    ? data.subtotalVnd >= delivery.freeShippingThresholdVnd
      ? 0
      : delivery.shippingFeeVnd
    : 0
  const displayedLines = validQuote && quote ? quote.lines : data.items
  const displayedSubtotal =
    validQuote && quote ? quote.subtotalVnd : data.subtotalVnd
  const displayedShipping =
    validQuote && quote ? quote.shippingFeeVnd : shipping
  const displayedTotal =
    validQuote && quote ? quote.totalVnd : data.subtotalVnd + shipping
  const prepareQuote = async (recipient: Recipient) => {
    const next = await quoteRequest.run(recipient)
    if (next) {
      setQuote(next)
      setForceRefresh(false)
      setRestoreError(null)
      try {
        sessionStorage.setItem(restoreKey, next.id)
      } catch {
        /* Checkout remains usable without storage. */
      }
    }
    return next
  }
  const submit = form.handleSubmit(async (recipient) => {
    if (
      pendingQuoteId ||
      acceptedOrderId ||
      quoteRequest.isPending ||
      placement.isPending ||
      checkoutLock.current
    )
      return
    checkoutLock.current = true
    setPriceChanged(false)
    try {
      const validated = recipientSchema.safeParse(recipient)
      if (!validated.success) {
        for (const issue of validated.error.issues)
          form.setError(issue.path[0] as keyof Recipient, {
            message: issue.message,
          })
        return
      }
      const orderQuote =
        validQuote && quote ? quote : await prepareQuote(validated.data)
      if (!orderQuote) return
      if (orderQuote.acceptedOrderId) {
        setPlacedOrder({
          orderId: orderQuote.acceptedOrderId,
          paymentMethod: orderQuote.paymentMethod,
        })
        return
      }
      const shownItems = new Map(
        displayedLines.map((line) => [line.productId, line]),
      )
      if (
        orderQuote.subtotalVnd !== displayedSubtotal ||
        orderQuote.shippingFeeVnd !== displayedShipping ||
        orderQuote.totalVnd !== displayedTotal ||
        orderQuote.lines.length !== displayedLines.length ||
        orderQuote.lines.some((line) => {
          const shown = shownItems.get(line.productId)
          return (
            !shown ||
            shown.quantity !== line.quantity ||
            shown.unitPriceVnd !== line.unitPriceVnd ||
            shown.lineTotalVnd !== line.lineTotalVnd
          )
        })
      ) {
        setPriceChanged(true)
        return
      }
      const result = await placement.run(orderQuote.id)
      if (result) setPlacedOrder(result)
    } finally {
      checkoutLock.current = false
    }
  })
  return (
    <>
      <PageHeading
        title="Thông tin đặt hàng"
        subtitle="Kiểm tra thông tin nhận hàng và chọn cách thanh toán."
      >
        <Link to="/cart" className="c-text-link">
          <ArrowLeft aria-hidden="true" size={16} />
          Quay lại giỏ hàng
        </Link>
      </PageHeading>
      <form onSubmit={submit}>
        <div className="checkout-layout">
          <div className="c-stack">
            <Panel title="Thông tin người nhận" icon={<UserRound size={20} />}>
              <fieldset className="checkout-fieldset" disabled={busy}>
                <RecipientFields
                  addressFields={
                    <CheckoutAddressFields disabled={busy} form={form} />
                  }
                  form={form}
                />
                <small className="checkout-note">
                  Chọn tỉnh / thành phố và phường / xã hiện hành. Quận / huyện
                  cũ không bắt buộc.
                </small>
              </fieldset>
            </Panel>
            <Panel title="Phương thức giao hàng" icon={<Truck size={20} />}>
              <DeliveryOption
                feeVnd={displayedShipping}
                freeShippingThresholdVnd={delivery?.freeShippingThresholdVnd}
              />
            </Panel>
            <Panel
              title="Phương thức thanh toán"
              icon={<CreditCard size={20} />}
            >
              <div className="checkout-option-list">
                <PaymentOption
                  checked={paymentMethod === 'cod'}
                  description="Thanh toán cho nhân viên giao hàng"
                  disabled={busy}
                  icon={Banknote}
                  onSelect={() => setPaymentMethod('cod')}
                  title="Thanh toán khi nhận hàng (COD)"
                />
                <PaymentOption
                  checked={paymentMethod === 'bank_transfer'}
                  description={
                    policy.data?.bankTransferConfigured
                      ? 'Thông tin chuyển khoản hiển thị sau khi đặt hàng'
                      : 'Cửa hàng chưa mở phương thức này'
                  }
                  disabled={busy || !policy.data?.bankTransferConfigured}
                  icon={QrCode}
                  onSelect={() => setPaymentMethod('bank_transfer')}
                  title="Chuyển khoản ngân hàng"
                />
              </div>
            </Panel>
          </div>
          <aside className="checkout-aside">
            <Panel
              title={`Đơn hàng của bạn (${cartItemCount(data)})`}
              icon={<ShoppingCart size={20} />}
            >
              <CheckoutLines cartLines={data.items} lines={displayedLines} />
              <PriceSummary
                subtotal={displayedSubtotal}
                shipping={displayedShipping}
                total={displayedTotal}
              />
              {priceChanged && (
                <Notice tone="amber">
                  <strong>Giá hoặc phí giao hàng đã thay đổi</strong>Vui lòng
                  kiểm tra số tiền mới và bấm Đặt hàng để xác nhận.
                </Notice>
              )}
              <ErrorNotice
                error={restoreError || quoteRequest.error || placement.error}
              />
              <div className="c-actions">
                <Action
                  type="submit"
                  className="c-button--block c-button--large"
                  pending={busy}
                >
                  Đặt hàng
                </Action>
              </div>
            </Panel>
          </aside>
        </div>
      </form>
    </>
  )
}

export function RecipientFields({
  addressFields,
  form,
}: {
  addressFields?: ReactNode
  form: ReturnType<typeof useForm<Recipient>>
}) {
  const errors = form.formState.errors
  return (
    <div className="c-form-grid">
      <Field label="Họ và tên *" error={errors.name?.message}>
        <input
          {...form.register('name', { required: 'Nhập họ tên.' })}
          autoComplete="name"
          maxLength={120}
          aria-invalid={Boolean(errors.name)}
        />
      </Field>
      <Field label="Số điện thoại *" error={errors.phone?.message}>
        <input
          {...form.register('phone', { required: 'Nhập số điện thoại.' })}
          type="tel"
          autoComplete="tel"
          maxLength={16}
          aria-invalid={Boolean(errors.phone)}
        />
      </Field>
      {addressFields ?? <ManualAddressFields form={form} />}
      <Field label="Địa chỉ cụ thể *" wide error={errors.addressLine?.message}>
        <input
          {...form.register('addressLine', {
            required: 'Nhập địa chỉ cụ thể.',
          })}
          autoComplete="street-address"
          maxLength={300}
          placeholder="Số nhà, tên đường…"
          aria-invalid={Boolean(errors.addressLine)}
        />
      </Field>
    </div>
  )
}

function ManualAddressFields({
  form,
}: {
  form: ReturnType<typeof useForm<Recipient>>
}) {
  const errors = form.formState.errors
  const province = form.watch('province') ?? ''
  // Addresses saved before the 2025 merger may name a province outside the list.
  const isListedProvince = storeProvinces.some((item) => item === province)
  return (
    <div className="c-form-grid c-form-grid--three c-field--wide">
      <Field label="Tỉnh / Thành phố *" error={errors.province?.message}>
        <select
          {...form.register('province', { required: 'Chọn tỉnh / thành phố.' })}
          aria-invalid={Boolean(errors.province)}
          autoComplete="address-level1"
          value={province}
        >
          <option value="">Chọn tỉnh / thành phố</option>
          {province && !isListedProvince && (
            <option value={province}>{province}</option>
          )}
          {storeProvinces.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Phường / Xã *" error={errors.ward?.message}>
        <input
          {...form.register('ward', { required: 'Nhập phường / xã.' })}
          autoComplete={
            form.watch('district')?.trim() ? 'address-level3' : 'address-level2'
          }
          maxLength={100}
          aria-invalid={Boolean(errors.ward)}
        />
      </Field>
      <Field
        label="Quận / Huyện cũ (không bắt buộc)"
        error={errors.district?.message}
      >
        <input
          {...form.register('district')}
          autoComplete="off"
          maxLength={100}
          aria-invalid={Boolean(errors.district)}
        />
      </Field>
    </div>
  )
}

export function CustomerOrdersPage() {
  return (
    <CustomerLayout>
      <AccessGate>
        <CustomerOrdersContent />
      </AccessGate>
    </CustomerLayout>
  )
}

function CustomerOrdersContent() {
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const orders = useCommerceQuery<OrderPage>('orders', {
    offset,
    limit: 10,
    status: status || undefined,
  })
  return (
    <>
      <PageHeading
        title="Đơn hàng của tôi"
        subtitle="Theo dõi giao hàng, thanh toán và yêu cầu trả hàng."
      />
      <Panel className="c-table-panel">
        <div className="c-tabs">
          {[
            ['', 'Tất cả'],
            ['placed', 'Chờ xác nhận'],
            ['shipped', 'Đang giao'],
            ['delivered', 'Đã giao'],
            ['completed', 'Hoàn thành'],
            ['cancelled', 'Đã hủy'],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={status === value ? 'is-active' : ''}
              onClick={() => {
                setStatus(value)
                setOffset(0)
              }}
            >
              {label}
            </button>
          ))}
        </div>
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
                      <th>Ngày đặt</th>
                      <th className="c-number">Tổng tiền</th>
                      <th>Thanh toán</th>
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.data.items.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link
                            className="c-text-link"
                            to="/orders/$orderId"
                            params={{ orderId: order.id }}
                          >
                            #{order.code}
                          </Link>
                        </td>
                        <td>{formatDate(order.createdAt)}</td>
                        <td className="c-number">
                          <b>{formatMoney(order.totalVnd)}</b>
                        </td>
                        <td>
                          <PaymentStatusBadge
                            status={order.paymentStatus}
                            orderStatus={order.status}
                            completedOverpaymentRefundVnd={
                              order.completedOverpaymentRefundVnd
                            }
                          />
                          <small>
                            {order.paymentMethod === 'cod'
                              ? 'COD'
                              : 'Chuyển khoản'}
                          </small>
                        </td>
                        <td>
                          <Badge status={order.status} />
                        </td>
                        <td>
                          <Link
                            className="c-text-link"
                            to="/orders/$orderId"
                            params={{ orderId: order.id }}
                          >
                            Xem chi tiết
                            <ArrowRight size={15} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Chưa có đơn hàng"
                description="Những đơn hàng của bạn sẽ được hiển thị tại đây."
              >
                <BackToShop />
              </Empty>
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
    </>
  )
}
