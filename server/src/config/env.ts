import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const localEnvironment = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(localEnvironment)) process.loadEnvFile(localEnvironment)

const optionalSetting = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).max(200).optional(),
)

const nodeEnvSchema = z
  .enum(['development', 'production', 'test'])
  .default('development')

const nodeEnv = nodeEnvSchema.parse(process.env.NODE_ENV)

const databaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    'DATABASE_URL must use the postgres or postgresql protocol',
  )

const redisUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
    'REDIS_URL must use the redis or rediss protocol',
  )

const publicUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'URL must use the http or https protocol',
  )

const developmentSecret = 'development_secret_minimum_32_characters_long'
const unsafeProductionSecrets = new Set([
  developmentSecret,
  'replace_with_a_secure_random_secret_at_least_32_characters_long',
])

const rateLimitWindowSchema = z.coerce.number().int().min(1_000).max(86_400_000)
const rateLimitCountSchema = z.coerce.number().int().min(1).max(1_000_000)
const trustProxySchema = z
  .union([z.literal('loopback'), z.coerce.number().int().min(0).max(10)])
  .default(nodeEnv === 'development' ? 'loopback' : 0)

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
    TRUST_PROXY: trustProxySchema,
    API_RATE_LIMIT_WINDOW_MS: rateLimitWindowSchema.default(60_000),
    API_READ_RATE_LIMIT: rateLimitCountSchema.default(300),
    API_WRITE_RATE_LIMIT: rateLimitCountSchema.default(60),
    AUTH_RATE_LIMIT_WINDOW_MS: rateLimitWindowSchema.default(15 * 60 * 1000),
    AUTH_WRITE_RATE_LIMIT: rateLimitCountSchema.default(20),
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    BETTER_AUTH_URL: publicUrlSchema,
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    CLIENT_ORIGIN: publicUrlSchema,
    ORDER_SHIPPING_FEE_VND: z.coerce
      .number()
      .int()
      .min(0)
      .max(9_999_999_999)
      .default(30_000),
    ORDER_FREE_SHIPPING_THRESHOLD_VND: z.coerce
      .number()
      .int()
      .min(1)
      .max(9_999_999_999)
      .default(500_000),
    ORDER_BANK_RESERVATION_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(30),
    ORDER_COD_CONFIRMATION_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    ORDER_BANK_RECONCILIATION_SLA_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(2),
    ORDER_MAX_PENDING_PER_CUSTOMER: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(3),
    ORDER_ASSIGNMENT_QUEUE_SLA_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(5),
    ORDER_ASSIGNMENT_DEADLINE_WARNING_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(10),
    ORDER_ADMIN_USER_IDS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ORDER_BANK_NAME: optionalSetting,
    ORDER_BANK_ACCOUNT_NUMBER: optionalSetting,
    ORDER_BANK_ACCOUNT_HOLDER: optionalSetting,
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') {
      return
    }

    if (unsafeProductionSecrets.has(value.BETTER_AUTH_SECRET)) {
      context.addIssue({
        code: 'custom',
        message: 'BETTER_AUTH_SECRET must be replaced in production',
        path: ['BETTER_AUTH_SECRET'],
      })
    }

    for (const key of ['BETTER_AUTH_URL', 'CLIENT_ORIGIN'] as const) {
      if (new URL(value[key]).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          message: `${key} must use HTTPS in production`,
          path: [key],
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

const useDevelopmentDefaults = nodeEnv !== 'production'

export const env: Env = envSchema.parse({
  NODE_ENV: nodeEnv,
  PORT: process.env.PORT,
  TRUST_PROXY: process.env.TRUST_PROXY,
  API_RATE_LIMIT_WINDOW_MS: process.env.API_RATE_LIMIT_WINDOW_MS,
  API_READ_RATE_LIMIT: process.env.API_READ_RATE_LIMIT,
  API_WRITE_RATE_LIMIT: process.env.API_WRITE_RATE_LIMIT,
  AUTH_RATE_LIMIT_WINDOW_MS: process.env.AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_WRITE_RATE_LIMIT: process.env.AUTH_WRITE_RATE_LIMIT,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    (useDevelopmentDefaults
      ? 'postgresql://postgres:postgres@localhost:5432/tech_ecommerce'
      : undefined),
  REDIS_URL:
    process.env.REDIS_URL ??
    (useDevelopmentDefaults ? 'redis://localhost:6379' : undefined),
  BETTER_AUTH_URL:
    process.env.BETTER_AUTH_URL ??
    (useDevelopmentDefaults ? 'http://localhost:5000' : undefined),
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ??
    (useDevelopmentDefaults ? developmentSecret : undefined),
  CLIENT_ORIGIN:
    process.env.CLIENT_ORIGIN ??
    (useDevelopmentDefaults ? 'http://localhost:5173' : undefined),
  ORDER_SHIPPING_FEE_VND: process.env.ORDER_SHIPPING_FEE_VND,
  ORDER_FREE_SHIPPING_THRESHOLD_VND:
    process.env.ORDER_FREE_SHIPPING_THRESHOLD_VND,
  ORDER_BANK_RESERVATION_MINUTES: process.env.ORDER_BANK_RESERVATION_MINUTES,
  ORDER_BANK_RECONCILIATION_SLA_HOURS:
    process.env.ORDER_BANK_RECONCILIATION_SLA_HOURS,
  ORDER_COD_CONFIRMATION_HOURS: process.env.ORDER_COD_CONFIRMATION_HOURS,
  ORDER_MAX_PENDING_PER_CUSTOMER: process.env.ORDER_MAX_PENDING_PER_CUSTOMER,
  ORDER_ASSIGNMENT_QUEUE_SLA_MINUTES:
    process.env.ORDER_ASSIGNMENT_QUEUE_SLA_MINUTES,
  ORDER_ASSIGNMENT_DEADLINE_WARNING_MINUTES:
    process.env.ORDER_ASSIGNMENT_DEADLINE_WARNING_MINUTES,
  ORDER_ADMIN_USER_IDS: process.env.ORDER_ADMIN_USER_IDS,
  ORDER_BANK_NAME: process.env.ORDER_BANK_NAME,
  ORDER_BANK_ACCOUNT_NUMBER: process.env.ORDER_BANK_ACCOUNT_NUMBER,
  ORDER_BANK_ACCOUNT_HOLDER: process.env.ORDER_BANK_ACCOUNT_HOLDER,
})
