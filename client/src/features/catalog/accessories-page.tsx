import { Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Empty,
  Loading,
  PageHeading,
  Pagination,
  QueryError,
} from '@/features/commerce/components'
import { CustomerLayout } from '@/features/commerce/layouts'
import type { CatalogProduct } from '@/features/commerce/types'
import { groupAccessories, useAccessories } from './accessory-groups'
import { StoreProductCard } from './components/store-product-card'
import './accessories-page.css'

const PAGE_SIZE = 20

function AccessoryResults({ items }: { items: CatalogProduct[] }) {
  const [offset, setOffset] = useState(0)
  const visibleItems = items.slice(offset, offset + PAGE_SIZE)
  return (
    <>
      <div className="store-product-grid store-product-grid--wide">
        {visibleItems.map((item) => (
          <StoreProductCard item={item} key={item.id} />
        ))}
      </div>
      {items.length > PAGE_SIZE && (
        <Pagination
          count={visibleItems.length}
          limit={PAGE_SIZE}
          offset={offset}
          onChange={setOffset}
          total={items.length}
        />
      )}
    </>
  )
}

export function AccessoriesPage() {
  const { type } = useSearch({ from: '/accessories' })
  const accessories = useAccessories()
  const products = accessories.data ?? []
  const groups = groupAccessories(products)
  const activeGroup = groups.find((group) => group.id === type)
  const items = activeGroup?.products ?? products
  return (
    <CustomerLayout>
      <nav aria-label="Đường dẫn" className="c-breadcrumb">
        <Link to="/">Trang chủ</Link>
        <span aria-hidden="true">›</span>
        {activeGroup ? (
          <>
            <Link activeOptions={{ exact: true }} search={{}} to="/accessories">
              Phụ kiện
            </Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{activeGroup.label}</span>
          </>
        ) : (
          <span aria-current="page">Phụ kiện</span>
        )}
      </nav>
      <PageHeading
        subtitle={
          accessories.isSuccess
            ? `${items.length} sản phẩm`
            : 'Phụ kiện chính hãng cho điện thoại và máy tính.'
        }
        title={activeGroup?.label ?? 'Phụ kiện công nghệ'}
      />
      {groups.length > 0 && (
        <nav aria-label="Nhóm phụ kiện" className="accessory-groups">
          <Link
            activeOptions={{ exact: true }}
            resetScroll={false}
            search={{}}
            to="/accessories"
          >
            Tất cả
          </Link>
          {groups.map((group) => (
            <Link
              activeOptions={{ exact: true }}
              key={group.id}
              resetScroll={false}
              search={{ type: group.id }}
              to="/accessories"
            >
              {group.label}
            </Link>
          ))}
        </nav>
      )}
      {accessories.isPending ? (
        <Loading />
      ) : accessories.isError ? (
        <QueryError
          error={accessories.error}
          retry={() => accessories.refetch()}
        />
      ) : items.length ? (
        <AccessoryResults items={items} key={activeGroup?.id ?? 'all'} />
      ) : (
        <Empty title="Chưa có phụ kiện" />
      )}
    </CustomerLayout>
  )
}
