import type { ProductCategoryId } from '@/features/catalog/types/product'

export type HomeCatalogTab = {
  id: string
  category: ProductCategoryId
  title: string
  rows: number
  q?: string
  banner?: string
  mobileBanner?: string
  bannerAlt: string
  featuredSkus: readonly string[]
  previews: readonly string[]
}

export type HomeCatalogSection = {
  id: string
  title: string
  tabs: readonly HomeCatalogTab[]
}
