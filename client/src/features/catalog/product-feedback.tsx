import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { CircleHelp, MessageSquareText, Star } from 'lucide-react'
import { useState } from 'react'
import {
  read,
  useCommand,
  useCommerceQuery,
  useSession,
  write,
} from '@/features/commerce/api'
import {
  Action,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  Notice,
  Pagination,
  Panel,
  QueryError,
} from '@/features/commerce/components'
import type {
  CatalogProductDetail,
  MyProductReview,
  ProductQuestionPage,
  ProductReviewPage,
} from '@/features/commerce/types'

const PAGE_SIZE = 5
const MIN_REVIEW_LENGTH = 10
const MIN_QUESTION_LENGTH = 5

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

function SignInPrompt({ children }: { children: string }) {
  const redirect = useLocation({ select: (location) => location.href })
  return (
    <Link
      className="c-button c-button--secondary"
      search={{ redirect }}
      to="/login"
    >
      {children}
    </Link>
  )
}

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
      className="pd-review-form"
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
        <legend>Mức độ hài lòng</legend>
        {[1, 2, 3, 4, 5].map((point) => (
          <label className={point <= rating ? 'is-on' : ''} key={point}>
            <input
              checked={rating === point}
              className="visually-hidden"
              name="rating"
              onChange={() => setRating(point)}
              type="radio"
              value={point}
            />
            <Star aria-hidden="true" fill="currentColor" size={24} />
            <span className="visually-hidden">{point} sao</span>
          </label>
        ))}
      </fieldset>
      <Field
        label="Nhận xét"
        hint={`Tối thiểu ${MIN_REVIEW_LENGTH} ký tự.`}
        wide
      >
        <textarea
          maxLength={2000}
          onChange={(event) => setComment(event.target.value)}
          required
          rows={3}
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
      <div className="pd-feedback-prompt">
        <p>Đăng nhập bằng tài khoản đã mua sản phẩm để đánh giá.</p>
        <SignInPrompt>Đăng nhập để đánh giá</SignInPrompt>
      </div>
    )
  if (mine.isPending) return <Loading />
  if (mine.isError)
    return <QueryError error={mine.error} retry={() => mine.refetch()} />
  if (!mine.data.eligible)
    return (
      <div className="pd-feedback-prompt">
        <p>Bạn có thể đánh giá sau khi nhận được sản phẩm này.</p>
      </div>
    )
  return <ReviewForm mine={mine.data} productId={productId} />
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="pd-avatar">
      {[...name][0]?.toUpperCase()}
    </span>
  )
}

export function ProductReviews({ product }: { product: CatalogProductDetail }) {
  const [offset, setOffset] = useState(0)
  const [composing, setComposing] = useState(false)
  const reviews = useQuery({
    queryKey: ['catalog', 'reviews', product.id, offset],
    queryFn: ({ signal }) =>
      read<ProductReviewPage>(`products/${product.id}/reviews`, {
        signal,
        searchParams: { limit: PAGE_SIZE, offset },
      }),
  })
  const summary = reviews.data?.summary
  return (
    <Panel
      className="pd-feedback"
      icon={<Star size={18} aria-hidden="true" />}
      title="Đánh giá sản phẩm"
    >
      <span className="pd-anchor" id="reviews" />
      <div className="pd-feedback__header">
        <Action
          aria-expanded={composing}
          onClick={() => setComposing((value) => !value)}
          variant="secondary"
        >
          Viết đánh giá
        </Action>
      </div>
      {composing && <ReviewComposer productId={product.id} />}
      {reviews.isPending ? (
        <Loading />
      ) : reviews.isError ? (
        <QueryError error={reviews.error} retry={() => reviews.refetch()} />
      ) : (
        <>
          {summary?.average != null && (
            <div className="pd-review-summary">
              <div className="pd-review-summary__score">
                <strong>{summary.average.toFixed(1)}</strong>
                <Stars rating={summary.average} size={18} />
                <small>{summary.count} đánh giá</small>
              </div>
              <ul>
                {summary.distribution.map(({ rating, total }) => (
                  <li key={rating}>
                    <span>{rating} sao</span>
                    <span className="pd-review-summary__bar">
                      <span
                        style={{
                          width: `${(total / summary.count) * 100}%`,
                        }}
                      />
                    </span>
                    <span>{total}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reviews.data.items.length ? (
            <ul className="pd-feedback-list">
              {reviews.data.items.map((review) => (
                <li key={review.id}>
                  <Avatar name={review.author} />
                  <div className="pd-feedback-list__body">
                    <div className="pd-feedback-list__meta">
                      <strong>{review.author}</strong>
                      <span className="pd-verified">Đã mua hàng</span>
                      <small>{formatDate(review.createdAt, false)}</small>
                    </div>
                    <Stars rating={review.rating} size={14} />
                    <p>{review.comment}</p>
                    <small>Phiên bản: {review.productName}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="Chưa có đánh giá"
              description="Đánh giá từ khách đã nhận hàng sẽ hiển thị tại đây."
            />
          )}
          {reviews.data.total > PAGE_SIZE && (
            <Pagination
              count={reviews.data.items.length}
              disabled={reviews.isFetching}
              limit={PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
              total={reviews.data.total}
            />
          )}
        </>
      )}
    </Panel>
  )
}

function QuestionForm({ productId }: { productId: string }) {
  const session = useSession()
  const [question, setQuestion] = useState('')
  const [sent, setSent] = useState(false)
  const ask = useCommand(
    (input: { question: string }) =>
      write(`products/${productId}/questions`, input),
    [],
  )
  if (!session.data)
    return (
      <div className="pd-feedback-prompt">
        <p>Đăng nhập để đặt câu hỏi về sản phẩm này.</p>
        <SignInPrompt>Đăng nhập để hỏi</SignInPrompt>
      </div>
    )
  const trimmed = question.trim()
  return (
    <form
      className="pd-review-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setSent(false)
        if (await ask.run({ question: trimmed })) {
          setQuestion('')
          setSent(true)
        }
      }}
    >
      <Field label="Câu hỏi của bạn" wide>
        <textarea
          maxLength={1000}
          onChange={(event) => setQuestion(event.target.value)}
          required
          rows={2}
          value={question}
        />
      </Field>
      <ErrorNotice error={ask.error} />
      {sent && (
        <Notice tone="green">
          Đã gửi câu hỏi. Câu hỏi sẽ hiển thị sau khi TinovaShop trả lời.
        </Notice>
      )}
      <Action
        disabled={trimmed.length < MIN_QUESTION_LENGTH}
        pending={ask.isPending}
        type="submit"
      >
        Gửi câu hỏi
      </Action>
    </form>
  )
}

export function ProductQuestions({
  product,
}: {
  product: CatalogProductDetail
}) {
  const [offset, setOffset] = useState(0)
  const [composing, setComposing] = useState(false)
  const questions = useQuery({
    queryKey: ['catalog', 'questions', product.id, offset],
    queryFn: ({ signal }) =>
      read<ProductQuestionPage>(`products/${product.id}/questions`, {
        signal,
        searchParams: { limit: PAGE_SIZE, offset },
      }),
  })
  return (
    <Panel
      className="pd-feedback"
      icon={<CircleHelp size={18} aria-hidden="true" />}
      title="Hỏi đáp"
    >
      <div className="pd-feedback__header">
        <Action
          aria-expanded={composing}
          onClick={() => setComposing((value) => !value)}
          variant="secondary"
        >
          Gửi câu hỏi
        </Action>
      </div>
      {composing && <QuestionForm productId={product.id} />}
      {questions.isPending ? (
        <Loading />
      ) : questions.isError ? (
        <QueryError error={questions.error} retry={() => questions.refetch()} />
      ) : questions.data.items.length ? (
        <>
          <ul className="pd-feedback-list">
            {questions.data.items.map((item) => (
              <li key={item.id}>
                <Avatar name={item.author} />
                <div className="pd-feedback-list__body">
                  <div className="pd-feedback-list__meta">
                    <strong>{item.author}</strong>
                    <small>{formatDate(item.createdAt, false)}</small>
                  </div>
                  <p>{item.question}</p>
                  <div className="pd-answer">
                    <MessageSquareText size={15} aria-hidden="true" />
                    <div>
                      <strong>
                        TinovaShop
                        <span className="pd-answer__tag">QTV</span>
                      </strong>
                      <p>{item.answer}</p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {questions.data.total > PAGE_SIZE && (
            <Pagination
              count={questions.data.items.length}
              disabled={questions.isFetching}
              limit={PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
              total={questions.data.total}
            />
          )}
        </>
      ) : (
        <Empty
          title="Chưa có câu hỏi"
          description="Hãy là người đầu tiên đặt câu hỏi về sản phẩm này."
        />
      )}
    </Panel>
  )
}
