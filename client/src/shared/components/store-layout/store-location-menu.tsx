import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { type StoreProvince, storeProvinces } from './store-location.data'
import './store-location-menu.css'

const STORAGE_KEY = 'tinovashop:province:v1'

function parseProvince(value: string | null): StoreProvince | null {
  return storeProvinces.find((province) => province === value) ?? null
}

function readProvince(): StoreProvince | null {
  try {
    return parseProvince(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim()
}

export function StoreLocationMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [province, setProvince] = useState(readProvince)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function syncProvince(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      try {
        if (event.storageArea !== window.localStorage) return
      } catch {
        return
      }
      setProvince(parseProvince(event.newValue))
    }
    window.addEventListener('storage', syncProvince)
    return () => window.removeEventListener('storage', syncProvince)
  }, [])

  function selectProvince(value: StoreProvince) {
    setProvince(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Keep the current selection usable when browser storage is unavailable.
    }
    onOpenChange(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="store-action store-location"
          aria-label={`Chọn khu vực: ${province ?? 'Chưa chọn tỉnh/thành'}`}
          title={province ?? 'Chọn tỉnh/thành'}
        >
          <MapPin aria-hidden="true" size={21} />
          <span className="store-location__copy">
            <span className="store-location__label">Khu vực của bạn</span>
            <span className="store-location__value">
              {province ?? 'Chọn tỉnh/thành'}
            </span>
          </span>
          <ChevronDown
            className="store-location__chevron"
            aria-hidden="true"
            size={14}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="store-header-popup store-location-panel"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Chọn khu vực của bạn"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
        >
          <div className="store-location-panel__heading">
            <strong>Chọn tỉnh/thành phố</strong>
            <Popover.Close
              className="store-location-panel__close"
              aria-label="Đóng chọn khu vực"
            >
              <X aria-hidden="true" size={20} />
            </Popover.Close>
          </div>
          <ProvinceOptions
            province={province}
            onSelect={selectProvince}
            searchRef={searchRef}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ProvinceOptions({
  province,
  onSelect,
  searchRef,
}: {
  province: StoreProvince | null
  onSelect: (province: StoreProvince) => void
  searchRef: RefObject<HTMLInputElement | null>
}) {
  const [query, setQuery] = useState('')
  const matchingProvinces = storeProvinces.filter((item) =>
    normalize(item).includes(normalize(query)),
  )

  return (
    <>
      <label className="store-location-panel__search">
        <Search aria-hidden="true" size={18} />
        <input
          ref={searchRef}
          type="search"
          placeholder="Tìm tỉnh/thành phố"
          aria-label="Tìm tỉnh/thành phố"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {matchingProvinces.length ? (
        <ul
          className="store-location-panel__options"
          aria-label="Tỉnh/thành phố"
        >
          {matchingProvinces.map((item) => (
            <li key={item}>
              <button
                type="button"
                aria-pressed={province === item}
                onClick={() => onSelect(item)}
              >
                {item}
                {province === item && <Check aria-hidden="true" size={17} />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="store-location-panel__empty" role="status">
          Không tìm thấy tỉnh/thành phố phù hợp.
        </p>
      )}
    </>
  )
}
