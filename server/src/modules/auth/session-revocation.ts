import { and, eq, ne } from 'drizzle-orm'
import type { db } from '../../config/db.js'
import { adminSession, session } from '../../db/schema.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type SessionScope = 'customer' | 'admin'

export async function revokeAdminSessions(tx: Transaction, userId: string) {
  await tx.delete(adminSession).where(eq(adminSession.userId, userId))
}

export async function revokeAccountSessions(tx: Transaction, userId: string) {
  await tx.delete(session).where(eq(session.userId, userId))
  await revokeAdminSessions(tx, userId)
}

export async function revokeOtherAccountSessions(
  tx: Transaction,
  userId: string,
  current: { scope: SessionScope; id: string },
) {
  await tx
    .delete(session)
    .where(
      and(
        eq(session.userId, userId),
        current.scope === 'customer' ? ne(session.id, current.id) : undefined,
      ),
    )
  await tx
    .delete(adminSession)
    .where(
      and(
        eq(adminSession.userId, userId),
        current.scope === 'admin' ? ne(adminSession.id, current.id) : undefined,
      ),
    )
}
