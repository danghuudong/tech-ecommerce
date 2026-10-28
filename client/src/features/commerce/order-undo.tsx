import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { orderQueryPaths, orderUndoMessages, useCommand, write } from './api'
import {
  Action,
  Drawer,
  ErrorNotice,
  Field,
  formatDate,
  Notice,
  orderLabels,
} from './components'
import { readOrderUndoDocument } from './order-undo-document'
import type { OrderDetail, OrderStatus, OrderUndo } from './types'

const descriptions: Record<OrderUndo['action'], string> = {
  confirmation: 'Đưa đơn về chờ xác nhận để kiểm tra và xác nhận lại.',
  packing: 'Đưa đơn về đã xác nhận để kiểm tra và bắt đầu đóng gói lại.',
  handover:
    'Sửa bàn giao đã ghi nhầm khi toàn bộ hàng vẫn còn tại kho. Hệ thống khôi phục tồn kho, giữ hàng cho đơn và cho phép lập lại vận đơn.',
  delivery:
    'Sửa xác nhận giao thành công đã ghi nhầm. Đơn quay về vận chuyển, giữ nguyên số lần giao thất bại và các khoản chuyển khoản đã xác minh.',
}

const actionLabels: Record<OrderUndo['action'], string> = {
  confirmation: 'Hoàn tác xác nhận đơn hàng',
  packing: 'Hoàn tác đóng gói',
  handover: 'Hoàn tác bàn giao vận chuyển',
  delivery: 'Hoàn tác ghi nhận giao thành công',
}

type UndoSelection = {
  policy: OrderUndo
  revision: number
  status: OrderStatus
}

export function OrderUndoControl({
  order,
  disabled = false,
}: {
  order: OrderDetail
  disabled?: boolean
}) {
  const [selection, setSelection] = useState<UndoSelection | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const policy = order.undo
  if (!policy && !selection && !message) return null
  return (
    <div className="c-form-section">
      {message && <Notice tone="green">{message}</Notice>}
      {policy && (
        <Notice tone={policy.allowed ? 'blue' : 'amber'}>
          <strong>{actionLabels[policy.action]}</strong>
          <p>{descriptions[policy.action]}</p>
          {policy.blockedReason && (
            <p>{orderUndoMessages[policy.blockedReason]}</p>
          )}
          <div className="c-actions">
            <Action
              variant="secondary"
              disabled={disabled || !policy.allowed}
              onClick={() => {
                setMessage(null)
                setSelection({
                  policy,
                  revision: order.revision,
                  status: order.status,
                })
              }}
            >
              <RotateCcw size={16} />
              Hoàn tác: {orderLabels[order.status]} →{' '}
              {orderLabels[policy.targetStatus]}
            </Action>
          </div>
        </Notice>
      )}
      {selection && (
        <OrderUndoDrawer
          order={order}
          selection={selection}
          onClose={() => setSelection(null)}
          onSaved={() => {
            setMessage(
              `Đã đưa đơn về “${orderLabels[selection.policy.targetStatus]}”. Bạn có thể thực hiện lại bước này.`,
            )
            setSelection(null)
          }}
        />
      )}
    </div>
  )
}

function OrderUndoDrawer({
  order,
  selection,
  onClose,
  onSaved,
}: {
  order: OrderDetail
  selection: UndoSelection
  onClose: () => void
  onSaved: () => void
}) {
  const [validation, setValidation] = useState<string | null>(null)
  const { policy } = selection
  const changed =
    order.revision !== selection.revision ||
    order.status !== selection.status ||
    !order.undo?.allowed ||
    order.undo.action !== policy.action ||
    order.undo.requiresConfirmationRenewal !==
      policy.requiresConfirmationRenewal
  const command = useCommand(
    async ({
      file,
      ...input
    }: Record<string, unknown> & { file: File | null }) => {
      const evidenceDocument = file ? await readOrderUndoDocument(file) : null
      return write(`staff/orders/${order.id}/undo`, {
        ...input,
        ...(evidenceDocument ? { evidenceDocument } : {}),
      })
    },
    [...orderQueryPaths, 'staff/products', 'products'],
  )
  return (
    <Drawer
      title={actionLabels[policy.action]}
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          if (changed || command.isPending) return
          const data = new FormData(event.currentTarget)
          const reason = String(data.get('reason') ?? '').trim()
          const file = data.get('evidence')
          if (reason.length < 3) {
            setValidation('Vui lòng nhập lý do có ít nhất 3 ký tự.')
            return
          }
          if (
            policy.requiresEvidence &&
            (!(file instanceof File) ||
              file.size === 0 ||
              data.get('verified') !== 'on')
          ) {
            setValidation(
              'Cần đính kèm tài liệu và xác nhận đã kiểm tra thực tế.',
            )
            return
          }
          const renewalHours = Number(data.get('renewalHours'))
          if (
            policy.requiresConfirmationRenewal &&
            (!Number.isInteger(renewalHours) ||
              renewalHours < 1 ||
              renewalHours > (policy.maxConfirmationRenewalHours ?? 0) ||
              data.get('renewalApproved') !== 'on')
          ) {
            setValidation(
              'Cần chọn thời hạn giữ hàng trong giới hạn và xác nhận duyệt gia hạn.',
            )
            return
          }
          setValidation(null)
          const input = {
            action: policy.action,
            expectedRevision: selection.revision,
            reason,
            file: policy.requiresEvidence && file instanceof File ? file : null,
            ...(policy.requiresConfirmationRenewal
              ? {
                  confirmationRenewal: { hours: renewalHours, confirmed: true },
                }
              : {}),
            ...(policy.action === 'handover'
              ? { goodsInWarehouse: true }
              : policy.action === 'delivery'
                ? { deliveryRecordedIncorrectly: true }
                : {}),
          }
          if (await command.run(input)) onSaved()
        }}
      >
        <Notice tone="amber">
          <strong>
            {orderLabels[selection.status]} → {orderLabels[policy.targetStatus]}
          </strong>
          <p>{descriptions[policy.action]}</p>
          <p>Lý do và người thực hiện sẽ được lưu vào lịch sử đơn hàng.</p>
          {policy.collectionFailuresToCorrect && (
            <p>
              Khi xác nhận giao nhầm, bộ đếm thu COD thất bại từ khách (
              {policy.collectionFailuresToCorrect.customer} lần) và từ đơn vị
              vận chuyển ({policy.collectionFailuresToCorrect.carrier} lần) được
              hiệu chỉnh về 0. Các lần thu đã ghi vẫn được giữ trong lịch sử
              cùng lý do và hồ sơ xác minh này.
            </p>
          )}
          {policy.confirmationExpiresAt &&
            !policy.requiresConfirmationRenewal && (
              <p>
                Giữ nguyên hạn xác nhận hiện hành:{' '}
                {formatDate(policy.confirmationExpiresAt)}.
              </p>
            )}
          {policy.requiresConfirmationRenewal && (
            <p>
              Hạn xác nhận hiện hành đã hết lúc{' '}
              {formatDate(policy.confirmationExpiresAt)}. Quản trị viên cần
              duyệt hạn giữ hàng mới. Thời hạn tính từ lúc lưu thành công theo
              giờ máy chủ; nếu chưa xác nhận lại khi hết hạn, đơn sẽ tự hủy.
            </p>
          )}
        </Notice>
        {changed && (
          <Notice tone="red">
            Đơn hàng vừa thay đổi. Hãy đóng cửa sổ và kiểm tra dữ liệu mới trước
            khi thực hiện lại.
          </Notice>
        )}
        <Field label="Lý do hoàn tác *">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={changed || command.isPending}
            placeholder="Mô tả thao tác đã làm sai và nội dung cần sửa"
          />
        </Field>
        {policy.requiresConfirmationRenewal && (
          <>
            <Field
              label="Giữ hàng thêm (giờ) *"
              hint={`Từ 1 đến ${policy.maxConfirmationRenewalHours} giờ kể từ khi xác nhận thao tác này.`}
            >
              <input
                type="number"
                name="renewalHours"
                min={1}
                max={policy.maxConfirmationRenewalHours ?? 1}
                step={1}
                defaultValue={1}
                required
                disabled={changed || command.isPending}
              />
            </Field>
            <label className="c-check">
              <input
                type="checkbox"
                name="renewalApproved"
                required
                disabled={changed || command.isPending}
              />
              Tôi duyệt gia hạn giữ hàng để sửa xác nhận COD đã ghi nhầm. Lý do
              và hạn mới sẽ được lưu trong lịch sử.
            </label>
          </>
        )}
        {policy.requiresEvidence && (
          <>
            <Field
              label="Tài liệu xác minh *"
              hint="Đính kèm biên bản kiểm kho hoặc xác nhận từ đơn vị vận chuyển: PDF, PNG, JPEG, tối đa 512 KiB. Tệp được lưu cùng thao tác để tra cứu lại."
            >
              <input
                name="evidence"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                required
                disabled={changed || command.isPending}
              />
            </Field>
            <label className="c-check">
              <input
                type="checkbox"
                name="verified"
                required
                disabled={changed || command.isPending}
              />
              {policy.action === 'handover'
                ? 'Tôi đã kiểm tra: toàn bộ hàng vẫn ở kho, chưa bàn giao thực tế cho đơn vị vận chuyển.'
                : 'Tôi đã xác minh: khách chưa nhận hàng, xác nhận giao thành công trước đó được ghi nhầm.'}
            </label>
          </>
        )}
        {validation && <Notice tone="red">{validation}</Notice>}
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            disabled={command.isPending}
            onClick={onClose}
          >
            Đóng
          </Action>
          <Action type="submit" disabled={changed} pending={command.isPending}>
            Xác nhận đưa về “{orderLabels[policy.targetStatus]}”
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
