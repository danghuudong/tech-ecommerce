import { Link, useSearch } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../commerce/api'
import { adminDestination, useAdminAuth } from './admin-auth'
import './admin-login-page.css'

const capabilities = [
  {
    icon: PackageCheck,
    title: 'Đơn hàng trong tầm tay',
    description: 'Theo dõi và xử lý đơn hàng tập trung.',
  },
  {
    icon: Truck,
    title: 'Vận hành thông suốt',
    description: 'Phối hợp giao vận, đổi trả và hoàn tiền.',
  },
  {
    icon: CreditCard,
    title: 'Thanh toán rõ ràng',
    description: 'Quản lý thanh toán và đối soát đơn hàng.',
  },
]

export function AdminLoginPage() {
  const search = useSearch({ strict: false })
  const auth = useAdminAuth()
  const { account, busy } = auth
  const destination = adminDestination(
    search.redirect,
    account.data?.actor.role,
  )
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const error = auth.error ?? account.error
  const canAccess =
    account.data?.actor.role === 'admin' ||
    account.data?.actor.role === 'staff' ||
    account.data?.actor.role === 'accountant'
  const checking = account.isPending || (canAccess && !account.isError)

  useEffect(() => {
    if (canAccess && account.isSuccess && !account.isFetching && !busy)
      window.location.replace(destination)
  }, [canAccess, account.isSuccess, account.isFetching, busy, destination])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  return (
    <div className="admin-login">
      <title>Đăng nhập quản trị | TechViet</title>
      <meta
        name="description"
        content="Đăng nhập khu vực quản trị TechViet dành cho nhân viên, kế toán và quản trị viên được cấp quyền."
      />
      <meta name="robots" content="noindex, nofollow" />
      <aside className="admin-login__story" aria-label="TechViet Admin">
        <div className="admin-login__brand-row">
          <Link
            to="/"
            className="admin-login__brand"
            aria-label="TechViet — Trang chủ"
          >
            Tech<strong>Viet</strong>
          </Link>
          <span className="admin-login__brand-tag">ADMIN</span>
        </div>

        <div className="admin-login__story-content">
          <span className="admin-login__eyebrow">
            <span />
            KHÔNG GIAN VẬN HÀNH
          </span>
          <h2>
            Mọi vận hành.
            <br />
            Một điểm chạm.
          </h2>
          <p>
            Kết nối công việc mỗi ngày, cùng đội ngũ TechViet mang trải nghiệm
            tốt hơn đến khách hàng.
          </p>
          <ul className="admin-login__capabilities">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <li key={title}>
                <span className="admin-login__capability-icon">
                  <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="admin-login__story-footer">
          <ShieldCheck size={17} aria-hidden="true" />
          Dành riêng cho đội ngũ TechViet
        </div>
        <div className="admin-login__decoration" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </aside>

      <div className="admin-login__workspace">
        <nav className="admin-login__navigation" aria-label="Quay lại cửa hàng">
          <Link to="/">
            <ArrowLeft size={16} aria-hidden="true" />
            Về cửa hàng
          </Link>
        </nav>

        <main className="admin-login__main">
          <div className="admin-login__heading">
            <span className="admin-login__emblem">
              <LayoutDashboard size={25} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <p className="admin-login__kicker">TECHVIET ADMIN</p>
            <h1>Đăng nhập quản trị</h1>
            <p>Chào mừng trở lại. Bắt đầu phiên làm việc của bạn.</p>
          </div>

          {error && (
            <div
              className="admin-login__error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
              id="admin-login-error"
            >
              <AlertCircle size={19} aria-hidden="true" />
              <p>{errorMessage(error)}</p>
            </div>
          )}

          {checking ? (
            <div className="admin-login__checking" role="status">
              <LoaderCircle
                className="admin-login__spinner"
                size={24}
                aria-hidden="true"
              />
              <p>
                {canAccess
                  ? 'Đang chuyển đến khu vực quản trị…'
                  : 'Đang kiểm tra phiên đăng nhập…'}
              </p>
            </div>
          ) : account.isError ? (
            <div className="admin-login__session">
              <p>Chưa thể xác minh tài khoản. Vui lòng thử lại để tiếp tục.</p>
              <button
                type="button"
                className="admin-login__submit"
                disabled={busy || account.isFetching}
                onClick={() => void account.refetch()}
              >
                <RefreshCw size={17} aria-hidden="true" />
                Kiểm tra lại
              </button>
              <button
                type="button"
                className="admin-login__text-button"
                disabled={busy || account.isFetching}
                onClick={auth.signOut}
              >
                <LogOut size={16} aria-hidden="true" />
                {busy ? 'Đang đăng xuất…' : 'Đăng xuất và thử lại'}
              </button>
            </div>
          ) : account.data ? (
            <div className="admin-login__session">
              <div className="admin-login__restricted" role="status">
                <ShieldCheck size={22} aria-hidden="true" />
                <div>
                  <h2>Tài khoản chưa có quyền truy cập</h2>
                  <p>
                    <strong>{account.data.session.user.email}</strong> chưa được
                    cấp quyền nhân viên, kế toán hoặc quản trị viên. Liên hệ
                    quản trị viên hệ thống để được hỗ trợ.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="admin-login__submit"
                disabled={busy || account.isFetching}
                onClick={auth.signOut}
              >
                {busy ? (
                  <LoaderCircle
                    className="admin-login__spinner"
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <LogOut size={18} aria-hidden="true" />
                )}
                {busy ? 'Đang đăng xuất…' : 'Đăng nhập bằng tài khoản khác'}
              </button>
            </div>
          ) : (
            <form
              className="admin-login__form"
              aria-label="Đăng nhập quản trị"
              aria-busy={busy}
              aria-describedby={error ? 'admin-login-error' : undefined}
              onChange={auth.clearError}
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                auth.signIn({
                  email: String(values.get('email') ?? '').trim(),
                  password: String(values.get('password') ?? ''),
                  rememberMe: values.get('rememberMe') === 'on',
                })
              }}
            >
              <fieldset disabled={busy}>
                <div className="admin-login__field">
                  <label htmlFor="admin-email">Email</label>
                  <div className="admin-login__input">
                    <Mail size={19} aria-hidden="true" />
                    <input
                      id="admin-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="Nhập email của bạn"
                      maxLength={254}
                      required
                    />
                  </div>
                </div>

                <div className="admin-login__field">
                  <label htmlFor="admin-password">Mật khẩu</label>
                  <div className="admin-login__input">
                    <KeyRound size={19} aria-hidden="true" />
                    <input
                      id="admin-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Nhập mật khẩu"
                      minLength={8}
                      maxLength={128}
                      required
                      aria-describedby={
                        capsLock ? 'admin-caps-lock' : undefined
                      }
                      onKeyDown={(event) =>
                        setCapsLock(event.getModifierState('CapsLock'))
                      }
                      onKeyUp={(event) =>
                        setCapsLock(event.getModifierState('CapsLock'))
                      }
                      onBlur={() => setCapsLock(false)}
                    />
                    <button
                      type="button"
                      className="admin-login__reveal"
                      aria-label={
                        showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'
                      }
                      aria-controls="admin-password"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? (
                        <EyeOff size={19} aria-hidden="true" />
                      ) : (
                        <Eye size={19} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {capsLock && (
                    <p className="admin-login__caps-lock" id="admin-caps-lock">
                      Caps Lock đang bật.
                    </p>
                  )}
                </div>

                <div className="admin-login__remember">
                  <label>
                    <input type="checkbox" name="rememberMe" />
                    Duy trì đăng nhập
                  </label>
                  <p>Chỉ bật trên thiết bị cá nhân.</p>
                </div>

                <button
                  type="submit"
                  className="admin-login__submit"
                  disabled={busy}
                >
                  {busy && (
                    <LoaderCircle
                      className="admin-login__spinner"
                      size={18}
                      aria-hidden="true"
                    />
                  )}
                  {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
                  {!busy && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </fieldset>
            </form>
          )}

          <div className="admin-login__help">
            <details>
              <summary>Cần hỗ trợ đăng nhập?</summary>
              <p>
                Liên hệ quản trị viên hệ thống để được cấp tài khoản, khôi phục
                mật khẩu hoặc kiểm tra quyền truy cập.
              </p>
            </details>
          </div>
          <div className="admin-login__access-note">
            <LockKeyhole size={15} aria-hidden="true" />
            <p>Chỉ dành cho tài khoản được cấp quyền.</p>
          </div>
        </main>

        <footer className="admin-login__footer">
          © {new Date().getFullYear()} TechViet. Hệ thống quản trị nội bộ.
        </footer>
      </div>
    </div>
  )
}
