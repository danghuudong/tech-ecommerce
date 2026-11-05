import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { productStoreAvailability, stores } from '../../db/schema.js'
import type {
  StoreAvailabilityInput,
  StoreCreateInput,
  StoreUpdateInput,
} from './commerce.contracts.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
} from './commerce.persistence.js'
import { lockProducts } from './inventory.service.js'

export async function listStores(userId: string) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    return {
      items: await tx
        .select()
        .from(stores)
        .orderBy(asc(stores.province), asc(stores.name)),
    }
  })
}

export function createStore(command: Command, input: StoreCreateInput) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    const [store] = await tx
      .insert(stores)
      .values(input)
      .returning({ id: stores.id })
    if (!store) fail(503, 'STORE_UNAVAILABLE', 'Store could not be created')
    return { storeId: store.id }
  })
}

export function updateStore(
  command: Command,
  storeId: string,
  input: StoreUpdateInput,
) {
  return executeCommand({ ...command, permission: 'admin' }, async (tx) => {
    const [store] = await tx
      .update(stores)
      .set({ ...input, updatedAt: sql`clock_timestamp()` })
      .where(eq(stores.id, storeId))
      .returning({ id: stores.id })
    if (!store) fail(404, 'STORE_NOT_FOUND', 'Store was not found')
    return { storeId }
  })
}

export async function staffProductStoreAvailability(
  userId: string,
  productId: string,
) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'staff')
    return {
      items: await tx
        .select({
          storeId: stores.id,
          name: stores.name,
          province: stores.province,
          status: productStoreAvailability.status,
          updatedAt: productStoreAvailability.updatedAt,
        })
        .from(stores)
        .leftJoin(
          productStoreAvailability,
          and(
            eq(productStoreAvailability.storeId, stores.id),
            eq(productStoreAvailability.productId, productId),
          ),
        )
        .where(eq(stores.active, true))
        .orderBy(asc(stores.province), asc(stores.name)),
    }
  })
}

export function setProductStoreAvailability(
  command: Command,
  productId: string,
  storeId: string,
  input: StoreAvailabilityInput,
) {
  return executeCommand(
    { ...command, permission: 'staff' },
    async (tx, actor) => {
      await lockProducts(tx, [productId])
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, storeId))
      if (!store) fail(404, 'STORE_NOT_FOUND', 'Store was not found')
      if (input.status === null) {
        await tx
          .delete(productStoreAvailability)
          .where(
            and(
              eq(productStoreAvailability.productId, productId),
              eq(productStoreAvailability.storeId, storeId),
            ),
          )
        return { productId, storeId }
      }
      const change = {
        status: input.status,
        updatedBy: actor.userId,
        updatedAt: sql`clock_timestamp()`,
      }
      await tx
        .insert(productStoreAvailability)
        .values({ productId, storeId, ...change })
        .onConflictDoUpdate({
          target: [
            productStoreAvailability.productId,
            productStoreAvailability.storeId,
          ],
          set: change,
        })
      return { productId, storeId }
    },
  )
}
