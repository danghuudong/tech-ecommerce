import { Link, useLocation } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import './product-feedback.css'

export const FEEDBACK_PAGE_SIZE = 5

export function Stars({
  rating,
  size = 16,
}: {
  rating: number
  size?: number
}) {
  return (
    <span aria-label={`${rating} trên 5 sao`} className="pd-stars" role="img">
      {[1, 2, 3, 4, 5].map((point) => (
        <Star
          aria-hidden="true"
          fill={point <= Math.round(rating) ? 'currentColor' : 'none'}
          key={point}
          size={size}
        />
      ))}
    </span>
  )
}
const AVATAR_TONES = 5

export function FeedbackAvatar({ name }: { name: string }) {
  // The same customer keeps the same colour on every visit.
  const tone =
    [...name].reduce((sum, letter) => sum + (letter.codePointAt(0) ?? 0), 0) %
    AVATAR_TONES
  return (
    <span aria-hidden="true" className={`pd-avatar pd-avatar--${tone}`}>
      {[...name][0]?.toUpperCase()}
    </span>
  )
}

export function SignInPrompt({
  children,
  primary = false,
}: {
  children: string
  primary?: boolean
}) {
  const redirect = useLocation({ select: (location) => location.href })
  return (
    <Link
      className={`c-button c-button--${primary ? 'primary' : 'secondary'}`}
      search={{ redirect }}
      to="/login"
    >
      {children}
    </Link>
  )
}
