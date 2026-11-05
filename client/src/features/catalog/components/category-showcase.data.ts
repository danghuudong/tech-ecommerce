import type {
  ProductArtId,
  ProductCategoryId,
} from '@/features/catalog/types/product'

export type ShowcaseTab = {
  category: ProductCategoryId
  title: string
  art: ProductArtId
}

export type ShowcaseBlock = {
  id: string
  label: string
  tone: 'red' | 'navy' | 'blush'
  tabs: ShowcaseTab[]
}

export const showcaseBlocks: ShowcaseBlock[] = [
  {
    id: 'phones',
    label: 'Điện thoại',
    tone: 'red',
    tabs: [{ category: 'phone', title: 'Điện thoại chính hãng', art: 'phone' }],
  },
  {
    id: 'computers',
    label: 'Laptop, màn hình và PC',
    tone: 'navy',
    tabs: [
      { category: 'laptop', title: 'Laptop cho mọi nhu cầu', art: 'laptop' },
      { category: 'monitor', title: 'Màn hình sắc nét', art: 'monitor' },
      { category: 'desktop', title: 'PC cấu hình mạnh', art: 'tower' },
    ],
  },
  {
    id: 'accessories',
    label: 'Âm thanh và phụ kiện',
    tone: 'blush',
    tabs: [
      { category: 'audio', title: 'Tai nghe mỗi ngày', art: 'headphones' },
      {
        category: 'accessories',
        title: 'Phụ kiện góc làm việc',
        art: 'keyboard',
      },
      { category: 'gaming', title: 'Gaming gear', art: 'mouse' },
      { category: 'office', title: 'Thiết bị văn phòng', art: 'keyboard' },
    ],
  },
]
