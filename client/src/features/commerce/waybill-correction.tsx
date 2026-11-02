import { useState } from 'react'
import { orderQueryPaths, useCommand, write } from './api'
import { CarrierPicker } from './carrier-picker'
import { Action, Drawer, ErrorNotice, Field, Notice } from './components'
import type { OrderDetail } from './types'
import {
  readWaybillChecks,
  WaybillVerificationFields,
} from './waybill-verification'

export function WaybillCorrectionDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const shipment = order.shipment
  const [carrierId, setCarrierId] = useState(shipment?.carrierId ?? '')
  const [trackingReference, setTrackingReference] = useState(
    shipment?.trackingReference ?? '',
  )
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const command = useCommand(
    (input: {
      carrierId: string
      trackingReference: string
      reason: string
      recipientVerified: true
      paymentVerified: true
    }) =>
      write(`staff/orders/${order.id}/waybill/correction`, {
        ...input,
        shipmentId: shipment?.id,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  if (!shipment) return null
  return (
    <Drawer
      title="Sửa vận đơn trước bàn giao"
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault()
          if (command.isPending) return
          const reference = trackingReference.trim()
          const checks = readWaybillChecks(new FormData(event.currentTarget))
          const error = !carrierId
            ? 'Vui lòng chọn hãng vận chuyển.'
            : reference.length < 3 || reference.length > 200
              ? 'Mã vận đơn cần từ 3 đến 200 ký tự.'
              : carrierId === shipment.carrierId &&
                  reference === shipment.trackingReference
                ? 'Hãy sửa hãng hoặc mã vận đơn đã nhập nhầm.'
                : reason.trim().length < 3 || reason.trim().length > 1000
                  ? 'Lý do sửa cần từ 3 đến 1.000 ký tự.'
                  : !checks.recipientVerified || !checks.paymentVerified
                    ? 'Vui lòng đối chiếu lại cả người nhận và thanh toán/COD với vận đơn vừa sửa.'
                    : null
          setValidationError(error)
          if (error) return
          const result = await command.run({
            carrierId,
            trackingReference: reference,
            reason: reason.trim(),
            recipientVerified: true,
            paymentVerified: true,
          })
          if (result) onClose()
        }}
      >
        <Notice>
          Đối chiếu với vận đơn thực tế của hãng trước khi lưu. Nếu cần đổi vận
          đơn bên hãng, hãy xử lý với hãng trước rồi cập nhật tại đây.
        </Notice>
        <CarrierPicker
          value={carrierId}
          onChange={(value) => {
            setCarrierId(value)
            setValidationError(null)
          }}
          disabled={command.isPending}
        />
        <Field label="Mã vận đơn *">
          <input
            value={trackingReference}
            minLength={3}
            maxLength={200}
            disabled={command.isPending}
            onChange={(event) => {
              setTrackingReference(event.currentTarget.value)
              setValidationError(null)
            }}
          />
        </Field>
        <Field label="Lý do sửa *">
          <textarea
            value={reason}
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
            onChange={(event) => {
              setReason(event.currentTarget.value)
              setValidationError(null)
            }}
          />
        </Field>
        <WaybillVerificationFields
          order={order}
          carrierId={carrierId}
          trackingReference={trackingReference}
          disabled={command.isPending}
          onChange={() => setValidationError(null)}
        />
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
            Lưu thay đổi vận đơn
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
