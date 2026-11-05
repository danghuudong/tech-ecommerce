import { type RefObject, useLayoutEffect } from 'react'

const REVEAL_SELECTOR = [
  '.hv2-catalog-banner',
  '.hv2-catalog-tabs',
  '.hv2-catalog-needs',
  '.hv2-catalog-filter-row',
  '.store-product-card',
  '.hv2-catalog-pagination',
  '.hv2-accessories__heading',
  '.hv2-accessory-tile',
].join(',')

// Trigger slightly after an element enters, so its fade can actually be seen.
const VIEWPORT_MARGIN = '0px 0px -10% 0px'
const STAGGER_MS = 70
const MAX_STAGGER_STEPS = 5

/**
 * Fades matching elements up as they scroll into view, once each. Attributes are
 * set directly so no wrapper can break the sticky banners, and the observers
 * also pick up cards added later by tabs, filters or pagination.
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const visibility = new IntersectionObserver(
      (entries, observer) => {
        let step = 0
        for (const entry of entries) {
          const isPassed = entry.boundingClientRect.bottom < 0
          if (!entry.isIntersecting && !isPassed) continue
          const element = entry.target as HTMLElement
          observer.unobserve(element)
          if (!isPassed) {
            const delay = Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS
            element.style.setProperty('--reveal-delay', `${delay}ms`)
            step += 1
          }
          element.dataset.revealed = ''
        }
      },
      { rootMargin: VIEWPORT_MARGIN },
    )

    const observeNewElements = () => {
      for (const element of root.querySelectorAll<HTMLElement>(
        `:is(${REVEAL_SELECTOR}):not([data-revealed])`,
      )) {
        element.dataset.reveal = ''
        visibility.observe(element)
      }
    }

    observeNewElements()
    const additions = new MutationObserver(observeNewElements)
    additions.observe(root, { childList: true, subtree: true })
    return () => {
      additions.disconnect()
      visibility.disconnect()
    }
  }, [rootRef])
}
