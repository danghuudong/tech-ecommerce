import { createApp } from './app.js'
import { pool } from './config/db.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { connectRedis, redisClient } from './config/redis.js'
import { startOrderAssignmentWorker } from './modules/commerce/order-assignment.worker.js'
import { startReservationExpiryWorker } from './modules/commerce/reservation.worker.js'

async function startServer() {
  await connectRedis()
  const app = createApp()
  const stopReservationExpiry = startReservationExpiryWorker()
  const stopOrderAssignment = startOrderAssignmentWorker()

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      'Server started successfully',
    )
  })

  async function shutdown(signal: string) {
    logger.info({ signal }, 'Graceful shutdown initiated')
    server.close(async () => {
      try {
        await Promise.all([stopReservationExpiry(), stopOrderAssignment()])
        await pool.end()
        if (redisClient.isOpen) {
          await redisClient.quit()
        }
        logger.info('Application dependencies closed')
      } catch (err) {
        logger.error({ err }, 'Error during graceful shutdown')
      }
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

startServer().catch((err) => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})
