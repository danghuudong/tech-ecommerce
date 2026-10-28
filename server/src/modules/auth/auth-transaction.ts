import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '../../config/db.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const transactions = new AsyncLocalStorage<Transaction>()

// Better Auth captures its adapter at initialization. Resolve the client at each
// query so its own writes and our hooks use the same request transaction.
export const authDatabaseClient = new Proxy(db, {
  get(target, property) {
    const client = transactions.getStore() ?? target
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function requireAuthTransaction() {
  const tx = transactions.getStore()
  if (!tx) throw new Error('Auth operations require an active transaction')
  return tx
}

class FailedAuthResponse extends Error {
  constructor(readonly response: Response) {
    super('Auth response requires transaction rollback')
  }
}

async function runAuthTransaction<T>(operation: () => Promise<T>): Promise<T> {
  if (transactions.getStore()) return operation()

  try {
    return await db.transaction((tx) =>
      transactions.run(tx, async () => {
        const result = await operation()
        // HTTP/asResponse calls turn API errors into responses instead of throws.
        if (result instanceof Response && result.status >= 400)
          throw new FailedAuthResponse(result)
        return result
      }),
    )
  } catch (error) {
    if (!(error instanceof FailedAuthResponse)) throw error
    const headers = new Headers(error.response.headers)
    headers.delete('set-cookie')
    return new Response(error.response.body, {
      status: error.response.status,
      statusText: error.response.statusText,
      headers,
    }) as T
  }
}

type AuthInstance = {
  handler: (request: Request) => Promise<Response>
  fetch: (request: Request) => Promise<Response>
  api: object
}

// Cover both HTTP aliases and server-side API calls, retaining endpoint metadata
// and inference. No success response or replacement cookie leaves before commit.
export function transactionalAuth<T extends AuthInstance>(instance: T): T {
  const handler = (request: Request) =>
    runAuthTransaction(() => instance.handler(request))
  const endpoints = new Map<PropertyKey, unknown>()
  const api = new Proxy(instance.api, {
    get(target, property, receiver) {
      const endpoint = Reflect.get(target, property, receiver)
      if (typeof endpoint !== 'function') return endpoint
      if (!endpoints.has(property))
        endpoints.set(
          property,
          new Proxy(endpoint, {
            apply(target, thisArg, args) {
              return runAuthTransaction(async () =>
                Reflect.apply(target, thisArg, args),
              )
            },
          }),
        )
      return endpoints.get(property)
    },
  })
  return new Proxy(instance, {
    get(target, property, receiver) {
      if (property === 'handler' || property === 'fetch') return handler
      if (property === 'api') return api
      return Reflect.get(target, property, receiver)
    },
  })
}
