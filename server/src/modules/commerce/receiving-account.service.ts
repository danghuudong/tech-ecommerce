import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../config/db.js'
import { payments, receivingAccounts, receivingBanks } from '../../db/schema.js'
import type {
  ReceivingAccountCreateInput,
  ReceivingAccountListInput,
} from './commerce.contracts.js'
import {
  type Command,
  executeCommand,
  fail,
  resolveActor,
  type Transaction,
} from './commerce.persistence.js'

export function createReceivingAccount(
  command: Command,
  input: ReceivingAccountCreateInput,
) {
  return executeCommand(
    { ...command, permission: 'admin' },
    async (tx, actor) => {
      const bank =
        input.channel === 'bank_transfer'
          ? (
              await tx
                .select()
                .from(receivingBanks)
                .where(eq(receivingBanks.bin, input.providerCode))
            )[0]
          : null
      if (input.channel === 'bank_transfer' && !bank)
        fail(
          422,
          'UNSUPPORTED_RECEIVING_BANK',
          'Select a bank from the supported directory',
        )
      const [account] = await tx
        .insert(receivingAccounts)
        .values({
          ...input,
          bankBin: bank?.bin ?? null,
          createdBy: actor.userId,
        })
        .onConflictDoNothing()
        .returning({
          id: receivingAccounts.id,
          channel: receivingAccounts.channel,
          providerCode: receivingAccounts.providerCode,
          accountReference: receivingAccounts.accountReference,
          name: receivingAccounts.name,
        })
      if (!account)
        fail(
          409,
          'RECEIVING_ACCOUNT_EXISTS',
          'Receiving account is already registered',
        )
      return {
        receivingAccountId: account.id,
        receivingAccount: { ...account, bank: bank ?? null },
      }
    },
  )
}

export function listReceivingAccounts(
  userId: string,
  input: ReceivingAccountListInput,
) {
  return db.transaction(
    async (tx) => {
      await resolveActor(tx, userId, 'accountant')
      const term = input.q?.replace(/[\\%_]/g, '\\$&')
      const filter = and(
        input.channel
          ? eq(receivingAccounts.channel, input.channel)
          : undefined,
        term
          ? or(
              ilike(receivingAccounts.name, `%${term}%`),
              ilike(receivingAccounts.accountReference, `%${term}%`),
              ilike(receivingAccounts.providerCode, `%${term}%`),
              ilike(receivingBanks.code, `%${term}%`),
              ilike(receivingBanks.shortName, `%${term}%`),
              ilike(receivingBanks.name, `%${term}%`),
            )
          : undefined,
      )
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(receivingAccounts)
        .leftJoin(
          receivingBanks,
          eq(receivingBanks.bin, receivingAccounts.bankBin),
        )
        .where(filter)
      return {
        items: await tx
          .select({
            id: receivingAccounts.id,
            channel: receivingAccounts.channel,
            providerCode: receivingAccounts.providerCode,
            accountReference: receivingAccounts.accountReference,
            name: receivingAccounts.name,
            bankBin: receivingAccounts.bankBin,
            createdBy: receivingAccounts.createdBy,
            createdAt: receivingAccounts.createdAt,
            bank: receivingBanks,
          })
          .from(receivingAccounts)
          .leftJoin(
            receivingBanks,
            eq(receivingBanks.bin, receivingAccounts.bankBin),
          )
          .where(filter)
          .orderBy(
            receivingAccounts.channel,
            receivingAccounts.providerCode,
            receivingAccounts.accountReference,
            receivingAccounts.id,
          )
          .limit(input.limit)
          .offset(input.offset),
        ...input,
        total: count?.total ?? 0,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export function listReceivingBanks(userId: string) {
  return db.transaction(async (tx) => {
    await resolveActor(tx, userId, 'accountant')
    return {
      items: await tx
        .select()
        .from(receivingBanks)
        .orderBy(receivingBanks.shortName, receivingBanks.bin),
    }
  })
}

// Also serialize unidentified historic receipts, whose receiving account is unknown.
// This lock always precedes order locks, including administrator reconciliation.
export async function lockMerchantReceiptIdentity(
  tx: Transaction,
  reference: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(7348024, hashtext(${reference}))`,
  )
}

export async function getReceivingAccount(tx: Transaction, accountId: string) {
  const [account] = await tx
    .select()
    .from(receivingAccounts)
    .where(eq(receivingAccounts.id, accountId))
  if (!account)
    fail(404, 'RECEIVING_ACCOUNT_NOT_FOUND', 'Receiving account was not found')
  return account
}

export async function findMerchantReceipt(
  tx: Transaction,
  accountId: string,
  reference: string,
) {
  await getReceivingAccount(tx, accountId)
  const [existing] = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.receivingAccountId, accountId),
        eq(payments.reference, reference),
        eq(payments.receiptReconciliationRequired, false),
        isNull(payments.duplicateOfId),
      ),
    )
  if (existing) return existing
  const [unidentified] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reference, reference),
        eq(payments.receiptReconciliationRequired, true),
        isNull(payments.duplicateOfId),
      ),
    )
    .limit(1)
  if (unidentified)
    fail(
      409,
      'RECEIPT_IDENTITY_RECONCILIATION_REQUIRED',
      'Administrator must identify historic receipts with this reference before recording new merchant cash',
    )
  return undefined
}
