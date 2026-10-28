import { Plus } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { z } from 'zod'
import { useCommand, useCommerceQuery, write } from './api'
import {
  AccessGate,
  Action,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  Panel,
  QueryError,
} from './components'
import { StaffLayout } from './layouts'
import type {
  ReceivingAccount,
  ReceivingAccountPage,
  ReceivingBank,
} from './types'

const accountPart = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.toLowerCase().replace(/\s+/g, ''))
    .pipe(
      z
        .string()
        .min(min, 'Mã quá ngắn.')
        .max(max, 'Mã quá dài.')
        .regex(
          /^[a-z0-9][a-z0-9._-]*$/,
          'Chỉ dùng chữ không dấu, số, dấu chấm, gạch ngang hoặc gạch dưới; bắt đầu bằng chữ hoặc số.',
        ),
    )
const accountFields = {
  accountReference: accountPart(1, 100),
  name: z.string().trim().min(2, 'Nhập tên từ 2 ký tự.').max(200),
}
const accountSchema = z.discriminatedUnion('channel', [
  z.object({
    ...accountFields,
    channel: z.literal('bank_transfer'),
    providerCode: z.string().regex(/^[0-9]{6}$/, 'Chọn ngân hàng từ danh mục.'),
  }),
  z.object({
    ...accountFields,
    channel: z.literal('cash'),
    providerCode: accountPart(2, 64),
  }),
])

export function ReceivingAccountsPage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['admin']}>
        <ReceivingAccountsContent />
      </AccessGate>
    </StaffLayout>
  )
}

function ReceivingAccountsContent() {
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [channel, setChannel] = useState('')
  const accounts = useCommerceQuery<ReceivingAccountPage>(
    'staff/receiving-accounts',
    { limit: 20, offset, channel: channel || undefined, q: q || undefined },
  )
  return (
    <>
      <PageHeading
        title="Tài khoản nhận tiền"
        subtitle="Đăng ký tài khoản ngân hàng hoặc quỹ tiền mặt của cửa hàng để ghi nhận tiền thực nhận."
      >
        <Action onClick={() => setCreating(true)}>
          <Plus size={16} /> Đăng ký tài khoản nhận tiền
        </Action>
      </PageHeading>
      <Panel className="c-table-panel">
        <form
          className="c-filters"
          onSubmit={(event) => {
            event.preventDefault()
            setQ(text.trim())
            setOffset(0)
          }}
        >
          <Field label="Tìm tài khoản nhận tiền">
            <input
              type="search"
              maxLength={120}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Tên, số tài khoản, mã quỹ hoặc ngân hàng"
            />
          </Field>
          <Field label="Hình thức nhận">
            <select
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value)
                setOffset(0)
              }}
            >
              <option value="">Tất cả</option>
              <option value="bank_transfer">Ngân hàng</option>
              <option value="cash">Quỹ tiền mặt</option>
            </select>
          </Field>
          <Action variant="secondary" type="submit">
            Tìm
          </Action>
        </form>
        {accounts.isPending ? (
          <Loading />
        ) : accounts.isError ? (
          <QueryError error={accounts.error} retry={() => accounts.refetch()} />
        ) : (
          <>
            {accounts.data.items.length ? (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>Tên tài khoản / quỹ</th>
                      <th>Hình thức</th>
                      <th>Ngân hàng / đơn vị quản lý quỹ</th>
                      <th>Số tài khoản / mã quỹ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.data.items.map((account) => (
                      <tr key={account.id}>
                        <td>{account.name}</td>
                        <td>
                          {account.channel === 'bank_transfer'
                            ? 'Ngân hàng'
                            : 'Tiền mặt'}
                        </td>
                        <td>
                          {account.bank?.shortName ?? account.providerCode}
                        </td>
                        <td>{account.accountReference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Không có tài khoản nhận tiền phù hợp"
                description="Thử thay bộ lọc hoặc đăng ký tài khoản ngân hàng, quỹ tiền mặt của cửa hàng."
              />
            )}
            <Pagination
              offset={offset}
              limit={20}
              count={accounts.data.items.length}
              total={accounts.data.total}
              disabled={accounts.isFetching}
              onChange={setOffset}
            />
          </>
        )}
      </Panel>
      {creating && (
        <ReceivingAccountDrawer
          onClose={() => setCreating(false)}
          onSaved={(account) => {
            setOffset(0)
            setChannel(account.channel)
            setQ(account.accountReference)
            setText(account.accountReference)
          }}
        />
      )}
    </>
  )
}

export function ReceivingAccountDrawer({
  channel: fixedChannel,
  onClose,
  onSaved,
}: {
  channel?: ReceivingAccount['channel']
  onClose: () => void
  onSaved: (account: ReceivingAccount) => void
}) {
  const [channel, setChannel] = useState<ReceivingAccount['channel']>(
    fixedChannel ?? 'bank_transfer',
  )
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [bankSearch, setBankSearch] = useState('')
  const [bankBin, setBankBin] = useState('')
  const banks = useCommerceQuery<{ items: ReceivingBank[] }>(
    'staff/receiving-banks',
    {},
    channel === 'bank_transfer',
  )
  const bankOptions =
    banks.data?.items.filter(
      (bank) =>
        bank.bin === bankBin ||
        `${bank.bin} ${bank.code} ${bank.shortName} ${bank.name}`
          .toLocaleLowerCase('vi')
          .includes(bankSearch.trim().toLocaleLowerCase('vi')),
    ) ?? []
  const command = useCommand(
    (input: z.infer<typeof accountSchema>) =>
      write<{ receivingAccountId: string; receivingAccount: ReceivingAccount }>(
        'admin/receiving-accounts',
        input,
      ),
    ['staff/receiving-accounts'],
  )
  return createPortal(
    <Drawer
      title="Đăng ký tài khoản nhận tiền"
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const data = new FormData(event.currentTarget)
          const parsed = accountSchema.safeParse({
            channel,
            providerCode: String(data.get('providerCode')),
            accountReference: String(data.get('accountReference')),
            name: String(data.get('name')),
          })
          if (!parsed.success) {
            setErrors(z.flattenError(parsed.error).fieldErrors)
            return
          }
          setErrors({})
          const result = await command.run(parsed.data)
          if (result) {
            onSaved(result.receivingAccount)
            onClose()
          }
        }}
      >
        <Notice>
          Nhập thông tin tài khoản hoặc quỹ thực tế do cửa hàng quản lý. Với tài
          khoản ngân hàng, chọn ngân hàng từ danh mục để tránh đăng ký trùng
          bằng tên viết tắt khác nhau.
        </Notice>
        <Field label="Hình thức nhận tiền *">
          <select
            value={channel}
            onChange={(event) =>
              setChannel(event.target.value as ReceivingAccount['channel'])
            }
            disabled={command.isPending || Boolean(fixedChannel)}
          >
            <option value="bank_transfer">Tài khoản ngân hàng</option>
            <option value="cash">Quỹ tiền mặt</option>
          </select>
        </Field>
        {channel === 'bank_transfer' ? (
          <>
            <Field label="Tìm ngân hàng">
              <input
                type="search"
                value={bankSearch}
                maxLength={120}
                disabled={command.isPending}
                onChange={(event) => setBankSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
              />
            </Field>
            <Field
              label="Ngân hàng *"
              error={errors.providerCode?.[0]}
              hint="Mỗi ngân hàng dùng một mã BIN cố định trong hệ thống."
            >
              <select
                name="providerCode"
                required
                value={bankBin}
                onChange={(event) => setBankBin(event.target.value)}
                disabled={command.isPending || banks.isPending || banks.isError}
              >
                <option value="">Chọn ngân hàng</option>
                {bankOptions.map((bank) => (
                  <option key={bank.bin} value={bank.bin}>
                    {bank.shortName} · {bank.code} · {bank.bin}
                  </option>
                ))}
              </select>
            </Field>
            {banks.isPending && <Loading text="Đang tải danh mục ngân hàng…" />}
            {banks.isError && (
              <QueryError error={banks.error} retry={() => banks.refetch()} />
            )}
          </>
        ) : (
          <Field
            label="Mã đơn vị quản lý quỹ *"
            hint="Ví dụ: store. Dùng cùng mã cho các quỹ của cùng đơn vị."
            error={errors.providerCode?.[0]}
          >
            <input
              name="providerCode"
              required
              minLength={2}
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              disabled={command.isPending}
            />
          </Field>
        )}
        <Field
          label={channel === 'bank_transfer' ? 'Số tài khoản *' : 'Mã quỹ *'}
          hint={
            channel === 'bank_transfer'
              ? 'Nhập đúng số tài khoản nhận tiền của cửa hàng.'
              : 'Ví dụ: cash-main. Mỗi quỹ có một mã riêng.'
          }
          error={errors.accountReference?.[0]}
        >
          <input
            name="accountReference"
            required
            maxLength={100}
            autoCapitalize="none"
            spellCheck={false}
            disabled={command.isPending}
          />
        </Field>
        <Field label="Tên tài khoản / quỹ *" error={errors.name?.[0]}>
          <input
            name="name"
            required
            minLength={2}
            maxLength={200}
            disabled={command.isPending}
          />
        </Field>
        <label className="c-check">
          <input type="checkbox" required disabled={command.isPending} />
          Đã kiểm tra thông tin và quyền quản lý tài khoản / quỹ của cửa hàng
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
            disabled={
              channel === 'bank_transfer' &&
              (!bankBin || banks.isPending || banks.isError)
            }
          >
            Đăng ký tài khoản
          </Action>
        </div>
      </form>
    </Drawer>,
    document.body,
  )
}
