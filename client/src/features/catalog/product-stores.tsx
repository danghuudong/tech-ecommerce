import { Clock, MapPin, Phone, Store } from 'lucide-react'
import { useState } from 'react'
import {
  Action,
  Badge,
  Field,
  formatDate,
  Panel,
} from '@/features/commerce/components'
import type { CatalogProductDetail } from '@/features/commerce/types'
import { storeAvailabilityOptions } from './product-view'

const COLLAPSED_STORES = 3

export function ProductStores({ product }: { product: CatalogProductDetail }) {
  const [province, setProvince] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const provinces = [
    ...new Set(product.storeAvailability.map((store) => store.province)),
  ]
  if (product.storeAvailability.length === 0) return null
  const matchingStores = product.storeAvailability.filter(
    (store) =>
      (!province || store.province === province) &&
      (!inStockOnly || store.status !== 'out_of_stock'),
  )
  const visibleStores = showAll
    ? matchingStores
    : matchingStores.slice(0, COLLAPSED_STORES)
  const hiddenCount = matchingStores.length - visibleStores.length
  return (
    <Panel
      className="pd-stores"
      icon={<Store size={18} aria-hidden="true" />}
      title="Cửa hàng tại khu vực của bạn"
    >
      <div className="pd-stores__filters">
        {provinces.length > 1 && (
          <Field label="Tỉnh / thành phố">
            <select
              value={province}
              onChange={(event) => setProvince(event.target.value)}
            >
              <option value="">Tất cả</option>
              {provinces.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="pd-stores__toggle">
          <input
            checked={inStockOnly}
            onChange={(event) => setInStockOnly(event.target.checked)}
            type="checkbox"
          />
          Chỉ hiện cửa hàng còn hàng
        </label>
      </div>
      {visibleStores.length ? (
        <ul className="pd-stores__list">
          {visibleStores.map((store) => {
            const status = storeAvailabilityOptions[store.status]
            return (
              <li key={store.storeId}>
                <div className="pd-stores__heading">
                  <strong>{store.name}</strong>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p>
                  <MapPin size={14} aria-hidden="true" />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.address}, ${store.province}`)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {store.address}, {store.province}
                  </a>
                </p>
                {store.openingHours && (
                  <p>
                    <Clock size={14} aria-hidden="true" />
                    {store.openingHours}
                  </p>
                )}
                {store.phone && (
                  <p>
                    <Phone size={14} aria-hidden="true" />
                    <a href={`tel:${store.phone.replace(/[ .-]/g, '')}`}>
                      {store.phone}
                    </a>
                  </p>
                )}
                <small>Cập nhật {formatDate(store.updatedAt)}</small>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="pd-stores__note">
          Không có cửa hàng phù hợp với lựa chọn này.
        </p>
      )}
      {hiddenCount > 0 && (
        <Action onClick={() => setShowAll(true)} variant="secondary">
          Xem thêm {hiddenCount} cửa hàng
        </Action>
      )}
      <p className="pd-stores__note">
        Thông tin do cửa hàng cập nhật, vui lòng gọi trước khi đến. Đơn đặt
        online được xử lý từ kho TinovaShop.
      </p>
    </Panel>
  )
}
