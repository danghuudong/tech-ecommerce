import { Plus } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { storeProvinces } from '@/shared/components/store-layout/store-location.data'
import { useActor, useCommand, useCommerceQuery, write } from './api'
import {
  AccessGate,
  Action,
  Badge,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  PageHeading,
  Panel,
  QueryError,
} from './components'
import { StaffLayout } from './layouts'
import type { Store } from './types'

export function StoresPage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['staff', 'admin']}>
        <StoresContent />
      </AccessGate>
    </StaffLayout>
  )
}

function StoresContent() {
  const actor = useActor()
  const isAdmin = actor.data?.role === 'admin'
  const stores = useCommerceQuery<{ items: Store[] }>('staff/stores')
  const [editing, setEditing] = useState<Store | 'new' | null>(null)
  return (
    <>
      <PageHeading
        title="Cửa hàng"
        subtitle="Danh sách cửa hàng hiển thị ở mục tình trạng hàng trên trang sản phẩm."
      >
        {isAdmin && (
          <Action onClick={() => setEditing('new')}>
            <Plus size={16} /> Thêm cửa hàng
          </Action>
        )}
      </PageHeading>
      <Panel className="c-table-panel">
        {stores.isPending ? (
          <Loading />
        ) : stores.isError ? (
          <QueryError error={stores.error} retry={() => stores.refetch()} />
        ) : stores.data.items.length ? (
          <div className="c-table-wrap">
            <table className="c-table">
              <thead>
                <tr>
                  <th>Cửa hàng</th>
                  <th>Địa chỉ</th>
                  <th>Liên hệ</th>
                  <th>Trạng thái</th>
                  {isAdmin && <th>Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {stores.data.items.map((store) => (
                  <tr key={store.id}>
                    <td>{store.name}</td>
                    <td>
                      {store.address}, {store.province}
                    </td>
                    <td>
                      {store.phone ?? '—'}
                      <br />
                      <small>{store.openingHours ?? ''}</small>
                    </td>
                    <td>
                      <Badge tone={store.active ? 'green' : 'amber'}>
                        {store.active ? 'Đang hiển thị' : 'Đã ẩn'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td>
                        <Action
                          onClick={() => setEditing(store)}
                          variant="secondary"
                        >
                          Sửa
                        </Action>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Chưa có cửa hàng"
            description="Thêm cửa hàng để khách xem tình trạng hàng theo từng địa điểm."
          />
        )}
      </Panel>
      {editing &&
        createPortal(
          <StoreDrawer
            onClose={() => setEditing(null)}
            store={editing === 'new' ? null : editing}
          />,
          document.body,
        )}
    </>
  )
}

function StoreDrawer({
  store,
  onClose,
}: {
  store: Store | null
  onClose: () => void
}) {
  const save = useCommand(
    (body: Record<string, unknown>) =>
      store
        ? write(`admin/stores/${store.id}`, body, 'patch')
        : write('admin/stores', body),
    ['staff/stores'],
  )
  return (
    <Drawer
      busy={save.isPending}
      onClose={onClose}
      title={store ? 'Sửa cửa hàng' : 'Thêm cửa hàng'}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const data = new FormData(event.currentTarget)
          const result = await save.run({
            name: String(data.get('name')).trim(),
            address: String(data.get('address')).trim(),
            province: String(data.get('province')),
            phone: String(data.get('phone')).trim() || null,
            openingHours: String(data.get('openingHours')).trim() || null,
            active: data.get('active') === 'true',
          })
          if (result) onClose()
        }}
      >
        <Field label="Tên cửa hàng *">
          <input
            defaultValue={store?.name ?? ''}
            maxLength={120}
            minLength={2}
            name="name"
            required
          />
        </Field>
        <Field label="Tỉnh / thành phố *">
          <select defaultValue={store?.province ?? ''} name="province" required>
            <option value="">Chọn tỉnh / thành phố</option>
            {storeProvinces.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Địa chỉ *">
          <input
            defaultValue={store?.address ?? ''}
            maxLength={300}
            minLength={5}
            name="address"
            required
          />
        </Field>
        <Field label="Số điện thoại">
          <input
            defaultValue={store?.phone ?? ''}
            maxLength={20}
            name="phone"
            pattern="\+?[0-9 .\-]{6,20}"
            type="tel"
          />
        </Field>
        <Field label="Giờ mở cửa" hint="Ví dụ: 8:00 - 21:30 mỗi ngày.">
          <input
            defaultValue={store?.openingHours ?? ''}
            maxLength={120}
            name="openingHours"
          />
        </Field>
        <Field label="Trạng thái">
          <select defaultValue={String(store?.active ?? true)} name="active">
            <option value="true">Đang hiển thị</option>
            <option value="false">Đã ẩn</option>
          </select>
        </Field>
        <ErrorNotice error={save.error} />
        <div className="c-actions c-actions--end">
          <Action pending={save.isPending} type="submit">
            Lưu
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
