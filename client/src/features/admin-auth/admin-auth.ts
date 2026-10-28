import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { z } from 'zod'
import { ApiError, api } from '@/shared/api/client'
import { getSession, read } from '../commerce/api'
import { resetSessionQueries } from '../commerce/session-scope'
import type { Role } from '../commerce/types'

const accountKey = ['admin-account'] as const
const actorSchema = z.object({
  userId: z.string(),
  role: z.enum(['customer', 'staff', 'accountant', 'admin']),
})
const staffPaths = new Set([
  '/staff/orders',
  '/staff/fulfillment',
  '/staff/payments',
  '/staff/returns',
  '/staff/team',
  '/staff/receiving-accounts',
])

interface Credentials {
  email: string
  password: string
  rememberMe: boolean
}

export function adminDestination(value: unknown, role?: Role) {
  const fallback = role === 'accountant' ? '/staff/payments' : '/staff/orders'
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return fallback

  try {
    const base = 'https://techviet.invalid'
    const url = new URL(value, base)
    const pathname = url.pathname.replace(/\/$/, '')
    const isOrder =
      pathname.startsWith('/staff/orders/') &&
      z.uuid().safeParse(pathname.slice('/staff/orders/'.length)).success
    if (url.origin !== base || (!staffPaths.has(pathname) && !isOrder))
      return fallback
    if (pathname === '/staff/team' && role !== 'admin') return fallback
    if (pathname === '/staff/receiving-accounts' && role !== 'admin')
      return fallback
    if (pathname === '/staff/payments' && role === 'staff') return fallback
    if (pathname === '/staff/fulfillment' && role === 'accountant')
      return fallback
    return pathname + url.search + url.hash
  } catch {
    return fallback
  }
}

async function getAccount(signal: AbortSignal) {
  const session = await getSession(signal, 'admin')
  if (!session) return null
  const actor = actorSchema.parse(await read('staff/me', { signal }))
  if (actor.userId !== session.user.id)
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  return { session, actor }
}

export function useAdminAuth() {
  const client = useQueryClient()
  const lock = useRef(false)
  const account = useQuery({
    queryKey: accountKey,
    queryFn: ({ signal }) => getAccount(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
  })

  async function refreshAccount() {
    await client.cancelQueries({ queryKey: accountKey, exact: true })
    await resetSessionQueries(client, 'admin')
    await client.resetQueries({ queryKey: accountKey, exact: true })
  }

  const signIn = useMutation({
    mutationFn: async (credentials: Credentials) => {
      await api.post('admin/auth/sign-in/email', {
        json: credentials,
        retry: 0,
      })
    },
    retry: false,
    gcTime: 0,
    onSuccess: refreshAccount,
    onSettled: () => {
      lock.current = false
    },
  })
  const signOut = useMutation({
    mutationFn: async () => {
      await api.post('admin/auth/sign-out', { json: {}, retry: 0 })
    },
    retry: false,
    onSuccess: refreshAccount,
    onSettled: () => {
      lock.current = false
    },
  })

  return {
    account,
    busy: signIn.isPending || signOut.isPending,
    error: signIn.error ?? signOut.error,
    clearError() {
      if (signIn.isError) signIn.reset()
      if (signOut.isError) signOut.reset()
    },
    signIn(credentials: Credentials) {
      if (lock.current) return
      lock.current = true
      signOut.reset()
      signIn.mutate(credentials)
    },
    signOut() {
      if (lock.current) return
      lock.current = true
      signIn.reset()
      signOut.mutate()
    },
  }
}
