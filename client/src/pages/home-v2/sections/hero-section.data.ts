import type { CatalogSearch } from '@/features/catalog/catalog-search'

// Banner artwork follows https://clickbuy.com.vn/ and is served locally.
type HeroBanner = {
  id: string
  title: string
  subtitle: string
  image: string
  search: CatalogSearch
}

export const heroBanners: readonly HeroBanner[] = [
  {
    id: 'camera',
    title: 'CAMERA ACTION, POCKET CAMERA',
    subtitle: 'Tặng voucher 600K',
    image: 'camera.png',
    search: { q: 'Camera' },
  },
  {
    id: 'redmi',
    title: 'Redmi Note 17 Series',
    subtitle: 'Giá tốt, 1 đổi 1 365 ngày',
    image: 'redmi.png',
    search: { q: 'Redmi Note 17' },
  },
  {
    id: 'honor',
    title: 'Honor 600s 5G',
    subtitle: 'Ưu đãi mở bán',
    image: 'honor.jpg',
    search: { q: 'Honor 600' },
  },
  {
    id: 'watch',
    title: 'Apple Watch thế hệ mới',
    subtitle: 'Thời lượng pin lâu',
    image: 'watch.png',
    search: { q: 'Apple Watch' },
  },
  {
    id: 'iphone-duo',
    title: 'iPhone Duo lên dáng',
    subtitle: 'Clickbuy lên Deal',
    image: 'iphone-duo.jpg',
    search: { q: 'iPhone Duo' },
  },
  {
    id: 'iphone-pro',
    title: 'iPhone 18 Pro',
    subtitle: 'Chính thức mở bán',
    image: 'iphone-pro.jpg',
    search: { q: 'iPhone 18 Pro' },
  },
  {
    id: 'galaxy',
    title: 'Galaxy S26 Ultra',
    subtitle: 'Ưu đãi 10 triệu',
    image: 'galaxy.png',
    search: { q: 'Galaxy S26 Ultra' },
  },
  {
    id: 'iphone-max',
    title: 'iPhone 17 Pro Max',
    subtitle: 'Bảo hành 24 tháng',
    image: 'iphone-max.jpg',
    search: { q: 'iPhone 17 Pro Max' },
  },
  {
    id: 'xiaomi',
    title: 'Xiaomi 17T Series',
    subtitle: 'Giảm 6 triệu - 1 đổi 1 12 tháng',
    image: 'xiaomi.png',
    search: { q: 'Xiaomi 17T' },
  },
  {
    id: 'installment',
    title: 'Trả góp iPhone 3 KHÔNG',
    subtitle: 'Trả trước 0đ - Phí 0đ - Góp 0%',
    image: 'installment.png',
    search: { category: 'phone', brand: 'apple' },
  },
]

export const heroSideBanners = [
  {
    id: 'technology',
    title: 'Giá tốt, quà hay - Công nghệ mê say',
    image: 'side-tech.png',
    search: {},
  },
  {
    id: 'iphone',
    title: 'Chính thức mở bán iPhone 18 Pro',
    image: 'side-iphone.jpg',
    search: { q: 'iPhone 18 Pro' },
  },
  {
    id: 'redmi',
    title: 'Redmi Note 17 Series',
    image: 'side-redmi.png',
    search: { q: 'Redmi Note 17' },
  },
] as const satisfies readonly {
  id: string
  title: string
  image: string
  search: CatalogSearch
}[]

export const heroImagePath = '/images/home-v2-hero/'
