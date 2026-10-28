import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { paymentQueryPaths, useCommand, useCommerceQuery, write } from './api'
import { CarrierPicker } from './carrier-picker'
import { CodCarrierMergeDrawer } from './cod-carrier-merge-form'
import {
  Action,
  Badge,
  ErrorNotice,
  Field,
  formatMoney,
  Loading,
  Notice,
  QueryError,
} from './components'
import type { OrderDetail } from './types'

interface CarrierContext {
  orderId: string
  fingerprint: string
  shipment: {
    carrierId: string | null
    carrierName: string | null
    trackingReference: string
  }
  collections: {
    id: string
    orderId: string
    canonicalRootId: string | null
    carrierId: string
    carrierName: string
    reference: string
    amountVnd: number
    active: boolean
    reconciliationRequired: boolean
  }[]
  receipts: {
    id: string
    allocationId: string
    reference: string
    amountVnd: number
    source: string
    duplicateOfId: string | null
    reconciliationRequired: boolean
  }[]
  decisions: {
    id: string
    disposition: string
    amountVnd: number
    responsibleParty: string
    responsibleCarrierId: string | null
    supersedesDecisionId: string | null
    kind: 'resolution' | 'responsibility_correction'
    current: boolean
    reference: string
  }[]
  codReviewPending: boolean
  carrierDecisionBalance: {
    receivableVnd: number | null
    writtenOffVnd: number | null
    unresolvedVnd: number | null
  }
}

export function ShipmentCarrierForm({ order }: { order: OrderDetail }) {
  const [open, setOpen] = useState(false)
  const [proposedCarrierId, setProposedCarrierId] = useState('')
  const [merge, setMerge] = useState<{
    collectionId: string
    carrierId: string
  } | null>(null)
  const allowed = order.permittedActions.staff.some((action) =>
    ['identify_shipment_carrier', 'correct_shipment_carrier'].includes(action),
  )
  const query = useCommerceQuery<CarrierContext>(
    `staff/orders/${order.id}/shipment/carrier`,
    {},
    open && allowed,
  )
  if (!order.shipment) return null
  if (!allowed)
    return order.shipment.carrierId ? null : (
      <Notice tone="amber">
        Vận đơn cũ chưa xác định đơn vị vận chuyển. Quản trị viên cần xác minh
        đơn vị vận chuyển và đối soát các khoản COD liên quan trước khi ghi nhận
        khoản thu hộ mới.
      </Notice>
    )
  if (!open)
    return (
      <Action variant="secondary" onClick={() => setOpen(true)}>
        {order.shipment.carrierId
          ? 'Hiệu chỉnh đơn vị vận chuyển'
          : 'Xác minh đơn vị vận chuyển'}
      </Action>
    )
  return (
    <div className="c-form-section">
      {query.isPending ? (
        <Loading text="Đang tải chứng từ vận chuyển và COD…" />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        <CarrierEditor
          key={`${query.data.fingerprint}:${proposedCarrierId}`}
          context={query.data}
          initialCarrierId={proposedCarrierId}
          onClose={() => setOpen(false)}
          onMerge={(collectionId, carrierId) =>
            setMerge({ collectionId, carrierId })
          }
        />
      )}
      {merge && (
        <CodCarrierMergeDrawer
          collectionId={merge.collectionId}
          carrierId={merge.carrierId}
          onClose={(carrierId) => {
            if (carrierId) setProposedCarrierId(carrierId)
            setMerge(null)
          }}
        />
      )}
      {(query.isPending || query.isError) && (
        <Action variant="secondary" onClick={() => setOpen(false)}>
          Đóng
        </Action>
      )}
    </div>
  )
}

function CarrierEditor({
  context,
  onClose,
  onMerge,
  initialCarrierId,
}: {
  context: CarrierContext
  onClose: () => void
  onMerge: (collectionId: string, carrierId: string) => void
  initialCarrierId: string
}) {
  const [carrierId, setCarrierId] = useState(
    initialCarrierId || context.shipment.carrierId || '',
  )
  const [confirmed, setConfirmed] = useState(false)
  const [codConfirmed, setCodConfirmed] = useState(false)
  const [responsibilityConfirmed, setResponsibilityConfirmed] = useState(false)
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`staff/orders/${context.orderId}/shipment/carrier`, input),
    paymentQueryPaths,
  )
  const changes = carrierId
    ? context.collections.filter(
        (row) => row.canonicalRootId && row.carrierId !== carrierId,
      )
    : []
  const blockedByReconciliation = changes.length > 0 && context.codReviewPending
  const currentDecision = context.decisions.find((row) => row.current)
  const responsibilityRequired = Boolean(
    carrierId &&
      currentDecision &&
      currentDecision.responsibleCarrierId !== carrierId,
  )
  const financialEvidence =
    context.collections.some((row) => row.active) ||
    context.receipts.some(
      (row) => !row.duplicateOfId && row.source === 'carrier',
    ) ||
    context.decisions.length > 0
  const reconciliationRequired = Boolean(
    carrierId &&
      (responsibilityRequired ||
        changes.length ||
        (context.shipment.carrierId &&
          carrierId !== context.shipment.carrierId &&
          financialEvidence)),
  )
  const unchanged =
    carrierId === context.shipment.carrierId &&
    !changes.length &&
    !responsibilityRequired
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        if (
          !carrierId ||
          !confirmed ||
          unchanged ||
          blockedByReconciliation ||
          (reconciliationRequired && !codConfirmed) ||
          (responsibilityRequired && !responsibilityConfirmed)
        )
          return
        const data = new FormData(event.currentTarget)
        const result = await command.run({
          carrierId,
          expectedFingerprint: context.fingerprint,
          evidenceReference: String(data.get('evidence')).trim(),
          reason: String(data.get('reason')).trim(),
          evidenceVerified: true,
          ...(reconciliationRequired
            ? {
                codReconciliation: {
                  evidenceReference: String(data.get('codEvidence')).trim(),
                  evidenceVerified: true,
                },
              }
            : {}),
          ...(responsibilityRequired && currentDecision
            ? {
                responsibilityCorrection: {
                  expectedDecisionId: currentDecision.id,
                  reference: String(data.get('decisionReference')).trim(),
                  evidenceVerified: true,
                },
              }
            : {}),
        })
        if (result) onClose()
      }}
    >
      <Notice>
        Vận đơn <strong>{context.shipment.trackingReference}</strong> hiện thuộc
        đơn vị vận chuyển{' '}
        <strong>{context.shipment.carrierName ?? 'Chưa xác định'}</strong>. Kiểm
        tra chứng từ bàn giao và các khoản COD dưới đây trước khi lưu đơn vị vận
        chuyển.
      </Notice>
      <CarrierPicker
        value={carrierId}
        onChange={(value) => {
          setCarrierId(value)
          setConfirmed(false)
          setCodConfirmed(false)
          setResponsibilityConfirmed(false)
        }}
        disabled={command.isPending}
      />
      {context.collections.length > 0 && (
        <>
          <h3>Chứng từ thu hộ liên quan</h3>
          <div className="c-table-wrap">
            <table className="c-table">
              <thead>
                <tr>
                  <th>Chứng từ</th>
                  <th>Đơn vị vận chuyển đã ghi nhận</th>
                  <th>Số tiền</th>
                  <th>Đối soát</th>
                </tr>
              </thead>
              <tbody>
                {context.collections.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.reference}
                      {row.orderId !== context.orderId && (
                        <small>Đơn liên quan: {row.orderId}</small>
                      )}
                    </td>
                    <td>{row.carrierName}</td>
                    <td>{formatMoney(row.amountVnd)}</td>
                    <td>
                      {row.reconciliationRequired ? (
                        <Badge tone="amber">Chưa đối soát</Badge>
                      ) : !row.active ? (
                        <small>Đã gộp chứng từ trùng</small>
                      ) : carrierId && row.carrierId !== carrierId ? (
                        <Badge tone="amber">
                          Cần hiệu chỉnh đơn vị vận chuyển
                        </Badge>
                      ) : (
                        <Badge tone="green">Đang có hiệu lực</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notice>
            Nếu một chứng từ đã ghi trùng ở nhiều đơn vị vận chuyển, hãy xác
            minh và gộp trước khi lưu đơn vị vận chuyển của vận đơn.
          </Notice>
          <div className="c-actions">
            {context.collections
              .filter(
                (row, index, rows) =>
                  rows.findIndex((item) => item.reference === row.reference) ===
                  index,
              )
              .map((row) => (
                <Action
                  key={row.id}
                  variant="secondary"
                  disabled={command.isPending}
                  onClick={() => onMerge(row.id, carrierId)}
                >
                  Gộp chứng từ trùng {row.reference}
                </Action>
              ))}
          </div>
        </>
      )}
      {context.receipts.length > 0 && (
        <>
          <h3>Tiền thực nhận liên quan</h3>
          {context.receipts.map((row) => (
            <p key={row.allocationId}>
              <strong>{row.reference}</strong> · {formatMoney(row.amountVnd)} ·{' '}
              {row.source === 'carrier'
                ? 'Đơn vị vận chuyển nộp'
                : row.source === 'customer'
                  ? 'Khách hàng trả trực tiếp'
                  : 'Chưa phân loại'}
              {row.duplicateOfId
                ? ' (chứng từ trùng, đã loại)'
                : row.reconciliationRequired
                  ? ' (cần đối soát)'
                  : ''}
            </p>
          ))}
        </>
      )}
      {context.decisions.length > 0 && (
        <>
          <h3>Quyết định công nợ với đơn vị vận chuyển</h3>
          <p>
            Công nợ còn lại:{' '}
            {formatMoney(context.carrierDecisionBalance.receivableVnd)} · Tổn
            thất còn lại:{' '}
            {formatMoney(context.carrierDecisionBalance.writtenOffVnd)} · Chưa
            có quyết định:{' '}
            {formatMoney(context.carrierDecisionBalance.unresolvedVnd)}
          </p>
          {context.decisions.map((row) => (
            <p key={row.id}>
              {row.reference} · {row.responsibleParty} · phê duyệt{' '}
              {formatMoney(row.amountVnd)} ·{' '}
              {row.disposition === 'debt' ? 'Ghi nợ' : 'Chấp nhận tổn thất'}{' '}
              <Badge tone={row.current ? 'blue' : 'amber'}>
                {row.current ? 'Quyết định hiện tại' : 'Lịch sử'}
              </Badge>
              {row.kind === 'responsibility_correction' && (
                <small>
                  Hiệu chỉnh trách nhiệm, thay quyết định{' '}
                  {context.decisions.find(
                    (item) => item.id === row.supersedesDecisionId,
                  )?.reference ?? row.supersedesDecisionId}
                </small>
              )}
            </p>
          ))}
        </>
      )}
      {responsibilityRequired && currentDecision && (
        <>
          <Notice tone="amber">
            Quyết định {currentDecision.reference} đang ghi bên chịu trách nhiệm
            là {currentDecision.responsibleParty}. Cần quyết định hiệu chỉnh
            sang đơn vị vận chuyển đã chọn. Quyết định cũ được giữ lại; số tiền
            phê duyệt và phần đã thu tiếp tục được tính theo quyết định gốc.
          </Notice>
          <Field label="Mã quyết định hiệu chỉnh trách nhiệm *">
            <input
              name="decisionReference"
              required
              minLength={3}
              maxLength={200}
              disabled={command.isPending}
              onChange={() => setResponsibilityConfirmed(false)}
            />
          </Field>
          <label className="c-check">
            <input
              type="checkbox"
              required
              checked={responsibilityConfirmed}
              onChange={(event) =>
                setResponsibilityConfirmed(event.target.checked)
              }
              disabled={command.isPending}
            />
            Tôi xác minh đơn vị vận chuyển đã chọn chịu trách nhiệm cho quyết
            định này theo hồ sơ đối soát, giữ nguyên số tiền phê duyệt và lịch
            sử đã thu.
          </label>
        </>
      )}
      {context.codReviewPending && (
        <Notice tone="amber">
          {blockedByReconciliation
            ? 'Cần hoàn tất đối soát chứng từ COD và tiền đơn vị vận chuyển nộp trước khi đổi đơn vị vận chuyển trên các chứng từ thu hộ.'
            : 'Các khoản COD chưa xác minh sẽ tiếp tục chờ đối soát sau khi lưu đơn vị vận chuyển đã nhận bàn giao.'}{' '}
          <Link to="/staff/payments" className="c-text-link">
            Đi đến đối soát thanh toán
          </Link>
        </Notice>
      )}
      <Field label="Mã chứng từ bàn giao / hiệu chỉnh *">
        <input
          name="evidence"
          required
          minLength={3}
          maxLength={200}
          disabled={command.isPending}
        />
      </Field>
      <Field label="Lý do xác minh / hiệu chỉnh *">
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          disabled={command.isPending}
        />
      </Field>
      <label className="c-check">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={command.isPending}
        />
        Tôi đã xác minh đơn vị vận chuyển được chọn từ chứng từ bàn giao thực
        tế.
      </label>
      {reconciliationRequired && (
        <>
          <Notice tone="amber">
            Cần đối soát các chứng từ thu hộ, tiền đơn vị vận chuyển đã nộp và
            công nợ với đơn vị vận chuyển đã chọn. Các chứng từ ghi nhầm đơn vị
            vận chuyển sẽ được hiệu chỉnh cùng vận đơn và lưu lại lịch sử; số
            tiền thực nhận và phân bổ được giữ nguyên.
          </Notice>
          <Field label="Mã hồ sơ đối soát COD *">
            <input
              name="codEvidence"
              required
              minLength={3}
              maxLength={200}
              disabled={command.isPending}
            />
          </Field>
          <label className="c-check">
            <input
              type="checkbox"
              required
              checked={codConfirmed}
              onChange={(event) => setCodConfirmed(event.target.checked)}
              disabled={command.isPending}
            />
            Tôi đã kiểm tra chứng từ thu hộ, các khoản đơn vị vận chuyển nộp và
            công nợ liên quan; xác nhận chúng thuộc đơn vị vận chuyển được chọn.
          </label>
        </>
      )}
      <ErrorNotice error={command.error} />
      <div className="c-actions">
        <Action
          type="submit"
          pending={command.isPending}
          disabled={
            !carrierId ||
            !confirmed ||
            unchanged ||
            blockedByReconciliation ||
            (reconciliationRequired && !codConfirmed) ||
            (responsibilityRequired && !responsibilityConfirmed)
          }
        >
          {reconciliationRequired
            ? 'Lưu đơn vị vận chuyển và kết quả đối soát'
            : 'Lưu đơn vị vận chuyển'}
        </Action>
        <Action
          variant="secondary"
          disabled={command.isPending}
          onClick={onClose}
        >
          Hủy
        </Action>
      </div>
    </form>
  )
}
