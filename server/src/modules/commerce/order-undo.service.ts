import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { orderEvents, orders, shipments } from '../../db/schema.js'
import type { orderUndoSchema } from './commerce.contracts.js'
import {
  appendOrderEvent,
  assertOrderAccess,
  type Command,
  databaseNow,
  executeCommand,
  fail,
  getOrderItems,
  lockOrder,
} from './commerce.persistence.js'
import { changeStock } from './inventory.service.js'
import { saveOrderUndoDocument } from './order-undo-document.service.js'
import { orderUndoPolicy, readOrderUndoFacts } from './order-undo-policy.js'
import { paymentSummaryForOrder } from './payment-ledger.js'

export function undoOrderStep(
  command: Command,
  orderId: string,
  input: z.infer<typeof orderUndoSchema>,
) {
  return executeCommand(
    { ...command, permission: 'staff', roleLock: 'shared' },
    async (tx, actor) => {
      const order = await lockOrder(tx, orderId)
      assertOrderAccess(actor, order, true)
      if (order.revision !== input.expectedRevision)
        fail(409, 'ORDER_CHANGED', 'Reload the order before undoing a step')
      const [shipment] = await tx
        .select()
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .for('update')
      const events = await tx
        .select()
        .from(orderEvents)
        .where(eq(orderEvents.orderId, orderId))
        .orderBy(orderEvents.createdAt, orderEvents.id)
      const payment = await paymentSummaryForOrder(tx, order)
      const facts = await readOrderUndoFacts(
        tx,
        order,
        shipment ?? null,
        events,
        payment,
      )
      const now = await databaseNow(tx)
      const policy = orderUndoPolicy(actor, order, facts, now)
      if (!policy || policy.action !== input.action)
        fail(
          409,
          'ORDER_CHANGED',
          'The order is no longer at the selected step',
        )
      if (policy.blockedReason)
        fail(
          policy.blockedReason === 'ORDER_UNDO_ADMIN_REQUIRED' ? 403 : 409,
          policy.blockedReason,
          'Resolve the blocking order activity before undoing this step',
        )

      const renewal =
        input.action === 'confirmation' ? input.confirmationRenewal : undefined
      if (renewal && actor.role !== 'admin')
        fail(
          403,
          'ORDER_UNDO_ADMIN_REQUIRED',
          'Only administrators can renew confirmation',
        )
      if (policy.requiresConfirmationRenewal && !renewal)
        fail(
          409,
          'ORDER_UNDO_RENEWAL_REQUIRED',
          'Approve a new COD confirmation deadline',
        )
      if (
        renewal &&
        (!policy.requiresConfirmationRenewal ||
          !policy.maxConfirmationRenewalHours ||
          renewal.hours > policy.maxConfirmationRenewalHours)
      )
        fail(
          422,
          'ORDER_UNDO_RENEWAL_INVALID',
          'The confirmation renewal is outside policy',
        )
      const confirmationRenewal = renewal
        ? {
            hours: renewal.hours,
            previousExpiresAt:
              facts.confirmationExpiresAt?.toISOString() ?? null,
            expiresAt: new Date(
              now.getTime() + renewal.hours * 3_600_000,
            ).toISOString(),
            approvedBy: actor.userId,
            approvedAt: now.toISOString(),
          }
        : null
      const evidenceDocument =
        input.action === 'handover' || input.action === 'delivery'
          ? await saveOrderUndoDocument(tx, actor, order, input)
          : null

      if (input.action === 'handover' && shipment) {
        for (const item of await getOrderItems(tx, orderId)) {
          // The handover was recorded by mistake and the administrator has
          // verified the goods are still in the warehouse. Compensate both
          // ledger dimensions without deleting the original shipment movement.
          await changeStock(tx, actor, {
            productId: item.productId,
            orderId,
            kind: 'adjustment',
            onHandDelta: item.quantity,
            reservedDelta: 0,
            reason: input.reason,
            reference: shipment.id,
          })
          await changeStock(tx, actor, {
            productId: item.productId,
            orderId,
            kind: 'reserve',
            onHandDelta: 0,
            reservedDelta: item.quantity,
            reason: input.reason,
            reference: shipment.id,
          })
        }
      }
      if (input.action === 'delivery' && shipment) {
        if (!facts.previousShipmentStatus)
          fail(
            409,
            'ORDER_UNDO_HISTORY_REQUIRED',
            'Shipment history is required',
          )
        await tx
          .update(shipments)
          .set({
            status: facts.previousShipmentStatus,
            proofReference: null,
            deliveredAt: null,
            updatedAt: now,
          })
          .where(eq(shipments.id, shipment.id))
      }
      const reservationExpiresAt =
        input.action === 'confirmation' && order.paymentMethod === 'cod'
          ? confirmationRenewal
            ? new Date(confirmationRenewal.expiresAt)
            : facts.confirmationExpiresAt
          : order.reservationExpiresAt
      // Fulfillment already in progress keeps its place in the capacity queue.
      // Waiting for a carrier becomes actionable only at packing or failed delivery.
      const reopensStaffWork =
        input.action === 'handover' ||
        (input.action === 'delivery' &&
          facts.previousShipmentStatus === 'delivery_failed')
      const staffWorkStartedAt = reopensStaffWork
        ? now
        : order.staffWorkStartedAt
      const collectionFailureCorrection = policy.collectionFailuresToCorrect
        ? {
            before: {
              customerFailureCount: order.collectionFailureCount,
              customerIssueReason: order.collectionIssueReason,
              carrierFailureCount: order.carrierCollectionFailureCount,
              carrierIssueReason: order.carrierCollectionIssueReason,
            },
            after: {
              customerFailureCount: 0,
              customerIssueReason: null,
              carrierFailureCount: 0,
              carrierIssueReason: null,
            },
          }
        : null
      await tx
        .update(orders)
        .set({
          status: policy.targetStatus,
          stockState:
            input.action === 'handover' ? 'reserved' : order.stockState,
          reservationExpiresAt,
          deliveredAt: null,
          completedAt: null,
          staffWorkStartedAt,
          ...(collectionFailureCorrection
            ? {
                collectionFailureCount: 0,
                collectionIssueReason: null,
                carrierCollectionFailureCount: 0,
                carrierCollectionIssueReason: null,
              }
            : {}),
          revision: order.revision + 1,
          updatedAt: now,
        })
        .where(eq(orders.id, orderId))
      await appendOrderEvent(tx, actor, orderId, 'order_step_undone', {
        action: input.action,
        previousStatus: order.status,
        nextStatus: policy.targetStatus,
        previousRevision: order.revision,
        revision: order.revision + 1,
        reason: input.reason,
        evidenceDocument,
        evidenceVerification: evidenceDocument
          ? {
              documentStored: true,
              attestedBy: actor.userId,
              attestedAt: now.toISOString(),
            }
          : null,
        goodsInWarehouse:
          input.action === 'handover' ? input.goodsInWarehouse : null,
        deliveryRecordedIncorrectly:
          input.action === 'delivery'
            ? input.deliveryRecordedIncorrectly
            : null,
        previousDeliveredAt: order.deliveredAt?.toISOString() ?? null,
        previousCompletedAt: order.completedAt?.toISOString() ?? null,
        previousStaffWorkStartedAt:
          order.staffWorkStartedAt?.toISOString() ?? null,
        staffWorkStartedAt: staffWorkStartedAt?.toISOString() ?? null,
        previousReservationExpiresAt:
          order.reservationExpiresAt?.toISOString() ?? null,
        reservationExpiresAt: reservationExpiresAt?.toISOString() ?? null,
        originalConfirmationExpiresAt: policy.originalConfirmationExpiresAt,
        confirmationRenewal,
        previousShipment: shipment
          ? {
              ...shipment,
              createdAt: shipment.createdAt.toISOString(),
              updatedAt: shipment.updatedAt.toISOString(),
              deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
              returnedAt: shipment.returnedAt?.toISOString() ?? null,
            }
          : null,
        restoredShipmentStatus:
          input.action === 'delivery' ? facts.previousShipmentStatus : null,
      })
      if (collectionFailureCorrection) {
        await appendOrderEvent(
          tx,
          actor,
          orderId,
          'cod_collection_failures_corrected',
          {
            ...collectionFailureCorrection,
            reason: input.reason,
            evidenceDocument,
            shipmentId: shipment?.id ?? null,
            previousDeliveredAt: order.deliveredAt?.toISOString() ?? null,
            previousRevision: order.revision,
            revision: order.revision + 1,
            correction: 'incorrect_delivery_acknowledgement',
          },
        )
      }
      if (input.action === 'handover' && shipment) {
        // Keep the invalid document's full snapshot in the immutable event
        // above. Removing only its active projection permits a new handover.
        await tx.delete(shipments).where(eq(shipments.id, shipment.id))
      }
      return {
        orderId,
        status: policy.targetStatus,
        revision: order.revision + 1,
      }
    },
  )
}
