export type ProductCategoryId =
  | 'laptop'
  | 'phone'
  | 'desktop'
  | 'monitor'
  | 'audio'
  | 'accessories'
  | 'gaming'
  | 'office'
  | 'tablet'
  | 'watch'
  | 'television'
  | 'appliance'

export type ProductArtId =
  | 'laptop'
  | 'phone'
  | 'tower'
  | 'monitor'
  | 'headphones'
  | 'keyboard'
  | 'mouse'

export type Product = {
  id: string
  name: string
  category: ProductCategoryId | null
  specs: string
  price: string
  oldPrice?: string
  discount?: string
  rating?: string
  ratingCount?: number
  availableQuantity?: number
  art: ProductArtId
  imageUrl?: string | undefined
  featured?: boolean
}
