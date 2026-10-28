import { LogOut } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useState } from 'react'
import { queryClient } from '@/app/query-client'
import { api } from '@/shared/api/client'
import { errorMessage } from './api'
import { resetSessionQueries, useSessionScope } from './session-scope'

export function SignOut({
  inMenu = false,
  className = 'c-staff-account-menu__signout',
}: {
  inMenu?: boolean
  className?: string
}) {
  const scope = useSessionScope()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`${scope === 'admin' ? 'admin/auth' : 'auth'}/sign-out`, {
        json: {},
        retry: 0,
      })
      await resetSessionQueries(queryClient, scope)
      window.location.assign(scope === 'admin' ? '/admin/login' : '/')
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  const label = (
    <>
      <LogOut size={15} aria-hidden="true" />
      {busy ? 'Đang đăng xuất…' : 'Đăng xuất'}
    </>
  )
  return (
    <>
      {inMenu ? (
        <DropdownMenu.Item
          className={className}
          disabled={busy}
          aria-busy={busy}
          onSelect={(event) => {
            event.preventDefault()
            if (!busy) void signOut()
          }}
        >
          {label}
        </DropdownMenu.Item>
      ) : (
        <button type="button" disabled={busy} onClick={() => void signOut()}>
          {label}
        </button>
      )}
      {error && <small role="alert">{errorMessage(error)}</small>}
    </>
  )
}
