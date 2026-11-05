import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../db/schema.js'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Bound both connection establishment and waits for a free pool client.
  connectionTimeoutMillis: 10_000,
})

export const db = drizzle(pool, { schema })
