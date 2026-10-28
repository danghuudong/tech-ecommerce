import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useCommand, useCommerceQuery, write } from './api'
import {
  Action,
  Drawer,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  Panel,
  QueryError,
} from './components'
import { inputToIso, vietnamDateInput } from './date-time'
import type { OrderAssignmentSummary, StaffOrderSettings } from './types'

export function OrderAssignmentOverview() {
  const summary = useCommerceQuery<OrderAssignmentSummary>(
    'admin/order-assignment',
    {},
    true,
    15_000,
  )
  return (
    <Panel title="Tự động phân công đơn">
      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <QueryError error={summary.error} retry={() => summary.refetch()} />
      ) : (
        <div className="c-form-section" aria-live="polite">
          <p>
            <strong>{summary.data.pendingOrders}</strong> đơn cần phân công ·{' '}
            <strong>{summary.data.eligibleOrders}</strong> đơn đủ điều kiện đang
            chờ · <strong>{summary.data.receivingStaff}</strong> nhân viên đang
            nhận đơn
          </p>
          <small>
            Nhân viên cần xác nhận trước hạn chờ hiển thị trên từng đơn hàng.
          </small>
          {summary.data.eligibleOrders > 0 &&
            summary.data.availableStaff === 0 && (
              <Notice tone="amber">
                {summary.data.receivingStaff === 0
                  ? 'Chưa có nhân viên bật nhận đơn trong ca. Hãy cấu hình nhận đơn cho nhân viên.'
                  : 'Các nhân viên đang nhận đơn đều đã đạt giới hạn. Đơn sẽ tiếp tục chờ đến khi có người giảm tải.'}
              </Notice>
            )}
          {summary.data.pendingOrders > summary.data.eligibleOrders && (
            <small>
              Một số đơn chưa đủ điều kiện tự phân công. Kiểm tra trạng thái đơn
              và hạn giữ hàng.
            </small>
          )}
          {summary.data.overdueAssignments > 0 && (
            <Notice tone="amber">
              {summary.data.overdueAssignments} đơn đã được phân công nhưng chưa
              xác nhận khi hết hạn chờ. Kiểm tra mục “Chậm xác nhận” trong danh
              sách đơn để xử lý đơn hết hạn.
            </Notice>
          )}
          {summary.data.waitingOverdueOrders > 0 && (
            <Notice tone="amber">
              {summary.data.waitingOverdueOrders} đơn chờ phân công hoặc bàn
              giao quá {summary.data.queueSlaMinutes} phút. Xem mục “Chờ phân
              công quá lâu” để điều phối.
            </Notice>
          )}
          {summary.data.deadlineAtRiskOrders > 0 && (
            <Notice tone="red">
              {summary.data.deadlineAtRiskOrders} đơn trong hàng chờ còn không
              quá {summary.data.deadlineWarningMinutes} phút giữ hàng hoặc đã
              hết hạn. Cần kiểm tra ngay.
            </Notice>
          )}
          {(summary.data.handoverOrders > 0 ||
            summary.data.handoverReviewOrders > 0) && (
            <Notice tone="amber">
              {summary.data.handoverOrders} đơn chờ tự bàn giao sau ca;{' '}
              {summary.data.handoverReviewOrders} đơn đang đóng gói hoặc chờ đơn
              vị vận chuyển/kế toán được giữ nguyên người phụ trách để admin
              kiểm tra.
            </Notice>
          )}
          {summary.data.blockedPaymentOrders > 0 && (
            <small>
              {summary.data.blockedPaymentOrders} đơn chuyển khoản hết hạn đang
              chờ đối soát, được loại khỏi tải nhân viên. Khi mở xử lý lại, đơn
              tự tính vào tải.
            </small>
          )}
          {summary.data.overloadedStaff > 0 && (
            <Notice tone="red">
              {summary.data.overloadedStaff} nhân viên đang vượt hạn mức, tổng
              cộng {summary.data.overCapacityOrders} đơn vượt tải.{' '}
              {summary.data.rebalanceOrders} đơn có công việc mới quay lại đang
              chờ điều phối sang người trong ca còn tải. Xem tải từng người ở
              Nhân sự để hỗ trợ các đơn giữ lại hoặc chưa có người nhận. Thanh
              toán và yêu cầu trả hàng vẫn được tiếp nhận.
            </Notice>
          )}
          {summary.data.oldestWaitingOrders.length > 0 && (
            <div>
              <strong>Đơn chờ lâu nhất</strong>
              <ul>
                {summary.data.oldestWaitingOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      className="c-text-link"
                      to="/staff/orders/$orderId"
                      params={{ orderId: order.id }}
                    >
                      #{order.code}
                    </Link>
                    {' · '}
                    {order.assignmentNeedsHandover
                      ? 'Chờ bàn giao'
                      : order.assignmentNeedsRebalance
                        ? 'Chờ điều phối do vượt tải'
                        : 'Chờ phân công'}{' '}
                    từ {formatDate(order.assignmentWaitingSince)}
                    {order.reservationExpiresAt && (
                      <>
                        {' '}
                        · Hạn giữ hàng: {formatDate(order.reservationExpiresAt)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <small>
            Tải gồm đơn cần xử lý trước giao vận, giao thất bại và trả hàng đang
            mở; mỗi đơn chỉ tính một lần. Ưu tiên người ít tải nhất trong ca,
            sau đó đến người lâu chưa nhận đơn.
          </small>
        </div>
      )}
    </Panel>
  )
}

export function StaffOrderSettingsDrawer({
  member,
  onClose,
  onReload,
}: {
  member: { id: string; name: string; orderAssignment: StaffOrderSettings }
  onClose: () => void
  onReload: () => Promise<void>
}) {
  const settings = member.orderAssignment
  const [enabled, setEnabled] = useState(settings.enabled)
  const [acceptingOrders, setAcceptingOrders] = useState(settings.receivingNow)
  const [shiftEnd, setShiftEnd] = useState(
    settings.receivingNow && settings.shiftEndsAt
      ? vietnamDateInput(settings.shiftEndsAt)
      : '',
  )
  const [capacity, setCapacity] = useState(String(settings.maxActiveOrders))
  const [reloading, setReloading] = useState(false)
  const command = useCommand(
    (input: {
      enabled: boolean
      acceptingOrders: boolean
      maxActiveOrders: number
      shiftEndsAt: string | null
      expectedRevision: number
      reason: string
    }) =>
      write(
        `admin/users/${encodeURIComponent(member.id)}/order-assignment`,
        input,
        'patch',
      ),
    ['admin/users', 'admin/order-assignment'],
  )
  const changed =
    enabled !== settings.enabled ||
    acceptingOrders !== settings.acceptingOrders ||
    Number(capacity) !== settings.maxActiveOrders ||
    (shiftEnd ? inputToIso(shiftEnd) : null) !== settings.shiftEndsAt
  return (
    <Drawer
      title={`Nhận đơn tự động: ${member.name}`}
      onClose={onClose}
      busy={command.isPending || reloading}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const maxActiveOrders = Number(capacity)
          if (
            !Number.isInteger(maxActiveOrders) ||
            maxActiveOrders < 1 ||
            maxActiveOrders > 100
          )
            return
          if (
            await command.run({
              enabled,
              acceptingOrders,
              maxActiveOrders,
              shiftEndsAt: shiftEnd ? inputToIso(shiftEnd) : null,
              expectedRevision: settings.revision,
              reason: String(data.get('reason') ?? '').trim(),
            })
          )
            onClose()
        }}
      >
        <p>
          Đang cần xử lý {settings.activeOrders} đơn:{' '}
          {settings.fulfillmentOrders} trước giao vận,{' '}
          {settings.deliveryIssueOrders} giao thất bại, {settings.returnOrders}{' '}
          có yêu cầu trả hàng đang mở. Mỗi đơn chỉ tính một lần vào tổng tải.
        </p>
        {settings.blockedPaymentOrders > 0 && (
          <small>
            {settings.blockedPaymentOrders} đơn chuyển khoản hết hạn chờ đối
            soát không tính vào tải.
          </small>
        )}
        {settings.activeOrders > settings.maxActiveOrders && (
          <Notice tone="red">
            Đang vượt hạn mức {settings.activeOrders - settings.maxActiveOrders}{' '}
            đơn. Hệ thống chỉ điều phối phần việc mới quay lại có thể bàn giao;
            cần admin kiểm tra phần việc giữ lại và phân công thủ công.
          </Notice>
        )}
        <Field label="Tham gia tự động nhận đơn">
          <select
            value={enabled ? 'enabled' : 'disabled'}
            disabled={command.isPending || reloading}
            onChange={(event) => {
              const next = event.target.value === 'enabled'
              setEnabled(next)
              if (!next) setAcceptingOrders(false)
            }}
          >
            <option value="disabled">Tắt</option>
            <option value="enabled">Bật</option>
          </select>
        </Field>
        <Field label="Nhận đơn trong ca hiện tại">
          <select
            value={acceptingOrders ? 'accepting' : 'paused'}
            disabled={!enabled || command.isPending || reloading}
            onChange={(event) =>
              setAcceptingOrders(event.target.value === 'accepting')
            }
          >
            <option value="paused">Tạm dừng và bàn giao việc phù hợp</option>
            <option value="accepting">Đang nhận đơn</option>
          </select>
        </Field>
        {acceptingOrders && (
          <Field
            label="Kết thúc ca (giờ Việt Nam) *"
            hint="Chọn thời điểm trong 24 giờ tới. Đến giờ, hệ thống tự dừng nhận đơn và bàn giao việc phù hợp."
          >
            <input
              type="datetime-local"
              step="any"
              required
              value={shiftEnd}
              disabled={command.isPending || reloading}
              onChange={(event) => setShiftEnd(event.target.value)}
            />
          </Field>
        )}
        <Field label="Giới hạn đơn đang xử lý *">
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            required
            value={capacity}
            disabled={command.isPending || reloading}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </Field>
        <Notice>
          Tạm dừng hoặc hết ca sẽ tự giao lại việc có thể tiếp tục cho người
          trong ca còn tải. Nếu chưa có người phù hợp, đơn vẫn giữ người phụ
          trách cũ và nằm trong hàng chờ bàn giao. Đơn đang đóng gói hoặc chờ
          đơn vị vận chuyển/kế toán giữ nguyên để admin kiểm tra. Giảm giới hạn
          chặn phân công mới khi đủ tải và có thể đưa phần việc quay lại vượt
          tải vào hàng chờ điều phối.
        </Notice>
        <Field label="Lý do thay đổi *">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            disabled={command.isPending || reloading}
          />
        </Field>
        <ErrorNotice error={command.error} />
        {command.isError && (
          <Action
            variant="secondary"
            disabled={command.isPending || reloading}
            onClick={async () => {
              setReloading(true)
              try {
                await onReload()
              } finally {
                setReloading(false)
              }
            }}
          >
            Tải lại cấu hình
          </Action>
        )}
        <div className="c-actions">
          <Action
            variant="secondary"
            disabled={command.isPending || reloading}
            onClick={onClose}
          >
            Quay lại
          </Action>
          <Action
            type="submit"
            pending={command.isPending}
            disabled={!changed || reloading}
          >
            Lưu cấu hình
          </Action>
        </div>
      </form>
    </Drawer>
  )
}
