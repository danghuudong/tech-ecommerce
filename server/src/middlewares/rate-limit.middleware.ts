import type { Request } from 'express'
import rateLimit from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { isRedisReady, redisClient } from '../config/redis.js'

interface RateLimiterOptions {
  windowMs: number
  limit: number
  identifier: string
  message?: string
  redisPrefix: string
  skip?: (request: Request) => boolean
}

export function createRateLimiter(options: RateLimiterOptions) {
  const store = isRedisReady()
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
        prefix: options.redisPrefix,
      })
    : undefined

  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    identifier: options.identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    skip: (request) =>
      request.method === 'OPTIONS' || (options.skip?.(request) ?? false),
    // Redis is optional: keep the API available if its remote counter fails.
    passOnStoreError: store !== undefined,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: options.message || 'Too many requests, please try again later',
      },
    },
  })
}
