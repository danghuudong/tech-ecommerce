import ky, { HTTPError, type KyInstance } from 'ky'
import { z } from 'zod'

const apiErrorPayloadSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
})
const authErrorPayloadSchema = z.object({
  code: z.string().min(1).optional(),
  message: z.string().min(1),
})

const apiBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      if (value.startsWith('/')) {
        return !value.startsWith('//')
      }

      try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
      } catch {
        return false
      }
    },
    { message: 'VITE_API_BASE_URL must be a relative path or an HTTP(S) URL' },
  )

export type ApiErrorPayload = z.infer<typeof apiErrorPayloadSchema>

export class ApiError extends Error {
  readonly code: string
  readonly fieldErrors?: Record<string, string[]>
  readonly status: number
  readonly retryAt?: number

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
    retryAt?: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.retryAt = retryAt
  }
}

const prefix = apiBaseUrlSchema.parse(
  import.meta.env.VITE_API_BASE_URL ?? '/api',
)

type RateLimitScope = 'api-read' | 'api-write' | 'auth-write'
const rateLimitResets = new Map<RateLimitScope, number>()

function requestScope(request: Request): RateLimitScope {
  if (['GET', 'HEAD'].includes(request.method)) return 'api-read'
  return new URL(request.url).pathname.includes('/auth/')
    ? 'auth-write'
    : 'api-write'
}

function retryTime(response: Response) {
  const value = (
    response.headers.get('Retry-After') ?? response.headers.get('X-Retry-After')
  )?.trim()
  if (value) {
    const delay = /^\d+$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now()
    if (Number.isFinite(delay) && delay >= 0)
      return Date.now() + Math.max(1000, delay)
  }
  return Date.now() + 60_000
}

export const api: KyInstance = ky.create({
  prefix,
  credentials: 'include',
  retry: 0,
  hooks: {
    beforeRequest: [
      ({ request }) => {
        const scope = requestScope(request)
        const retryAt = rateLimitResets.get(scope)
        if (retryAt && retryAt > Date.now()) {
          throw new ApiError(
            429,
            'RATE_LIMIT_EXCEEDED',
            'Request quota temporarily exhausted',
            undefined,
            retryAt,
          )
        }
        rateLimitResets.delete(scope)
      },
    ],
    afterResponse: [
      ({ request, response }) => {
        if (response.status === 429) {
          const scope = requestScope(request)
          rateLimitResets.set(
            scope,
            Math.max(rateLimitResets.get(scope) ?? 0, retryTime(response)),
          )
        }
      },
    ],
    beforeError: [
      ({ error }) => {
        if (error instanceof HTTPError && error.response) {
          const retryAt =
            error.response.status === 429
              ? rateLimitResets.get(requestScope(error.request))
              : undefined
          // Ky consumes the response body before this hook and stores it in data.
          const payload: unknown = error.data
          const body = apiErrorPayloadSchema.safeParse(payload)

          if (body.success) {
            return new ApiError(
              error.response.status,
              body.data.error.code,
              body.data.error.message,
              body.data.error.fieldErrors,
              retryAt,
            )
          }
          const authError = authErrorPayloadSchema.safeParse(payload)
          if (authError.success) {
            return new ApiError(
              error.response.status,
              authError.data.code ?? 'AUTH_ERROR',
              authError.data.message,
              undefined,
              retryAt,
            )
          }

          return new ApiError(
            error.response.status,
            'HTTP_ERROR',
            error.message,
            undefined,
            retryAt,
          )
        }

        return error
      },
    ],
  },
})
