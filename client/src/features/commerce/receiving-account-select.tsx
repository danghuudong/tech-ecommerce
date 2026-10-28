import { useState } from 'react'
import { useActor, useCommerceQuery } from './api'
import {
  Action,
  Field,
  Loading,
  Notice,
  Pagination,
  QueryError,
} from './components'
import { ReceivingAccountDrawer } from './receiving-accounts-page'
import type { ReceivingAccount, ReceivingAccountPage } from './types'

export function AccountSelect({
  channel,
  disabled,
  name = 'account',
}: {
  channel?: ReceivingAccount['channel']
  disabled?: boolean
  name?: string
}) {
  const actor = useActor()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<ReceivingAccount | null>(null)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [filterChannel, setFilterChannel] = useState('')
  const effectiveChannel = channel ?? (filterChannel || undefined)
  const accounts = useCommerceQuery<ReceivingAccountPage>(
    'staff/receiving-accounts',
    { limit: 20, offset, q: q || undefined, channel: effectiveChannel },
  )
  const pinned =
    selected && (!effectiveChannel || selected.channel === effectiveChannel)
      ? selected
      : null
  const items = [
    ...(pinned ? [pinned] : []),
    ...(accounts.data?.items ?? []),
  ].filter(
    (item, index, all) => all.findIndex((row) => row.id === item.id) === index,
  )
  const search = () => {
    setQ(text.trim())
    setOffset(0)
  }
  return (
    <div className="c-form-section">
      {!channel && (
        <Field label="Lọc hình thức nhận tiền">
          <select
            value={filterChannel}
            disabled={disabled}
            onChange={(event) => {
              setFilterChannel(event.target.value)
              setOffset(0)
              setSelected(null)
            }}
          >
            <option value="">Tất cả hình thức</option>
            <option value="bank_transfer">Ngân hàng</option>
            <option value="cash">Quỹ tiền mặt</option>
          </select>
        </Field>
      )}
      <Field
        label="Tìm tài khoản nhận tiền"
        hint="Tìm theo tên, số tài khoản, mã quỹ hoặc ngân hàng."
      >
        <input
          type="search"
          value={text}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              search()
            }
          }}
        />
      </Field>
      <Action
        variant="secondary"
        disabled={disabled || accounts.isFetching}
        onClick={search}
      >
        Tìm tài khoản
      </Action>
      <Field
        label="Tài khoản nhận *"
        hint={
          pinned
            ? 'Tài khoản đang chọn được giữ khi chuyển trang hoặc tìm kiếm.'
            : undefined
        }
      >
        <select
          name={name}
          required
          disabled={disabled || (accounts.isPending && !pinned)}
          aria-busy={accounts.isFetching}
          value={pinned?.id ?? ''}
          onChange={(event) =>
            setSelected(
              items.find((item) => item.id === event.target.value) ?? null,
            )
          }
        >
          <option value="">Chọn tài khoản nhận</option>
          {items.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.bank?.shortName ?? account.providerCode}{' '}
              · {account.accountReference}
            </option>
          ))}
        </select>
      </Field>
      {accounts.isPending ? (
        <Loading />
      ) : accounts.isError ? (
        <QueryError error={accounts.error} retry={() => accounts.refetch()} />
      ) : (
        <>
          {!accounts.data.items.length && (
            <Notice>
              Không tìm thấy tài khoản phù hợp. Thử thay bộ lọc hoặc đăng ký tài
              khoản nhận tiền.
            </Notice>
          )}
          <Pagination
            offset={offset}
            limit={20}
            total={accounts.data.total}
            count={accounts.data.items.length}
            onChange={setOffset}
            disabled={disabled || accounts.isFetching}
          />
        </>
      )}
      {actor.data?.role === 'admin' && (
        <Action
          variant="secondary"
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          Đăng ký tài khoản nhận tiền
        </Action>
      )}
      {creating && (
        <ReceivingAccountDrawer
          channel={channel}
          onClose={() => setCreating(false)}
          onSaved={(account) => {
            setFilterChannel(account.channel)
            setQ('')
            setText('')
            setOffset(0)
            setSelected(account)
          }}
        />
      )}
    </div>
  )
}
