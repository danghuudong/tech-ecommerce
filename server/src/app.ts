import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { pool } from './config/db.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { isRedisReady } from './config/redis.js'
import { AppError, errorHandler } from './middlewares/error.middleware.js'
import { createRateLimiter } from './middlewares/rate-limit.middleware.js'
import { adminAuth, auth } from './modules/auth/auth.js'
import { commerceRouter } from './modules/commerce/commerce.routes.js'

export function createApp() {
  const app = express()

  if (env.TRUST_PROXY !== 0) {
    app.set('trust proxy', env.TRUST_PROXY)
  }

  app.use(
    pinoHttp({
      logger,
      genReqId: (req: IncomingMessage) =>
        (req.headers['x-request-id'] as string) || randomUUID(),
    }),
  )
  app.use(helmet())
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      exposedHeaders: [
        'Retry-After',
        'X-Retry-After',
        'RateLimit',
        'RateLimit-Policy',
      ],
    }),
  )

  // Keep container probes independent from public request quotas.
  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'live' })
  })

  app.get('/health/ready', async (_req, res) => {
    let databaseReady = false
    try {
      await pool.query('SELECT 1')
      databaseReady = true
    } catch {
      databaseReady = false
    }

    const redisReady = isRedisReady()
    if (!databaseReady) {
      res.status(503).json({
        status: 'unready',
        database: 'unreachable',
        redis: redisReady ? 'connected' : 'degraded',
      })
      return
    }

    res.status(200).json({
      status: 'ready',
      database: 'connected',
      redis: redisReady ? 'connected' : 'degraded',
    })
  })

  // Session checks and catalog reads share a read quota, independent of writes.
  app.use(
    '/api',
    createRateLimiter({
      windowMs: env.API_RATE_LIMIT_WINDOW_MS,
      limit: env.API_READ_RATE_LIMIT,
      identifier: 'api-read',
      message: 'Too many read requests, please try again later',
      redisPrefix: 'rate-limit:api-read:',
      skip: (request) => !['GET', 'HEAD'].includes(request.method),
    }),
  )

  const authWriteRateLimiter = createRateLimiter({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_WRITE_RATE_LIMIT,
    identifier: 'auth-write',
    message: 'Too many authentication attempts, please try again later',
    redisPrefix: 'rate-limit:auth-write:',
    skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
  })

  // Better Auth must consume the raw body before Express body parsers do.
  app.all('/api/auth/*splat', authWriteRateLimiter, toNodeHandler(auth))
  app.all(
    '/api/admin/auth/*splat',
    authWriteRateLimiter,
    toNodeHandler(adminAuth),
  )

  // Auth handles its own writes before the commerce write quota is applied.
  app.use(
    '/api',
    createRateLimiter({
      windowMs: env.API_RATE_LIMIT_WINDOW_MS,
      limit: env.API_WRITE_RATE_LIMIT,
      identifier: 'api-write',
      message: 'Too many write requests, please try again later',
      redisPrefix: 'rate-limit:api-write:',
      skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  app.use('/api', commerceRouter)

  app.use((_req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found'))
  })
  app.use(errorHandler)

  return app
}
