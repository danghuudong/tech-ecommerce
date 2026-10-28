import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      staleTime: 30_000,
    },
  },
})
