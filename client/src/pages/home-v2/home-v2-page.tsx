import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type { Product } from '@/features/catalog/types/product'
import { useAddToCart, useSession } from '@/features/commerce/api'
import { ErrorNotice, Notice } from '@/features/commerce/components'
import { StoreFooter } from '@/shared/components/store-layout/store-footer'
import { StoreHeader } from '@/shared/components/store-layout/store-header'
import { HeroSection } from './sections/hero-section'
import { HomeCatalog } from './sections/home-catalog'
import './home-v2.css'

export function HomeV2Page() {
  const session = useSession()
  const navigate = useNavigate()
  const [added, setAdded] = useState('')
  const add = useAddToCart()

  function handleAddToCart(product: Product) {
    if (!session.data) {
      void navigate({ to: '/login', search: { redirect: '/' } })
      return
    }
    void add.run(product).then((result) => {
      if (result) setAdded(product.name)
    })
  }

  return (
    <div className="store-page hv2" id="top">
      <StoreHeader />
      <main>
        <div className="store-container">
          <HeroSection />
          <div className="commerce-app">
            <ErrorNotice error={add.error} />
            {added && (
              <Notice tone="green">
                Đã thêm {added} vào giỏ hàng.{' '}
                <a className="c-text-link" href="/cart">
                  Xem giỏ hàng
                </a>
              </Notice>
            )}
          </div>
          <HomeCatalog onAddToCart={handleAddToCart} busy={add.isPending} />
        </div>
      </main>
      <StoreFooter />
    </div>
  )
}
