import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  type LucideIcon,
  Mail,
  PackageSearch,
  RefreshCcw,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { type InputHTMLAttributes, useId, useRef, useState } from 'react'
import { api } from '@/shared/api/client'
import { StoreLogo } from '@/shared/components/store-layout/store-logo'
import { useSession } from './api'
import { Action, ErrorNotice, Notice } from './components'
import { CustomerLayout } from './layouts'
import { resetSessionQueries } from './session-scope'
import './auth-page.css'

type AuthMode = 'sign-in' | 'sign-up'

const modeCopy: Record<AuthMode, { title: string; intro: string }> = {
  'sign-in': {
    title: 'Chào mừng trở lại',
    intro: 'Đăng nhập để mua sắm và theo dõi đơn hàng của bạn.',
  },
  'sign-up': {
    title: 'Tạo tài khoản mới',
    intro: 'Chỉ cần vài thông tin để bắt đầu mua sắm tại TinovaShop.',
  },
}

const benefits = [
  { icon: BadgeCheck, text: 'Hàng chính hãng 100%' },
  { icon: RefreshCcw, text: 'Đổi trả trong 7 ngày đầu tiên' },
  { icon: PackageSearch, text: 'Theo dõi đơn hàng mọi lúc' },
]

function AuthField({
  label,
  icon: Icon,
  hint,
  type = 'text',
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icon: LucideIcon
  hint?: string | undefined
}) {
  const id = useId()
  const [isVisible, setIsVisible] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-field__control">
        <Icon aria-hidden="true" size={18} />
        <input
          {...input}
          aria-describedby={hint ? `${id}-hint` : undefined}
          id={id}
          type={isPassword && isVisible ? 'text' : type}
        />
        {isPassword && (
          <button
            aria-label={isVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            aria-pressed={isVisible}
            onClick={() => setIsVisible((current) => !current)}
            type="button"
          >
            {isVisible ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        )}
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  )
}

function AuthBrand() {
  return (
    <aside className="auth-brand">
      <img
        alt=""
        className="auth-brand__photo"
        decoding="async"
        src="/images/workspace-banner.webp"
      />
      <span className="auth-brand__logo">
        <StoreLogo />
      </span>
      <div className="auth-brand__copy">
        <h2>Công nghệ chính hãng, mua sắm an tâm</h2>
        <ul>
          {benefits.map(({ icon: Icon, text }) => (
            <li key={text}>
              <Icon aria-hidden="true" size={17} />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

export function AuthPage() {
  const search = useSearch({ strict: false })
  const redirect =
    'redirect' in search &&
    typeof search.redirect === 'string' &&
    search.redirect.startsWith('/') &&
    !search.redirect.startsWith('//') &&
    !search.redirect.includes('\\')
      ? search.redirect
      : '/cart'
  const mode: AuthMode =
    'mode' in search && search.mode === 'sign-up' ? 'sign-up' : 'sign-in'
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const client = useQueryClient()
  const lock = useRef(false)
  const session = useSession()
  const copy = modeCopy[mode]

  function changeMode(next: AuthMode) {
    setError(null)
    void navigate({
      to: '/login',
      replace: true,
      resetScroll: false,
      search: { redirect, mode: next },
    })
  }

  return (
    <CustomerLayout>
      <div className="auth-page">
        <AuthBrand />
        <section className="auth-panel">
          {session.data ? (
            <>
              <span aria-hidden="true" className="auth-panel__badge">
                <ShieldCheck size={24} />
              </span>
              <h1>Bạn đã đăng nhập</h1>
              <Notice tone="green">
                Bạn đang đăng nhập với {session.data.user.email}.
              </Notice>
              <a className="c-button c-button--primary" href={redirect}>
                Tiếp tục
                <ArrowRight size={16} />
              </a>
            </>
          ) : (
            <>
              <h1>{copy.title}</h1>
              <p className="auth-panel__intro">{copy.intro}</p>
              <form
                className="auth-form"
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (lock.current) return
                  lock.current = true
                  setBusy(true)
                  setError(null)
                  const values = new FormData(event.currentTarget)
                  try {
                    await api.post(`auth/${mode}/email`, {
                      json: {
                        email: String(values.get('email')).trim(),
                        password: String(values.get('password')),
                        ...(mode === 'sign-up'
                          ? { name: String(values.get('name')).trim() }
                          : {}),
                      },
                      retry: 0,
                    })
                    await resetSessionQueries(client, 'customer')
                    window.location.assign(redirect)
                  } catch (caught) {
                    setError(caught)
                    setBusy(false)
                    lock.current = false
                  }
                }}
              >
                <fieldset disabled={busy}>
                  {mode === 'sign-up' && (
                    <AuthField
                      autoComplete="name"
                      icon={UserRound}
                      label="Họ và tên"
                      maxLength={120}
                      minLength={2}
                      name="name"
                      placeholder="Nguyễn Văn A"
                      required
                    />
                  )}
                  <AuthField
                    autoComplete="email"
                    icon={Mail}
                    label="Email"
                    maxLength={254}
                    name="email"
                    placeholder="ban@email.com"
                    required
                    type="email"
                  />
                  <AuthField
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    hint={
                      mode === 'sign-up' ? 'Từ 8 đến 128 ký tự.' : undefined
                    }
                    icon={KeyRound}
                    label="Mật khẩu"
                    maxLength={128}
                    minLength={8}
                    name="password"
                    placeholder="Nhập mật khẩu"
                    required
                    type="password"
                  />
                </fieldset>
                <ErrorNotice error={error} />
                <Action
                  className="c-button--block"
                  pending={busy}
                  type="submit"
                >
                  {mode === 'sign-in' ? 'Đăng nhập' : 'Tạo tài khoản'}
                </Action>
              </form>
              <p className="auth-panel__switch">
                {mode === 'sign-in' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
                <button
                  disabled={busy}
                  onClick={() =>
                    changeMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                  }
                  type="button"
                >
                  {mode === 'sign-in' ? 'Đăng ký ngay' : 'Đăng nhập'}
                </button>
              </p>
            </>
          )}
        </section>
      </div>
    </CustomerLayout>
  )
}
