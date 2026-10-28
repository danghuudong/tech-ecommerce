import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useActor, useCommand, useCommerceQuery, write } from './api'
import {
  Action,
  Drawer,
  ErrorNotice,
  Field,
  Loading,
  Pagination,
} from './components'
import type { Carrier, Page } from './types'

export function CarrierPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const actor = useActor()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const carriers = useCommerceQuery<Page<Carrier>>('staff/carriers', {
    limit: 20,
    offset,
    q: q || undefined,
  })
  const search = () => {
    setQ(text.trim())
    setOffset(0)
    onChange('')
  }
  return (
    <div className="c-form-section">
      <Field label="Tìm đơn vị vận chuyển">
        <input
          type="search"
          value={text}
          maxLength={120}
          disabled={disabled}
          placeholder="Tên hoặc mã đơn vị vận chuyển"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              search()
            }
          }}
        />
      </Field>
      <div className="c-actions">
        <Action variant="secondary" disabled={disabled} onClick={search}>
          Tìm đơn vị vận chuyển
        </Action>
        {actor.data?.role === 'admin' && (
          <Action
            variant="secondary"
            disabled={disabled}
            onClick={() => setCreating(true)}
          >
            Thêm đơn vị vận chuyển
          </Action>
        )}
      </div>
      <Field label="Đơn vị vận chuyển *">
        <select
          required
          value={value}
          disabled={disabled || carriers.isPending || carriers.isError}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Chọn đơn vị vận chuyển</option>
          {carriers.data?.items.map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name} ({carrier.code})
            </option>
          ))}
        </select>
      </Field>
      {carriers.isPending && <Loading text="Đang tải đơn vị vận chuyển…" />}
      <ErrorNotice error={carriers.error} />
      {carriers.isError && (
        <Action variant="secondary" onClick={() => carriers.refetch()}>
          Tải lại danh sách đơn vị vận chuyển
        </Action>
      )}
      {carriers.data && (
        <>
          {!carriers.data.items.length && (
            <small>Không tìm thấy đơn vị vận chuyển phù hợp.</small>
          )}
          <Pagination
            offset={offset}
            limit={20}
            count={carriers.data.items.length}
            total={carriers.data.total}
            onChange={(next) => {
              if (disabled) return
              setOffset(next)
              onChange('')
            }}
          />
        </>
      )}
      {creating &&
        createPortal(
          <CreateCarrier
            onClose={() => setCreating(false)}
            onCreated={(carrierId, code) => {
              setText(code)
              setQ(code)
              setOffset(0)
              onChange(carrierId)
              setCreating(false)
            }}
          />,
          document.body,
        )}
    </div>
  )
}

function CreateCarrier({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (carrierId: string, code: string) => void
}) {
  const command = useCommand(
    (input: { code: string; name: string }) =>
      write<{ carrierId: string; code: string }>('admin/carriers', input),
    ['staff/carriers'],
  )
  return (
    <Drawer
      title="Thêm đơn vị vận chuyển"
      busy={command.isPending}
      onClose={onClose}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const data = new FormData(event.currentTarget)
          const result = await command.run({
            code: String(data.get('code')).trim().toLowerCase(),
            name: String(data.get('name')).trim(),
          })
          if (result) onCreated(result.carrierId, result.code)
        }}
      >
        <Field
          label="Mã đơn vị vận chuyển *"
          hint="Mã cố định, ví dụ: ghn hoặc viettel-post."
        >
          <input
            name="code"
            required
            minLength={2}
            maxLength={64}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*"
            disabled={command.isPending}
          />
        </Field>
        <Field label="Tên đơn vị vận chuyển *">
          <input
            name="name"
            required
            minLength={2}
            maxLength={200}
            disabled={command.isPending}
          />
        </Field>
        <ErrorNotice error={command.error} />
        <Action type="submit" pending={command.isPending}>
          Lưu đơn vị vận chuyển
        </Action>
      </form>
    </Drawer>
  )
}
