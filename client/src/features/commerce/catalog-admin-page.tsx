import { Plus } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useActor, useCommerceQuery } from './api'
import {
  CatalogProductForm,
  type ProductFormValues,
} from './catalog-product-form'
import {
  ProductImagesPanel,
  ProductStockPanel,
  ProductStoresPanel,
} from './catalog-product-panels'
import {
  AccessGate,
  Action,
  Badge,
  Drawer,
  Empty,
  Field,
  formatMoney,
  Loading,
  PageHeading,
  Pagination,
  Panel,
  QueryError,
} from './components'
import { StaffLayout } from './layouts'
import type { Page, StaffProduct } from './types'

const PAGE_SIZE = 20

type Editing =
  | { mode: 'create'; initial: ProductFormValues }
  | { mode: 'edit'; productId: string }

const allTabs = [
  { id: 'details', label: 'Thông tin', admin: true },
  { id: 'images', label: 'Ảnh', admin: true },
  { id: 'stock', label: 'Tồn kho', admin: true },
  { id: 'stores', label: 'Cửa hàng', admin: false },
] as const

export function CatalogAdminPage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['staff', 'admin']}>
        <CatalogAdminContent />
      </AccessGate>
    </StaffLayout>
  )
}

function CatalogAdminContent() {
  const actor = useActor()
  const isAdmin = actor.data?.role === 'admin'
  const [offset, setOffset] = useState(0)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const products = useCommerceQuery<Page<StaffProduct>>('staff/products', {
    limit: PAGE_SIZE,
    offset,
    q: q || undefined,
  })
  const editedProduct =
    editing?.mode === 'edit'
      ? products.data?.items.find((item) => item.id === editing.productId)
      : undefined
  return (
    <>
      <PageHeading
        title="Sản phẩm"
        subtitle="Quản lý thông tin, phiên bản, ảnh, tồn kho và tình trạng tại cửa hàng."
      >
        {isAdmin && (
          <Action onClick={() => setEditing({ mode: 'create', initial: {} })}>
            <Plus size={16} /> Thêm sản phẩm
          </Action>
        )}
      </PageHeading>
      <Panel className="c-table-panel">
        <form
          className="c-filters"
          onSubmit={(event) => {
            event.preventDefault()
            setQ(text.trim())
            setOffset(0)
          }}
        >
          <Field label="Tìm sản phẩm">
            <input
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
              placeholder="Tên hoặc mã SKU"
              type="search"
              value={text}
            />
          </Field>
          <Action type="submit" variant="secondary">
            Tìm
          </Action>
        </form>
        {products.isPending ? (
          <Loading />
        ) : products.isError ? (
          <QueryError error={products.error} retry={() => products.refetch()} />
        ) : (
          <>
            {products.data.items.length ? (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Nhóm phiên bản</th>
                      <th className="c-number">Giá bán</th>
                      <th className="c-number">Có thể bán</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.items.map((product) => (
                      <tr key={product.id}>
                        <td>
                          {product.name}
                          <br />
                          <small>{product.sku}</small>
                        </td>
                        <td>{product.variantGroup ?? '—'}</td>
                        <td className="c-number">
                          {formatMoney(product.priceVnd)}
                        </td>
                        <td className="c-number">
                          {product.stockOnHand - product.stockReserved}
                        </td>
                        <td>
                          <Badge tone={product.active ? 'green' : 'amber'}>
                            {product.active ? 'Đang bán' : 'Ngừng bán'}
                          </Badge>
                        </td>
                        <td>
                          <div className="c-actions">
                            <Action
                              onClick={() =>
                                setEditing({
                                  mode: 'edit',
                                  productId: product.id,
                                })
                              }
                              variant="secondary"
                            >
                              {isAdmin ? 'Sửa' : 'Cập nhật cửa hàng'}
                            </Action>
                            {isAdmin && (
                              <Action
                                onClick={() =>
                                  setEditing({
                                    mode: 'create',
                                    initial: { ...product, sku: '' },
                                  })
                                }
                                variant="ghost"
                              >
                                Thêm phiên bản
                              </Action>
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
                title="Không có sản phẩm phù hợp"
                description="Thử từ khóa khác."
              />
            )}
            <Pagination
              count={products.data.items.length}
              disabled={products.isFetching}
              limit={PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
              total={products.data.total}
            />
          </>
        )}
      </Panel>
      {editing?.mode === 'create' &&
        createPortal(
          <Drawer
            onClose={() => setEditing(null)}
            title={
              editing.initial.name
                ? `Thêm phiên bản của ${editing.initial.name}`
                : 'Thêm sản phẩm'
            }
            wide
          >
            <CatalogProductForm
              initial={editing.initial}
              onSaved={() => setEditing(null)}
            />
          </Drawer>,
          document.body,
        )}
      {editedProduct &&
        createPortal(
          <ProductDrawer
            isAdmin={isAdmin}
            onClose={() => setEditing(null)}
            product={editedProduct}
          />,
          document.body,
        )}
    </>
  )
}

function ProductDrawer({
  product,
  isAdmin,
  onClose,
}: {
  product: StaffProduct
  isAdmin: boolean
  onClose: () => void
}) {
  const tabs = allTabs.filter((tab) => isAdmin || !tab.admin)
  const [tab, setTab] = useState<(typeof allTabs)[number]['id']>(
    tabs[0]?.id ?? 'stores',
  )
  return (
    <Drawer onClose={onClose} title={product.name} wide>
      <div className="c-tabs">
        {tabs.map((item) => (
          <button
            className={tab === item.id ? 'is-active' : ''}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'details' && (
        <CatalogProductForm
          initial={product}
          key={product.version}
          onSaved={onClose}
          productId={product.id}
        />
      )}
      {tab === 'images' && <ProductImagesPanel product={product} />}
      {tab === 'stock' && <ProductStockPanel product={product} />}
      {tab === 'stores' && <ProductStoresPanel product={product} />}
    </Drawer>
  )
}
