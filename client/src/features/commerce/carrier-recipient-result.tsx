import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { orderQueryPaths, useCommand, write } from './api'
import { Action, Drawer, ErrorNotice, Field, Notice } from './components'
import { RecipientFields, recipientSchema } from './customer-pages'
import { inputToIso, vietnamDateInput } from './date-time'
import type { OrderDetail, Recipient } from './types'

export function CarrierRecipientResultDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const form = useForm<Recipient>({ defaultValues: order.recipient })
  const [outcome, setOutcome] = useState('')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [confirmedAt, setConfirmedAt] = useState(() =>
    vietnamDateInput(order.serverTime),
  )
  const [verified, setVerified] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const command = useCommand(
    (input: {
      recipient: Recipient
      outcome: 'accepted' | 'rejected'
      reference: string
      reason: string
      confirmedAt: string
    }) =>
      write(`staff/orders/${order.id}/shipment/recipient-result`, {
        ...input,
        expectedRevision: order.revision,
        shipmentId: order.shipment?.id,
        carrierId: order.shipment?.carrierId,
        trackingReference: order.shipment?.trackingReference,
        evidenceVerified: true,
      }),
    orderQueryPaths,
  )
  return (
    <Drawer
      title="Kết quả đổi người nhận qua hãng"
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onChange={(event) => {
          const target = event.target
          if (
            !(
              target instanceof HTMLInputElement &&
              target.name === 'evidenceVerified'
            )
          )
            setVerified(false)
        }}
        onSubmit={form.handleSubmit(async (values) => {
          if (command.isPending) return
          const parsed = recipientSchema.safeParse(values)
          if (!parsed.success) {
            for (const issue of parsed.error.issues)
              form.setError(issue.path[0] as keyof Recipient, {
                message: issue.message,
              })
            return
          }
          const timestamp = Date.parse(`${confirmedAt}+07:00`)
          if (
            !verified ||
            !['accepted', 'rejected'].includes(outcome) ||
            !Number.isFinite(timestamp)
          ) {
            setValidationError(
              'Vui lòng chọn kết quả, thời điểm phản hồi và xác nhận đã đối chiếu bằng chứng từ hãng.',
            )
            return
          }
          setValidationError(null)
          if (
            await command.run({
              recipient: parsed.data,
              outcome: outcome as 'accepted' | 'rejected',
              reference: reference.trim(),
              reason: reason.trim(),
              confirmedAt: inputToIso(confirmedAt),
            })
          )
            onClose()
        })}
      >
        <Notice tone="amber">
          Liên hệ hãng trước khi ghi nhận. Chỉ cập nhật người nhận khi hãng đã
          chấp thuận cho đúng vận đơn {order.shipment?.trackingReference}. Nếu
          hãng từ chối, đơn giữ nguyên thông tin hiện tại.
        </Notice>
        <h3>Thông tin người nhận đã đề nghị hãng thay đổi</h3>
        <RecipientFields form={form} />
        <Field label="Kết quả từ hãng *">
          <select
            required
            value={outcome}
            disabled={command.isPending}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="">Chọn kết quả đã xác minh</option>
            <option value="accepted">Hãng đã chấp thuận và cập nhật</option>
            <option value="rejected">Hãng từ chối thay đổi</option>
          </select>
        </Field>
        <Field label="Mã phản hồi hoặc tham chiếu bằng chứng *">
          <input
            required
            minLength={3}
            maxLength={200}
            value={reference}
            disabled={command.isPending}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        <Field label="Thời điểm hãng phản hồi (giờ Việt Nam) *">
          <input
            type="datetime-local"
            step={0.001}
            required
            min={
              order.shipment
                ? vietnamDateInput(order.shipment.createdAt)
                : undefined
            }
            value={confirmedAt}
            disabled={command.isPending}
            onChange={(event) => setConfirmedAt(event.target.value)}
          />
        </Field>
        <Field label="Nội dung phản hồi và lý do thay đổi *">
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={reason}
            disabled={command.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <label className="c-check">
          <input
            type="checkbox"
            name="evidenceVerified"
            required
            checked={verified}
            disabled={command.isPending}
            onChange={(event) => setVerified(event.target.checked)}
          />
          Tôi đã đối chiếu phản hồi của đúng hãng và đúng mã vận đơn.
        </label>
        {validationError && (
          <Notice tone="red">
            <span role="alert">{validationError}</span>
          </Notice>
        )}
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            disabled={command.isPending}
            onClick={onClose}
          >
            Quay lại
          </Action>
          <Action type="submit" pending={command.isPending}>
            Lưu kết quả của hãng
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
