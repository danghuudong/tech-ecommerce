import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { paymentQueryPaths, useCommand, useCommerceQuery, write } from './api'
import { CarrierPicker } from './carrier-picker'
import {
  Action,
  Badge,
  Drawer,
  ErrorNotice,
  Field,
  formatDate,
  formatMoney,
  Loading,
  Notice,
  QueryError,
} from './components'

const dateTimeInput = (value: string | Date = new Date()) =>
  new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, -1)

interface Collection {
  id: string
  orderId: string
  carrierId: string
  carrier: string
  reference: string
  revision: number
  amountVnd: number
  receivedAt: string
  duplicateOfId: string | null
  reconciliationRequired: boolean
}

interface MergeContext {
  primary: Collection
  collections: Collection[]
  orders: { id: string; code: string }[]
  receipts: {
    id: string
    orderId: string
    source: string
    recordedPaymentMethod: string
    allocationId: string
    codCollectionId: string | null
    reference: string
    amountVnd: number
    receiptAmountVnd: number
    revision: number
    receivedAt: string
    duplicateOfId: string | null
    receiptReconciliationRequired: boolean
  }[]
}

interface MergeResult {
  carrierId: string
  balances: {
    orderId: string
    orderCode: string
    balancesVerified: boolean
    amountDueVnd: number | null
    refundDueVnd: number | null
    carrierOverremittedVnd: number | null
  }[]
  unallocatedReceipts: {
    paymentId: string
    reference: string
    unallocatedVnd: number
  }[]
}

type MergeRequest = { id: string; body: Record<string, unknown> }
type MergeCommand = {
  isPending: boolean
  error: unknown
  run: (input: MergeRequest) => Promise<MergeResult | undefined>
}

export function CodCarrierMergeDrawer({
  collectionId,
  carrierId,
  onClose,
}: {
  collectionId: string
  carrierId: string
  onClose: (carrierId?: string) => void
}) {
  const query = useCommerceQuery<MergeContext>(
    `admin/cod-collections/${collectionId}/cross-carrier-context`,
  )
  const [result, setResult] = useState<MergeResult | null>(null)
  const command = useCommand(
    (input: MergeRequest) =>
      write<MergeResult>(
        `admin/cod-collections/${input.id}/adjustment`,
        input.body,
      ),
    paymentQueryPaths,
  )
  const close = () => onClose(result?.carrierId)
  return createPortal(
    <Drawer
      title="Xác minh và gộp chứng từ COD"
      onClose={close}
      busy={command.isPending}
      wide
    >
      {result ? (
        <MergeOutcome result={result} onClose={close} />
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <QueryError error={query.error} retry={() => query.refetch()} />
      ) : (
        <MergeEditor
          key={JSON.stringify([
            query.data.collections.map((row) => [row.id, row.revision]),
            query.data.receipts.map((row) => [row.allocationId, row.revision]),
          ])}
          context={query.data}
          initialCarrierId={carrierId}
          onClose={close}
          command={command}
          onSaved={setResult}
        />
      )}
    </Drawer>,
    document.body,
  )
}

function MergeEditor({
  context,
  initialCarrierId,
  onClose,
  command,
  onSaved,
}: {
  context: MergeContext
  initialCarrierId: string
  onClose: () => void
  command: MergeCommand
  onSaved: (result: MergeResult) => void
}) {
  const initialPrimary =
    context.collections.find(
      (row) => row.id === context.primary.duplicateOfId,
    ) ?? context.primary
  const [carrierId, setCarrierId] = useState(
    initialCarrierId || context.primary.carrierId,
  )
  const [selectedCarriers, setSelectedCarriers] = useState(
    [context.primary.carrierId, initialCarrierId].filter(Boolean),
  )
  const [primaryId, setPrimaryId] = useState(initialPrimary.id)
  const [amount, setAmount] = useState(String(initialPrimary.amountVnd))
  const [receivedAt, setReceivedAt] = useState(
    dateTimeInput(initialPrimary.receivedAt),
  )
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [legacyIds, setLegacyIds] = useState<string[]>([])
  const group = context.collections.filter((row) =>
    selectedCarriers.includes(row.carrierId),
  )
  const crossCarrier = new Set(group.map((row) => row.carrierId)).size >= 2
  const primary = group.find((row) => row.id === primaryId)
  const legacyCandidates = context.receipts.filter(
    (row) =>
      row.source === 'legacy' &&
      row.recordedPaymentMethod === 'cod' &&
      !row.duplicateOfId &&
      group.some((item) => item.orderId === row.orderId),
  )
  const receipts = context.receipts.filter(
    (row) =>
      !row.duplicateOfId &&
      (group.some((item) => item.id === row.codCollectionId) ||
        (legacyCandidates.some((item) => item.id === row.id) &&
          legacyIds.includes(row.id))),
  )
  const allocated = (id: string, current: number) =>
    Number(allocations[id] ?? current)
  const beforeVnd = receipts.reduce((sum, row) => sum + row.amountVnd, 0)
  const afterVnd = receipts.reduce(
    (sum, row) => sum + allocated(row.allocationId, row.amountVnd),
    0,
  )
  const valid = Boolean(
    primary &&
      carrierId &&
      !context.collections.some(
        (row) =>
          row.carrierId === carrierId &&
          !selectedCarriers.includes(row.carrierId),
      ) &&
      group.length > 0 &&
      (crossCarrier || group.every((row) => row.carrierId === carrierId)) &&
      Number.isSafeInteger(Number(amount)) &&
      Number(amount) > 0 &&
      afterVnd <= Number(amount) &&
      receipts.every(
        (row) =>
          Number.isSafeInteger(allocated(row.allocationId, row.amountVnd)) &&
          allocated(row.allocationId, row.amountVnd) >= 0 &&
          allocated(row.allocationId, row.amountVnd) <= row.amountVnd,
      ),
  )
  const code = (id: string) =>
    context.orders.find((row) => row.id === id)?.code ?? id
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!valid || !confirmed || !primary) return
        const data = new FormData(event.currentTarget)
        const saved = await command.run({
          id: primary.id,
          body: {
            expectedRevision: primary.revision,
            ...(crossCarrier
              ? {
                  crossCarrierMerge: {
                    carrierId,
                    evidenceVerified: true,
                    expectedCollections: group.map((row) => ({
                      id: row.id,
                      revision: row.revision,
                    })),
                  },
                }
              : {}),
            verifiedAmountVnd: Number(amount),
            verifiedReceivedAt: new Date(
              `${receivedAt.length === 16 ? `${receivedAt}:00` : receivedAt}+07:00`,
            ).toISOString(),
            evidenceReference: String(data.get('evidence')).trim(),
            reason: String(data.get('reason')).trim(),
            evidenceVerified: true,
            legacyRemittanceIds: [
              ...new Set(
                receipts
                  .filter((row) => legacyIds.includes(row.id))
                  .map((row) => row.id),
              ),
            ],
            expectedRemittances: receipts.map((row) => ({
              paymentId: row.id,
              allocationId: row.allocationId,
              revision: row.revision,
            })),
            remittanceAllocations: receipts.map((row) => ({
              allocationId: row.allocationId,
              collectionId: primary.id,
              amountVnd: allocated(row.allocationId, row.amountVnd),
            })),
          },
        })
        if (saved) onSaved(saved)
      }}
    >
      <Notice>
        Đối chiếu chứng từ <strong>{context.primary.reference}</strong>. Chọn
        các đơn vị vận chuyển đã ghi trùng cùng một lần thu thực tế, đơn giữ
        khoản thu và đơn vị vận chuyển đúng. Mã giống nhau giữa các đơn vị vận
        chuyển cần được xác minh bằng chứng từ trước khi gộp.
      </Notice>
      <CarrierPicker
        value={carrierId}
        onChange={(id) => {
          setCarrierId(id)
          setSelectedCarriers((previous) => [...new Set([...previous, id])])
          setConfirmed(false)
        }}
        disabled={command.isPending}
      />
      <h3>Các bản ghi cần xác minh</h3>
      {[...new Set(context.collections.map((row) => row.carrierId))].map(
        (id) => (
          <fieldset key={id} disabled={command.isPending}>
            <label className="c-check">
              <input
                type="checkbox"
                checked={selectedCarriers.includes(id)}
                onChange={(event) => {
                  if (!event.target.checked && primary?.carrierId === id)
                    setPrimaryId('')
                  setSelectedCarriers((previous) =>
                    event.target.checked
                      ? [...previous, id]
                      : previous.filter((value) => value !== id),
                  )
                  setConfirmed(false)
                }}
              />
              Gộp nhóm{' '}
              {context.collections.find((row) => row.carrierId === id)?.carrier}
            </label>
            {context.collections
              .filter((row) => row.carrierId === id)
              .map((row) => (
                <p key={row.id}>
                  #{code(row.orderId)} · {formatMoney(row.amountVnd)} ·{' '}
                  {formatDate(row.receivedAt)} ·{' '}
                  {row.duplicateOfId
                    ? 'Bản ghi đã gộp'
                    : row.reconciliationRequired
                      ? 'Chờ đối soát'
                      : 'Đang có hiệu lực'}
                </p>
              ))}
          </fieldset>
        ),
      )}
      <Field label="Đơn giữ khoản thu sau khi gộp *">
        <select
          value={primaryId}
          required
          disabled={command.isPending}
          onChange={(event) => {
            const row = group.find((item) => item.id === event.target.value)
            setPrimaryId(event.target.value)
            if (row) {
              setAmount(String(row.amountVnd))
              setReceivedAt(dateTimeInput(row.receivedAt))
            }
            setConfirmed(false)
          }}
        >
          <option value="">Chọn bản ghi giữ lại</option>
          {group.map((row) => (
            <option key={row.id} value={row.id}>
              #{code(row.orderId)} · {row.carrier} ·{' '}
              {formatMoney(row.amountVnd)}
              {row.duplicateOfId ? ' · đã gộp' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tiền khách thực trả theo chứng từ (VND) *">
        <input
          type="number"
          min={1}
          max={9999999999}
          step={1}
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            setConfirmed(false)
          }}
          disabled={command.isPending}
        />
      </Field>
      <Field label="Thời điểm khách trả tiền (giờ Việt Nam) *">
        <input
          type="datetime-local"
          step="0.001"
          required
          max={dateTimeInput()}
          value={receivedAt}
          onChange={(event) => {
            setReceivedAt(event.target.value)
            setConfirmed(false)
          }}
          disabled={command.isPending}
        />
      </Field>
      <h3>Đối soát tiền đã phân bổ</h3>
      {legacyCandidates.length > 0 && (
        <fieldset disabled={command.isPending}>
          <legend>Tiền COD cũ chưa phân loại</legend>
          <p>
            Chọn khoản đã xác minh là tiền đơn vị vận chuyển nộp để phân loại và
            đối soát cùng nhóm chứng từ.
          </p>
          {legacyCandidates.map((row) => (
            <label key={row.allocationId} className="c-check">
              <input
                type="checkbox"
                checked={legacyIds.includes(row.id)}
                onChange={(event) => {
                  setLegacyIds((previous) =>
                    event.target.checked
                      ? [...new Set([...previous, row.id])]
                      : previous.filter((id) => id !== row.id),
                  )
                  setConfirmed(false)
                }}
              />
              {row.reference} · #{code(row.orderId)} ·{' '}
              {formatMoney(row.amountVnd)}
            </label>
          ))}
        </fieldset>
      )}
      <Notice>
        Nhập phần tiền của từng khoản thực nhận được gắn với khoản thu sau gộp.
        Phần tách ra sẽ vào “Khoản tiền chưa phân bổ” để tiếp tục xử lý. Tổng
        phân bổ sau gộp phải nằm trong tiền khách thực trả đã xác minh.
      </Notice>
      {receipts.map((row) => (
        <div key={row.allocationId}>
          <p>
            {row.reference} · thực nhận {formatMoney(row.receiptAmountVnd)} ·{' '}
            {formatDate(row.receivedAt)}
            {row.receiptReconciliationRequired && (
              <Badge tone="amber">Tiền thực nhận chờ xác minh</Badge>
            )}
          </p>
          <Field
            label={`Phân bổ sau gộp từ khoản ${formatMoney(row.amountVnd)} (VND)`}
          >
            <input
              type="number"
              min={0}
              max={row.amountVnd}
              step={1}
              required
              value={allocations[row.allocationId] ?? String(row.amountVnd)}
              onChange={(event) => {
                setAllocations((previous) => ({
                  ...previous,
                  [row.allocationId]: event.target.value,
                }))
                setConfirmed(false)
              }}
              disabled={command.isPending}
            />
          </Field>
        </div>
      ))}
      <p>
        Đã phân bổ trong nhóm: {formatMoney(beforeVnd)} · Sau gộp:{' '}
        {formatMoney(afterVnd)} · Tách về chờ phân bổ:{' '}
        {formatMoney(beforeVnd - afterVnd)}
      </p>
      {afterVnd > Number(amount) && (
        <Notice tone="amber">
          Cần tách {formatMoney(afterVnd - Number(amount))} tiền dư về chờ phân
          bổ trước khi gộp.
        </Notice>
      )}
      {!crossCarrier && (
        <Notice>
          Đang chọn nhóm của một đơn vị vận chuyển. Có thể hiệu chỉnh bản giữ
          lại và phân bổ tiền trong nhóm. Chọn thêm nhóm của đơn vị vận chuyển
          khác để xác minh chứng từ trùng giữa các đơn vị vận chuyển.
        </Notice>
      )}
      {!crossCarrier && group.some((row) => row.carrierId !== carrierId) && (
        <Notice tone="amber">
          Đổi đơn vị vận chuyển cho một nhóm chứng từ được thực hiện ở bước hiệu
          chỉnh đơn vị vận chuyển của vận đơn. Nếu có chứng từ trùng tại đơn vị
          vận chuyển khác, hãy chọn cả hai nhóm để xác minh và gộp.
        </Notice>
      )}
      {context.collections.some(
        (row) =>
          row.carrierId === carrierId &&
          !selectedCarriers.includes(row.carrierId),
      ) && (
        <Notice tone="amber">
          Đơn vị vận chuyển được chọn đã có chứng từ cùng mã. Cần chọn nhóm của
          đơn vị vận chuyển này để xác minh trước khi gộp.
        </Notice>
      )}
      <Field label="Mã hồ sơ xác minh / đối soát *">
        <input
          name="evidence"
          required
          minLength={3}
          maxLength={200}
          disabled={command.isPending}
          onChange={() => setConfirmed(false)}
        />
      </Field>
      <Field label="Lý do gộp và căn cứ phân bổ *">
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          disabled={command.isPending}
          onChange={() => setConfirmed(false)}
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
        Tôi đã xác minh các bản ghi đã chọn là cùng một chứng từ thu thực tế,
        đơn vị vận chuyển đúng, số tiền, thời điểm và từng khoản phân bổ sau
        gộp.
      </label>
      <ErrorNotice error={command.error} />
      <div className="c-actions">
        <Action
          type="submit"
          pending={command.isPending}
          disabled={!valid || !confirmed}
        >
          {crossCarrier
            ? 'Gộp chứng từ và đối soát phân bổ'
            : 'Lưu hiệu chỉnh chứng từ và phân bổ'}
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

function MergeOutcome({
  result,
  onClose,
}: {
  result: MergeResult
  onClose: () => void
}) {
  return (
    <div className="c-form-section">
      <Notice tone="green">
        Đã lưu kết quả đối soát, bằng chứng và tính lại số dư của các đơn liên
        quan. Tiếp tục xác minh đơn vị vận chuyển của vận đơn và quyết định
        trách nhiệm từ dữ liệu mới.
      </Notice>
      {result.balances.map((row) => (
        <p key={row.orderId}>
          #{row.orderCode}: khách còn phải trả {formatMoney(row.amountDueVnd)} ·
          cần hoàn {formatMoney(row.refundDueVnd)} · đơn vị vận chuyển nộp dư{' '}
          {formatMoney(row.carrierOverremittedVnd)}
          {!row.balancesVerified && ' · còn chứng từ chờ đối soát'}
        </p>
      ))}
      {result.unallocatedReceipts
        .filter((row) => row.unallocatedVnd > 0)
        .map((row) => (
          <p key={row.paymentId}>
            Chứng từ {row.reference}: {formatMoney(row.unallocatedVnd)} chờ phân
            bổ.
          </p>
        ))}
      <Link to="/staff/payments" className="c-text-link">
        Mở đối soát thanh toán và khoản tiền chưa phân bổ
      </Link>
      <Action onClick={onClose}>Tiếp tục hiệu chỉnh đơn vị vận chuyển</Action>
    </div>
  )
}
