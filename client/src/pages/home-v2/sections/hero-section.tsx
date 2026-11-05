import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { CategoryMenu } from '@/shared/components/store-layout/category-menu'
import {
  heroBanners,
  heroImagePath,
  heroSideBanners,
} from './hero-section.data'

const SWIPE_THRESHOLD_PX = 40

type SlideDirection = 1 | -1

export function HeroSection() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [slideChange, setSlideChange] = useState<{
    from: number
    direction: SlideDirection
  } | null>(null)
  const [rotationEnabled, setRotationEnabled] = useState(true)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const tabsRef = useRef<HTMLFieldSetElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const viewportId = useId()
  const isPaused = !rotationEnabled || isHovered || isFocused

  function showBanner(index: number, direction: SlideDirection) {
    if (index === activeIndex) return
    setSlideChange({ from: activeIndex, direction })
    setActiveIndex(index)
  }

  function changeBanner(direction: SlideDirection) {
    showBanner(
      (activeIndex + direction + heroBanners.length) % heroBanners.length,
      direction,
    )
  }

  useEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    tabs.scrollTo({
      left: (Math.max(0, activeIndex - 1) * tabs.clientWidth) / 3,
      behavior: reducedMotion.matches ? 'instant' : 'smooth',
    })
  }, [activeIndex])

  return (
    <section aria-labelledby="hero-title" className="hv2-home-hero">
      <h1 className="sr-only" id="hero-title">
        Sản phẩm công nghệ và khuyến mãi nổi bật
      </h1>
      <CategoryMenu variant="hero" />
      <div className="hv2-home-hero__center">
        <section
          aria-label="Khuyến mãi nổi bật"
          aria-roledescription="băng chuyền"
          className="hv2-hero-carousel"
          data-paused={isPaused || undefined}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setIsFocused(false)
            }
          }}
          onFocusCapture={(event) => {
            // A mouse click must not hold the rotation after the pointer leaves.
            setIsFocused(event.target.matches(':focus-visible'))
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') setIsHovered(true)
          }}
          onPointerLeave={() => setIsHovered(false)}
        >
          <div
            className="hv2-hero-carousel__viewport"
            id={viewportId}
            onTouchCancel={() => {
              touchStart.current = null
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current
              const end = event.changedTouches[0]
              touchStart.current = null
              if (!start || !end) return
              const distanceX = start.x - end.clientX
              const distanceY = start.y - end.clientY
              if (
                Math.abs(distanceX) >= SWIPE_THRESHOLD_PX &&
                Math.abs(distanceX) > Math.abs(distanceY)
              ) {
                changeBanner(distanceX > 0 ? 1 : -1)
              }
            }}
            onTouchStart={(event) => {
              const touch = event.touches[0]
              touchStart.current = touch
                ? { x: touch.clientX, y: touch.clientY }
                : null
            }}
          >
            <div
              className="hv2-hero-carousel__track"
              data-direction={slideChange?.direction}
            >
              {heroBanners.map((banner, index) => (
                <Link
                  aria-hidden={index !== activeIndex}
                  className={`hv2-hero-carousel__slide${
                    index === activeIndex
                      ? ' is-active'
                      : index === slideChange?.from
                        ? ' is-leaving'
                        : ''
                  }`}
                  key={banner.id}
                  search={banner.search}
                  tabIndex={index === activeIndex ? 0 : -1}
                  to="/products"
                >
                  <img
                    alt={`${banner.title} - ${banner.subtitle}`}
                    className="hv2-hero-carousel__image"
                    decoding="async"
                    draggable={false}
                    fetchPriority={index === 0 ? 'high' : 'auto'}
                    height={388}
                    loading={index < 2 ? 'eager' : 'lazy'}
                    src={`${heroImagePath}${banner.image}`}
                    width={800}
                  />
                </Link>
              ))}
            </div>
            <button
              aria-controls={viewportId}
              aria-label="Banner trước"
              className="hv2-hero-carousel__arrow hv2-hero-carousel__arrow--previous"
              onClick={() => changeBanner(-1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={19} strokeWidth={1.5} />
            </button>
            <button
              aria-controls={viewportId}
              aria-label="Banner sau"
              className="hv2-hero-carousel__arrow hv2-hero-carousel__arrow--next"
              onClick={() => changeBanner(1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={19} strokeWidth={1.5} />
            </button>
            <button
              aria-label={
                rotationEnabled
                  ? 'Tạm dừng tự chuyển banner'
                  : 'Tự chuyển banner'
              }
              aria-pressed={rotationEnabled}
              className="hv2-hero-carousel__rotation"
              onClick={() => setRotationEnabled((current) => !current)}
              type="button"
            >
              {rotationEnabled ? (
                <Pause aria-hidden="true" size={12} />
              ) : (
                <Play aria-hidden="true" size={12} />
              )}
            </button>
          </div>
          <fieldset
            aria-label="Chọn khuyến mãi"
            className="hv2-hero-carousel__tabs"
            ref={tabsRef}
          >
            {heroBanners.map((banner, index) => (
              <button
                aria-controls={viewportId}
                aria-pressed={activeIndex === index}
                className="hv2-hero-carousel__tab"
                key={banner.id}
                onClick={() => showBanner(index, index > activeIndex ? 1 : -1)}
                type="button"
              >
                <span className="hv2-hero-carousel__tab-title">
                  {banner.title}
                </span>
                <span className="hv2-hero-carousel__tab-subtitle">
                  {banner.subtitle}
                </span>
                {/* The bar's CSS animation is the rotation timer, so a hover
                    pause resumes where it stopped. */}
                {rotationEnabled && activeIndex === index && (
                  <span
                    aria-hidden="true"
                    className="hv2-hero-carousel__tab-progress"
                    onAnimationEnd={() => changeBanner(1)}
                  />
                )}
              </button>
            ))}
          </fieldset>
          <p
            aria-atomic="true"
            aria-live={isPaused ? 'polite' : 'off'}
            className="sr-only"
          >
            Banner {activeIndex + 1} trên {heroBanners.length}:{' '}
            {heroBanners[activeIndex].title}
          </p>
        </section>
        <Link
          className="hv2-hero-wide"
          search={{ q: 'iPhone 18 Pro' }}
          to="/products"
        >
          <img
            alt="Chính thức mở bán iPhone 18 Pro, iPhone 18 Pro Max"
            className="hv2-hero-wide__image"
            decoding="async"
            height={105}
            src={`${heroImagePath}wide.jpg`}
            width={800}
          />
        </Link>
      </div>
      <nav aria-label="Khuyến mãi đáng chú ý" className="hv2-home-hero__side">
        {heroSideBanners.map((banner) => (
          <Link
            className="hv2-hero-side-banner"
            key={banner.id}
            search={banner.search}
            to="/products"
          >
            <img
              alt={banner.title}
              className="hv2-hero-side-banner__image"
              decoding="async"
              height={166}
              src={`${heroImagePath}${banner.image}`}
              width={293}
            />
          </Link>
        ))}
      </nav>
    </section>
  )
}
