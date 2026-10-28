import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import { db } from '../config/db.js'
import { adminAuth, auth } from '../modules/auth/auth.js'
import { resolveActor } from '../modules/commerce/commerce.persistence.js'

export interface AuthenticatedRequest extends Request {
  user?: typeof auth.$Infer.Session.user
  session?: typeof auth.$Infer.Session.session
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return authenticate(auth, req, res, next)
}

export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return authenticate(adminAuth, req, res, next, true)
}

async function authenticate(
  instance: typeof auth | typeof adminAuth,
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  staff = false,
): Promise<void> {
  try {
    const session = await instance.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })

    if (!session) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      })
      return
    }

    if (staff)
      await db.transaction((tx) =>
        resolveActor(tx, session.user.id, 'workforce'),
      )

    req.user = session.user
    req.session = session.session
    next()
  } catch (error) {
    next(error)
  }
}
