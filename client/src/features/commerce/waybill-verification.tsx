import { formatDate, formatMoney, RecipientCard } from './components'
import {
  paymentVerificationKey,
  recipientVerificationKey,
} from './packing-checklist'
import type { OrderDetail, WaybillVerificationProof } from './types'

export type WaybillChecks = {
  recipientVerified?: true | undefined
  paymentVerified?: true | undefined
}

export function readWaybillChecks(data: FormData): WaybillChecks {
  return {
    recipientVerified:
      data.get('recipientVerified') === 'true' ? true : undefined,
    paymentVerified: data.get('paymentVerified') === 'true' ? true : undefined,
  }
}

function VerificationProof({
  label,
  proof,
}: {
  label: string
  proof: WaybillVerificationProof
}) {
  return (
    <div role="status">
      <strong>{label}</strong>
      <p>
        Người xác nhận:{' '}
        {proof.actorName ??
          (proof.actorUserId ? 'Nhân viên đã xác nhận' : 'Hệ thống')}
        {' · '}
        {formatDate(proof.verifiedAt)}
      </p>
    </div>
  )
}

export function WaybillVerificationFields({
  order,
  carrierId,
  trackingReference,
  disabled,
  verification,
  onChange,
}: {
  order: OrderDetail
  carrierId: string
  trackingReference: string
  disabled: boolean
  verification?: NonNullable<OrderDetail['shipment']>['verification']
  onChange: () => void
}) {
  return (
    <>
      <div
        className="c-packing-checks"
        key={JSON.stringify([
          recipientVerificationKey(order),
          carrierId,
          trackingReference,
          verification?.recipient?.eventId,
        ])}
      >
        <h3>Đối chiếu người nhận trên vận đơn</h3>
        <RecipientCard recipient={order.recipient} />
        {verification?.recipient ? (
          <VerificationProof
            label="Đã đối chiếu người nhận"
            proof={verification.recipient}
          />
        ) : (
          <label className="c-check">
            <input
              type="checkbox"
              name="recipientVerified"
              value="true"
              defaultChecked={false}
              disabled={disabled}
              onChange={onChange}
            />
            Tên, điện thoại và địa chỉ trên vận đơn đúng với thông tin người
            nhận.
          </label>
        )}
      </div>
      <div
        className="c-packing-checks"
        key={JSON.stringify([
          paymentVerificationKey(order),
          carrierId,
          trackingReference,
          verification?.payment?.eventId,
        ])}
      >
        <h3>Đối chiếu thanh toán và thu hộ</h3>
        <p>
          {order.paymentMethod === 'cod'
            ? `COD: hãng thu ${formatMoney(order.prices.totalVnd)}`
            : 'Chuyển khoản ngân hàng: hãng không thu COD.'}
        </p>
        {verification?.payment ? (
          <VerificationProof
            label="Đã đối chiếu thanh toán/COD"
            proof={verification.payment}
          />
        ) : (
          <label className="c-check">
            <input
              type="checkbox"
              name="paymentVerified"
              value="true"
              defaultChecked={false}
              disabled={disabled}
              onChange={onChange}
            />
            Phương thức thanh toán và số tiền hãng phải thu trên vận đơn đã
            chính xác.
          </label>
        )}
      </div>
    </>
  )
}
