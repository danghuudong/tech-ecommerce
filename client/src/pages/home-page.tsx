import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import type {
  Product,
  ProductArtId,
  ProductCategoryId,
} from '@/features/catalog/types/product'
import { read, useAddToCart, useSession } from '@/features/commerce/api'
import {
  ErrorNotice,
  formatMoney,
  Loading,
  Notice,
  QueryError,
} from '@/features/commerce/components'
import type { CatalogProduct, Page } from '@/features/commerce/types'
import { StoreFooter } from '@/shared/components/store-layout/store-footer'
import { StoreHeader } from '@/shared/components/store-layout/store-header'
import type { SuggestionFilterId } from './home/home.data'
import { AdviceSection } from './home/sections/advice-section'
import { BenefitsSection } from './home/sections/benefits-section'
import { CategoriesSection } from './home/sections/categories-section'
import { DealsSection } from './home/sections/deals-section'
import { HeroSection } from './home/sections/hero-section'
import { NewsletterSection } from './home/sections/newsletter-section'
import { SuggestionsSection } from './home/sections/suggestions-section'
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
  const [selectedFilter, setSelectedFilter] =
    useState<SuggestionFilterId>('featured')

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
    setSelectedFilter(category)
    document
      .getElementById('suggestions')
      ?.scrollIntoView({ behavior: 'smooth' })
  }

  const products = (catalog.data?.items ?? []).map(toHomeProduct)
  const visibleProducts = products.filter((product) => {
    const matchesFilter =
      selectedFilter === 'featured' ? true : product.category === selectedFilter
    return matchesFilter
  })

  return (
    <div className="store-page" id="top">
      <StoreHeader />
      <main>
        <div className="store-container">
          <HeroSection />
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
          <SuggestionsSection
            visibleProducts={visibleProducts}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
            onAddToCart={handleAddToCart}
            busy={add.isPending}
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

function toHomeProduct(product: CatalogProduct): Product {
  const text = `${product.name} ${product.sku}`.toLowerCase()
  const category = product.category
  const art: ProductArtId =
    category === 'laptop'
      ? 'laptop'
      : category === 'phone'
        ? 'phone'
        : category === 'monitor'
          ? 'monitor'
          : category === 'audio'
            ? 'headphones'
            : category === 'desktop'
              ? 'tower'
              : /chuột|mouse|g304/.test(text)
                ? 'mouse'
                : 'keyboard'
  return {
    id: product.id,
    name: product.name,
    category,
    art,
    specs: product.description || product.sku,
    price: formatMoney(product.priceVnd),
    availableQuantity: product.availableQuantity,
  }
}
