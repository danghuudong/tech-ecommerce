import { useQuery } from '@tanstack/react-query'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Phone,
  ShieldCheck,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { read, useAddToCart, useSession } from '@/features/commerce/api'
import {
  Action,
  Badge,
  Empty,
  ErrorNotice,
  formatMoney,
  Loading,
  Notice,
  Panel,
  QueryError,
} from '@/features/commerce/components'
import { CustomerLayout } from '@/features/commerce/layouts'
import type {
  CatalogProduct,
  CatalogProductDetail,
} from '@/features/commerce/types'
import { ApiError } from '@/shared/api/client'
import { storePromises } from '@/shared/components/store-layout/store-header.data'
import { brandLabel, catalogCategoryLabels } from './catalog-search'
import { ProductQuestions, ProductReviews, Stars } from './product-feedback'
import { ProductGallery } from './product-gallery'
import { ProductStores } from './product-stores'
import { ProductVariants } from './product-variants'
import { discountPercent, productArt, productImageUrl } from './product-view'
import './product-detail.css'

const LOW_STOCK_THRESHOLD = 5
const HOTLINE = { href: 'tel:1900636888', label: '1900 63 6888' }

export function ProductDetailPage() {
  const { productId } = useParams({ from: '/products/$productId' })
  const product = useQuery({
    queryKey: ['catalog', 'product', productId],
    queryFn: ({ signal }) =>
      read<CatalogProductDetail>(`products/${productId}`, { signal }),
  })
  const notFound =
    product.error instanceof ApiError &&
    [400, 404].includes(product.error.status)
  return (
    <CustomerLayout>
      {product.isPending ? (
        <Loading />
      ) : notFound ? (
        <Empty
          title="Không tìm thấy sản phẩm"
          description="Sản phẩm không tồn tại hoặc đã ngừng kinh doanh."
        >
          <Link
            to="/products"
            search={{}}
            className="c-button c-button--secondary"
          >
            Tất cả sản phẩm
          </Link>
        </Empty>
      ) : product.isError ? (
        <QueryError error={product.error} retry={() => product.refetch()} />
      ) : (
        <ProductDetail key={product.data.id} product={product.data} />
      )}
    </CustomerLayout>
  )
}

function ProductDetail({ product }: { product: CatalogProductDetail }) {
  return (
    <div className="pd-page">
      <nav className="c-breadcrumb" aria-label="Đường dẫn">
        <Link to="/">Trang chủ</Link>
        <span aria-hidden="true">›</span>
        <Link to="/products" search={{}}>
          Sản phẩm
        </Link>
        {product.category && (
          <>
            <span aria-hidden="true">›</span>
            <Link to="/products" search={{ category: product.category }}>
              {catalogCategoryLabels[product.category]}
            </Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <header className="pd-title">
        <h1>{product.name}</h1>
        <div className="pd-title__meta">
          {product.rating ? (
            <a href="#reviews">
              <Stars rating={product.rating.average} />
              <span>({product.rating.count} đánh giá)</span>
            </a>
          ) : (
            <a href="#reviews">Chưa có đánh giá</a>
          )}
          {product.specifications.length > 0 && (
            <a href="#specifications">Thông số kỹ thuật</a>
          )}
        </div>
      </header>
      <div className="pd-hero">
        <div className="pd-hero__media">
          <Panel className="pd-gallery">
            <ProductGallery key={product.id} product={product} />
          </Panel>
          <ProductPolicies product={product} />
        </div>
        <div className="pd-hero__buy">
          <Panel className="pd-buybox">
            <BuyBox product={product} />
          </Panel>
          <ProductStores key={product.id} product={product} />
        </div>
      </div>
      {product.related.length > 0 && (
        <section className="pd-related" aria-labelledby="pd-related-title">
          <h2 id="pd-related-title">Sản phẩm tương tự</h2>
          <div className="pd-related__grid">
            {product.related.map((item) => (
              <RelatedProduct key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
      <div className="pd-detail">
        <div className="pd-detail__main">
          <ProductDescription product={product} />
          <ProductReviews product={product} />
          <ProductQuestions product={product} />
        </div>
        <aside className="pd-detail__side">
          {product.specifications.length > 0 && (
            <Panel title="Thông số kỹ thuật" className="pd-specifications">
              <span className="pd-anchor" id="specifications" />
              {product.specifications.map((group) => (
                <section key={group.title}>
                  <h3>{group.title}</h3>
                  <dl>
                    {group.rows.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </Panel>
          )}
          <StickyPurchaseCard product={product} />
        </aside>
      </div>
    </div>
  )
}

function ProductPolicies({ product }: { product: CatalogProductDetail }) {
  return (
    <div className="pd-policies">
      <Panel title="Thông tin sản phẩm">
        <dl className="pd-facts">
          <div>
            <dt>Mã sản phẩm</dt>
            <dd>{product.sku}</dd>
          </div>
          {product.brand && (
            <div>
              <dt>Thương hiệu</dt>
              <dd>{brandLabel(product.brand)}</dd>
            </div>
          )}
          {product.warrantyMonths && (
            <div>
              <dt>Bảo hành</dt>
              <dd>{product.warrantyMonths} tháng</dd>
            </div>
          )}
          {product.packageContents.length > 0 && (
            <div>
              <dt>Bộ sản phẩm</dt>
              <dd>{product.packageContents.join(', ')}</dd>
            </div>
          )}
        </dl>
      </Panel>
      <Panel title="Cam kết sản phẩm">
        <ul className="pd-promises">
          {storePromises.map(({ text, icon: Icon }) => (
            <li key={text}>
              <Icon size={16} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

function BuyBox({ product }: { product: CatalogProductDetail }) {
  const discount = discountPercent(product)
  const inStock = product.availableQuantity > 0
  const lowStock = inStock && product.availableQuantity <= LOW_STOCK_THRESHOLD
  return (
    <>
      <div className="pd-price">
        <div className="pd-price__row">
          <strong>{formatMoney(product.priceVnd)}</strong>
          {discount && <del>{formatMoney(product.listPriceVnd)}</del>}
          {discount && <span>−{discount}%</span>}
        </div>
        {product.listPriceVnd && discount && (
          <small>
            Tiết kiệm {formatMoney(product.listPriceVnd - product.priceVnd)}
          </small>
        )}
      </div>
      <Badge tone={!inStock ? 'red' : lowStock ? 'amber' : 'green'}>
        {!inStock
          ? 'Tạm hết hàng'
          : lowStock
            ? `Chỉ còn ${product.availableQuantity} sản phẩm`
            : 'Còn hàng'}
      </Badge>
      <ProductVariants product={product} />
      {product.warrantyMonths && (
        <div className="pd-warranty">
          <span className="pd-variants__label">Dịch vụ bảo hành</span>
          <div className="pd-warranty__option">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>Bảo hành {product.warrantyMonths} tháng</span>
            <strong>Đã gồm trong giá</strong>
          </div>
        </div>
      )}
      <PurchaseActions product={product} inStock={inStock} />
      {inStock ? (
        <a className="pd-hotline" href={HOTLINE.href}>
          <Phone size={16} aria-hidden="true" />
          Gọi mua hàng <strong>{HOTLINE.label}</strong>
        </a>
      ) : (
        <p className="pd-hotline">
          Vui lòng liên hệ <a href={HOTLINE.href}>{HOTLINE.label}</a> để được tư
          vấn.
        </p>
      )}
    </>
  )
}

function PurchaseActions({
  product,
  inStock,
}: {
  product: CatalogProductDetail
  inStock: boolean
}) {
  const session = useSession()
  const navigate = useNavigate()
  const loginRedirect = useLocation({ select: (location) => location.href })
  const add = useAddToCart()
  const [intent, setIntent] = useState<'add' | 'buy'>('add')
  const [added, setAdded] = useState(false)

  async function handleAdd(next: 'add' | 'buy') {
    setIntent(next)
    setAdded(false)
    if (!(await add.run(product))) return
    if (next === 'buy') await navigate({ to: '/cart' })
    else setAdded(true)
  }

  if (!inStock)
    return (
      <div className="c-actions pd-actions">
        <Action disabled>Tạm hết hàng</Action>
      </div>
    )
  if (!session.data)
    return (
      <div className="c-actions pd-actions">
        <Link
          to="/login"
          search={{ redirect: loginRedirect }}
          className="c-button c-button--primary"
        >
          Đăng nhập để mua
        </Link>
      </div>
    )
  return (
    <>
      <ErrorNotice error={add.error} />
      {added && (
        <Notice tone="green">
          Đã thêm vào giỏ hàng.{' '}
          <Link to="/cart" className="c-text-link">
            Xem giỏ hàng
            <ArrowRight size={14} />
          </Link>
        </Notice>
      )}
      <div className="c-actions pd-actions">
        <Action
          className="pd-actions__buy"
          disabled={add.isPending}
          pending={add.isPending && intent === 'buy'}
          onClick={() => handleAdd('buy')}
        >
          <strong>Mua ngay</strong>
          <small>Giao hàng toàn quốc</small>
        </Action>
        <Action
          variant="secondary"
          disabled={add.isPending}
          pending={add.isPending && intent === 'add'}
          onClick={() => handleAdd('add')}
        >
          Thêm vào giỏ
        </Action>
      </div>
    </>
  )
}

function ProductDescription({ product }: { product: CatalogProductDetail }) {
  const content = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)
  useLayoutEffect(() => {
    const element = content.current
    if (element) setCollapsible(element.scrollHeight > element.clientHeight)
  }, [])
  if (!product.overview && product.highlights.length === 0) return null
  return (
    <Panel title="Nội dung chính" className="pd-description">
      <div
        className={`pd-description__body${expanded ? ' is-expanded' : ''}`}
        ref={content}
      >
        {product.overview && <p className="pd-overview">{product.overview}</p>}
        {product.highlights.length > 0 && (
          <>
            <h3>Đặc điểm nổi bật</h3>
            <ul className="pd-checklist">
              {product.highlights.map((highlight) => (
                <li key={highlight}>
                  <Check size={16} aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {collapsible && (
        <Action
          className="pd-description__toggle"
          onClick={() => setExpanded((value) => !value)}
          variant="secondary"
        >
          {expanded ? 'Ẩn bớt' : 'Xem thêm'}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Action>
      )}
    </Panel>
  )
}

function ProductImage({ product }: { product: CatalogProduct }) {
  return product.primaryImageId ? (
    <img
      alt=""
      className="product-photo"
      loading="lazy"
      src={productImageUrl(product.primaryImageId)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`product-art product-art--${productArt(product)}`}
    />
  )
}

function StickyPurchaseCard({ product }: { product: CatalogProductDetail }) {
  return (
    <Panel className="pd-sticky-card">
      <div className="pd-sticky-card__product">
        <ProductImage product={product} />
        <div>
          <strong>{product.name}</strong>
          <span>{formatMoney(product.priceVnd)}</span>
        </div>
      </div>
      <PurchaseActions
        inStock={product.availableQuantity > 0}
        product={product}
      />
    </Panel>
  )
}

function RelatedProduct({ product }: { product: CatalogProduct }) {
  return (
    <Link
      to="/products/$productId"
      params={{ productId: product.id }}
      className="pd-related__card"
    >
      <ProductImage product={product} />
      <span className="pd-related__name">{product.name}</span>
      {product.rating && (
        <span className="pd-related__rating">
          <Stars rating={product.rating.average} size={13} />(
          {product.rating.count} đánh giá)
        </span>
      )}
      <strong>{formatMoney(product.priceVnd)}</strong>
      {discountPercent(product) && (
        <del>{formatMoney(product.listPriceVnd)}</del>
      )}
    </Link>
  )
}
