import { createClient } from 'redis'
import { env } from './env.js'
import { logger } from './logger.js'

export const redisClient = createClient({
  url: env.REDIS_URL,
})

redisClient.on('error', (err) => {
  logger.warn({ err }, 'Redis client connection warning')
})

export async function connectRedis(): Promise<boolean> {
  if (redisClient.isReady) {
    return true
  }

  if (redisClient.isOpen) {
    logger.warn('Redis socket is open but not ready; using degraded mode')
    return false
  }

  try {
    await redisClient.connect()
    logger.info('Connected to Redis')
    return redisClient.isReady
  } catch (err) {
    logger.warn(
      { err },
      'Redis connection failed; operating in degraded mode without Redis',
    )
    return false
  }
}

export function isRedisReady(): boolean {
  return redisClient.isReady
}
