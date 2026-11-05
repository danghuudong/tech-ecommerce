import { useQuery } from '@tanstack/react-query'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { ClipboardList, Gift, ShieldCheck, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { StoreProductCard } from '@/features/catalog/components/store-product-card'
import { read, useAddToCart, useSession } from '@/features/commerce/api'
import { CartToast } from '@/features/commerce/cart-toast'
import {
  Action,
  Badge,
  Empty,
  ErrorNotice,
  formatMoney,
  Loading,
  Panel,
  QueryError,
} from '@/features/commerce/components'
import { CustomerLayout } from '@/features/commerce/layouts'
import type {
  CatalogProduct,
  CatalogProductDetail,
} from '@/features/commerce/types'
import { ApiError } from '@/shared/api/client'
import { brandLabel, catalogCategoryLabels } from './catalog-search'
import { Stars } from './product-feedback'
import { ProductGallery } from './product-gallery'
import { ProductQuestions } from './product-questions'
import { ProductReviews } from './product-reviews'
import { ProductStores } from './product-stores'
import { ProductVariants } from './product-variants'
import { discountPercent } from './product-view'
import './product-detail.css'

const LOW_STOCK_THRESHOLD = 5

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
        {product.brand && (
          <>
            <span aria-hidden="true">›</span>
            <Link to="/products" search={{ brand: product.brand }}>
              {brandLabel(product.brand)}
            </Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <div className="pd-hero">
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
            <a className="pd-title__jump" href="#questions">
              Hỏi đáp
            </a>
            {product.specifications.length > 0 && (
              <a className="pd-title__jump" href="#specifications">
                <ClipboardList size={15} aria-hidden="true" />
                Thông số kỹ thuật
              </a>
            )}
          </div>
        </header>
        <div className="pd-hero__media">
          <ProductGallery product={product} />
        </div>
        <section aria-label="Mua hàng" className="pd-buybox">
          <BuyBox product={product} />
        </section>
        <div className="pd-hero__support">
          <ProductSpecifications product={product} />
          <ProductStores product={product} />
        </div>
      </div>
      {product.related.length > 0 && (
        <RelatedProducts key={product.id} products={product.related} />
      )}
      <div className="pd-detail">
        <ProductReviews key={product.id} product={product} />
        <ProductQuestions key={product.id} product={product} />
      </div>
    </div>
  )
}

function ProductSpecifications({ product }: { product: CatalogProductDetail }) {
  return (
    <div className="pd-anchor" id="specifications">
      <Panel title="Thông số kỹ thuật" className="pd-specifications">
        {product.specifications.length === 0 && (
          <p className="c-muted">Thông số kỹ thuật đang được cập nhật.</p>
        )}
        {product.specifications.map((group) => (
          <section key={group.title}>
            {group.title !== 'Thông số kỹ thuật' && <h3>{group.title}</h3>}
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
    </div>
  )
}

function BuyBox({ product }: { product: CatalogProductDetail }) {
  const discount = discountPercent(product)
  const savings = (product.listPriceVnd ?? product.priceVnd) - product.priceVnd
  const inStock = product.availableQuantity > 0
  const lowStock = inStock && product.availableQuantity <= LOW_STOCK_THRESHOLD
  return (
    <>
      <div className="pd-price">
        <div>
          <div className="pd-price__label">
            {savings > 0 ? (
              <del>{formatMoney(product.listPriceVnd)}</del>
            ) : (
              'Giá bán'
            )}
          </div>
          <div className="pd-price__row">
            <strong>{formatMoney(product.priceVnd)}</strong>
            {discount && <span>−{discount}%</span>}
          </div>
        </div>
        <Badge tone={!inStock ? 'red' : lowStock ? 'amber' : 'green'}>
          {!inStock
            ? 'Tạm hết hàng'
            : lowStock
              ? `Chỉ còn ${product.availableQuantity} sản phẩm`
              : 'Còn hàng'}
        </Badge>
      </div>
      <ProductVariants product={product} />
      {product.warrantyMonths && (
        <div className="pd-warranty">
          <h2>
            <ShieldCheck size={17} aria-hidden="true" /> Dịch vụ bảo hành
          </h2>
          <div className="pd-warranty__option">
            <span>Bảo hành {product.warrantyMonths} tháng</span>
            <strong>Đã gồm trong giá</strong>
          </div>
        </div>
      )}
      {savings > 0 && (
        <Panel
          className="pd-offers"
          title="Ưu đãi sản phẩm"
          icon={<Gift size={18} aria-hidden="true" />}
        >
          <p>
            Giảm trực tiếp <strong>{formatMoney(savings)}</strong> so với giá
            niêm yết.
          </p>
        </Panel>
      )}
      <PurchaseActions product={product} inStock={inStock} />
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
  const [addedCount, setAddedCount] = useState(0)

  async function handleAdd(next: 'add' | 'buy') {
    setIntent(next)
    if (!(await add.run(product))) return
    if (next === 'buy') await navigate({ to: '/cart' })
    else setAddedCount((count) => count + 1)
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
          className="c-button c-button--primary pd-actions__buy"
        >
          <strong>Mua ngay</strong>
          <small>Đăng nhập để đặt hàng</small>
        </Link>
      </div>
    )
  return (
    <>
      <ErrorNotice error={add.error} />
      {addedCount > 0 && (
        <CartToast key={addedCount} productName={product.name} />
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
          className="pd-actions__add"
          variant="secondary"
          disabled={add.isPending}
          pending={add.isPending && intent === 'add'}
          onClick={() => handleAdd('add')}
        >
          <ShoppingCart size={17} aria-hidden="true" />
          Thêm vào giỏ
        </Action>
      </div>
    </>
  )
}

function RelatedProducts({ products }: { products: CatalogProduct[] }) {
  return (
    <section className="pd-related" aria-labelledby="pd-related-title">
      <h2 id="pd-related-title">
        <span>Sản phẩm tương tự</span>
      </h2>
      <div className="store-product-grid">
        {products.map((item) => (
          <StoreProductCard item={item} key={item.id} />
        ))}
      </div>
    </section>
  )
}
