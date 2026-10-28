import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { env } from '../../config/env.js'
import * as schema from '../../db/schema.js'
import { resolveActor } from '../commerce/commerce.persistence.js'
import {
  authDatabaseClient,
  requireAuthTransaction,
  transactionalAuth,
} from './auth-transaction.js'
import {
  revokeAccountSessions,
  revokeOtherAccountSessions,
  type SessionScope,
} from './session-revocation.js'

const sharedOptions = {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CLIENT_ORIGIN],
  user: {
    additionalFields: {
      role: {
        type: ['customer', 'staff', 'accountant', 'admin'],
        defaultValue: 'customer',
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  session: { cookieCache: { enabled: false } },
} satisfies BetterAuthOptions

const accountSecurityPaths = new Set([
  '/change-password',
  '/revoke-sessions',
  '/revoke-other-sessions',
])

function accountSessionHooks(scope: SessionScope) {
  return {
    before: createAuthMiddleware(async (ctx) => {
      const tx = requireAuthTransaction()
      if (
        ctx.path === '/sign-in/email' &&
        typeof ctx.body?.email === 'string'
      ) {
        // Keep credential verification and session creation on the same side of
        // password changes, account-wide revocation and role downgrades.
        await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, ctx.body.email.toLowerCase()))
          .for('share')
      } else if (accountSecurityPaths.has(ctx.path)) {
        const current = await getSessionFromCtx(ctx, {
          disableCookieCache: true,
          disableRefresh: true,
        })
        if (current)
          await tx
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, current.user.id))
            .for('update')
        // Sensitive middleware must revalidate after waiting for the lock.
        ctx.context.session = null
      }
      // Account-wide revocation must cross both stores. Single-session sign-out
      // keeps using Better Auth's scoped deleteSession implementation.
      return {
        context: {
          context: {
            internalAdapter: {
              ...ctx.context.internalAdapter,
              deleteUserSessions: async (userId: string) => {
                await tx
                  .select({ id: schema.user.id })
                  .from(schema.user)
                  .where(eq(schema.user.id, userId))
                  .for('update')
                await revokeAccountSessions(tx, userId)
              },
            },
          },
        },
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path !== '/revoke-other-sessions' ||
        isAPIError(ctx.context.returned)
      )
        return
      const current = ctx.context.session
      if (!current) throw new APIError('UNAUTHORIZED')
      // Better Auth deletes individual sessions on this route, bypassing
      // deleteUserSessions. Complete both stores before the shared commit.
      await revokeOtherAccountSessions(
        requireAuthTransaction(),
        current.user.id,
        { scope, id: current.session.id },
      )
    }),
  } satisfies BetterAuthOptions['hooks']
}

function authDatabase(
  sessionTable: typeof schema.session | typeof schema.adminSession,
) {
  return drizzleAdapter(authDatabaseClient, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: sessionTable,
      account: schema.account,
      verification: schema.verification,
    },
  })
}

// Existing sessions remain storefront sessions; administration always signs in separately.
export const auth = transactionalAuth(
  betterAuth({
    ...sharedOptions,
    database: authDatabase(schema.session),
    basePath: '/api/auth',
    hooks: accountSessionHooks('customer'),
  }),
)

export const adminAuth = transactionalAuth(
  betterAuth({
    ...sharedOptions,
    database: authDatabase(schema.adminSession),
    baseURL: new URL('/api/admin/auth', env.BETTER_AUTH_URL).toString(),
    basePath: '/api/admin/auth',
    advanced: { cookiePrefix: 'techviet-admin' },
    emailAndPassword: { enabled: true, disableSignUp: true },
    hooks: accountSessionHooks('admin'),
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const actor = await resolveActor(
              requireAuthTransaction(),
              session.userId,
              'signed_in',
              true,
            )
            if (actor.role === 'customer')
              throw new APIError('FORBIDDEN', {
                code: 'STAFF_ACCESS_REQUIRED',
                message: 'Staff access is required',
              })
          },
        },
      },
    },
  }),
)
