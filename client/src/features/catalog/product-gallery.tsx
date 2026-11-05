import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CatalogProductDetail } from '@/features/commerce/types'
import { productArt, productImageUrl } from './product-view'

export function ProductGallery({ product }: { product: CatalogProductDetail }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const count = product.images.length
  const index = selectedIndex < count ? selectedIndex : 0
  const selected = product.images[index]
  if (!selected)
    return (
      <div className="pd-gallery__stage">
        <div
          aria-label={`${product.name}, ảnh minh họa`}
          className={`product-art product-art--${productArt(product)}`}
          role="img"
        />
      </div>
    )

  function changeImage(direction: -1 | 1) {
    setSelectedIndex((index + direction + count) % count)
  }

  return (
    <section aria-label="Thư viện ảnh sản phẩm" className="pd-gallery">
      <div className="pd-gallery__stage">
        <button
          aria-label="Phóng to ảnh sản phẩm"
          className="pd-gallery__zoom"
          onClick={() => dialog.current?.showModal()}
          type="button"
        >
          <img
            alt={selected.altText || product.name}
            fetchPriority="high"
            src={productImageUrl(selected.id)}
          />
          <span className="pd-gallery__expand" aria-hidden="true">
            <Maximize2 size={15} />
          </span>
        </button>
        {count > 1 && (
          <>
            <button
              aria-label="Ảnh trước"
              className="pd-gallery__arrow pd-gallery__arrow--previous"
              onClick={() => changeImage(-1)}
              type="button"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              aria-label="Ảnh tiếp theo"
              className="pd-gallery__arrow pd-gallery__arrow--next"
              onClick={() => changeImage(1)}
              type="button"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <fieldset className="pd-gallery__thumbs" aria-label="Chọn ảnh">
        {product.images.map((image, index) => (
          <button
            aria-label={`Xem ảnh ${index + 1}`}
            aria-pressed={image.id === selected.id}
            key={image.id}
            onClick={() => setSelectedIndex(index)}
            type="button"
          >
            <img alt="" loading="lazy" src={productImageUrl(image.id)} />
          </button>
        ))}
      </fieldset>
      <dialog
        aria-label="Ảnh sản phẩm"
        className="pd-gallery__dialog"
        ref={dialog}
      >
        <button
          aria-label="Đóng ảnh phóng to"
          className="pd-gallery__close"
          onClick={() => dialog.current?.close()}
          type="button"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <img
          alt={selected.altText || product.name}
          src={productImageUrl(selected.id)}
        />
      </dialog>
    </section>
  )
}
