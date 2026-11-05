import {
  CreditCard,
  type LucideIcon,
  PackageCheck,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import type {
  ProductArtId,
  ProductCategoryId,
} from '@/features/catalog/types/product'

export type SuggestionFilterId = 'featured' | ProductCategoryId

export const heroTiles: {
  id: ProductCategoryId
  label: string
  caption?: string
  art: ProductArtId
}[] = [
  {
    id: 'laptop',
    label: 'Laptop',
    caption: 'Mỏng nhẹ, mạnh mẽ',
    art: 'laptop',
  },
  { id: 'phone', label: 'Điện thoại', art: 'phone' },
  { id: 'audio', label: 'Tai nghe', art: 'headphones' },
]

export const categoryTiles: {
  id: ProductCategoryId
  label: string
  art: ProductArtId
}[] = [
  { id: 'laptop', label: 'Laptop', art: 'laptop' },
  { id: 'phone', label: 'Điện thoại', art: 'phone' },
  { id: 'desktop', label: 'Máy tính bàn', art: 'tower' },
  { id: 'monitor', label: 'Màn hình', art: 'monitor' },
  { id: 'audio', label: 'Tai nghe', art: 'headphones' },
  { id: 'accessories', label: 'Phụ kiện', art: 'keyboard' },
  { id: 'gaming', label: 'Gaming gear', art: 'mouse' },
]

export const benefits: { title: string; caption: string; icon: LucideIcon }[] =
  [
    {
      title: 'Chính hãng 100%',
      caption: 'Cam kết hàng chính hãng',
      icon: ShieldCheck,
    },
    {
      title: 'Thanh toán linh hoạt',
      caption: 'COD hoặc chuyển khoản',
      icon: CreditCard,
    },
    {
      title: 'Đổi trả dễ dàng',
      caption: 'Trong 7 ngày đầu tiên',
      icon: PackageCheck,
    },
    {
      title: 'Giao hàng toàn quốc',
      caption: 'Giao hàng tiêu chuẩn',
      icon: Truck,
    },
  ]

export const adviceArticles: {
  id: string
  label: string
  category: ProductCategoryId
  title: string
  summary: string
  art: ProductArtId
}[] = [
  {
    id: 'laptop-guide',
    label: 'Laptop',
    category: 'laptop',
    title: 'Chọn laptop phù hợp với nhu cầu',
    summary:
      'Hướng dẫn chi tiết giúp bạn dễ dàng chọn được chiếc laptop phù hợp.',
    art: 'laptop',
  },
  {
    id: 'phone-guide',
    label: 'Điện thoại',
    category: 'phone',
    title: 'Gợi ý điện thoại cho từng ngân sách',
    summary: 'Từ dễ dùng đến hiệu năng mạnh, có lựa chọn cho mọi người.',
    art: 'phone',
  },
  {
    id: 'workspace-guide',
    label: 'Phụ kiện',
    category: 'accessories',
    title: 'Phụ kiện giúp góc làm việc gọn hơn',
    summary: 'Những món phù hợp để bàn làm việc tiện nghi hơn mỗi ngày.',
    art: 'monitor',
  },
]
