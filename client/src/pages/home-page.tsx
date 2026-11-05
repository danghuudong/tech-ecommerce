import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CategoryShowcaseSection } from '@/features/catalog/components/category-showcase'
import { toHomeProduct } from '@/features/catalog/to-home-product'
import type {
  Product,
  ProductCategoryId,
} from '@/features/catalog/types/product'
import { read, useAddToCart, useSession } from '@/features/commerce/api'
import {
  ErrorNotice,
  Loading,
  Notice,
  QueryError,
} from '@/features/commerce/components'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { CategoryMenu } from '@/shared/components/store-layout/category-menu'
import { StoreFooter } from '@/shared/components/store-layout/store-footer'
import { StoreHeader } from '@/shared/components/store-layout/store-header'
import { AdviceSection } from './home/sections/advice-section'
import { BenefitsSection } from './home/sections/benefits-section'
import { CategoriesSection } from './home/sections/categories-section'
import { DealsSection } from './home/sections/deals-section'
import { HeroSection } from './home/sections/hero-section'
import { NewsletterSection } from './home/sections/newsletter-section'
import { WorkspaceSection } from './home/sections/workspace-section'
import './home-page.css'

export function HomePage() {
  const session = useSession()
  const navigate = useNavigate()
  const catalog = useQuery({
    queryKey: ['catalog', 'home'],
    queryFn: ({ signal }) =>
      read<Page<CatalogProduct>>('products', {
        signal,
        searchParams: { limit: 20 },
      }),
  })
  const [added, setAdded] = useState('')
  const add = useAddToCart()

  function handleAddToCart(product: Product) {
    if (!session.data) {
      void navigate({ to: '/login', search: { redirect: '/products' } })
      return
    }
    void add.run(product).then((result) => {
      if (result) setAdded(product.name)
    })
  }

  function handleCategorySelect(category: ProductCategoryId) {
    void navigate({ to: '/products', search: { category } })
  }

  const products = (catalog.data?.items ?? []).map(toHomeProduct)

  return (
    <div className="store-page" id="top">
      <StoreHeader />
      <main>
        <div className="store-container">
          <div className="home-stage">
            <CategoryMenu variant="sidebar" />
            <HeroSection />
          </div>
          <BenefitsSection />
          <CategoriesSection onCategorySelect={handleCategorySelect} />
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
            {catalog.isPending && <Loading />}
            {catalog.isError && (
              <QueryError
                error={catalog.error}
                retry={() => catalog.refetch()}
              />
            )}
          </div>
          <DealsSection
            onAddToCart={handleAddToCart}
            products={products.slice(0, 4)}
            busy={add.isPending}
          />
          <CategoryShowcaseSection
            busy={add.isPending}
            onAddToCart={handleAddToCart}
          />
          <WorkspaceSection />
          <AdviceSection />
          <NewsletterSection />
        </div>
      </main>
      <StoreFooter />
    </div>
  )
}
