import { useState } from 'react'
import { useActor, useCommand, useCommerceQuery, write } from './api'
import {
  AccessGate,
  Action,
  Badge,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  PageHeading,
  Pagination,
  Panel,
  QueryError,
} from './components'
import { StaffLayout } from './layouts'
import {
  OrderAssignmentOverview,
  StaffOrderSettingsDrawer,
} from './order-assignment-settings'
import { roleLabels } from './roles'
import type { Page, Role, StaffOrderSettings } from './types'

interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  orderAssignment: StaffOrderSettings
}

export function TeamPage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['admin']}>
        <TeamContent />
      </AccessGate>
    </StaffLayout>
  )
}

function TeamContent() {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<TeamMember | null>(null)
  const [assignmentMember, setAssignmentMember] = useState<TeamMember | null>(
    null,
  )
  const users = useCommerceQuery<Page<TeamMember> & { total: number }>(
    'admin/users',
    { q: q || undefined, limit: 10, offset },
    true,
    15_000,
  )
  return (
    <>
      <PageHeading
        title="Nhân sự & phân quyền"
        subtitle="Cấp vai trò cho tài khoản đã đăng ký; mọi thay đổi được lưu lịch sử."
      />
      <Notice>
        Nhân viên xử lý đơn: xử lý đơn được giao, người nhận, đóng gói, giao vận
        và nhận hàng trả. Kế toán: xác minh thu tiền, đối soát COD, ghi nhận thu
        thất bại và mở lần hoàn tiền. Quản trị viên: xác minh hoàn tiền do người
        khác mở, quản lý quyền, chấp nhận thanh toán trễ và phê duyệt xử lý công
        nợ, tổn thất, ngoại lệ.
      </Notice>
      <OrderAssignmentOverview />
      <Panel className="c-table-panel">
        <form
          className="c-filters"
          onSubmit={(event) => {
            event.preventDefault()
            setQ(text.trim())
            setOffset(0)
          }}
        >
          <Field label="Tìm tài khoản">
            <input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={120}
              placeholder="Tên, email hoặc mã tài khoản"
            />
          </Field>
          <Action type="submit" variant="secondary">
            Tìm
          </Action>
        </form>
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <QueryError error={users.error} retry={() => users.refetch()} />
        ) : (
          <>
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Họ tên</th>
                    <th>Email</th>
                    <th>Vai trò</th>
                    <th>Nhận đơn tự động</th>
                    <th>Đơn đang xử lý</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.items.map((member) => (
                    <tr key={member.id}>
                      <td>{member.name}</td>
                      <td>{member.email}</td>
                      <td>{roleLabels[member.role]}</td>
                      <td>
                        {member.role === 'staff' ? (
                          <Badge
                            tone={
                              member.orderAssignment.receivingNow
                                ? 'green'
                                : 'amber'
                            }
                          >
                            {!member.orderAssignment.enabled
                              ? 'Chưa bật'
                              : member.orderAssignment.receivingNow
                                ? 'Đang nhận'
                                : 'Tạm dừng'}
                          </Badge>
                        ) : (
                          '—'
                        )}
                        {member.role === 'staff' &&
                          member.orderAssignment.shiftEndsAt && (
                            <small>
                              Kết thúc ca:{' '}
                              {formatDate(member.orderAssignment.shiftEndsAt)}
                            </small>
                          )}
                      </td>
                      <td>
                        {member.role === 'staff'
                          ? `${member.orderAssignment.activeOrders} / ${member.orderAssignment.maxActiveOrders}`
                          : '—'}
                        {member.role === 'staff' && (
                          <small>
                            {member.orderAssignment.fulfillmentOrders} trước
                            giao vận ·{' '}
                            {member.orderAssignment.deliveryIssueOrders} giao
                            lỗi · {member.orderAssignment.returnOrders} trả hàng
                          </small>
                        )}
                        {member.role === 'staff' &&
                          member.orderAssignment.activeOrders >
                            member.orderAssignment.maxActiveOrders && (
                            <Badge tone="red">
                              Vượt tải{' '}
                              {member.orderAssignment.activeOrders -
                                member.orderAssignment.maxActiveOrders}{' '}
                              đơn
                            </Badge>
                          )}
                      </td>
                      <td>
                        <div className="c-actions">
                          <Action
                            variant="secondary"
                            onClick={() => setSelected(member)}
                          >
                            Đổi vai trò
                          </Action>
                          {member.role === 'staff' && (
                            <Action
                              variant="secondary"
                              onClick={() => setAssignmentMember(member)}
                            >
                              Cấu hình nhận đơn
                            </Action>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users.data.items.length === 0 && (
              <Empty title="Không có tài khoản phù hợp" />
            )}
            <Pagination
              offset={offset}
              limit={10}
              count={users.data.items.length}
              total={users.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </Panel>
      {selected && (
        <RoleDrawer
          key={selected.id}
          member={selected}
          onClose={() => setSelected(null)}
        />
      )}
      {assignmentMember && (
        <StaffOrderSettingsDrawer
          key={`${assignmentMember.id}:${assignmentMember.orderAssignment.revision}`}
          member={assignmentMember}
          onClose={() => setAssignmentMember(null)}
          onReload={async () => {
            const latest = await users.refetch()
            if (!latest.data || latest.isError) return
            const member = latest.data.items.find(
              (item) => item.id === assignmentMember.id,
            )
            setAssignmentMember(member?.role === 'staff' ? member : null)
          }}
        />
      )}
    </>
  )
}

function RoleDrawer({
  member,
  onClose,
}: {
  member: TeamMember
  onClose: () => void
}) {
  const actor = useActor()
  const [role, setRole] = useState<Role>(member.role)
  const command = useCommand(
    (input: { role: Role; reason: string }) =>
      write(
        `admin/users/${encodeURIComponent(member.id)}/role`,
        input,
        'patch',
      ),
    [
      'admin/users',
      'admin/role-history',
      'staff/orders',
      'admin/order-assignment',
    ],
  )
  return (
    <Drawer
      title={`Đổi vai trò: ${member.name}`}
      onClose={onClose}
      busy={command.isPending}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          if (
            await command.run({
              role,
              reason: String(data.get('reason')).trim(),
            })
          ) {
            if (member.id === actor.data?.userId) {
              window.location.replace('/admin/login')
            } else onClose()
          }
        }}
      >
        <p>{member.email}</p>
        <Field label="Vai trò mới *">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            disabled={command.isPending}
          >
            {(Object.keys(roleLabels) as Role[]).map((value) => (
              <option key={value} value={value}>
                {roleLabels[value]}
              </option>
            ))}
          </select>
        </Field>
        <Notice tone="amber">
          Cần bàn giao các đơn đang phụ trách trước khi chuyển sang kế toán hoặc
          khách hàng, bao gồm đơn đã hoàn tất còn thời hạn trả hàng. Phiên nội
          bộ của tài khoản sẽ kết thúc sau khi đổi vai trò.
          {member.id === actor.data?.userId &&
            ' Bạn đang thay đổi quyền của chính mình.'}
        </Notice>
        <Field label="Lý do thay đổi *">
          <textarea
            name="reason"
            required
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
          <Action
            type="submit"
            pending={command.isPending}
            disabled={role === member.role}
          >
            Lưu vai trò
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
