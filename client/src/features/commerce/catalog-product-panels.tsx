import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { prepareProductImage } from '@/features/catalog/product-image-upload'
import {
  productImageUrl,
  storeAvailabilityOptions,
} from '@/features/catalog/product-view'
import { useCommand, useCommerceQuery, write } from './api'
import {
  Action,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  QueryError,
} from './components'
import type {
  StaffProduct,
  StaffProductImage,
  StaffStoreAvailability,
  StoreAvailabilityStatus,
} from './types'

const MAX_IMAGES = 8

export function ProductImagesPanel({ product }: { product: StaffProduct }) {
  const path = `staff/products/${product.id}/images`
  const images = useCommerceQuery<{ items: StaffProductImage[] }>(path)
  const [uploadError, setUploadError] = useState('')
  const refresh = ['staff/products']
  const upload = useCommand(
    (input: { mediaType: string; contentBase64: string; altText: string }) =>
      write(`admin/products/${product.id}/images`, input),
    refresh,
  )
  const remove = useCommand(
    (imageId: string) =>
      write(`admin/products/${product.id}/images/${imageId}/remove`, {}),
    refresh,
  )
  const reorder = useCommand(
    (imageIds: string[]) =>
      write(`admin/products/${product.id}/images/order`, { imageIds }, 'patch'),
    refresh,
  )
  if (images.isPending) return <Loading />
  if (images.isError)
    return <QueryError error={images.error} retry={() => images.refetch()} />
  const items = images.data.items
  const busy = upload.isPending || remove.isPending || reorder.isPending
  const move = (index: number, step: number) => {
    const ids = items.map((image) => image.id)
    const [id] = ids.splice(index, 1)
    if (!id) return
    ids.splice(index + step, 0, id)
    void reorder.run(ids)
  }
  return (
    <div className="c-form-section">
      <Notice>
        Dùng ảnh thật do cửa hàng chụp hoặc được hãng cho phép sử dụng. Ảnh đầu
        tiên là ảnh đại diện. Mỗi sản phẩm có tối đa {MAX_IMAGES} ảnh.
      </Notice>
      {items.length ? (
        <ul className="c-product-images">
          {items.map((image, index) => (
            <li key={image.id}>
              <img
                alt={image.altText}
                className="product-photo"
                src={productImageUrl(image.id)}
              />
              <div>
                <Action
                  aria-label="Chuyển ảnh lên trước"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  variant="ghost"
                >
                  <ArrowLeft size={16} />
                </Action>
                <Action
                  aria-label="Chuyển ảnh ra sau"
                  disabled={busy || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  variant="ghost"
                >
                  <ArrowRight size={16} />
                </Action>
                <Action
                  aria-label="Xóa ảnh"
                  disabled={busy}
                  onClick={() => void remove.run(image.id)}
                  variant="ghost"
                >
                  <Trash2 size={16} />
                </Action>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title="Sản phẩm chưa có ảnh"
          description="Trang sản phẩm đang dùng ảnh minh họa theo danh mục."
        />
      )}
      {items.length < MAX_IMAGES && (
        <Field label="Thêm ảnh" hint="Ảnh JPEG, PNG hoặc WebP.">
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              if (!file) return
              setUploadError('')
              try {
                const prepared = await prepareProductImage(file)
                await upload.run({ ...prepared, altText: product.name })
              } catch (error) {
                setUploadError(
                  error instanceof Error
                    ? error.message
                    : 'Không đọc được ảnh này.',
                )
              }
              input.value = ''
            }}
            type="file"
          />
        </Field>
      )}
      {upload.isPending && (
        <Notice>
          <ImagePlus size={15} aria-hidden="true" /> Đang tải ảnh lên…
        </Notice>
      )}
      {uploadError && <Notice tone="red">{uploadError}</Notice>}
      <ErrorNotice error={upload.error ?? remove.error ?? reorder.error} />
    </div>
  )
}

export function ProductStoresPanel({ product }: { product: StaffProduct }) {
  const stores = useCommerceQuery<{ items: StaffStoreAvailability[] }>(
    `staff/products/${product.id}/store-availability`,
  )
  const update = useCommand(
    (input: { storeId: string; status: StoreAvailabilityStatus | null }) =>
      write(
        `staff/products/${product.id}/store-availability/${input.storeId}`,
        { status: input.status },
        'put',
      ),
    ['staff/products'],
  )
  if (stores.isPending) return <Loading />
  if (stores.isError)
    return <QueryError error={stores.error} retry={() => stores.refetch()} />
  if (stores.data.items.length === 0)
    return (
      <Empty
        title="Chưa có cửa hàng"
        description="Thêm cửa hàng ở mục Cửa hàng trước khi cập nhật tình trạng."
      />
    )
  return (
    <div className="c-form-section">
      <Notice>
        Đây là thông tin hiển thị cho khách, không thay đổi tồn kho bán online
        và không tự giảm khi có đơn hàng.
      </Notice>
      {stores.data.items.map((store) => (
        <Field
          hint={
            store.updatedAt
              ? `Cập nhật ${formatDate(store.updatedAt)}`
              : store.province
          }
          key={store.storeId}
          label={store.name}
        >
          <select
            disabled={update.isPending}
            onChange={(event) =>
              void update.run({
                storeId: store.storeId,
                status: (event.target.value as StoreAvailabilityStatus) || null,
              })
            }
            value={store.status ?? ''}
          >
            <option value="">Không hiển thị</option>
            {Object.entries(storeAvailabilityOptions).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <ErrorNotice error={update.error} />
    </div>
  )
}

export function ProductStockPanel({ product }: { product: StaffProduct }) {
  const [saved, setSaved] = useState(false)
  const adjust = useCommand(
    (input: { delta: number; reason: string; reference: string }) =>
      write(`admin/products/${product.id}/stock-adjustments`, input),
    ['staff/products'],
  )
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        event.stopPropagation()
        setSaved(false)
        const form = event.currentTarget
        const data = new FormData(form)
        const result = await adjust.run({
          delta: Number(data.get('delta')),
          reason: String(data.get('reason')).trim(),
          reference: String(data.get('reference')).trim(),
        })
        if (result) {
          form.reset()
          setSaved(true)
        }
      }}
    >
      <Notice>
        Tồn kho hiện có: {product.stockOnHand}, đang giữ cho đơn:{' '}
        {product.stockReserved}. Mọi thay đổi đều được ghi vào lịch sử tồn kho.
      </Notice>
      <Field
        label="Số lượng thay đổi *"
        hint="Nhập số dương để nhập kho, số âm để giảm."
      >
        <input name="delta" required step={1} type="number" />
      </Field>
      <Field label="Lý do *">
        <input maxLength={1000} minLength={3} name="reason" required />
      </Field>
      <Field label="Mã chứng từ *" hint="Ví dụ: số phiếu nhập kho.">
        <input maxLength={200} minLength={3} name="reference" required />
      </Field>
      <ErrorNotice error={adjust.error} />
      {saved && <Notice tone="green">Đã cập nhật tồn kho.</Notice>}
      <div className="c-actions c-actions--end">
        <Action pending={adjust.isPending} type="submit">
          Ghi nhận
        </Action>
      </div>
    </form>
  )
}
