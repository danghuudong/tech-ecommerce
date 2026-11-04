import { Send } from 'lucide-react'
import { useState } from 'react'
import { orderQueryPaths, useCommand, write } from './api'
import { CarrierPicker } from './carrier-picker'
import { Action, ErrorNotice, Field, Notice } from './components'
import {
  type PackingChecklist,
  packingChecklistKey,
  packingChecklistVerified,
  packingChecks,
} from './packing-checklist'
import type { OrderDetail } from './types'
import { WaybillCorrectionDrawer } from './waybill-correction'
import {
  readWaybillChecks,
  type WaybillChecks,
  WaybillVerificationFields,
} from './waybill-verification'

type WaybillFormInput = WaybillChecks & {
  carrierId: string
  trackingReference: string
}

export function DispatchForm({ order }: { order: OrderDetail }) {
  const [carrierId, setCarrierId] = useState('')
  const [trackingReference, setTrackingReference] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const dispatch = useCommand(
    (input: WaybillFormInput & { packingChecklist: PackingChecklist }) =>
      write(`staff/orders/${order.id}/dispatch`, {
        ...input,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  const waybill = useCommand(
    (input: WaybillFormInput) =>
      write(`staff/orders/${order.id}/waybill`, {
        ...input,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  const verify = useCommand(
    (input: WaybillChecks) =>
      write(`staff/orders/${order.id}/waybill/verification`, {
        ...input,
        shipmentId: order.shipment?.id,
        expectedRevision: order.revision,
      }),
    orderQueryPaths,
  )
  const busy = dispatch.isPending || waybill.isPending || verify.isPending
  const locked = Boolean(order.shipment)
  const selectedCarrierId = locked
    ? (order.shipment?.carrierId ?? '')
    : carrierId
  const selectedTracking =
    order.shipment?.trackingReference ?? trackingReference
  const verification = order.shipment?.verification
  const needsVerification =
    locked && (!verification?.recipient || !verification?.payment)
  const actions = order.permittedActions.staff
  return (
    <>
      <form
        className="c-form-section"
        style={{ marginTop: 18 }}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault()
          if (busy || correcting) return
          const submitter = (event.nativeEvent as SubmitEvent).submitter
          if (!(submitter instanceof HTMLButtonElement)) return
          const intent = submitter.value
          if (
            !['waybill', 'dispatch', 'verify'].includes(intent) ||
            (intent === 'waybill' && locked)
          )
            return
          const data = new FormData(event.currentTarget)
          const reference = selectedTracking.trim()
          const checks = readWaybillChecks(data)
          const checked: PackingChecklist = {
            productsChecked: data.get('productsChecked') === 'true',
            conditionChecked: data.get('conditionChecked') === 'true',
            packagingChecked: data.get('packagingChecked') === 'true',
          }
          const error =
            intent === 'dispatch' && !packingChecklistVerified(checked)
              ? 'Vui lòng tích đủ 3 mục kiểm tra đóng gói trước khi bàn giao.'
              : !selectedCarrierId
                ? 'Vui lòng chọn đơn vị vận chuyển.'
                : reference.length < 3 || reference.length > 200
                  ? 'Mã vận đơn cần từ 3 đến 200 ký tự, không tính khoảng trắng ở đầu và cuối.'
                  : !verification?.recipient && !checks.recipientVerified
                    ? 'Vui lòng đối chiếu lại tên, điện thoại và địa chỉ trên vận đơn.'
                    : !verification?.payment && !checks.paymentVerified
                      ? 'Vui lòng đối chiếu phương thức thanh toán và số tiền hãng phải thu.'
                      : null
          setValidationError(error)
          if (error) return
          dispatch.reset()
          waybill.reset()
          verify.reset()
          const input = {
            carrierId: selectedCarrierId,
            trackingReference: reference,
            ...checks,
          }
          if (intent === 'waybill') await waybill.run(input)
          else if (intent === 'verify') await verify.run(checks)
          else await dispatch.run({ ...input, packingChecklist: checked })
        }}
      >
        <div key={packingChecklistKey(order)} className="c-packing-checks">
          <h3>Kiểm tra và đóng gói</h3>
          <p>
            Tích sau khi kiểm tra và đóng gói xong. Bắt buộc trước khi xác nhận
            bàn giao.
          </p>
          {packingChecks.map(({ key, label }) => (
            <label className="c-check" key={key}>
              <input
                type="checkbox"
                name={key}
                value="true"
                defaultChecked={false}
                disabled={busy}
                onChange={() => setValidationError(null)}
              />
              {label}
            </label>
          ))}
        </div>
        <h3>Thông tin vận đơn</h3>
        <CarrierPicker
          value={selectedCarrierId}
          onChange={(value) => {
            setCarrierId(value)
            setValidationError(null)
          }}
          disabled={busy || locked}
        />
        <Field
          label="Mã vận đơn *"
          hint="Nhập mã vận đơn do đơn vị vận chuyển cấp."
        >
          <input
            name="tracking"
            value={selectedTracking}
            required
            minLength={3}
            maxLength={200}
            disabled={busy || locked}
            placeholder="Nhập mã vận đơn thực tế"
            onChange={(event) => {
              setTrackingReference(event.currentTarget.value)
              setValidationError(null)
            }}
          />
        </Field>
        {locked && (
          <Notice>
            <strong>Đã lưu vận đơn.</strong>
            <p>
              Nếu cần thay đổi thông tin người nhận, hãy liên hệ hãng vận chuyển
              trước. Khi hãng phản hồi, ghi nhận kết quả tại đây.
            </p>
            {actions.includes('correct_waybill') && (
              <Action
                variant="secondary"
                disabled={busy}
                onClick={() => setCorrecting(true)}
              >
                Sửa vận đơn
              </Action>
            )}
          </Notice>
        )}
        <WaybillVerificationFields
          order={order}
          carrierId={selectedCarrierId}
          trackingReference={selectedTracking}
          disabled={busy}
          verification={verification}
          onChange={() => setValidationError(null)}
        />
        <div className="c-actions c-actions--end">
          {!locked && actions.includes('confirm_waybill') && (
            <Action
              type="submit"
              value="waybill"
              variant="secondary"
              pending={waybill.isPending}
              disabled={dispatch.isPending || verify.isPending}
            >
              Lưu vận đơn đã chốt
            </Action>
          )}
          {needsVerification && actions.includes('verify_waybill') && (
            <Action
              type="submit"
              value="verify"
              variant="secondary"
              pending={verify.isPending}
              disabled={dispatch.isPending || waybill.isPending}
            >
              Lưu đối chiếu vận đơn
            </Action>
          )}
        </div>
        {validationError && (
          <Notice tone="red">
            <span role="alert">{validationError}</span>
          </Notice>
        )}
        <ErrorNotice error={dispatch.error} />
        <ErrorNotice error={waybill.error} />
        <ErrorNotice error={verify.error} />
        <h3>Bàn giao cho đơn vị vận chuyển</h3>
        <p>
          Chỉ xác nhận khi đã giao kiện hàng cho nhân viên vận chuyển đến lấy.
        </p>
        <div className="c-actions c-actions--end">
          <Action
            type="submit"
            value="dispatch"
            pending={dispatch.isPending}
            disabled={waybill.isPending || verify.isPending}
          >
            <Send size={16} />
            Xác nhận bàn giao
          </Action>
        </div>
      </form>
      {correcting && actions.includes('correct_waybill') && (
        <WaybillCorrectionDrawer
          order={order}
          onClose={() => setCorrecting(false)}
        />
      )}
    </>
  )
}
