import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { BadgeCheck, Clock3, Star, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  read,
  useCommand,
  useCommerceQuery,
  useSession,
  write,
} from '@/features/commerce/api'
import {
  Action,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  Pagination,
  QueryError,
} from '@/features/commerce/components'
import type {
  CatalogProductDetail,
  MyProductReview,
  ProductReview,
  ProductReviewPage,
} from '@/features/commerce/types'
import {
  FEEDBACK_PAGE_SIZE,
  FeedbackAvatar,
  SignInPrompt,
  Stars,
} from './product-feedback'

const MIN_REVIEW_LENGTH = 10
const MAX_REVIEW_LENGTH = 2000
const RATING_LABELS = ['Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Tuyệt vời']

function ReviewForm({
  productId,
  mine,
}: {
  productId: string
  mine: MyProductReview
}) {
  const client = useQueryClient()
  const [rating, setRating] = useState(mine.review?.rating ?? 5)
  const [comment, setComment] = useState(mine.review?.comment ?? '')
  const [saved, setSaved] = useState(false)
  const save = useCommand(
    (input: { rating: number; comment: string }) =>
      write(`products/${productId}/my-review`, input, 'put'),
    [`products/${productId}/my-review`],
  )
  const trimmed = comment.trim()
  return (
    <form
      className="pd-feedback-compose"
      onSubmit={async (event) => {
        event.preventDefault()
        setSaved(false)
        if (await save.run({ rating, comment: trimmed })) {
          setSaved(true)
          await client.invalidateQueries({ queryKey: ['catalog'] })
        }
      }}
    >
      <h3>{mine.review ? 'Sửa đánh giá của bạn' : 'Viết đánh giá'}</h3>
      {mine.review?.status === 'hidden' && (
        <Notice tone="amber">
          Đánh giá này đang bị ẩn vì không phù hợp với quy định của cửa hàng.
        </Notice>
      )}
      <fieldset className="pd-rating-input">
        <legend>Đánh giá chung</legend>
        <div className="pd-rating-input__stars">
          {[1, 2, 3, 4, 5].map((point) => (
            <label className={point <= rating ? 'is-on' : ''} key={point}>
              <input
                checked={rating === point}
                className="sr-only"
                name="rating"
                onChange={() => setRating(point)}
                type="radio"
                value={point}
              />
              <Star aria-hidden="true" fill="currentColor" size={30} />
              <span>{RATING_LABELS[point - 1]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        hint={`Tối thiểu ${MIN_REVIEW_LENGTH} ký tự. Đã nhập ${trimmed.length}/${MAX_REVIEW_LENGTH}.`}
        label="Nhận xét của bạn"
        wide
      >
        <textarea
          maxLength={MAX_REVIEW_LENGTH}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Chia sẻ trải nghiệm thực tế về sản phẩm, dịch vụ và giao hàng…"
          required
          rows={4}
          value={comment}
        />
      </Field>
      <ErrorNotice error={save.error} />
      {saved && <Notice tone="green">Đã lưu đánh giá của bạn.</Notice>}
      <Action
        disabled={trimmed.length < MIN_REVIEW_LENGTH}
        pending={save.isPending}
        type="submit"
      >
        Gửi đánh giá
      </Action>
    </form>
  )
}

function ReviewComposer({ productId }: { productId: string }) {
  const session = useSession()
  const mine = useCommerceQuery<MyProductReview>(
    `products/${productId}/my-review`,
  )
  if (!session.data)
    return (
      <div className="pd-feedback-compose pd-feedback-compose--note">
        <p>Đăng nhập bằng tài khoản đã mua sản phẩm để viết đánh giá.</p>
        <SignInPrompt>Đăng nhập để đánh giá</SignInPrompt>
      </div>
    )
  if (mine.isPending) return <Loading />
  if (mine.isError)
    return <QueryError error={mine.error} retry={() => mine.refetch()} />
  if (!mine.data.eligible)
    return (
      <div className="pd-feedback-compose pd-feedback-compose--note">
        <p>Bạn có thể đánh giá sau khi đã nhận được sản phẩm này.</p>
      </div>
    )
  return <ReviewForm mine={mine.data} productId={productId} />
}

function ReviewSummary({
  summary,
  children,
}: {
  summary: ProductReviewPage['summary']
  children: React.ReactNode
}) {
  const average = summary.average
  return (
    <div className="pd-review-summary">
      <div className="pd-review-summary__score">
        {average === null ? (
          <span className="pd-review-summary__no-score">
            Chưa có lượt đánh giá
          </span>
        ) : (
          <strong>
            {average.toFixed(1)}
            <small>/5</small>
          </strong>
        )}
        <Stars rating={average ?? 0} size={18} />
        <span>{summary.count} lượt đánh giá</span>
        {children}
      </div>
      <ul className="pd-review-summary__bars">
        {summary.distribution.map(({ rating, total }) => (
          <li key={rating}>
            <span>
              {rating} <Star aria-hidden="true" fill="currentColor" size={12} />
            </span>
            <progress
              aria-label={`${rating} sao`}
              className="pd-review-summary__bar"
              max={summary.count || 1}
              value={total}
            />
            <span>{total} đánh giá</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReviewFilters({
  summary,
  selected,
  onSelect,
}: {
  summary: ProductReviewPage['summary']
  selected: number | null
  onSelect: (rating: number | null) => void
}) {
  return (
    <fieldset aria-label="Lọc theo số sao" className="pd-review-filters">
      <button
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        type="button"
      >
        Tất cả ({summary.count})
      </button>
      {summary.distribution.map(({ rating, total }) => (
        <button
          aria-pressed={selected === rating}
          key={rating}
          onClick={() => onSelect(rating)}
          type="button"
        >
          {rating} sao ({total})
        </button>
      ))}
    </fieldset>
  )
}

function ReviewItem({ review }: { review: ProductReview }) {
  return (
    <li className="pd-review">
      <div className="pd-review__author">
        <FeedbackAvatar name={review.author} />
        <strong>{review.author}</strong>
      </div>
      <div className="pd-review__body">
        <div className="pd-review__rating">
          <Stars rating={review.rating} size={14} />
          <span>{RATING_LABELS[review.rating - 1]}</span>
          <span className="pd-verified">
            <BadgeCheck aria-hidden="true" size={14} />
            Đã mua hàng
          </span>
        </div>
        <span className="pd-review__variant">
          Phiên bản: {review.productName}
        </span>
        <p>{review.comment}</p>
        <time dateTime={review.createdAt}>
          <Clock3 aria-hidden="true" size={13} />
          {formatDate(review.createdAt, false)}
        </time>
      </div>
    </li>
  )
}

export function ProductReviews({ product }: { product: CatalogProductDetail }) {
  const [offset, setOffset] = useState(0)
  const [rating, setRating] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const reviews = useQuery({
    queryKey: ['catalog', 'reviews', product.id, rating, offset],
    queryFn: ({ signal }) =>
      read<ProductReviewPage>(`products/${product.id}/reviews`, {
        signal,
        searchParams: {
          limit: FEEDBACK_PAGE_SIZE,
          offset,
          ...(rating ? { rating } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  })
  return (
    <section
      aria-labelledby="reviews-title"
      className="pd-feedback pd-anchor"
      id="reviews"
    >
      <h2 className="pd-feedback__title" id="reviews-title">
        Đánh giá {product.name}
      </h2>
      {reviews.isPending ? (
        <Loading />
      ) : reviews.isError ? (
        <QueryError error={reviews.error} retry={() => reviews.refetch()} />
      ) : (
        <>
          <ReviewSummary summary={reviews.data.summary}>
            <Action
              aria-haspopup="dialog"
              onClick={() => {
                dialog.current?.showModal()
                setComposing(true)
              }}
            >
              Viết đánh giá
            </Action>
          </ReviewSummary>
          <div className="pd-feedback-results">
            <ReviewFilters
              onSelect={(next) => {
                setRating(next)
                setOffset(0)
              }}
              selected={rating}
              summary={reviews.data.summary}
            />
            {reviews.data.items.length ? (
              <ul
                aria-busy={reviews.isPlaceholderData}
                className="pd-review-list"
              >
                {reviews.data.items.map((review) => (
                  <ReviewItem key={review.id} review={review} />
                ))}
              </ul>
            ) : (
              <p aria-live="polite" className="pd-review-empty">
                {rating
                  ? 'Chưa có đánh giá ở mức sao này'
                  : 'Chưa có đánh giá nào'}
              </p>
            )}
            {reviews.data.total > FEEDBACK_PAGE_SIZE && (
              <Pagination
                count={reviews.data.items.length}
                disabled={reviews.isFetching}
                limit={FEEDBACK_PAGE_SIZE}
                offset={offset}
                onChange={setOffset}
                total={reviews.data.total}
              />
            )}
          </div>
        </>
      )}
      <dialog
        aria-labelledby="pd-review-dialog-title"
        className="pd-review-dialog"
        onClose={() => setComposing(false)}
        ref={dialog}
      >
        <header className="pd-review-dialog__header">
          <h2 id="pd-review-dialog-title">Đánh giá và nhận xét</h2>
          <button
            aria-label="Đóng cửa sổ đánh giá"
            className="pd-review-dialog__close"
            onClick={() => dialog.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        {composing && <ReviewComposer productId={product.id} />}
      </dialog>
    </section>
  )
}
