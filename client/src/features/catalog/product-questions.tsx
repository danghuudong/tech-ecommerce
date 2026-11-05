import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, Clock3 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { read, useCommand, useSession, write } from '@/features/commerce/api'
import {
  Action,
  ErrorNotice,
  formatDate,
  Loading,
  Notice,
  Pagination,
  QueryError,
} from '@/features/commerce/components'
import type {
  CatalogProductDetail,
  ProductQuestion,
  ProductQuestionPage,
} from '@/features/commerce/types'
import {
  FEEDBACK_PAGE_SIZE,
  FeedbackAvatar,
  SignInPrompt,
} from './product-feedback'

const MIN_QUESTION_LENGTH = 5
const MAX_QUESTION_LENGTH = 1000

function QuestionComposer({ productId }: { productId: string }) {
  const session = useSession()
  const [question, setQuestion] = useState('')
  const [sent, setSent] = useState(false)
  const [showValidation, setShowValidation] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const validationId = useId()
  const ask = useCommand(
    (input: { question: string }) =>
      write(`products/${productId}/questions`, input),
    [],
  )
  const trimmed = question.trim()
  const invalid = showValidation && trimmed.length < MIN_QUESTION_LENGTH
  return (
    <form
      className="pd-question-box"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault()
        if (!session.data || ask.isPending) return
        setSent(false)
        if (trimmed.length < MIN_QUESTION_LENGTH) {
          setShowValidation(true)
          input.current?.focus()
          return
        }
        setShowValidation(false)
        if (await ask.run({ question: trimmed })) {
          setQuestion('')
          setSent(true)
        }
      }}
    >
      <h3>Đặt câu hỏi cho TinovaShop</h3>
      <p>
        Bạn có thể hỏi về sản phẩm hoặc tình trạng còn hàng. TinovaShop sẽ phản
        hồi tại đây.
      </p>
      <div className="pd-question-box__field">
        <textarea
          aria-describedby={invalid ? validationId : undefined}
          aria-invalid={invalid || undefined}
          aria-label="Câu hỏi của bạn"
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={
            session.data
              ? 'Viết câu hỏi của bạn tại đây'
              : 'Đăng nhập để viết câu hỏi'
          }
          readOnly={!session.data || ask.isPending}
          ref={input}
          required={Boolean(session.data)}
          rows={2}
          value={question}
        />
        <div className="pd-question-box__toolbar">
          {session.data ? (
            <>
              <span className="pd-question-box__count">
                {question.length}/{MAX_QUESTION_LENGTH} ký tự
              </span>
              <Action disabled={ask.isPending} type="submit">
                {ask.isPending ? 'Đang gửi…' : 'Gửi câu hỏi'}
              </Action>
            </>
          ) : (
            <SignInPrompt primary>Đăng nhập để hỏi</SignInPrompt>
          )}
        </div>
      </div>
      {invalid && (
        <span
          className="pd-question-box__validation"
          id={validationId}
          role="alert"
        >
          Câu hỏi cần ít nhất {MIN_QUESTION_LENGTH} ký tự.
        </span>
      )}
      <ErrorNotice error={ask.error} />
      {sent && (
        <Notice tone="green">
          Đã gửi câu hỏi. Câu hỏi sẽ hiển thị sau khi TinovaShop trả lời.
        </Notice>
      )}
    </form>
  )
}

function QuestionItem({ item }: { item: ProductQuestion }) {
  return (
    <li className="pd-thread">
      <div className="pd-thread__message">
        <FeedbackAvatar name={item.author} />
        <div>
          <div className="pd-thread__meta">
            <strong>{item.author}</strong>
            <time dateTime={item.createdAt}>
              <Clock3 aria-hidden="true" size={13} />
              {formatDate(item.createdAt, false)}
            </time>
          </div>
          <p>{item.question}</p>
        </div>
      </div>
      <details className="pd-thread__responses" open>
        <summary>
          <span className="pd-thread__expand">Xem phản hồi</span>
          <span className="pd-thread__collapse">Thu gọn phản hồi</span>
          <ChevronDown aria-hidden="true" size={14} />
        </summary>
        <div className="pd-thread__reply">
          <span aria-hidden="true" className="pd-avatar pd-avatar--shop">
            T
          </span>
          <div>
            <div className="pd-thread__meta">
              <strong>TinovaShop</strong>
              <span className="pd-thread__tag">QTV</span>
              <time dateTime={item.answeredAt}>
                <Clock3 aria-hidden="true" size={13} />
                {formatDate(item.answeredAt, false)}
              </time>
            </div>
            <p>{item.answer}</p>
          </div>
        </div>
      </details>
    </li>
  )
}

export function ProductQuestions({
  product,
}: {
  product: CatalogProductDetail
}) {
  const [offset, setOffset] = useState(0)
  const questions = useQuery({
    queryKey: ['catalog', 'questions', product.id, offset],
    queryFn: ({ signal }) =>
      read<ProductQuestionPage>(`products/${product.id}/questions`, {
        signal,
        searchParams: { limit: FEEDBACK_PAGE_SIZE, offset },
      }),
    placeholderData: keepPreviousData,
  })
  const total = questions.data?.total ?? 0
  return (
    <section
      aria-labelledby="questions-title"
      className="pd-feedback pd-anchor"
      id="questions"
    >
      <h2 className="pd-feedback__title" id="questions-title">
        Hỏi và đáp{total ? ` (${total})` : ''}
      </h2>
      <QuestionComposer productId={product.id} />
      {questions.isPending ? (
        <Loading />
      ) : questions.isError ? (
        <QueryError error={questions.error} retry={() => questions.refetch()} />
      ) : questions.data.items.length ? (
        <div className="pd-feedback-results">
          <ul
            aria-busy={questions.isPlaceholderData}
            className="pd-thread-list"
          >
            {questions.data.items.map((item) => (
              <QuestionItem item={item} key={item.id} />
            ))}
          </ul>
          {total > FEEDBACK_PAGE_SIZE && (
            <Pagination
              count={questions.data.items.length}
              disabled={questions.isFetching}
              limit={FEEDBACK_PAGE_SIZE}
              offset={offset}
              onChange={setOffset}
              total={total}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}
