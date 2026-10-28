import type { OrderDetail } from './types'

export const orderStages = [
  'placed',
  'confirmed',
  'packing',
  'shipped',
  'delivered',
  'completed',
] as const

export type OrderStage = (typeof orderStages)[number]
type StageState = 'done' | 'current' | 'corrected' | 'upcoming'
type HistoryEvent = OrderDetail['history'][number]

const milestones: Record<string, OrderStage> = {
  order_placed: 'placed',
  order_confirmed: 'confirmed',
  order_packing: 'packing',
  shipment_handed_over: 'shipped',
  order_delivered: 'delivered',
  shipment_delivered: 'delivered',
  order_completed: 'completed',
}

const relatedEvents: Record<string, OrderStage> = {
  recipient_changed: 'placed',
  order_assigned: 'placed',
  bank_deadline_reconciled: 'confirmed',
  shipment_carrier_identified: 'shipped',
  shipment_carrier_corrected: 'shipped',
  cod_carrier_corrected: 'shipped',
  delivery_failed: 'shipped',
  delivery_retried: 'shipped',
  delivery_retry_started: 'shipped',
  undelivered_shipment_received: 'shipped',
  payment_recorded: 'completed',
  payment_receipt_recorded: 'completed',
  customer_paid_carrier: 'completed',
  cod_collection_resolved: 'completed',
  cod_collection_failed: 'completed',
  cod_collection_adjusted: 'completed',
  carrier_responsibility_corrected: 'completed',
}

const undoActions: Record<string, OrderStage> = {
  confirmation: 'confirmed',
  packing: 'packing',
  handover: 'shipped',
  delivery: 'delivered',
}

function isStage(value: unknown): value is OrderStage {
  return orderStages.some((stage) => stage === value)
}

export function orderProgressModel(
  order: OrderDetail,
  audience: 'staff' | 'customer',
) {
  const events = [...order.history].sort(
    (first, second) =>
      Date.parse(first.createdAt) - Date.parse(second.createdAt),
  )
  const recorded = new Map<OrderStage, HistoryEvent>()
  const reached = new Set<OrderStage>(['placed'])
  const history = new Map(
    orderStages.map((stage) => [stage, [] as HistoryEvent[]]),
  )
  let lastStage: OrderStage = 'placed'
  for (const event of events) {
    const milestone = milestones[event.type]
    const stage = milestone ?? relatedEvents[event.type]
    if (stage) history.get(stage)?.push(event)
    if (milestone) {
      recorded.set(milestone, event)
      reached.add(milestone)
      lastStage = milestone
    }
    if (event.type === 'order_step_undone') {
      const previous = event.details?.previousStatus
      const next = event.details?.nextStatus
      const action = event.details?.action
      const corrected =
        typeof action === 'string' ? undoActions[action] : undefined
      const affected = new Set([previous, next, corrected].filter(isStage))
      if (isStage(previous) && isStage(next)) {
        for (const invalidated of orderStages.slice(
          orderStages.indexOf(next) + 1,
          orderStages.indexOf(previous) + 1,
        ))
          affected.add(invalidated)
      }
      for (const affectedStage of affected)
        history.get(affectedStage)?.push(event)
      if (isStage(previous)) {
        for (const passed of orderStages.slice(
          0,
          orderStages.indexOf(previous) + 1,
        ))
          reached.add(passed)
      }
      if (isStage(next)) {
        // Preserve audit entries, but never present an undone milestone as an
        // active acknowledgement or reuse its delivery proof in the summary.
        for (const invalidated of orderStages.slice(
          orderStages.indexOf(next) + 1,
        ))
          recorded.delete(invalidated)
        lastStage = next
      }
    }
    if (event.type === 'cod_collection_failures_corrected') {
      history.get('delivered')?.push(event)
      history.get('completed')?.push(event)
    }
    if (event.type === 'order_cancelled') history.get(lastStage)?.push(event)
  }
  const cancelled = order.status === 'cancelled'
  // An existing shipment still proves handover when older audit entries are
  // missing, including an undelivered shipment returned before cancellation.
  if (
    cancelled &&
    order.shipment &&
    orderStages.indexOf(lastStage) < orderStages.indexOf('shipped')
  )
    lastStage = 'shipped'
  const status = isStage(order.status) ? order.status : lastStage
  const activeStage =
    audience === 'customer' && status === 'completed' ? 'delivered' : status
  const visibleStages = orderStages.filter(
    (stage) => audience === 'staff' || stage !== 'completed',
  )
  const activeIndex = visibleStages.indexOf(activeStage)
  const finished =
    !cancelled &&
    (order.status === 'completed' ||
      (audience === 'customer' && order.status === 'delivered'))
  return {
    activeStage,
    activeIndex,
    cancelled,
    finished,
    visibleStages,
    recorded,
    history,
    canView: (stage: OrderStage) =>
      visibleStages.includes(stage) &&
      (visibleStages.indexOf(stage) <= activeIndex || reached.has(stage)),
    state: (stage: OrderStage): StageState => {
      const index = visibleStages.indexOf(stage)
      if (
        index < activeIndex ||
        (index === activeIndex && (finished || cancelled))
      )
        return 'done'
      if (index === activeIndex) return 'current'
      return reached.has(stage) ? 'corrected' : 'upcoming'
    },
  }
}
