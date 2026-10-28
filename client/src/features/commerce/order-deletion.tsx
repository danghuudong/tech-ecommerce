import { RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  orderDeletionMessages,
  orderQueryPaths,
  useCommand,
  useOrder,
  write,
} from './api'
import {
  Action,
  Drawer,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  QueryError,
} from './components'

export function OrderDeletionButton({
  orderId,
  deleted = false,
  onSuccess,
}: {
  orderId: string
  deleted?: boolean
  onSuccess?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Action
        variant={deleted ? 'secondary' : 'danger'}
        onClick={() => setOpen(true)}
      >
        {deleted ? <RotateCcw size={16} /> : <Trash2 size={16} />}
        {deleted ? 'Khôi phục đơn hàng' : 'Xóa đơn hàng'}
      </Action>
      {open && (
        <OrderDeletionDrawer
          orderId={orderId}
          action={deleted ? 'restore' : 'delete'}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setOpen(false)
            onSuccess?.()
          }}
        />
      )}
    </>
  )
}

function OrderDeletionDrawer({
  orderId,
  action,
  onClose,
  onSuccess,
}: {
  orderId: string
  action: 'delete' | 'restore'
  onClose: () => void
  onSuccess: () => void
}) {
  const query = useOrder(orderId)
  const command = useCommand(
    (input: { reason: string; expectedRevision: number }) =>
      write(`admin/orders/${orderId}/${action}`, input),
    orderQueryPaths,
  )
  const deleting = action === 'delete'
  const title = deleting ? 'Xóa đơn hàng' : 'Khôi phục đơn hàng'
  if (query.isPending)
    return (
      <Drawer title={title} onClose={onClose}>
        <Loading />
      </Drawer>
    )
  if (query.isError)
    return (
      <Drawer title={title} onClose={onClose}>
        <QueryError error={query.error} retry={() => query.refetch()} />
      </Drawer>
    )
  const order = query.data
  const allowed = Boolean(order?.permittedActions.staff.includes(action))
  const blockedReason = deleting ? order?.deletion?.blockedReason : null
  return (
    <Drawer title={title} onClose={onClose} busy={command.isPending}>
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!allowed || !order) return
          const data = new FormData(event.currentTarget)
          const reason = String(data.get('reason') ?? '').trim()
          if (reason.length < 3 || reason.length > 1000) return
          if (deleting && data.get('code') !== order.code) return
          if (await command.run({ reason, expectedRevision: order.revision }))
            onSuccess()
        }}
      >
        <strong>Đơn hàng #{order.code}</strong>
        <Notice tone={deleting ? 'amber' : 'blue'}>
          {deleting
            ? 'Đơn sẽ được ẩn khỏi danh sách quản lý. Lịch sử mua hàng của khách, thanh toán, tồn kho và đối soát vẫn được giữ. Admin có thể khôi phục trong mục “Đã xóa”.'
            : 'Đơn sẽ xuất hiện lại trong danh sách quản lý với trạng thái nghiệp vụ hiện tại.'}
        </Notice>
        {order.deletion?.deletedAt && (
          <Notice>
            Đã xóa lúc {formatDate(order.deletion.deletedAt)}.
            {order.deletion.reason && <p>Lý do: {order.deletion.reason}</p>}
          </Notice>
        )}
        {!allowed && (
          <Notice tone="red">
            {blockedReason
              ? orderDeletionMessages[blockedReason]
              : 'Thao tác không còn khả dụng. Hãy kiểm tra trạng thái đơn và quyền quản trị viên.'}
          </Notice>
        )}
        {allowed && (
          <>
            <Field label="Lý do *">
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                disabled={command.isPending}
              />
            </Field>
            {deleting && (
              <Field label={`Nhập mã ${order.code} để xác nhận *`}>
                <input
                  name="code"
                  required
                  pattern={order.code}
                  autoComplete="off"
                  disabled={command.isPending}
                />
              </Field>
            )}
          </>
        )}
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            onClick={onClose}
            disabled={command.isPending}
          >
            Quay lại
          </Action>
          {allowed && (
            <Action
              type="submit"
              variant={deleting ? 'danger' : 'primary'}
              pending={command.isPending}
            >
              {deleting ? 'Xác nhận xóa đơn' : 'Xác nhận khôi phục'}
            </Action>
          )}
        </div>
      </form>
    </Drawer>
  )
}
