import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { paymentQueryPaths, useCommand, useCommerceQuery, write } from './api'
import {
  Action,
  Badge,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  formatMoney,
  Loading,
  Notice,
  Pagination,
  Panel,
  QueryError,
} from './components'
import { inputToIso, vietnamDateInput } from './date-time'
import { AccountSelect } from './receiving-account-select'
import type { Page, ReceiptWork } from './types'

interface Allocation {
  orderId: string
  orderCode: string
  amountVnd: number
  collectionId?: string | null
  purpose?: 'payment' | 'refund_recovery'
  reviewId?: string | null
}

interface AllocationContext {
  receiptRevision: number
  receiptAmountVnd: number
  source: 'customer' | 'carrier' | 'legacy'
  unallocatedVnd: number
  receiptReconciliationRequired: boolean
  allocations: Allocation[]
}

export function UnallocatedReceipts() {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useCommerceQuery<Page<ReceiptWork>>(
    'admin/payment-receipts/unallocated',
    { limit: 10, offset },
  )
  return (
    <Panel title="Khoản tiền chưa phân bổ">
      <Notice>
        Chọn khoản tiền thực nhận để phân bổ phần còn dư cho một đơn hàng.
      </Notice>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          {query.data.items.length ? (
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Giao dịch</th>
                    <th>Thời điểm tiền vào</th>
                    <th className="c-number">Thực nhận</th>
                    <th className="c-number">Chưa phân bổ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.receipt.id}>
                      <td>
                        {row.receipt.reference}
                        {row.receipt.receiptReconciliationRequired && (
                          <Badge tone="amber">Cần xác minh bằng chứng</Badge>
                        )}
                      </td>
                      <td>{formatDate(row.receipt.receivedAt)}</td>
                      <td className="c-number">
                        {formatMoney(row.receipt.amountVnd)}
                      </td>
                      <td className="c-number">
                        {formatMoney(row.unallocatedVnd)}
                      </td>
                      <td>
                        <Action
                          variant="secondary"
                          onClick={() => setSelected(row.receipt.id)}
                        >
                          Phân bổ
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Không có khoản tiền chưa phân bổ" />
          )}
          <Pagination
            offset={offset}
            limit={10}
            count={query.data.items.length}
            onChange={setOffset}
          />
        </>
      )}
      {selected && (
        <AllocationDrawer id={selected} onClose={() => setSelected(null)} />
      )}
    </Panel>
  )
}

function AllocationDrawer({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const query = useCommerceQuery<AllocationContext>(
    `admin/payment-receipts/${id}/allocations`,
  )
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`admin/payment-receipts/${id}/allocations`, input),
    paymentQueryPaths,
  )
  const [validation, setValidation] = useState('')
  const context = query.data
  return (
    <Drawer
      title="Phân bổ khoản tiền chưa sử dụng"
      onClose={onClose}
      busy={command.isPending}
    >
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        context && (
          <form
            className="c-form-section"
            onSubmit={async (event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const orderId = String(data.get('orderId')).trim().toLowerCase()
              const collectionId = String(data.get('collectionId') ?? '')
                .trim()
                .toLowerCase()
              if (
                !z.uuid().safeParse(orderId).success ||
                (context.source === 'carrier' &&
                  !z.uuid().safeParse(collectionId).success)
              ) {
                setValidation(
                  'Nhập mã định danh đầy đủ, hợp lệ của đơn hàng và khoản thu hộ.',
                )
                return
              }
              setValidation('')
              const amountVnd = Number(data.get('amount'))
              const plan = context.allocations.map((line) => ({
                orderId: line.orderId,
                amountVnd: line.amountVnd,
                ...(line.collectionId
                  ? { collectionId: line.collectionId }
                  : {}),
                ...(line.purpose ? { purpose: line.purpose } : {}),
                ...(line.reviewId ? { reviewId: line.reviewId } : {}),
              }))
              const existing = plan.find(
                (line) =>
                  line.orderId === orderId &&
                  (line.collectionId ?? '') === collectionId &&
                  (line.purpose ?? 'payment') === 'payment',
              )
              if (existing) existing.amountVnd += amountVnd
              else
                plan.push({
                  orderId,
                  amountVnd,
                  ...(collectionId ? { collectionId } : {}),
                })
              if (
                await command.run({
                  expectedRevision: context.receiptRevision,
                  reason: String(data.get('reason')).trim(),
                  evidenceReference: String(data.get('evidence')).trim(),
                  evidenceVerified: true,
                  allocations: plan,
                })
              )
                onClose()
            }}
          >
            <dl className="c-financial-dl">
              <div>
                <dt>Tổng tiền thực nhận</dt>
                <dd>{formatMoney(context.receiptAmountVnd)}</dd>
              </div>
              <div>
                <dt>Còn có thể phân bổ</dt>
                <dd>{formatMoney(context.unallocatedVnd)}</dd>
              </div>
            </dl>
            {context.allocations.length > 0 && (
              <div>
                <h3>Phân bổ hiện tại</h3>
                {context.allocations.map((line) => (
                  <p
                    key={`${line.orderId}-${line.collectionId}-${line.purpose}`}
                  >
                    #{line.orderCode} · {formatMoney(line.amountVnd)}
                  </p>
                ))}
              </div>
            )}
            {context.receiptReconciliationRequired ||
            context.source === 'legacy' ? (
              <Notice tone="amber">
                Khoản tiền cần được xác minh danh tính hoặc phân loại trước khi
                thay đổi phân bổ.
              </Notice>
            ) : (
              <>
                <Field
                  label="Mã định danh đầy đủ của đơn hàng *"
                  hint="Sao chép mã đơn đầy đủ từ trang chi tiết đơn hàng."
                >
                  <input
                    name="orderId"
                    required
                    maxLength={36}
                    disabled={command.isPending}
                  />
                </Field>
                {context.source === 'carrier' && (
                  <Field label="Mã định danh khoản thu hộ *">
                    <input
                      name="collectionId"
                      required
                      maxLength={36}
                      disabled={command.isPending}
                    />
                  </Field>
                )}
                <Field label="Số tiền bổ sung cho đơn (VND) *">
                  <input
                    name="amount"
                    type="number"
                    step={1}
                    min={1}
                    max={context.unallocatedVnd}
                    required
                    disabled={command.isPending}
                  />
                </Field>
                <Field label="Mã bằng chứng *">
                  <input
                    name="evidence"
                    minLength={3}
                    maxLength={200}
                    required
                    disabled={command.isPending}
                  />
                </Field>
                <Field label="Lý do phân bổ *">
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                    disabled={command.isPending}
                  />
                </Field>
                <label className="c-check">
                  <input
                    type="checkbox"
                    required
                    disabled={command.isPending}
                  />
                  Đã kiểm tra đầy đủ bằng chứng và các phân bổ hiện tại
                </label>
                {validation && (
                  <p className="c-error-text" role="alert">
                    {validation}
                  </p>
                )}
                <ErrorNotice error={command.error} />
                <Action
                  type="submit"
                  pending={command.isPending}
                  disabled={context.unallocatedVnd <= 0}
                >
                  Xác nhận phân bổ
                </Action>
              </>
            )}
          </form>
        )
      )}
    </Drawer>
  )
}

interface BalanceCase {
  orderCode: string
  review: { id: string; orderId: string; revision: number; status: string }
  balancesVerified: boolean
  discrepancyVnd: number | null
  purchaseShortfallVnd: number | null
  refundDiscrepancyVnd: number | null
  paidVnd: number
  refundedVnd: number
  permittedActions?: string[]
}

export function BalanceReviews() {
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState('needs_review')
  const [selected, setSelected] = useState<string | null>(null)
  const query = useCommerceQuery<Page<BalanceCase>>(
    'admin/payment-balance-reviews',
    { limit: 10, offset, status },
  )
  return (
    <Panel title="Chênh lệch thanh toán & hoàn tiền">
      <div className="c-filters">
        <select
          aria-label="Trạng thái xử lý chênh lệch"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setOffset(0)
          }}
        >
          <option value="needs_review">Cần xem xét</option>
          <option value="debt">Đã ghi nhận công nợ</option>
          <option value="written_off">Đã xử lý tổn thất</option>
          <option value="resolved">Đã giải quyết</option>
        </select>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          {query.data.items.length ? (
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Đơn hàng</th>
                    <th className="c-number">Chênh lệch</th>
                    <th className="c-number">Thiếu thanh toán</th>
                    <th className="c-number">Chênh lệch hoàn</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((row) => (
                    <tr key={row.review.id}>
                      <td>
                        <Link
                          className="c-text-link"
                          to="/staff/orders/$orderId"
                          params={{ orderId: row.review.orderId }}
                        >
                          #{row.orderCode}
                        </Link>
                      </td>
                      <td className="c-number">
                        {formatMoney(row.discrepancyVnd)}
                      </td>
                      <td className="c-number">
                        {formatMoney(row.purchaseShortfallVnd)}
                      </td>
                      <td className="c-number">
                        {formatMoney(row.refundDiscrepancyVnd)}
                      </td>
                      <td>
                        <Action
                          variant="secondary"
                          onClick={() => setSelected(row.review.id)}
                        >
                          Xử lý
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Không có chênh lệch cần xử lý" />
          )}
          <Pagination
            offset={offset}
            limit={10}
            count={query.data.items.length}
            onChange={setOffset}
          />
        </>
      )}
      {selected && (
        <BalanceDrawer id={selected} onClose={() => setSelected(null)} />
      )}
    </Panel>
  )
}

function BalanceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useCommerceQuery<BalanceCase>(
    `admin/payment-balance-reviews/${id}`,
  )
  const [operation, setOperation] = useState('debt')
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(
        `admin/payment-balance-reviews/${id}/${operation === 'recovery' ? 'recoveries' : 'decisions'}`,
        input,
      ),
    paymentQueryPaths,
  )
  const detail = query.data
  return (
    <Drawer title="Xử lý chênh lệch" onClose={onClose} busy={command.isPending}>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        detail && (
          <form
            className="c-form-section"
            onSubmit={async (event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const common = {
                expectedRevision: detail.review.revision,
                amountVnd: Number(data.get('amount')),
                reason: String(data.get('reason')).trim(),
                evidenceReference: String(data.get('evidence')).trim(),
                evidenceVerified: true,
              }
              const body =
                operation === 'recovery'
                  ? {
                      ...common,
                      receivingAccountId: String(data.get('account')),
                      reference: String(data.get('reference')).trim(),
                      receivedAt: inputToIso(String(data.get('time'))),
                      currency: 'VND',
                      receiptVerified: true,
                    }
                  : {
                      ...common,
                      disposition: operation,
                      responsibleParty: String(data.get('party')).trim(),
                      allowFulfillment: data.get('fulfillment') === 'on',
                    }
              if (await command.run(body)) onClose()
            }}
          >
            <Notice tone="amber">
              <strong>Đơn hàng #{detail.orderCode}</strong>Chênh lệch hiện tại:{' '}
              {formatMoney(detail.discrepancyVnd)}
            </Notice>
            {detail.permittedActions?.length ? (
              <>
                <Field label="Hướng xử lý">
                  <select
                    value={operation}
                    onChange={(event) => setOperation(event.target.value)}
                    disabled={command.isPending}
                  >
                    {detail.permittedActions.includes('record_debt') && (
                      <option value="debt">Ghi nhận công nợ</option>
                    )}
                    {detail.permittedActions.includes('approve_loss') && (
                      <option value="written_off">Chấp nhận tổn thất</option>
                    )}
                    {detail.permittedActions.includes(
                      'record_recovery_receipt',
                    ) && (
                      <option value="recovery">
                        Ghi nhận tiền thu hồi thực tế
                      </option>
                    )}
                  </select>
                </Field>
                <Field label="Số tiền xử lý (VND) *">
                  <input
                    name="amount"
                    type="number"
                    step={1}
                    min={1}
                    max={Math.min(
                      detail.discrepancyVnd ?? 0,
                      operation === 'recovery'
                        ? 9999999999
                        : Number.MAX_SAFE_INTEGER,
                    )}
                    required
                    disabled={command.isPending}
                  />
                </Field>
                {operation === 'recovery' ? (
                  <>
                    <AccountSelect disabled={command.isPending} />
                    <Field label="Mã giao dịch thực nhận *">
                      <input
                        name="reference"
                        required
                        minLength={3}
                        maxLength={200}
                        disabled={command.isPending}
                      />
                    </Field>
                    <Field label="Thời điểm tiền vào (giờ Việt Nam) *">
                      <input
                        name="time"
                        type="datetime-local"
                        step={0.001}
                        required
                        max={vietnamDateInput()}
                        disabled={command.isPending}
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Bên chịu trách nhiệm *">
                    <input
                      name="party"
                      required
                      minLength={3}
                      maxLength={200}
                      disabled={command.isPending}
                    />
                  </Field>
                )}
                <Field label="Mã bằng chứng *">
                  <input
                    name="evidence"
                    required
                    minLength={3}
                    maxLength={200}
                    disabled={command.isPending}
                  />
                </Field>
                <Field label="Lý do quyết định *">
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={1000}
                    disabled={command.isPending}
                  />
                </Field>
                {operation === 'written_off' &&
                  detail.permittedActions.includes(
                    'approve_loss_and_continue_fulfillment',
                  ) && (
                    <label className="c-check">
                      <input
                        name="fulfillment"
                        type="checkbox"
                        disabled={command.isPending}
                      />
                      Cho phép tiếp tục giao hàng theo ngoại lệ tổn thất hoàn
                      tiền
                    </label>
                  )}
                <label className="c-check">
                  <input
                    type="checkbox"
                    required
                    disabled={command.isPending}
                  />
                  Đã xác minh số liệu và bằng chứng cho quyết định này
                </label>
                <ErrorNotice error={command.error} />
                <Action type="submit" pending={command.isPending}>
                  Xác nhận xử lý chênh lệch
                </Action>
              </>
            ) : (
              <Notice>
                Hiện không có thao tác xử lý khả dụng cho trường hợp này.
              </Notice>
            )}
          </form>
        )
      )}
    </Drawer>
  )
}
