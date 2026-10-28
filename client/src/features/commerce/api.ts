import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Options } from 'ky'
import { useRef } from 'react'
import { z } from 'zod'
import { queryClient } from '@/app/query-client'
import { ApiError, api } from '@/shared/api/client'
import {
  commerceKeys,
  type SessionScope,
  sessionKeys,
  useSessionScope,
} from './session-scope'
import type {
  Actor,
  Cart,
  OrderDeletionBlockReason,
  OrderDetail,
  OrderUndoBlockReason,
  Session,
  StaffShiftStatus,
} from './types'

export const commerceKey = commerceKeys.customer
export const orderQueryPaths = [
  'admin/users',
  'admin/order-assignment',
  'orders',
  'staff/orders',
  'staff/returns',
  'staff/refunds',
  'admin/payment-balance-reviews',
] as const
export const paymentQueryPaths = [
  ...orderQueryPaths,
  'admin/payment-receipts',
  'admin/cod-collections',
  'admin/carrier-remittances',
] as const
const sessionSchema = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    session: z.object({ id: z.string(), expiresAt: z.string() }),
  })
  .nullable()

export async function read<T>(path: string, options?: Options): Promise<T> {
  const result = await api.get(path, options).json<{ data: T }>()
  return result.data
}

export function downloadOrderUndoDocument(orderId: string, documentId: string) {
  return api
    .get(
      `staff/orders/${encodeURIComponent(orderId)}/undo-documents/${encodeURIComponent(documentId)}`,
    )
    .blob()
}

const pendingKeys = new Map<string, string>()

// Keep the same command identity after a lost response, including a page reload.
// Only a digest is stored; recipient and financial form values stay out of storage.
export async function write<T>(
  path: string,
  body: unknown = {},
  method: 'post' | 'put' | 'patch' = 'post',
): Promise<T> {
  const scope: SessionScope = /^(staff|admin)(\/|$)/.test(path)
    ? 'admin'
    : 'customer'
  const identity = queryClient.getQueryData<Session | null>(sessionKeys[scope])
    ?.user.id
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([identity, method, path, body])),
  )
  const storageKey = `techviet:command:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  let key = pendingKeys.get(storageKey)
  try {
    key ??= sessionStorage.getItem(storageKey) ?? undefined
  } catch {
    // Private browsing can deny session storage; in-page retries still retain keys.
  }
  key ??= crypto.randomUUID()
  pendingKeys.set(storageKey, key)
  try {
    sessionStorage.setItem(storageKey, key)
  } catch {
    // Storage is an optional recovery aid, never a prerequisite for a command.
  }
  const clear = () => {
    pendingKeys.delete(storageKey)
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      // The in-memory entry has already been cleared.
    }
  }
  try {
    const result = await api(path, {
      method,
      json: body,
      headers: { 'Idempotency-Key': key },
      retry: 0,
    }).json<{ data: T }>()
    clear()
    return result.data
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status < 500 &&
      ![408, 429].includes(error.status)
    )
      clear()
    throw error
  }
}

export async function getSession(
  signal?: AbortSignal,
  scope: SessionScope = 'customer',
) {
  try {
    return sessionSchema.parse(
      await api
        .get(`${scope === 'admin' ? 'admin/auth' : 'auth'}/get-session`, {
          signal,
        })
        .json(),
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export function useSession(scopeOverride?: SessionScope) {
  const contextScope = useSessionScope()
  const scope = scopeOverride ?? contextScope
  return useQuery({
    queryKey: sessionKeys[scope],
    queryFn: ({ signal }) => getSession(signal, scope),
    retry: false,
    staleTime: 30_000,
  })
}

export function useActor(scopeOverride?: SessionScope) {
  const contextScope = useSessionScope()
  const scope = scopeOverride ?? contextScope
  const session = useSession(scope)
  return useQuery({
    queryKey: [...commerceKeys[scope], 'actor', session.data?.user.id],
    queryFn: ({ signal }) =>
      read<Actor>(scope === 'admin' ? 'staff/me' : 'commerce/me', { signal }),
    enabled: Boolean(session.data),
    retry: false,
  })
}

export function useCommerceQuery<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  enabled = true,
  refetchInterval: number | false = false,
) {
  const scope = useSessionScope()
  const session = useSession()
  return useQuery({
    queryKey: [...commerceKeys[scope], session.data?.user.id, path, params],
    queryFn: ({ signal }) =>
      read<T>(path, {
        signal,
        searchParams: Object.fromEntries(
          Object.entries(params).filter(([, value]) => value !== undefined),
        ),
      }),
    enabled: enabled && Boolean(session.data),
    refetchInterval: (query) => {
      if (!refetchInterval) return false
      const error = query.state.error
      if (error instanceof ApiError && error.status < 500) {
        if (error.status !== 429) return false
        return Math.max(30_000, (error.retryAt ?? 0) - Date.now())
      }
      return refetchInterval
    },
    retry: (count, error) =>
      !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

export function useStaffShift() {
  const scope = useSessionScope()
  const session = useSession()
  return useQuery({
    queryKey: [...commerceKeys[scope], session.data?.user.id, 'staff/shift'],
    queryFn: async ({ signal }) => {
      const status = await read<StaffShiftStatus>('staff/shift', { signal })
      return { ...status, clockReceivedAt: performance.now() }
    },
    enabled: scope === 'admin' && Boolean(session.data),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (query) => {
      const error = query.state.error
      if (error instanceof ApiError && error.status < 500) {
        if (error.status !== 429) return false
        return Math.max(30_000, (error.retryAt ?? 0) - Date.now())
      }
      return 15_000
    },
    refetchIntervalInBackground: false,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

export function useCart() {
  return useCommerceQuery<Cart>('cart')
}

const cartIntentSchema = z.object({
  quantity: z.number().int().min(1).max(99),
  expectedVersion: z.number().int().min(0),
})

// Recover the original desired quantity instead of incrementing a second time
// when the server committed an add but its response was lost.
export function useAddToCart() {
  const session = useSession()
  const intents = useRef(new Map<string, z.infer<typeof cartIntentSchema>>())
  const add = async (product: { id: string }) => {
    const intentKey = `techviet:cart-intent:${session.data?.user.id}:${product.id}`
    let intent = intents.current.get(intentKey)
    try {
      const saved = sessionStorage.getItem(intentKey)
      if (!intent && saved) {
        const parsed = cartIntentSchema.safeParse(JSON.parse(saved))
        if (parsed.success) intent = parsed.data
      }
    } catch {
      // A blocked or corrupt storage entry does not prevent using the cart.
    }
    if (!intent) {
      const latest = await read<Cart>('cart')
      intent = {
        quantity:
          (latest.items.find((line) => line.productId === product.id)
            ?.quantity ?? 0) + 1,
        expectedVersion: latest.version,
      }
    }
    intents.current.set(intentKey, intent)
    try {
      sessionStorage.setItem(intentKey, JSON.stringify(intent))
    } catch {
      /* In-page recovery remains available. */
    }
    const clear = () => {
      intents.current.delete(intentKey)
      try {
        sessionStorage.removeItem(intentKey)
      } catch {
        /* Storage can be disabled. */
      }
    }
    try {
      const result = await write<{ version: number }>(
        `cart/items/${product.id}`,
        intent,
        'put',
      )
      clear()
      return result
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      )
        clear()
      throw error
    }
  }
  return useCommand(add, ['cart'])
}

export function useOrder(orderId: string, poll = false) {
  const scope = useSessionScope()
  const session = useSession()
  return useQuery({
    queryKey: [
      ...commerceKeys[scope],
      session.data?.user.id,
      'orders',
      orderId,
    ],
    queryFn: async ({ signal }) => {
      const clockStartedAt = performance.now()
      const order = await read<OrderDetail>(
        `${scope === 'admin' ? 'staff/' : ''}orders/${orderId}`,
        { signal },
      )
      // Cache the monotonic anchor with this response, including across remounts.
      // Counting the whole request avoids extending the server's deadline.
      // An occurrence-time upper bound must exclude request latency so a
      // prefilled timestamp cannot run ahead of the database clock.
      return { ...order, clockStartedAt, clockReceivedAt: performance.now() }
    },
    enabled: Boolean(session.data && z.uuid().safeParse(orderId).success),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: (query) => {
      if (!poll) return false
      const error = query.state.error
      if (error instanceof ApiError && error.status < 500) {
        if (error.status !== 429) return false
        return Math.max(30_000, (error.retryAt ?? 0) - Date.now())
      }
      return 30_000
    },
    refetchIntervalInBackground: false,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status < 500) && count < 1,
  })
}

export function useCommand<T, R = Record<string, unknown>>(
  action: (input: T) => Promise<R>,
  refreshPaths: readonly string[],
) {
  const client = useQueryClient()
  const scope = useSessionScope()
  const scopedCommerceKey = commerceKeys[scope]
  const lock = useRef(false)
  const refresh = () => {
    const userId = client.getQueryData<Session | null>(sessionKeys[scope])?.user
      .id
    return client.invalidateQueries({
      queryKey: scopedCommerceKey,
      predicate: ({ queryKey }) => {
        const path = queryKey[3]
        return (
          queryKey[2] === userId &&
          typeof path === 'string' &&
          refreshPaths.some(
            (target) => path === target || path.startsWith(`${target}/`),
          )
        )
      },
    })
  }
  const mutation = useMutation({
    mutationFn: action,
    retry: false,
    onSuccess: refresh,
    onError: async (error) => {
      if (!(error instanceof ApiError)) return
      if (error.status === 401) {
        await client.invalidateQueries({
          queryKey: scopedCommerceKey,
          refetchType: 'none',
        })
        await client.invalidateQueries({ queryKey: sessionKeys[scope] })
      } else if (error.status === 403) {
        await client.invalidateQueries({
          queryKey: [...scopedCommerceKey, 'actor'],
        })
        await refresh()
      } else if ([409, 422].includes(error.status)) {
        await refresh()
      }
    },
  })
  const run = async (input: T) => {
    if (lock.current) return undefined
    lock.current = true
    try {
      return await mutation.mutateAsync(input)
    } catch {
      return undefined
    } finally {
      lock.current = false
    }
  }
  return { ...mutation, run }
}

export const orderDeletionMessages: Record<OrderDeletionBlockReason, string> = {
  ORDER_DELETION_NOT_TERMINAL:
    'Chỉ có thể xóa đơn đã hủy hoặc hoàn tất. Hãy xử lý hoặc hủy đơn trước khi xóa.',
  ORDER_DELETION_RECONCILIATION_REQUIRED:
    'Cần xác minh đầy đủ chứng từ thanh toán và COD trước khi xóa đơn.',
  ORDER_DELETION_RETURNS_PENDING:
    'Đơn còn yêu cầu trả hàng đang xử lý. Hãy xử lý xong yêu cầu trước khi xóa.',
  ORDER_DELETION_FINANCIAL_WORK_PENDING:
    'Đơn còn công nợ, hoàn tiền hoặc chênh lệch thanh toán cần xử lý. Hãy hoàn tất đối soát trước khi xóa.',
}

export const orderUndoMessages: Record<OrderUndoBlockReason, string> = {
  ORDER_UNDO_DELETED: 'Hãy khôi phục đơn hàng trước khi sửa thao tác.',
  STAFF_ACCESS_REQUIRED: 'Thao tác này cần quyền nhân viên hoặc quản trị viên.',
  ORDER_ASSIGNED_ELSEWHERE: 'Bạn chỉ được sửa đơn hàng được giao cho mình.',
  ORDER_UNDO_ADMIN_REQUIRED:
    'Cần quản trị viên xác minh việc sửa bàn giao, giao thành công hoặc gia hạn xác nhận COD.',
  ASSIGNMENT_REQUIRED: 'Cần phân công người phụ trách trước khi sửa thao tác.',
  ORDER_UNDO_AFTER_SALE_ACTIVITY:
    'Đơn còn yêu cầu trả hàng có hiệu lực, chứng từ nhận hàng hoặc hồ sơ hoàn tiền. Hãy xử lý các phát sinh này trước khi quay lại.',
  ORDER_UNDO_FINANCIAL_ACTIVITY:
    'Đơn đã phát sinh thu tiền COD, công nợ hoặc điều chỉnh tài chính. Hãy sửa chứng từ qua đối soát thanh toán; không thể dùng nút quay lại để xóa các phát sinh này.',
  ORDER_UNDO_RECONCILIATION_REQUIRED:
    'Cần xác minh chứng từ thanh toán và COD trước khi sửa bước xử lý.',
  ORDER_UNDO_RESERVATION_EXPIRED:
    'Đơn đã hết hạn giữ hàng. Cần xử lý đơn hết hạn trước khi tiếp tục.',
  ORDER_UNDO_STATE_MISMATCH:
    'Dữ liệu kho hoặc vận chuyển chưa khớp trạng thái đơn. Cần quản trị viên kiểm tra.',
  ORDER_UNDO_HISTORY_REQUIRED:
    'Chưa đủ lịch sử gốc để khôi phục bước trước một cách chính xác. Cần quản trị viên kiểm tra.',
  ORDER_UNDO_CONFIRMATION_EXPIRED:
    'Hạn xác nhận COD đã hết. Cần quản trị viên duyệt hạn giữ hàng mới để đưa đơn về chờ xác nhận.',
  ORDER_UNDO_SHIPMENT_ACTIVITY:
    'Vận đơn đã phát sinh giao hàng thất bại hoặc nhận hàng hoàn. Hãy dùng thao tác giao lại hoặc nhận hàng hoàn.',
}

const messages: Record<string, string> = {
  ...orderDeletionMessages,
  ORDER_UNDO_RENEWAL_REQUIRED:
    'Hạn xác nhận COD đã hết trong lúc thao tác. Hãy mở lại cửa sổ để quản trị viên duyệt hạn giữ hàng mới.',
  ORDER_UNDO_RENEWAL_INVALID:
    'Chỉ được gia hạn khi hạn xác nhận COD đã hết, trong giới hạn số giờ hiển thị. Hãy tải lại thông tin đơn.',
  ORDER_UNDO_DOCUMENT_INVALID:
    'Cần tệp PDF, PNG hoặc JPEG hợp lệ, tối đa 512 KiB, tên tệp tối đa 160 ký tự.',
  ORDER_UNDO_DOCUMENT_READ_FAILED:
    'Không đọc được tệp đã chọn. Hãy chọn lại tài liệu và thử lại.',
  ORDER_UNDO_DOCUMENT_NOT_FOUND:
    'Không tìm thấy tài liệu xác minh của đơn hàng này.',
  ORDER_UNDO_DOCUMENT_SAVE_FAILED:
    'Chưa lưu được tài liệu. Hãy thử lại thao tác.',
  ...orderUndoMessages,
  UNSUPPORTED_RECEIVING_BANK:
    'Ngân hàng chưa có trong danh mục nhận tiền. Vui lòng chọn lại ngân hàng đã đăng ký trong hệ thống.',
  REFUND_CHECKER_UNAVAILABLE:
    'Chưa có quản trị viên khác người mở để xác minh kết quả. Hãy bổ sung nhân sự trước khi mở lần hoàn tiền.',
  REFUND_CHECKER_REQUIRED_FOR_OPEN_ATTEMPTS:
    'Tài khoản này đang là người xác minh cần thiết cho một lần hoàn tiền chưa kết thúc. Hoàn tất đối soát hoặc bổ sung quản trị viên khác trước khi đổi quyền.',
  RECEIVING_ACCOUNT_EXISTS:
    'Tài khoản hoặc quỹ này đã được đăng ký. Vui lòng chọn trong danh sách tài khoản nhận.',
  RECEIVING_ACCOUNT_NOT_FOUND:
    'Tài khoản nhận tiền không còn tồn tại. Vui lòng chọn lại.',
  REFUND_CHECKER_REQUIRED:
    'Kết quả hoàn tiền phải do quản trị viên khác người mở lần xử lý xác minh.',
  REFUND_SELF_VERIFICATION_FORBIDDEN:
    'Người mở lần hoàn tiền không được tự xác minh kết quả. Cần một quản trị viên khác kiểm tra.',
  CARRIER_REMITTANCE_ORDER_REQUIRED:
    'Phải phân bổ ít nhất một khoản thu hộ của đơn đang mở.',
  CARRIER_REMITTANCE_CARRIER_MISMATCH:
    'Một giao dịch nộp tiền chỉ phân bổ cho các khoản thu hộ của cùng đơn vị vận chuyển.',
  CARRIER_REMITTANCE_DUPLICATE_COLLECTION:
    'Một khoản thu hộ chỉ được xuất hiện một lần trong phân bổ.',
  CARRIER_REMITTANCE_EXCEEDED:
    'Tiền đơn vị vận chuyển đã nộp cho khoản thu hộ này vừa thay đổi hoặc số phân bổ vượt số còn phải nộp. Vui lòng kiểm tra số dư mới.',
  PAYMENT_REFERENCE_CONFLICT:
    'Mã giao dịch này đã được ghi nhận với số tiền, thời điểm hoặc phân bổ khác. Hãy kiểm tra chứng từ đã có trước khi tiếp tục.',
  COD_COLLECTION_RECONCILIATION_REQUIRED:
    'Khoản thu hộ cần quản trị viên đối soát trước khi nhận tiền đơn vị vận chuyển nộp.',
  INVALID_ASSIGNEE:
    'Người được phân công phải còn quyền nhân viên hoặc quản trị viên. Vui lòng tìm lại danh sách.',
  CARRIER_NOT_FOUND:
    'Đơn vị vận chuyển không tồn tại. Vui lòng chọn đơn vị vận chuyển đã đăng ký.',
  CARRIER_CODE_EXISTS:
    'Mã đơn vị vận chuyển đã tồn tại. Vui lòng tìm và chọn đơn vị vận chuyển đó.',
  TRACKING_REFERENCE_IN_USE:
    'Mã vận đơn đã được sử dụng cho một đơn khác của cùng đơn vị vận chuyển.',
  COD_CARRIER_MISMATCH:
    'Đơn vị vận chuyển thu hộ phải là đơn vị vận chuyển đã nhận bàn giao vận đơn của đơn hàng.',
  SHIPMENT_CARRIER_REQUIRED:
    'Quản trị viên cần xác minh đơn vị vận chuyển của vận đơn cũ trước khi ghi nhận khoản thu hộ mới.',
  SHIPMENT_CARRIER_CONTEXT_CHANGED:
    'Vận đơn hoặc chứng từ COD đã thay đổi. Vui lòng kiểm tra dữ liệu mới và xác nhận lại.',
  SHIPMENT_COD_REVIEW_REQUIRED:
    'Cần hoàn tất đối soát chứng từ COD và tiền đơn vị vận chuyển nộp trước khi đổi đơn vị vận chuyển trên chứng từ thu hộ.',
  SHIPMENT_COD_RECONCILIATION_REQUIRED:
    'Đơn vị vận chuyển đã chọn liên quan tới chứng từ COD hoặc công nợ cũ. Cần mã hồ sơ và xác nhận đối soát.',
  SHIPMENT_CARRIER_UNCHANGED:
    'Vận đơn và các chứng từ COD đã thuộc đơn vị vận chuyển này.',
  COD_CARRIER_REFERENCE_CONFLICT:
    'Mã chứng từ bị trùng tại đơn vị vận chuyển đích. Chọn “Gộp chứng từ trùng” bên dưới để xác minh và đối soát phân bổ trước khi lưu đơn vị vận chuyển.',
  COD_CROSS_CARRIER_GROUP_CHANGED:
    'Nhóm chứng từ đã thay đổi hoặc chưa chọn đủ các bản ghi của đơn vị vận chuyển đích. Vui lòng kiểm tra lại toàn bộ nhóm.',
  COD_COLLECTION_CHANGED:
    'Chứng từ thu hộ đã thay đổi. Vui lòng kiểm tra phiên bản mới.',
  COD_REMITTANCES_CHANGED:
    'Phân bổ tiền vừa thay đổi. Vui lòng đối soát lại các khoản tiền mới.',
  COD_MERGE_ALLOCATION_REQUIRED:
    'Cần xác nhận phân bổ cho từng khoản tiền trong nhóm gộp.',
  COD_MERGE_ALLOCATION_EXCEEDED:
    'Tiền phân bổ vượt số tiền thu hộ đã xác minh. Hãy chuyển phần dư về chờ phân bổ hoặc chọn lại phân bổ.',
  CARRIER_RESPONSIBILITY_CORRECTION_REQUIRED:
    'Cần lập quyết định hiệu chỉnh bên chịu trách nhiệm cho quyết định công nợ hiện tại.',
  CARRIER_DECISION_IDENTITY_MISMATCH:
    'Cần hiệu chỉnh đơn vị vận chuyển trên các chứng từ COD cho khớp vận đơn trước khi lập quyết định công nợ với đơn vị vận chuyển.',
  COLLECTION_REFERENCE_CONFLICT:
    'Mã quyết định đã được sử dụng. Hãy nhập mã quyết định hiệu chỉnh mới.',
  INVALID_EMAIL_OR_PASSWORD: 'Email hoặc mật khẩu không đúng.',
  USER_ALREADY_EXISTS:
    'Email đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Email đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.',
  PASSWORD_TOO_SHORT: 'Mật khẩu phải có ít nhất 8 ký tự.',
  INVALID_OCCURRENCE_TIME:
    'Thời điểm ghi nhận chưa hợp lệ. Vui lòng kiểm tra lại thời điểm thực tế.',
  ORDER_AMOUNT_LIMIT:
    'Giá trị đơn hàng vượt mức được hỗ trợ. Vui lòng giảm số lượng hoặc tách đơn.',
  REFUND_BALANCE_CHANGED:
    'Số dư hoàn tiền đã thay đổi. Vui lòng kiểm tra dữ liệu mới.',
  REFUND_AMOUNT_EXCEEDED:
    'Số tiền hoàn vượt quá số dư được phép của lần xử lý.',
  REFUND_REFERENCE_CONFLICT:
    'Mã giao dịch hoàn tiền đã được ghi nhận với thông tin khác.',
  PAYMENT_CHANGED:
    'Giao dịch vừa được cập nhật. Vui lòng tải lại trước khi đối soát.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  STAFF_ACCESS_REQUIRED: 'Tài khoản của bạn chưa có quyền nhân viên.',
  WORKFORCE_ACCESS_REQUIRED:
    'Tài khoản của bạn chưa có quyền truy cập khu vực nội bộ.',
  ACCOUNTANT_ACCESS_REQUIRED:
    'Thao tác này cần quyền kế toán hoặc quản trị viên.',
  ACTIVE_ASSIGNMENTS:
    'Hãy bàn giao các đơn đang phụ trách trước khi đổi sang vai trò khách hàng hoặc kế toán.',
  LAST_ADMIN: 'Không thể đổi vai trò của quản trị viên cuối cùng.',
  BOOTSTRAP_ADMIN_PROTECTED:
    'Tài khoản quản trị này đang được bảo vệ bởi cấu hình máy chủ.',
  PAYMENT_ALLOCATION_EXCEEDED: 'Tổng tiền phân bổ vượt quá số tiền thực nhận.',
  COLLECTION_RETRY_EXHAUSTED:
    'Đã đủ 3 lần thu thất bại. Quản trị viên cần xử lý công nợ.',
  COLLECTION_NOT_OUTSTANDING:
    'Khoản thu không còn công nợ mở để ghi nhận thất bại.',
  ADMIN_ACCESS_REQUIRED: 'Thao tác này cần quyền quản trị viên.',
  ADMIN_NOT_CONFIGURED: 'Backend chưa cấu hình tài khoản quản trị viên.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại các trường.',
  CART_CHANGED:
    'Giỏ hàng đã thay đổi. Dữ liệu mới đã được tải lại, vui lòng kiểm tra và thử lại.',
  ORDER_CHANGED: 'Đơn hàng vừa được cập nhật. Vui lòng kiểm tra dữ liệu mới.',
  QUOTE_EXPIRED:
    'Báo giá đã hết hạn. Vui lòng cập nhật giá trước khi đặt hàng.',
  PRICE_CHANGED:
    'Giá hoặc thông tin sản phẩm đã thay đổi. Vui lòng cập nhật báo giá.',
  CHECKOUT_CHANGED:
    'Chính sách thanh toán đã thay đổi. Vui lòng cập nhật báo giá.',
  INSUFFICIENT_STOCK: 'Số lượng yêu cầu vượt quá tồn kho hiện có.',
  PRODUCT_UNAVAILABLE: 'Sản phẩm hiện không còn được bán.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.',
  ORDER_ASSIGNED_ELSEWHERE:
    'Bạn chỉ được truy cập đơn hàng được giao cho mình.',
  ASSIGNMENT_REQUIRED:
    'Đơn chưa được phân công. Vui lòng chờ hệ thống hoặc nhờ quản trị viên phân công.',
  ASSIGNMENT_SETTINGS_CHANGED:
    'Cấu hình nhận đơn vừa thay đổi. Hãy tải lại cấu hình trước khi lưu.',
  INVALID_AUTO_ASSIGNEE:
    'Chỉ nhân viên xử lý đơn mới được tham gia nhận đơn tự động.',
  INVALID_SHIFT_END:
    'Hãy chọn giờ kết thúc ca trong tương lai, không quá 24 giờ kể từ hiện tại.',
  ORDER_DELETED: 'Hãy khôi phục đơn hàng trước khi phân công.',
  RETURN_WINDOW_CLOSED: 'Đã hết thời hạn yêu cầu trả hàng.',
  RETURN_QUANTITY_EXCEEDED: 'Số lượng trả vượt quá số lượng còn được phép trả.',
  RETURN_RECEIPT_EXCEEDED: 'Số lượng nhận vượt quá số lượng còn lại đã duyệt.',
  INVALID_ORDER_STATE: 'Trạng thái đơn hàng đã thay đổi. Vui lòng tải lại.',
  INVALID_RETURN_STATE:
    'Trạng thái yêu cầu trả hàng đã thay đổi. Vui lòng tải lại.',
  BANK_TRANSFER_NOT_CONFIGURED:
    'Chuyển khoản chưa được cấu hình. Vui lòng chọn COD.',
  PENDING_ORDER_LIMIT:
    'Bạn đã đặt quá nhiều đơn hàng. Vui lòng chờ cửa hàng xác nhận trước khi đặt thêm.',
  RECEIPT_REFERENCE_CONFLICT:
    'Mã bằng chứng đã được dùng cho một giao dịch khác.',
  RECEIPT_IDENTITY_RECONCILIATION_REQUIRED:
    'Quản trị viên cần xác minh giao dịch trùng trước khi tiếp tục.',
  PAYMENT_REQUIRED: 'Cần xác minh đủ khoản thanh toán trước khi tiếp tục.',
  ADMIN_RECONCILIATION_REQUIRED:
    'Cần quản trị viên đối soát trước khi tiếp tục.',
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const seconds = error.retryAt
        ? Math.max(0, Math.ceil((error.retryAt - Date.now()) / 1000))
        : 0
      return seconds > 0
        ? `Đã đạt hạn mức yêu cầu tạm thời. Vui lòng thử lại sau ${seconds} giây.`
        : 'Đã đạt hạn mức yêu cầu tạm thời. Vui lòng đợi một lát rồi thử lại.'
    }
    if (messages[error.code]) return messages[error.code]
    if (error.status === 403)
      return 'Bạn không có quyền thực hiện thao tác này.'
    if (error.status === 409)
      return 'Dữ liệu hoặc trạng thái đã thay đổi. Vui lòng kiểm tra dữ liệu mới và thử lại.'
    if (error.status === 400 || error.status === 422)
      return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại các trường và số liệu.'
    if (error.status === 404)
      return 'Không tìm thấy dữ liệu hoặc bạn không có quyền truy cập.'
    return 'Máy chủ chưa thể xử lý yêu cầu. Vui lòng thử lại sau.'
  }
  return 'Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.'
}
