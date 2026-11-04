import { Landmark } from 'lucide-react'
import { useState } from 'react'
import { orderQueryPaths, paymentQueryPaths, useCommand, write } from './api'
import {
  Action,
  Badge,
  Drawer,
  ErrorNotice,
  Field,
  formatDate,
  formatMoney,
  Notice,
  Panel,
} from './components'
import { inputToIso, vietnamDateInput } from './date-time'
import type { BankTransferNotice, OrderDetail } from './types'

function TransferNoticeDetails({ notice }: { notice: BankTransferNotice }) {
  return (
    <div className="c-form-section" style={{ overflowWrap: 'anywhere' }}>
      <div className="c-badges">
        <Badge tone={notice.status === 'recorded' ? 'green' : 'amber'}>
          {notice.status === 'recorded'
            ? 'Đã đối chiếu thông báo'
            : notice.status === 'not_found'
              ? 'Chưa tìm thấy trên sao kê'
              : notice.review?.outcome === 'recorded'
                ? 'Cần kiểm tra lại khoản thu'
                : 'Chờ kế toán kiểm tra'}
        </Badge>
        <strong>Khách báo: {formatMoney(notice.amountVnd)}</strong>
      </div>
      <div>
        <small>Mã giao dịch / nội dung: {notice.reference}</small>
        <p>Khách chuyển lúc: {formatDate(notice.transferredAt)}</p>
        <small>
          Gửi thông báo: {formatDate(notice.reportedAt)}
          {notice.reportedByName ? ` · ${notice.reportedByName}` : ''}
        </small>
      </div>
      {notice.evidenceReference && (
        <small>Tham chiếu bằng chứng: {notice.evidenceReference}</small>
      )}
      {notice.note && <p>Ghi chú của khách: {notice.note}</p>}
      {notice.matchedReceipt && (
        <Notice tone="green">
          Đã đối chiếu khoản thực nhận phân bổ cho đơn:{' '}
          {formatMoney(notice.matchedReceipt.allocatedAmountVnd)}. Tiền vào lúc{' '}
          {formatDate(notice.matchedReceipt.receivedAt)}. Số tiền còn thiếu hoặc
          cần hoàn được thể hiện trong phần thanh toán.
        </Notice>
      )}
      {notice.status === 'pending' && notice.review?.outcome === 'recorded' && (
        <Notice tone="amber">
          Khoản thu đã đối chiếu trước đây không còn hợp lệ cho đơn này. Kế toán
          cần kiểm tra lại chứng từ và phân bổ tiền.
        </Notice>
      )}
      {notice.status === 'not_found' && (
        <Notice tone="amber">
          Chưa tìm thấy khoản chuyển trên sao kê đã kiểm tra
          {notice.review?.statementCheckedThrough
            ? ` đến ${formatDate(notice.review.statementCheckedThrough)}`
            : ''}
          . Hãy kiểm tra biên nhận hoặc liên hệ cửa hàng để bổ sung thông tin.
        </Notice>
      )}
      {notice.review && (
        <small>Đối chiếu lúc: {formatDate(notice.review.reviewedAt)}</small>
      )}
      {notice.review?.reason && <p>Kết luận: {notice.review.reason}</p>}
      {notice.review?.evidenceReference && (
        <small>Bằng chứng đối chiếu: {notice.review.evidenceReference}</small>
      )}
    </div>
  )
}

function TransferNoticeList({
  notices,
  onReview,
}: {
  notices: BankTransferNotice[]
  onReview?: (notice: BankTransferNotice) => void
}) {
  const recent = [...notices].reverse()
  const pending = recent.filter((notice) => notice.status === 'pending')
  const visible = pending.length ? pending : recent.slice(0, 1)
  const visibleIds = new Set(visible.map((notice) => notice.id))
  const history = recent.filter((notice) => !visibleIds.has(notice.id))
  const item = (notice: BankTransferNotice) => (
    <div key={notice.id}>
      <TransferNoticeDetails notice={notice} />
      {onReview && notice.status !== 'recorded' && (
        <div className="c-actions">
          <Action variant="secondary" onClick={() => onReview(notice)}>
            {notice.status === 'not_found'
              ? 'Kiểm tra lại'
              : 'Đối chiếu thông báo'}
          </Action>
        </div>
      )}
    </div>
  )
  return (
    <div className="c-stack">
      {visible.map(item)}
      {history.length > 0 && (
        <details>
          <summary>Lịch sử thông báo ({history.length})</summary>
          <div className="c-stack">{history.map(item)}</div>
        </details>
      )}
    </div>
  )
}

export function CustomerBankTransfers({
  order,
  paymentAvailable = true,
}: {
  order: OrderDetail
  paymentAvailable?: boolean
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const payment = useCommand(
    () => write(`orders/${order.id}/bank-transfer-payment`),
    orderQueryPaths,
  )
  if (order.paymentMethod !== 'bank_transfer') return null
  const canReport = order.permittedActions.customer.includes(
    'report_bank_transfer',
  )
  if (order.bankTransferDemoEnabled) {
    const paid =
      order.payment.balancesVerified &&
      order.payment.bankPaymentApproved &&
      order.payment.amountDueVnd === 0 &&
      order.status !== 'cancelled'
    const canPay =
      paymentAvailable &&
      order.permittedActions.customer.includes('pay_bank_transfer')
    return (
      <Panel title="Thanh toán chuyển khoản" icon={<Landmark size={20} />}>
        <div className="c-stack">
          {paid ? (
            <Notice tone="green">
              <strong>Chuyển khoản thành công</strong>
              Cửa hàng đã ghi nhận thanh toán cho đơn hàng #{order.code}.
            </Notice>
          ) : order.bankTransferNoticePending ? (
            <Notice>
              Cửa hàng đang kiểm tra thông báo chuyển khoản của bạn. Vui lòng
              chờ kết quả trước khi thanh toán thêm.
            </Notice>
          ) : canPay ? (
            <>
              <p>Bấm chuyển khoản để thanh toán đơn hàng.</p>
              <Action
                pending={payment.isPending}
                onClick={() => payment.run(undefined)}
              >
                Chuyển khoản
              </Action>
            </>
          ) : (
            <Notice tone="amber">
              Đơn hàng hiện chưa thể thanh toán. Vui lòng kiểm tra trạng thái
              trong chi tiết đơn hàng.
            </Notice>
          )}
          {!paid && <ErrorNotice error={payment.error} />}
        </div>
      </Panel>
    )
  }
  return (
    <Panel title="Thông báo chuyển khoản" icon={<Landmark size={20} />}>
      <div className="c-stack">
        {order.bankTransferNotices.length > 0 ? (
          <TransferNoticeList notices={order.bankTransferNotices} />
        ) : (
          <p>
            Sau khi chuyển tiền, bạn có thể gửi thông tin để cửa hàng kiểm tra.
          </p>
        )}
        {order.bankTransferNoticePending && (
          <Notice>
            Cửa hàng đã nhận thông báo và đang kiểm tra khoản thực nhận. Vui
            lòng chờ kết quả trước khi chuyển thêm tiền.
          </Notice>
        )}
        {canReport && (
          <Action variant="secondary" onClick={() => setReportOpen(true)}>
            Tôi đã chuyển khoản
          </Action>
        )}
      </div>
      {reportOpen && canReport && (
        <TransferReportDrawer
          order={order}
          onClose={() => setReportOpen(false)}
        />
      )}
    </Panel>
  )
}

function TransferReportDrawer({
  order,
  onClose,
}: {
  order: OrderDetail
  onClose: () => void
}) {
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`orders/${order.id}/bank-transfer-notices`, input),
    orderQueryPaths,
  )
  return (
    <Drawer
      title={`Báo chuyển khoản #${order.code}`}
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const evidenceReference = String(data.get('evidenceReference')).trim()
          const note = String(data.get('note')).trim()
          const result = await command.run({
            amountVnd: Number(data.get('amountVnd')),
            currency: 'VND',
            reference: String(data.get('reference')).trim(),
            transferredAt: inputToIso(String(data.get('time'))),
            ...(evidenceReference ? { evidenceReference } : {}),
            ...(note ? { note } : {}),
          })
          if (result) onClose()
        }}
      >
        <Notice>
          Gửi thông tin khoản bạn đã chuyển. Kế toán sẽ kiểm tra số tiền thực
          nhận trước khi xác nhận thanh toán.
        </Notice>
        {(order.status === 'cancelled' || order.reservationExpired) && (
          <Notice tone="amber">
            Chỉ báo khoản tiền đã chuyển trước đây. Vui lòng không chuyển thêm
            tiền cho đơn đã hủy hoặc hết hạn thanh toán.
          </Notice>
        )}
        <Field
          label="Số tiền đã chuyển (VND) *"
          hint="Nhập toàn bộ số tiền của một giao dịch, kể cả phần chuyển dư."
        >
          <input
            name="amountVnd"
            type="number"
            min={1}
            max={9999999999}
            step={1}
            required
            disabled={command.isPending}
          />
        </Field>
        <Field label="Mã giao dịch hoặc nội dung đã chuyển *">
          <input
            name="reference"
            minLength={3}
            maxLength={200}
            required
            disabled={command.isPending}
          />
        </Field>
        <Field label="Thời điểm đã chuyển (giờ Việt Nam) *">
          <input
            name="time"
            type="datetime-local"
            step={0.001}
            defaultValue={vietnamDateInput()}
            max={vietnamDateInput()}
            required
            disabled={command.isPending}
          />
        </Field>
        <Field
          label="Mã biên nhận / tham chiếu bằng chứng"
          hint="Có thể điền mã biên nhận hoặc đường dẫn chứng từ đã gửi cho cửa hàng."
        >
          <input
            name="evidenceReference"
            minLength={3}
            maxLength={200}
            disabled={command.isPending}
          />
        </Field>
        <Field label="Ghi chú">
          <textarea
            name="note"
            minLength={3}
            maxLength={1000}
            disabled={command.isPending}
          />
        </Field>
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            onClick={onClose}
            disabled={command.isPending}
          >
            Quay lại
          </Action>
          <Action type="submit" pending={command.isPending}>
            Gửi thông báo đã chuyển khoản
          </Action>
        </div>
      </form>
    </Drawer>
  )
}

export function BankTransferNoticeWork({
  order,
  onReviewStart,
}: {
  order: OrderDetail
  onReviewStart: () => void
}) {
  const [reviewId, setReviewId] = useState<string | null>(null)
  if (!order.bankTransferNotices.length) return null
  const review = order.bankTransferNotices.find(
    (notice) => notice.id === reviewId,
  )
  const canReview = order.permittedActions.staff.includes(
    'review_bank_transfer_notice',
  )
  return (
    <div className="c-form-section">
      <h3>Thông báo khách chuyển khoản</h3>
      <TransferNoticeList
        notices={order.bankTransferNotices}
        {...(canReview
          ? { onReview: (notice: BankTransferNotice) => setReviewId(notice.id) }
          : {})}
      />
      {review && canReview && review.status !== 'recorded' && (
        <TransferReviewDrawer
          key={review.id}
          order={order}
          notice={review}
          onClose={() => setReviewId(null)}
          onReviewStart={onReviewStart}
        />
      )}
      <div className="c-divider" />
    </div>
  )
}

function TransferReviewDrawer({
  order,
  notice,
  onClose,
  onReviewStart,
}: {
  order: OrderDetail
  notice: BankTransferNotice
  onClose: () => void
  onReviewStart: () => void
}) {
  const receipts = order.payment.receipts.filter(
    (receipt) => receipt.bankTransferNoticeMatchable,
  )
  const [outcome, setOutcome] = useState(
    receipts.length ? 'recorded' : 'not_found',
  )
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(
        `staff/orders/${order.id}/bank-transfer-notices/${notice.id}/review`,
        input,
      ),
    paymentQueryPaths,
  )
  return (
    <Drawer
      title={`Đối chiếu thông báo #${order.code}`}
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          onReviewStart()
          const result = await command.run({
            outcome,
            ...(outcome === 'recorded'
              ? { paymentId: String(data.get('paymentId')) }
              : {
                  statementCheckedThrough: inputToIso(String(data.get('time'))),
                }),
            reason: String(data.get('reason')).trim(),
            evidenceReference: String(data.get('evidenceReference')).trim(),
            evidenceVerified: true,
          })
          if (result) onClose()
        }}
      >
        <Notice>
          Khách báo {formatMoney(notice.amountVnd)}, lúc{' '}
          {formatDate(notice.transferredAt)}. Mã / nội dung: {notice.reference}.
          Kết quả đối chiếu không tạo thêm khoản thu.
        </Notice>
        <Field label="Kết quả kiểm tra *">
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            disabled={command.isPending}
          >
            <option value="recorded">
              Đối chiếu với khoản thực nhận đã ghi
            </option>
            <option value="not_found">Chưa tìm thấy trên sao kê</option>
          </select>
        </Field>
        {outcome === 'recorded' ? (
          receipts.length ? (
            <Field label="Khoản thực nhận của đơn *">
              <select
                name="paymentId"
                defaultValue=""
                required
                disabled={command.isPending}
              >
                <option value="" disabled>
                  Chọn khoản thu đã kiểm tra
                </option>
                {receipts.map((receipt) => (
                  <option key={receipt.id} value={receipt.id}>
                    {receipt.reference} · {formatMoney(receipt.amountVnd)} ·{' '}
                    {formatDate(receipt.receivedAt)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Notice tone="amber">
              Chưa có khoản thu hợp lệ để chọn. Hãy ghi nhận tiền thực nhận
              trong biểu mẫu đối soát, rồi đối chiếu thông báo này.
            </Notice>
          )
        ) : (
          <Field label="Đã kiểm tra sao kê đến (giờ Việt Nam) *">
            <input
              name="time"
              type="datetime-local"
              step={0.001}
              required
              defaultValue={vietnamDateInput()}
              min={vietnamDateInput(
                notice.review?.statementCheckedThrough ?? notice.transferredAt,
              )}
              max={vietnamDateInput()}
              disabled={command.isPending}
            />
          </Field>
        )}
        <Field label="Mã sao kê / bằng chứng đã kiểm tra *">
          <input
            name="evidenceReference"
            minLength={3}
            maxLength={200}
            required
            disabled={command.isPending}
          />
        </Field>
        <Field label="Lý do kết luận *">
          <textarea
            name="reason"
            minLength={3}
            maxLength={1000}
            required
            disabled={command.isPending}
          />
        </Field>
        <label className="c-check">
          <input type="checkbox" required disabled={command.isPending} />
          Đã kiểm tra sao kê và bằng chứng của thông báo này
        </label>
        <ErrorNotice error={command.error} />
        <div className="c-actions">
          <Action
            variant="secondary"
            onClick={onClose}
            disabled={command.isPending}
          >
            Quay lại
          </Action>
          <Action
            type="submit"
            pending={command.isPending}
            disabled={outcome === 'recorded' && !receipts.length}
          >
            Lưu kết quả đối chiếu
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
