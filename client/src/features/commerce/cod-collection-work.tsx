import { useState } from 'react'
import { paymentQueryPaths, useCommand, write } from './api'
import {
  Action,
  Badge,
  ErrorNotice,
  Field,
  formatMoney,
  Notice,
} from './components'
import type { OrderDetail } from './types'

function collectionStatusLabel(
  status: string,
  party: 'customer' | 'carrier',
  payment: OrderDetail['payment'],
) {
  if (status === 'awaiting_collection')
    return party === 'carrier'
      ? 'Chờ đơn vị vận chuyển nộp tiền'
      : 'Chờ thu tiền từ khách hàng'
  if (status !== 'received') return undefined
  if (party === 'carrier')
    return payment.customerPaidToCarrierVnd > 0
      ? 'Đã nhận đủ tiền thu hộ'
      : 'Đơn vị vận chuyển chưa thu tiền'
  return payment.paidVnd > 0
    ? 'Khách hàng đã thanh toán đủ'
    : 'Không còn khoản phải thu'
}

export function CodCollectionWork({ order }: { order: OrderDetail }) {
  const parties = [
    {
      key: 'customer',
      label: 'Thu từ khách hàng',
      record: order.payment.collection,
      dueVnd: order.payment.purchaseAmountDueVnd,
    },
    {
      key: 'carrier',
      label: 'Thu từ đơn vị vận chuyển',
      record: order.payment.carrierCollection,
      dueVnd: order.payment.carrierAmountDueVnd,
    },
  ] as const
  return (
    <div className="c-form-section">
      <div className="c-divider" />
      {parties.map(
        ({ key, label, record, dueVnd }) =>
          record && (
            <div key={key}>
              <strong>
                {label}: {record.failureCount}/3 lần thất bại
              </strong>
              <div className="c-badges">
                <Badge
                  status={record.status}
                  tone={
                    record.status === 'received' &&
                    key === 'carrier' &&
                    order.payment.customerPaidToCarrierVnd === 0
                      ? 'amber'
                      : undefined
                  }
                >
                  {collectionStatusLabel(record.status, key, order.payment)}
                </Badge>
              </div>
              {record.issueReason && (
                <p>Lý do gần nhất: {record.issueReason}</p>
              )}
              {record.failureCount >= 3 && dueVnd !== null && dueVnd > 0 && (
                <Notice tone="amber">
                  Đã đạt giới hạn thu. Quản trị viên xử lý khoản còn lại{' '}
                  {formatMoney(dueVnd)}.
                </Notice>
              )}
            </div>
          ),
      )}
      <CollectionFailureForm order={order} />
      <CollectionResolutionForm order={order} />
    </div>
  )
}

function CollectionFailureForm({ order }: { order: OrderDetail }) {
  const actions = order.permittedActions.staff
  const choices = [
    ...(actions.includes('record_collection_failure')
      ? [{ value: 'customer', label: 'Chưa thu được tiền từ khách hàng' }]
      : []),
    ...(actions.includes('record_carrier_collection_failure')
      ? [
          {
            value: 'carrier',
            label: 'Chưa nhận được tiền đơn vị vận chuyển nộp',
          },
        ]
      : []),
  ]
  const [party, setParty] = useState(choices[0]?.value ?? '')
  const selected =
    choices.find((choice) => choice.value === party) ?? choices[0]
  const command = useCommand(
    (input: { party: string; reason: string }) =>
      write(`staff/orders/${order.id}/collection-failure`, input),
    paymentQueryPaths,
  )
  if (!selected) return null
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        await command.run({
          party: selected.value,
          reason: String(data.get('reason')).trim(),
        })
      }}
    >
      <h3>Ghi nhận lần thu thất bại</h3>
      <Field label="Khoản thu thất bại *">
        <select
          value={selected.value}
          onChange={(event) => setParty(event.target.value)}
          disabled={command.isPending}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Lý do / kết quả liên hệ *">
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          disabled={command.isPending}
        />
      </Field>
      <label className="c-check">
        <input type="checkbox" required disabled={command.isPending} />
        Đã xác minh lần thu thất bại này; mỗi lần ghi nhận được tính vào giới
        hạn 3 lần.
      </label>
      <ErrorNotice error={command.error} />
      <Action type="submit" variant="secondary" pending={command.isPending}>
        Ghi nhận thu thất bại
      </Action>
    </form>
  )
}

function CollectionResolutionForm({ order }: { order: OrderDetail }) {
  const actions = order.permittedActions.staff
  const choices = [
    ...(actions.includes('record_collection_debt')
      ? [
          {
            value: 'customer:debt',
            party: 'customer',
            disposition: 'debt',
            label: 'Ghi công nợ khách hàng',
          },
        ]
      : []),
    ...(actions.includes('write_off_collection')
      ? [
          {
            value: 'customer:written_off',
            party: 'customer',
            disposition: 'written_off',
            label: 'Chấp nhận tổn thất khoản thu từ khách',
          },
        ]
      : []),
    ...(actions.includes('record_carrier_debt')
      ? [
          {
            value: 'carrier:debt',
            party: 'carrier',
            disposition: 'debt',
            label: 'Ghi công nợ đơn vị vận chuyển',
          },
        ]
      : []),
    ...(actions.includes('write_off_carrier_collection')
      ? [
          {
            value: 'carrier:written_off',
            party: 'carrier',
            disposition: 'written_off',
            label: 'Chấp nhận tổn thất khoản đơn vị vận chuyển nộp',
          },
        ]
      : []),
  ]
  const [decision, setDecision] = useState(choices[0]?.value ?? '')
  const selected =
    choices.find((choice) => choice.value === decision) ?? choices[0]
  const amountVnd =
    selected?.party === 'carrier'
      ? order.payment.carrierAmountDueVnd
      : order.payment.purchaseAmountDueVnd
  const carrierName = order.shipment?.carrier?.name ?? ''
  const command = useCommand(
    (input: Record<string, unknown>) =>
      write(`admin/orders/${order.id}/collection-resolutions`, input),
    paymentQueryPaths,
  )
  if (!selected || amountVnd === null || amountVnd <= 0) return null
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        await command.run({
          party: selected.party,
          disposition: selected.disposition,
          amountVnd,
          responsibleParty: String(data.get('responsibleParty')).trim(),
          reference: String(data.get('reference')).trim(),
          reason: String(data.get('reason')).trim(),
          evidenceVerified: true,
        })
      }}
    >
      <h3>Quyết định xử lý công nợ</h3>
      <Field label="Quyết định *">
        <select
          value={selected.value}
          onChange={(event) => setDecision(event.target.value)}
          disabled={command.isPending}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </Field>
      <Notice tone="amber">
        Xử lý số dư hiện tại {formatMoney(amountVnd)}. Quyết định công nợ hoặc
        tổn thất được lưu riêng với các khoản tiền thực nhận.
      </Notice>
      <Field label="Bên chịu trách nhiệm *">
        <input
          key={selected.party}
          name="responsibleParty"
          defaultValue={
            selected.party === 'carrier'
              ? carrierName.length < 3
                ? `Đơn vị vận chuyển ${carrierName}`
                : carrierName
              : `Khách hàng ${order.recipient.name}`
          }
          readOnly={selected.party === 'carrier'}
          required
          minLength={3}
          maxLength={200}
          disabled={command.isPending}
        />
      </Field>
      <Field label="Mã quyết định / bằng chứng *">
        <input
          name="reference"
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
      <label className="c-check">
        <input type="checkbox" required disabled={command.isPending} />
        Đã xác minh công nợ, bên chịu trách nhiệm và bằng chứng xử lý.
      </label>
      <ErrorNotice error={command.error} />
      <Action
        type="submit"
        variant={selected.disposition === 'written_off' ? 'danger' : 'primary'}
        pending={command.isPending}
      >
        Lưu quyết định xử lý
      </Action>
    </form>
  )
}
