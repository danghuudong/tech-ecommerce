import { useEffect, useState } from 'react'
import { useStaffShift } from './api'
import { Action, Badge, ErrorNotice, formatDate, Panel } from './components'
import { serverClockNow } from './date-time'

export function StaffShiftCard() {
  const query = useStaffShift()
  const status = query.data
  const shift = status?.latestShift
  const [expiredAt, setExpiredAt] = useState<string | null>(null)

  useEffect(() => {
    const endsAt = status?.settings?.shiftEndsAt
    if (!status || !endsAt) return
    const remaining =
      Date.parse(endsAt) -
      serverClockNow(status.serverTime, status.clockReceivedAt).getTime()
    const timer = window.setTimeout(
      () => setExpiredAt(endsAt),
      Math.max(0, remaining),
    )
    return () => window.clearTimeout(timer)
  }, [status])

  if (query.isError || query.fetchStatus === 'paused') {
    return (
      <Panel title="Ca làm việc của tôi" className="c-shift-card">
        <div className="c-form-section">
          {query.isError ? (
            <ErrorNotice error={query.error} />
          ) : (
            <p>Chưa thể cập nhật thông tin ca. Vui lòng kiểm tra kết nối.</p>
          )}
          <Action variant="secondary" onClick={() => void query.refetch()}>
            Thử lại
          </Action>
        </div>
      </Panel>
    )
  }
  if (!status || !query.isFetchedAfterMount) {
    return (
      <Panel title="Ca làm việc của tôi" className="c-shift-card">
        <p role="status">Đang tải thông tin ca làm việc…</p>
      </Panel>
    )
  }
  const settings = status.settings
  if (!settings) return null
  const ended = Boolean(
    settings.shiftEndsAt &&
      (expiredAt === settings.shiftEndsAt ||
        Date.parse(settings.shiftEndsAt) <=
          serverClockNow(status.serverTime, status.clockReceivedAt).getTime()),
  )
  const active = settings.receivingNow && !ended
  const label = !settings.enabled
    ? 'Chưa bật nhận đơn'
    : ended
      ? 'Đã hết ca'
      : active
        ? 'Đang trong ca'
        : shift
          ? 'Tạm dừng nhận đơn'
          : 'Chưa vào ca'
  const description = !settings.enabled
    ? 'Admin chưa bật nhận đơn tự động cho bạn.'
    : ended
      ? 'Ca đã kết thúc. Liên hệ admin để mở ca mới.'
      : active
        ? settings.activeOrders >= settings.maxActiveOrders
          ? 'Bạn đã đạt giới hạn, hệ thống tạm dừng phân công đơn tự động mới.'
          : 'Bạn đang sẵn sàng nhận đơn tự động khi có đơn phù hợp.'
        : 'Bạn chưa nhận đơn tự động trong ca. Liên hệ admin để bật hoặc tiếp tục ca.'

  return (
    <Panel
      title="Ca làm việc của tôi"
      className="c-shift-card"
      aside={<Badge tone={active ? 'blue' : 'neutral'}>{label}</Badge>}
    >
      <div className="c-form-section">
        <dl className="c-shift-details">
          <div>
            <dt>{active ? 'Bắt đầu ca' : 'Bật ca gần nhất'}</dt>
            <dd>{formatDate(shift?.startedAt)}</dd>
          </div>
          <div>
            <dt>Kết thúc ca dự kiến</dt>
            <dd>{formatDate(settings.shiftEndsAt)}</dd>
          </div>
          <div>
            <dt>Đơn đang xử lý / Giới hạn</dt>
            <dd>
              {settings.activeOrders} / {settings.maxActiveOrders} đơn
            </dd>
          </div>
        </dl>
        <p className="c-shift-description">{description}</p>
        <small>Các mốc thời gian theo giờ Việt Nam. Ca do admin quản lý.</small>
      </div>
    </Panel>
  )
}
