import type { QueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

export type SessionScope = 'customer' | 'admin'

export const SessionScopeContext = createContext<SessionScope>('customer')

export const sessionKeys = {
  customer: ['session', 'customer'],
  admin: ['session', 'admin'],
} as const

export const commerceKeys = {
  customer: ['commerce', 'customer'],
  admin: ['commerce', 'admin'],
} as const

export function useSessionScope() {
  return useContext(SessionScopeContext)
}

export async function resetSessionQueries(
  client: QueryClient,
  scope: SessionScope,
) {
  await Promise.all([
    client.cancelQueries({ queryKey: sessionKeys[scope] }),
    client.cancelQueries({ queryKey: commerceKeys[scope] }),
  ])
  client.removeQueries({ queryKey: commerceKeys[scope] })
  await client.resetQueries({ queryKey: sessionKeys[scope], exact: true })
}
