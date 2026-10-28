import {
  CreditCard,
  type LucideIcon,
  PackageCheck,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import type {
  Product,
  ProductArtId,
  ProductCategoryId,
} from '@/features/catalog/types/product'

export type SuggestionFilterId = 'featured' | ProductCategoryId

export const suggestionFilters: { id: SuggestionFilterId; label: string }[] = [
  { id: 'featured', label: 'Tất cả' },
  { id: 'laptop', label: 'Laptop' },
  { id: 'phone', label: 'Điện thoại' },
  { id: 'monitor', label: 'Màn hình' },
  { id: 'accessories', label: 'Phụ kiện' },
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
]

export const dealProducts: Product[] = [
  {
    id: 'slim-laptop',
    name: 'Laptop mỏng nhẹ 14 inch',
    category: 'laptop',
    specs: 'Core i5 · 16GB · SSD 512GB',
    price: '18.990.000đ',
    oldPrice: '24.990.000đ',
    discount: '−24%',
    rating: '4.8',
    ratingCount: 124,
    art: 'laptop',
  },
  {
    id: 'smartphone-pro',
    name: 'Điện thoại thông minh',
    category: 'phone',
    specs: '128GB · OLED · 5G',
    price: '15.490.000đ',
    oldPrice: '18.990.000đ',
    discount: '−18%',
    rating: '4.9',
    ratingCount: 256,
    art: 'phone',
  },
  {
    id: 'wireless-headphones',
    name: 'Tai nghe không dây',
    category: 'audio',
    specs: 'Chống ồn · Pin 30 giờ',
    price: '1.290.000đ',
    oldPrice: '1.790.000đ',
    discount: '−28%',
    rating: '4.8',
    ratingCount: 89,
    art: 'headphones',
  },
  {
    id: 'rgb-keyboard',
    name: 'Bàn phím cơ RGB',
    category: 'accessories',
    specs: 'Switch cơ · RGB · USB',
    price: '890.000đ',
    oldPrice: '1.290.000đ',
    discount: '−31%',
    rating: '4.7',
    ratingCount: 178,
    art: 'keyboard',
  },
]

export const suggestedProducts: Product[] = [
  {
    ...dealProducts[0],
    id: 'creator-laptop',
    name: 'Laptop ASUS Vivobook 14',
    specs: 'Core i5 · 16GB · SSD 512GB',
    price: '17.990.000đ',
    oldPrice: '21.990.000đ',
    discount: undefined,
    ratingCount: 312,
    featured: true,
  },
  {
    ...dealProducts[1],
    id: 'iphone-15',
    name: 'iPhone 15 128GB',
    specs: '128GB · Camera 48MP · 5G',
    price: '16.990.000đ',
    oldPrice: '19.990.000đ',
    discount: undefined,
    ratingCount: 428,
    featured: true,
  },
  {
    id: 'ultrawide-monitor',
    name: 'Màn hình LG 27 inch 2K',
    category: 'monitor',
    specs: 'IPS · 144Hz · HDR10',
    price: '6.490.000đ',
    oldPrice: '7.990.000đ',
    rating: '4.8',
    ratingCount: 96,
    art: 'monitor',
    featured: true,
  },
  {
    id: 'gaming-mouse',
    name: 'Chuột gaming Logitech G304',
    category: 'accessories',
    specs: 'Không dây · 12.000 DPI',
    price: '690.000đ',
    oldPrice: '890.000đ',
    rating: '4.7',
    ratingCount: 220,
    art: 'mouse',
    featured: true,
  },
  {
    id: 'gaming-tower',
    name: 'PC gaming cấu hình mạnh',
    category: 'desktop',
    specs: 'Core i7 · RTX · RAM 32GB',
    price: '32.990.000đ',
    oldPrice: '36.990.000đ',
    rating: '4.9',
    ratingCount: 68,
    art: 'tower',
  },
  {
    ...dealProducts[2],
    id: 'studio-headphones',
    name: 'Tai nghe chụp tai Studio',
    price: '1.490.000đ',
    oldPrice: '1.890.000đ',
    discount: undefined,
  },
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
  category: string
  title: string
  summary: string
  art: ProductArtId
}[] = [
  {
    id: 'laptop-guide',
    category: 'Laptop',
    title: 'Chọn laptop phù hợp với nhu cầu',
    summary:
      'Hướng dẫn chi tiết giúp bạn dễ dàng chọn được chiếc laptop phù hợp.',
    art: 'laptop',
  },
  {
    id: 'phone-guide',
    category: 'Điện thoại',
    title: 'Gợi ý điện thoại cho từng ngân sách',
    summary: 'Từ dễ dùng đến hiệu năng mạnh, có lựa chọn cho mọi người.',
    art: 'phone',
  },
  {
    id: 'workspace-guide',
    category: 'Phụ kiện',
    title: 'Phụ kiện giúp góc làm việc gọn hơn',
    summary: 'Những món phù hợp để bàn làm việc tiện nghi hơn mỗi ngày.',
    art: 'monitor',
  },
]
