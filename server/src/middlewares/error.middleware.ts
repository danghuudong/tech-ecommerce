import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { logger } from '../config/logger.js'

export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly fieldErrors?: Record<string, string[]>

  constructor(
    statusCode: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    if (fieldErrors) {
      this.fieldErrors = fieldErrors
    }
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    _next(err)
    return
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      },
    })
    return
  }

  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of err.issues) {
      const path = issue.path.join('.') || 'root'
      const errors = fieldErrors[path] ?? []
      errors.push(issue.message)
      fieldErrors[path] = errors
    }

    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        fieldErrors,
      },
    })
    return
  }

  let databaseCode: string | undefined
  let cause: unknown = err
  for (
    let depth = 0;
    depth < 5 && cause && typeof cause === 'object';
    depth++
  ) {
    if ('code' in cause && typeof cause.code === 'string')
      databaseCode = cause.code
    cause = 'cause' in cause ? cause.cause : undefined
  }
  if (databaseCode === '23505') {
    res.status(409).json({
      error: {
        code: 'DUPLICATE_REFERENCE',
        message: 'A unique business reference is already in use',
      },
    })
    return
  }
  if (databaseCode === '23503') {
    res.status(409).json({
      error: {
        code: 'REFERENCE_UNAVAILABLE',
        message: 'A referenced resource is no longer available',
      },
    })
    return
  }
  if (
    databaseCode &&
    [
      '40001',
      '40P01',
      '55P03',
      '57014',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      '57P01',
      '53300',
    ].includes(databaseCode)
  ) {
    res
      .set('Retry-After', '1')
      .status(503)
      .json({
        error: {
          code: 'DATABASE_RETRY_REQUIRED',
          message:
            'Database operation is unavailable; retry with the same Idempotency-Key',
        },
      })
    return
  }
  if (err && typeof err === 'object' && 'type' in err) {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must contain valid JSON',
        },
      })
      return
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the supported size',
        },
      })
      return
    }
  }
  // ORM errors may embed SQL parameters containing recipients or credentials.
  logger.error(
    {
      errorName: err instanceof Error ? err.name : 'UnknownError',
      databaseCode,
      requestId: _req.id,
    },
    'Unhandled application error',
  )
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred',
    },
  })
}
