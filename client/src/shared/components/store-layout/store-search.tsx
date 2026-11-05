import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Package, Search } from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
} from 'react'
import {
  discountPercent,
  productImageUrl,
} from '@/features/catalog/product-view'
import { read } from '@/features/commerce/api'
import { formatMoney } from '@/features/commerce/components'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import './store-search.css'

const MIN_QUERY_LENGTH = 2
const SUGGESTION_LIMIT = 6
const TYPING_DELAY_MS = 250

function useDebouncedValue(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), TYPING_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [value])
  return debounced
}

export function StoreSearch({
  query,
  onSubmit,
  onNavigate,
  onOpenChange,
}: {
  query: string
  onSubmit: (value: string) => void
  onNavigate: () => void
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const listId = useId()
  const [searchText, setSearchText] = useState(query)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const trimmedText = searchText.trim()
  const term = useDebouncedValue(trimmedText)
  const suggestions = useQuery({
    queryKey: ['catalog', 'search-suggestions', term],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { q: term, limit: SUGGESTION_LIMIT },
      }),
    enabled: isOpen && term.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const items = suggestions.data?.items ?? []
  const total = suggestions.data?.total ?? items.length
  const isCurrent = term === trimmedText && !suggestions.isPlaceholderData
  const showPanel = isOpen && trimmedText.length >= MIN_QUERY_LENGTH
  const showList = showPanel && items.length > 0
  const activeId = showList && items[activeIndex] ? optionId(activeIndex) : null

  function optionId(index: number) {
    return `${listId}-${index}`
  }

  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeId])

  // The header remounts this box on navigation, so unmounting must also report.
  useEffect(() => {
    onOpenChange(isOpen)
    return () => onOpenChange(false)
  }, [isOpen, onOpenChange])

  function close() {
    setIsOpen(false)
    setActiveIndex(-1)
    onNavigate()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsOpen(false)
    onSubmit(searchText)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Vietnamese input methods use these keys while composing a word.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
      setActiveIndex(-1)
      return
    }
    if (!showPanel) return
    const count = items.length
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault()
      setActiveIndex((current) => ((current + 2) % (count + 1)) - 1)
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault()
      setActiveIndex((current) => ((current + count + 1) % (count + 1)) - 1)
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      close()
      void navigate({
        to: '/products/$productId',
        params: { productId: items[activeIndex].id },
      })
    }
  }

  return (
    <search
      className="store-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <form className="store-search__form" onSubmit={handleSubmit}>
        <input
          aria-activedescendant={activeId ?? undefined}
          aria-autocomplete="list"
          aria-controls={showList ? listId : undefined}
          aria-expanded={showList}
          aria-label="Tìm laptop, điện thoại, phụ kiện"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={120}
          onChange={(event) => {
            setSearchText(event.target.value)
            setIsOpen(true)
            setActiveIndex(-1)
          }}
          onClick={() => setIsOpen(true)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Bạn muốn tìm gì hôm nay?"
          role="combobox"
          type="search"
          value={searchText}
        />
        <button
          aria-label="Tìm kiếm"
          className="store-search__submit"
          type="submit"
        >
          <Search aria-hidden="true" size={20} />
        </button>
      </form>
      {showPanel && (
        // biome-ignore lint/a11y/noStaticElementInteractions: keeps focus in the input so choosing a result never closes the panel first.
        <div
          aria-busy={!isCurrent}
          className="store-search-panel"
          onMouseDown={(event) => event.preventDefault()}
        >
          {showList ? (
            <>
              <p className="store-search-panel__title">Sản phẩm gợi ý</p>
              <div
                aria-label="Sản phẩm gợi ý"
                className="store-search-panel__list"
                id={listId}
                role="listbox"
              >
                {items.map((product, index) => (
                  <SearchResult
                    id={optionId(index)}
                    isActive={index === activeIndex}
                    key={product.id}
                    onClick={close}
                    product={product}
                  />
                ))}
              </div>
              {total > items.length && (
                <Link
                  className="store-search-panel__all"
                  onClick={close}
                  search={{ q: trimmedText }}
                  to="/products"
                >
                  Xem tất cả {total} kết quả
                  <ChevronRight aria-hidden="true" size={16} />
                </Link>
              )}
            </>
          ) : (
            <p className="store-search-panel__status" role="status">
              {!isCurrent || suggestions.isPending
                ? 'Đang tìm sản phẩm…'
                : suggestions.isError
                  ? 'Chưa tải được gợi ý. Nhấn Enter để xem trang kết quả.'
                  : `Không tìm thấy sản phẩm nào cho “${trimmedText}”.`}
            </p>
          )}
        </div>
      )}
    </search>
  )
}

function SearchResult({
  product,
  id,
  isActive,
  onClick,
}: {
  product: CatalogProduct
  id: string
  isActive: boolean
  onClick: () => void
}) {
  const imageId = product.primaryImageId
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const discount = discountPercent(product)

  return (
    <Link
      aria-selected={isActive}
      className="store-search-result"
      id={id}
      onClick={onClick}
      params={{ productId: product.id }}
      role="option"
      tabIndex={-1}
      to="/products/$productId"
    >
      <span className="store-search-result__media">
        {imageId && imageId !== failedImage ? (
          <img
            alt=""
            decoding="async"
            onError={() => setFailedImage(imageId)}
            src={productImageUrl(imageId)}
          />
        ) : (
          <Package aria-hidden="true" size={22} />
        )}
      </span>
      <span className="store-search-result__text">
        <span className="store-search-result__name">{product.name}</span>
        <span className="store-search-result__price">
          <strong>{formatMoney(product.priceVnd)}</strong>
          {discount && (
            <>
              <s>{formatMoney(product.listPriceVnd)}</s>
              <span className="store-search-result__discount">
                -{discount}%
              </span>
            </>
          )}
        </span>
      </span>
    </Link>
  )
}
