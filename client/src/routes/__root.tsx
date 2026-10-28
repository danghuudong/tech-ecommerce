import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import { NotFound, RouteFailure } from '@/features/commerce/layouts'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RouteFailure,
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; orderId?: string; redirect?: string } => ({
    ...(typeof search.q === 'string' && search.q.trim()
      ? { q: search.q.trim().slice(0, 120) }
      : {}),
    ...(typeof search.orderId === 'string' &&
    z.uuid().safeParse(search.orderId).success
      ? { orderId: search.orderId }
      : {}),
    ...(typeof search.redirect === 'string' &&
    search.redirect.startsWith('/') &&
    !search.redirect.startsWith('//') &&
    !/[\\\r\n]/.test(search.redirect)
      ? { redirect: search.redirect }
      : {}),
  }),
})
