import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  CircleCheck,
  CreditCard,
  Landmark,
  ShoppingCart,
  Trash2,
  Truck,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  describeCatalogSearch,
  parseCatalogSearch,
} from '@/features/catalog/catalog-search'
import { ApiError, api } from '@/shared/api/client'
import {
  commerceKey,
  orderQueryPaths,
  read,
  useAddToCart,
  useCart,
  useCommand,
  useCommerceQuery,
  useSession,
  write,
} from './api'
import {
  AccessGate,
  Action,
  BackToShop,
  Badge,
  CheckoutSteps,
  CompactLines,
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
  PriceSummary,
  ProductThumb,
  Quantity,
  QueryError,
} from './components'
import { CustomerLayout } from './layouts'
import { resetSessionQueries } from './session-scope'
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

export function AuthPage() {
  const search = useSearch({ strict: false })
  const redirect =
    'redirect' in search &&
    typeof search.redirect === 'string' &&
    search.redirect.startsWith('/') &&
    !search.redirect.startsWith('//') &&
    !search.redirect.includes('\\')
      ? search.redirect
      : '/cart'
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const client = useQueryClient()
  const lock = useRef(false)
  const session = useSession()
  return (
    <CustomerLayout>
      <Panel className="c-auth-card">
        <h1>
          {mode === 'sign-in' ? 'Chào mừng trở lại' : 'Tạo tài khoản TechViet'}
        </h1>
        <p>Đăng nhập để mua sắm và quản lý đơn hàng.</p>
        {session.data ? (
          <>
            <Notice tone="green">
              Bạn đang đăng nhập với {session.data.user.email}.
            </Notice>
            <div className="c-actions">
              <a className="c-button c-button--primary" href={redirect}>
                Tiếp tục
                <ArrowRight size={16} />
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="c-tabs">
              <button
                type="button"
                className={mode === 'sign-in' ? 'is-active' : ''}
                onClick={() => {
                  setMode('sign-in')
                  setError(null)
                }}
                disabled={busy}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                className={mode === 'sign-up' ? 'is-active' : ''}
                onClick={() => {
                  setMode('sign-up')
                  setError(null)
                }}
                disabled={busy}
              >
                Đăng ký
              </button>
            </div>
            <form
              className="c-form-section"
              onSubmit={async (event) => {
                event.preventDefault()
                if (lock.current) return
                lock.current = true
                setBusy(true)
                setError(null)
                const values = new FormData(event.currentTarget)
                try {
                  await api.post(`auth/${mode}/email`, {
                    json: {
                      email: String(values.get('email')).trim(),
                      password: String(values.get('password')),
                      ...(mode === 'sign-up'
                        ? { name: String(values.get('name')).trim() }
                        : {}),
                    },
                    retry: 0,
                  })
                  await resetSessionQueries(client, 'customer')
                  window.location.assign(redirect)
                } catch (caught) {
                  setError(caught)
                  setBusy(false)
                  lock.current = false
                }
              }}
            >
              <fieldset
                disabled={busy}
                className="c-form-section"
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                {mode === 'sign-up' && (
                  <Field label="Họ và tên">
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </Field>
                )}
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </Field>
                <Field
                  label="Mật khẩu"
                  hint={mode === 'sign-up' ? 'Từ 8 đến 128 ký tự.' : undefined}
                >
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    required
                    minLength={8}
                    maxLength={128}
                  />
                </Field>
              </fieldset>
              <ErrorNotice error={error} />
              <Action type="submit" pending={busy} className="c-button--block">
                {mode === 'sign-in' ? 'Đăng nhập' : 'Tạo tài khoản'}
              </Action>
            </form>
          </>
        )}
      </Panel>
    </CustomerLayout>
  )
}

export function CatalogPage() {
  const search = parseCatalogSearch(useSearch({ from: '/products' }))
  const query = JSON.stringify(search)
  const filterLabel = describeCatalogSearch(search)
  const loginRedirect = useLocation({ select: (location) => location.href })
  const [pagination, setPagination] = useState({ query, offset: 0 })
  const offset = pagination.query === query ? pagination.offset : 0
  const setOffset = (value: number) => setPagination({ query, offset: value })
  const session = useSession()
  const cart = useCart()
  const [added, setAdded] = useState<string | null>(null)
  const products = useQuery({
    queryKey: ['catalog', offset, search],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { limit: 20, offset, ...search },
      }),
  })
  const add = useAddToCart()
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
          Giỏ hàng ({cart.data?.items.length ?? 0})
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
      <ErrorNotice error={add.error} />
      {added && (
        <Notice tone="green">
          Đã thêm {added} vào giỏ hàng.{' '}
          <Link to="/cart" className="c-text-link">
            Xem giỏ hàng
            <ArrowRight size={14} />
          </Link>
        </Notice>
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
            <div className="c-catalog-grid">
              {products.data.items.map((product) => (
                <Panel key={product.id} className="c-catalog-card">
                  <ProductThumb name={product.name} sku={product.sku} />
                  <h2>{product.name}</h2>
                  <p>{product.description?.slice(0, 130) || product.sku}</p>
                  <Badge tone={product.availableQuantity > 0 ? 'green' : 'red'}>
                    {product.availableQuantity > 0
                      ? 'Còn hàng'
                      : 'Tạm hết hàng'}
                  </Badge>
                  <strong>{formatMoney(product.priceVnd)}</strong>
                  {session.data ? (
                    <Action
                      disabled={product.availableQuantity < 1 || add.isPending}
                      pending={
                        add.isPending && add.variables?.id === product.id
                      }
                      onClick={async () => {
                        if (await add.run(product)) setAdded(product.name)
                      }}
                    >
                      Thêm vào giỏ
                    </Action>
                  ) : (
                    <Link
                      to="/login"
                      search={{
                        redirect: loginRedirect,
                      }}
                      className="c-button c-button--secondary"
                    >
                      Đăng nhập để mua
                    </Link>
                  )}
                </Panel>
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
        subtitle={`${data.items.length} sản phẩm`}
      >
        <CheckoutSteps active={0} />
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
        <div className="c-columns">
          <Panel>
            <div className="c-table-wrap">
              <table className="c-table c-table--cart">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th className="c-number">Đơn giá</th>
                    <th>Số lượng</th>
                    <th className="c-number">Thành tiền</th>
                    <th>
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((line) => (
                    <tr key={line.productId}>
                      <td>
                        <div className="c-product-cell">
                          <ProductThumb name={line.name} sku={line.sku} />
                          <div>
                            <strong>{line.name}</strong>
                            <small>{line.sku}</small>
                            <Badge tone={line.eligible ? 'green' : 'red'}>
                              {line.eligible ? (
                                <>
                                  <Check size={12} />
                                  Còn hàng
                                </>
                              ) : line.availableQuantity >= line.quantity ? (
                                'Sản phẩm không khả dụng'
                              ) : line.availableQuantity > 0 ? (
                                `Chỉ còn ${line.availableQuantity} sản phẩm`
                              ) : (
                                'Sản phẩm tạm hết hàng'
                              )}
                            </Badge>
                          </div>
                        </div>
                      </td>
                      <td className="c-number">
                        {formatMoney(line.unitPriceVnd)}
                      </td>
                      <td>
                        <Quantity
                          label={`số lượng ${line.name}`}
                          value={line.quantity}
                          max={Math.min(
                            99,
                            line.availableQuantity,
                            line.eligible ? 99 : line.quantity,
                          )}
                          disabled={update.isPending || !line.eligible}
                          onChange={(quantity) => {
                            void update.run({
                              productId: line.productId,
                              quantity,
                            })
                          }}
                        />
                        {line.availableQuantity > 0 &&
                          line.quantity > line.availableQuantity && (
                            <Action
                              variant="secondary"
                              disabled={update.isPending}
                              aria-label={`Điều chỉnh số lượng ${line.name} còn ${line.availableQuantity}`}
                              onClick={() => {
                                void update.run({
                                  productId: line.productId,
                                  quantity: line.availableQuantity,
                                })
                              }}
                            >
                              Điều chỉnh còn {line.availableQuantity}
                            </Action>
                          )}
                      </td>
                      <td className="c-number">
                        <b>{formatMoney(line.lineTotalVnd)}</b>
                      </td>
                      <td>
                        <Action
                          variant="ghost"
                          disabled={update.isPending}
                          aria-label={`Xóa ${line.name} khỏi giỏ`}
                          onClick={() => {
                            void update.run({
                              productId: line.productId,
                              quantity: 0,
                            })
                          }}
                        >
                          <Trash2 size={18} />
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="c-cart-note">
              <CircleCheck size={16} />
              Giá và tồn kho sẽ được kiểm tra lại khi đặt hàng.
            </p>
            <div className="c-actions">
              <BackToShop />
            </div>
          </Panel>
          <Panel title="Thông tin đơn hàng">
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
                  <ArrowRight size={18} />
                </Link>
              ) : (
                <>
                  <Action disabled className="c-button--block c-button--large">
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
                  <strong>Đơn hàng đủ điều kiện miễn phí giao hàng</strong>Miễn
                  phí giao hàng cho đơn từ{' '}
                  {formatMoney(delivery.freeShippingThresholdVnd)}.
                </Notice>
              )}
            </PriceSummary>
            {policy.isError && <ErrorNotice error={policy.error} />}
          </Panel>
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
    defaultValues: { ...emptyRecipient, name: session.data?.user.name ?? '' },
  })
  const { reset } = form
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
      <PageHeading title="Thông tin đặt hàng" />
      <form onSubmit={submit}>
        <div className="c-columns">
          <div className="c-stack">
            <CheckoutSteps active={1} />
            <Panel title="Thông tin người nhận" icon={<UserRound size={21} />}>
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                <RecipientFields form={form} />
                <div className="c-divider" />
                <small>
                  Nhập tỉnh / thành phố và phường / xã hiện hành. Quận / huyện
                  cũ không bắt buộc.
                </small>
              </fieldset>
            </Panel>
            <Panel title="Phương thức giao hàng" icon={<Truck size={21} />}>
              <label className="c-option">
                <input type="radio" checked readOnly name="delivery" />
                <div>
                  <strong>Giao hàng tiêu chuẩn</strong>
                  <small>Giao đến địa chỉ người nhận</small>
                </div>
                <b className="c-green">
                  {shipping === 0 ? 'Miễn phí' : formatMoney(shipping)}
                </b>
              </label>
            </Panel>
            <Panel
              title="Phương thức thanh toán"
              icon={<CreditCard size={21} />}
            >
              <div className="c-option-grid">
                <label className="c-option">
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === 'cod'}
                    onChange={() => setPaymentMethod('cod')}
                    disabled={busy}
                  />
                  <div>
                    <strong>Thanh toán khi nhận hàng (COD)</strong>
                    <small>Thanh toán cho nhân viên giao hàng</small>
                  </div>
                </label>
                <label
                  className={`c-option${!policy.data?.bankTransferConfigured ? ' c-option--disabled' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === 'bank_transfer'}
                    onChange={() => setPaymentMethod('bank_transfer')}
                    disabled={busy || !policy.data?.bankTransferConfigured}
                  />
                  <Landmark size={27} />
                  <div>
                    <strong>Chuyển khoản ngân hàng</strong>
                    <small>
                      {policy.data?.bankTransferConfigured
                        ? 'Thông tin chuyển khoản hiển thị sau khi đặt hàng'
                        : 'Cửa hàng chưa mở phương thức này'}
                    </small>
                  </div>
                </label>
              </div>
            </Panel>
            <BackToShop />
          </div>
          <aside className="c-stack c-checkout-aside">
            <Panel
              title={`Đơn hàng của bạn (${data.items.length} sản phẩm)`}
              icon={<ShoppingCart size={21} />}
            >
              <CompactLines lines={displayedLines} />
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
                  <ArrowRight size={17} />
                </Action>
              </div>
              <p
                className="c-muted"
                style={{ fontSize: 11, textAlign: 'center', marginTop: 12 }}
              >
                Thông tin người nhận, giá và tồn kho sẽ được kiểm tra khi xác
                nhận đặt hàng.
              </p>
            </Panel>
          </aside>
        </div>
      </form>
    </>
  )
}

export function RecipientFields({
  form,
}: {
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
      <div className="c-form-grid c-form-grid--three c-field--wide">
        <Field label="Tỉnh / Thành phố *" error={errors.province?.message}>
          <input
            {...form.register('province', {
              required: 'Nhập tỉnh / thành phố.',
            })}
            autoComplete="address-level1"
            maxLength={100}
            aria-invalid={Boolean(errors.province)}
          />
        </Field>
        <Field label="Phường / Xã *" error={errors.ward?.message}>
          <input
            {...form.register('ward', { required: 'Nhập phường / xã.' })}
            autoComplete={
              form.watch('district')?.trim()
                ? 'address-level3'
                : 'address-level2'
            }
            maxLength={100}
            aria-invalid={Boolean(errors.ward)}
          />
        </Field>
        <Field
          label="Quận / Huyện cũ (không bắt buộc)"
          hint="Chỉ điền nếu cần giữ thông tin địa chỉ cũ."
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
                          <Badge status={order.paymentStatus} />
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
