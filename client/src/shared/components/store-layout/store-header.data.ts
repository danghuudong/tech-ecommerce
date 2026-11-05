import {
  CreditCard,
  Gamepad2,
  Headphones,
  Keyboard,
  Laptop,
  type LucideIcon,
  Monitor,
  PackageCheck,
  PcCase,
  Printer,
  Refrigerator,
  ShieldCheck,
  Smartphone,
  Tablet,
  Truck,
  Tv,
  Watch,
} from 'lucide-react'
import { catalogCategoryLabels } from '@/features/catalog/catalog-search'
import type { ProductCategoryId } from '@/features/catalog/types/product'

export const storePromises: { text: string; icon: LucideIcon }[] = [
  { text: 'Hàng chính hãng 100%', icon: ShieldCheck },
  { text: 'Giao hàng toàn quốc', icon: Truck },
  { text: 'Đổi trả trong 7 ngày đầu tiên', icon: PackageCheck },
  { text: 'Thanh toán COD hoặc chuyển khoản', icon: CreditCard },
]

export type PriceBand = {
  label: string
  minPrice?: number
  maxPrice?: number
}

export type MenuCategory = {
  id: ProductCategoryId
  label: string
  icon: LucideIcon
  prices: PriceBand[]
}

const MILLION = 1_000_000

function money(value: number) {
  return value >= MILLION ? `${value / MILLION} triệu` : `${value / 1000}K`
}

function priceBands(first: number, ...rest: number[]) {
  const bands: PriceBand[] = [
    { label: `Dưới ${money(first)}`, maxPrice: first - 1 },
  ]
  let from = first
  for (const limit of rest) {
    bands.push({
      label: `${money(from)} - ${money(limit)}`,
      minPrice: from,
      maxPrice: limit - 1,
    })
    from = limit
  }
  bands.push({ label: `Từ ${money(from)}`, minPrice: from })
  return bands
}

export const menuCategories: MenuCategory[] = [
  {
    id: 'phone',
    label: 'Điện thoại',
    icon: Smartphone,
    prices: priceBands(5 * MILLION, 15 * MILLION, 25 * MILLION),
  },
  {
    id: 'tablet',
    label: catalogCategoryLabels.tablet,
    icon: Tablet,
    prices: priceBands(5 * MILLION, 10 * MILLION, 20 * MILLION),
  },
  {
    id: 'laptop',
    label: 'Laptop',
    icon: Laptop,
    prices: priceBands(15 * MILLION, 25 * MILLION, 35 * MILLION),
  },
  {
    id: 'desktop',
    label: 'Máy tính bàn',
    icon: PcCase,
    prices: priceBands(20 * MILLION, 40 * MILLION),
  },
  {
    id: 'monitor',
    label: 'Màn hình',
    icon: Monitor,
    prices: priceBands(5 * MILLION, 10 * MILLION),
  },
  {
    id: 'watch',
    label: catalogCategoryLabels.watch,
    icon: Watch,
    prices: priceBands(2 * MILLION, 5 * MILLION, 10 * MILLION),
  },
  {
    id: 'audio',
    label: 'Âm thanh',
    icon: Headphones,
    prices: priceBands(MILLION, 3 * MILLION),
  },
  {
    id: 'accessories',
    label: 'Phụ kiện',
    icon: Keyboard,
    prices: priceBands(500_000, MILLION, 3 * MILLION),
  },
  {
    id: 'gaming',
    label: 'Gaming gear',
    icon: Gamepad2,
    prices: priceBands(500_000, MILLION, 3 * MILLION),
  },
  {
    id: 'office',
    label: 'Thiết bị văn phòng',
    icon: Printer,
    prices: priceBands(2 * MILLION, 5 * MILLION),
  },
  {
    id: 'television',
    label: catalogCategoryLabels.television,
    icon: Tv,
    prices: priceBands(5 * MILLION, 10 * MILLION, 20 * MILLION),
  },
  {
    id: 'appliance',
    label: catalogCategoryLabels.appliance,
    icon: Refrigerator,
    prices: priceBands(5 * MILLION, 10 * MILLION, 20 * MILLION),
  },
]
