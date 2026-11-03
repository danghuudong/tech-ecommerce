import { useState } from 'react'
import { orderQueryPaths, useCommand, write } from './api'
import { Action, Drawer, ErrorNotice, Field, Notice } from './components'
import type { OrderDetail } from './types'

export function DeliveryRetryDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const shipment = order.shipment
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const command = useCommand(
    (input: { reason: string; reference?: string | undefined }) =>
      write(`staff/orders/${order.id}/retry-delivery`, {
        ...input,
        shipmentId: shipment?.id,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  if (!shipment) return null
  return (
    <Drawer
      title={`Ghi nhận yêu cầu giao lại lần ${shipment.failedAttempts}`}
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault()
          if (command.isPending) return
          const trimmedReason = reason.trim()
          const trimmedReference = reference.trim()
          const error =
            trimmedReason.length < 3 || trimmedReason.length > 1000
              ? 'Lý do yêu cầu giao lại cần từ 3 đến 1.000 ký tự.'
              : trimmedReference &&
                  (trimmedReference.length < 3 || trimmedReference.length > 200)
                ? 'Tham chiếu yêu cầu cần từ 3 đến 200 ký tự nếu có nhập.'
                : null
          setValidationError(error)
          if (error) return
          const result = await command.run({
            reason: trimmedReason,
            reference: trimmedReference || undefined,
          })
          if (result) onClose()
        }}
      >
        <Notice>
          Gửi yêu cầu giao lại cho hãng vận chuyển trước, sau đó ghi nhận tại
          đây. Thao tác này không tự gửi yêu cầu sang hãng.
        </Notice>
        {shipment.failureReason && (
          <Notice tone="amber">
            Lý do giao thất bại trước đó: {shipment.failureReason}
          </Notice>
        )}
        <Field label="Lý do yêu cầu giao lại *">
          <textarea
            value={reason}
            required
            minLength={3}
            maxLength={1000}
            placeholder="Ví dụ: Khách hẹn nhận lại vào chiều mai."
            disabled={command.isPending}
            onChange={(event) => {
              setReason(event.currentTarget.value)
              setValidationError(null)
            }}
          />
        </Field>
        <Field label="Tham chiếu yêu cầu (nếu có)">
          <input
            value={reference}
            minLength={3}
            maxLength={200}
            placeholder="Mã yêu cầu hoặc tham chiếu trao đổi với hãng"
            disabled={command.isPending}
            onChange={(event) => {
              setReference(event.currentTarget.value)
              setValidationError(null)
            }}
          />
        </Field>
        {validationError && (
          <Notice tone="red">
            <span role="alert">{validationError}</span>
          </Notice>
        )}
        <ErrorNotice error={command.error} />
        <div className="c-actions c-actions--end">
          <Action
            variant="secondary"
            disabled={command.isPending}
            onClick={onClose}
          >
            Đóng
          </Action>
          <Action type="submit" pending={command.isPending}>
            Lưu yêu cầu giao lại
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
