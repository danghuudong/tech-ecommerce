import {
  Gamepad2,
  Headphones,
  Keyboard,
  Laptop,
  type LucideIcon,
  Monitor,
  Smartphone,
} from 'lucide-react'
import type { CatalogSearch } from '@/features/catalog/catalog-search'

type MenuLink = {
  label: string
  search: CatalogSearch
}

type IconLink = MenuLink & {
  id: string
  icon: LucideIcon
}

export const categoryLinks: IconLink[] = [
  {
    id: 'laptop',
    label: 'Laptop',
    icon: Laptop,
    search: { category: 'laptop' },
  },
  {
    id: 'phone',
    label: 'Điện thoại',
    icon: Smartphone,
    search: { category: 'phone' },
  },
  {
    id: 'computing',
    label: 'PC & Màn hình',
    icon: Monitor,
    search: { category: 'computing' },
  },
  {
    id: 'audio',
    label: 'Tai nghe',
    icon: Headphones,
    search: { category: 'audio' },
  },
  {
    id: 'accessories',
    label: 'Phụ kiện',
    icon: Keyboard,
    search: { category: 'accessories' },
  },
  {
    id: 'gaming',
    label: 'Gaming gear',
    icon: Gamepad2,
    search: { category: 'gaming' },
  },
  {
    id: 'office',
    label: 'Thiết bị văn phòng',
    icon: Keyboard,
    search: { category: 'office' },
  },
]

export const menuGroups: { id: string; title: string; links: MenuLink[] }[] = [
  {
    id: 'needs',
    title: 'Theo nhu cầu',
    links: [
      {
        label: 'Học tập & văn phòng',
        search: { category: 'laptop', q: 'văn phòng' },
      },
      {
        label: 'Đồ họa & sáng tạo',
        search: { category: 'laptop', q: 'đồ họa' },
      },
      {
        label: 'Laptop gaming',
        search: { category: 'laptop', q: 'gaming' },
      },
      {
        label: 'Mỏng nhẹ cao cấp',
        search: { category: 'laptop', q: 'mỏng nhẹ' },
      },
    ],
  },
  {
    id: 'brands',
    title: 'Thương hiệu',
    links: [
      { label: 'Apple', search: { brand: 'apple' } },
      { label: 'ASUS', search: { brand: 'asus' } },
      { label: 'Dell', search: { brand: 'dell' } },
      { label: 'Lenovo', search: { brand: 'lenovo' } },
      { label: 'HP', search: { brand: 'hp' } },
    ],
  },
  {
    id: 'prices',
    title: 'Mức giá laptop',
    links: [
      {
        label: 'Dưới 15 triệu',
        search: { category: 'laptop', maxPrice: 14_999_999 },
      },
      {
        label: '15 đến dưới 25 triệu',
        search: {
          category: 'laptop',
          minPrice: 15_000_000,
          maxPrice: 24_999_999,
        },
      },
      {
        label: '25 – 35 triệu',
        search: {
          category: 'laptop',
          minPrice: 25_000_000,
          maxPrice: 35_000_000,
        },
      },
      {
        label: 'Trên 35 triệu',
        search: { category: 'laptop', minPrice: 35_000_001 },
      },
    ],
  },
]
