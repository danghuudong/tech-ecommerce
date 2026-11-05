import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useCommand, useCommerceQuery, write } from './api'
import {
  AccessGate,
  Action,
  Badge,
  Drawer,
  Empty,
  ErrorNotice,
  Field,
  formatDate,
  Loading,
  PageHeading,
  Pagination,
  Panel,
  QueryError,
} from './components'
import { StaffLayout } from './layouts'
import type { Page, StaffProductQuestion, StaffProductReview } from './types'

const PAGE_SIZE = 20

const questionStatus = {
  pending: { label: 'Chờ trả lời', tone: 'amber' },
  answered: { label: 'Đã trả lời', tone: 'green' },
  hidden: { label: 'Đã ẩn', tone: 'red' },
} as const

const reviewStatus = {
  published: { label: 'Đang hiển thị', tone: 'green' },
  hidden: { label: 'Đã ẩn', tone: 'red' },
} as const

export function FeedbackPage() {
  return (
    <StaffLayout>
      <AccessGate staff roles={['staff', 'admin']}>
        <FeedbackContent />
      </AccessGate>
    </StaffLayout>
  )
}

function FeedbackContent() {
  const [tab, setTab] = useState<'questions' | 'reviews'>('questions')
  return (
    <>
      <PageHeading
        title="Đánh giá & hỏi đáp"
        subtitle="Trả lời câu hỏi của khách và ẩn nội dung không phù hợp."
      />
      <Panel className="c-table-panel">
        <div className="c-tabs">
          <button
            className={tab === 'questions' ? 'is-active' : ''}
            onClick={() => setTab('questions')}
            type="button"
          >
            Hỏi đáp
          </button>
          <button
            className={tab === 'reviews' ? 'is-active' : ''}
            onClick={() => setTab('reviews')}
            type="button"
          >
            Đánh giá
          </button>
        </div>
        {tab === 'questions' ? <QuestionsTable /> : <ReviewsTable />}
      </Panel>
    </>
  )
}

function StatusFilter({
  options,
  value,
  onChange,
}: {
  options: Record<string, { label: string }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="c-filters">
      <Field label="Trạng thái">
        <select
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="">Tất cả</option>
          {Object.entries(options).map(([id, option]) => (
            <option key={id} value={id}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

function QuestionsTable() {
  const [status, setStatus] = useState('pending')
  const [offset, setOffset] = useState(0)
  const [answering, setAnswering] = useState<StaffProductQuestion | null>(null)
  const questions = useCommerceQuery<Page<StaffProductQuestion>>(
    'staff/product-questions',
    { limit: PAGE_SIZE, offset, status: status || undefined },
  )
  const decide = useCommand(
    ({ id, action }: { id: string; action: 'hide' | 'restore' }) =>
      write(`staff/product-questions/${id}`, { action }, 'patch'),
    ['staff/product-questions'],
  )
  return (
    <>
      <StatusFilter
        onChange={(value) => {
          setStatus(value)
          setOffset(0)
        }}
        options={questionStatus}
        value={status}
      />
      <ErrorNotice error={decide.error} />
      {questions.isPending ? (
        <Loading />
      ) : questions.isError ? (
        <QueryError error={questions.error} retry={() => questions.refetch()} />
      ) : (
        <>
          {questions.data.items.length ? (
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>Câu hỏi</th>
                    <th>Khách hàng</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.productName}</td>
                      <td>
                        {item.question}
                        {item.answer && (
                          <>
                            <br />
                            <small>Trả lời: {item.answer}</small>
                          </>
                        )}
                      </td>
                      <td>
                        {item.authorName}
                        <br />
                        <small>{formatDate(item.createdAt)}</small>
                      </td>
                      <td>
                        <Badge tone={questionStatus[item.status].tone}>
                          {questionStatus[item.status].label}
                        </Badge>
                      </td>
                      <td>
                        <div className="c-actions">
                          <Action
                            onClick={() => setAnswering(item)}
                            variant="secondary"
                          >
                            {item.answer ? 'Sửa câu trả lời' : 'Trả lời'}
                          </Action>
                          {item.status === 'hidden' ? (
                            item.answer && (
                              <Action
                                disabled={decide.isPending}
                                onClick={() =>
                                  void decide.run({
                                    id: item.id,
                                    action: 'restore',
                                  })
                                }
                                variant="ghost"
                              >
                                Hiện lại
                              </Action>
                            )
                          ) : (
                            <Action
                              disabled={decide.isPending}
                              onClick={() =>
                                void decide.run({
                                  id: item.id,
                                  action: 'hide',
                                })
                              }
                              variant="ghost"
                            >
                              Ẩn
                            </Action>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Không có câu hỏi"
              description="Câu hỏi mới của khách sẽ xuất hiện tại đây."
            />
          )}
          <Pagination
            count={questions.data.items.length}
            disabled={questions.isFetching}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
            total={questions.data.total}
          />
        </>
      )}
      {answering &&
        createPortal(
          <AnswerDrawer
            onClose={() => setAnswering(null)}
            question={answering}
          />,
          document.body,
        )}
    </>
  )
}

function AnswerDrawer({
  question,
  onClose,
}: {
  question: StaffProductQuestion
  onClose: () => void
}) {
  const answer = useCommand(
    (text: string) =>
      write(
        `staff/product-questions/${question.id}`,
        { action: 'answer', answer: text },
        'patch',
      ),
    ['staff/product-questions'],
  )
  return (
    <Drawer
      busy={answer.isPending}
      onClose={onClose}
      title={question.productName}
    >
      <form
        className="c-form-section"
        onSubmit={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const data = new FormData(event.currentTarget)
          if (await answer.run(String(data.get('answer')).trim())) onClose()
        }}
      >
        <p>{question.question}</p>
        <Field
          label="Câu trả lời *"
          hint="Câu hỏi hiển thị công khai sau khi trả lời."
        >
          <textarea
            defaultValue={question.answer ?? ''}
            maxLength={2000}
            minLength={2}
            name="answer"
            required
            rows={5}
          />
        </Field>
        <ErrorNotice error={answer.error} />
        <div className="c-actions c-actions--end">
          <Action pending={answer.isPending} type="submit">
            Gửi câu trả lời
          </Action>
        </div>
      </form>
    </Drawer>
  )
}

function ReviewsTable() {
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const reviews = useCommerceQuery<Page<StaffProductReview>>(
    'staff/product-reviews',
    { limit: PAGE_SIZE, offset, status: status || undefined },
  )
  const decide = useCommand(
    ({ id, next }: { id: string; next: 'published' | 'hidden' }) =>
      write(`staff/product-reviews/${id}`, { status: next }, 'patch'),
    ['staff/product-reviews'],
  )
  return (
    <>
      <StatusFilter
        onChange={(value) => {
          setStatus(value)
          setOffset(0)
        }}
        options={reviewStatus}
        value={status}
      />
      <ErrorNotice error={decide.error} />
      {reviews.isPending ? (
        <Loading />
      ) : reviews.isError ? (
        <QueryError error={reviews.error} retry={() => reviews.refetch()} />
      ) : (
        <>
          {reviews.data.items.length ? (
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th>Điểm</th>
                    <th>Nhận xét</th>
                    <th>Khách hàng</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.data.items.map((review) => (
                    <tr key={review.id}>
                      <td>{review.productName}</td>
                      <td>{review.rating}/5</td>
                      <td>{review.comment}</td>
                      <td>
                        {review.authorName}
                        <br />
                        <small>{formatDate(review.createdAt)}</small>
                      </td>
                      <td>
                        <Badge tone={reviewStatus[review.status].tone}>
                          {reviewStatus[review.status].label}
                        </Badge>
                      </td>
                      <td>
                        <Action
                          disabled={decide.isPending}
                          onClick={() =>
                            void decide.run({
                              id: review.id,
                              next:
                                review.status === 'hidden'
                                  ? 'published'
                                  : 'hidden',
                            })
                          }
                          variant="ghost"
                        >
                          {review.status === 'hidden' ? 'Hiện lại' : 'Ẩn'}
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Không có đánh giá"
              description="Đánh giá của khách sẽ xuất hiện tại đây."
            />
          )}
          <Pagination
            count={reviews.data.items.length}
            disabled={reviews.isFetching}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
            total={reviews.data.total}
          />
        </>
      )}
    </>
  )
}
