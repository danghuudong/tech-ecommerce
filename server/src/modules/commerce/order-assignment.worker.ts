import { logger } from '../../config/logger.js'
import {
  assignNextWaitingOrder,
  endExpiredStaffShifts,
} from './order-assignment.service.js'

const POLL_INTERVAL_MS = 5_000
const BATCH_SIZE = 50

export function startOrderAssignmentWorker() {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let currentRun: Promise<void>

  async function tick() {
    let assigned = 0
    let endedShifts = 0
    try {
      endedShifts = await endExpiredStaffShifts()
      while (!stopped && assigned < BATCH_SIZE) {
        if (!(await assignNextWaitingOrder())) break
        assigned += 1
      }
      if (assigned > 0)
        logger.info({ assigned }, 'Waiting orders automatically assigned')
      if (endedShifts > 0)
        logger.info({ endedShifts }, 'Expired staff shifts ended')
    } catch (err) {
      logger.error(
        { err },
        'Order assignment failed; waiting orders will be retried',
      )
    } finally {
      if (!stopped)
        timer = setTimeout(
          () => {
            currentRun = tick()
          },
          assigned === BATCH_SIZE || endedShifts === BATCH_SIZE
            ? 100
            : POLL_INTERVAL_MS,
        ).unref()
    }
  }

  currentRun = tick()
  return async () => {
    stopped = true
    if (timer) clearTimeout(timer)
    await currentRun
  }
}
