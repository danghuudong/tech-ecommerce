export const productCategoryCodes = [
  'laptop',
  'phone',
  'desktop',
  'monitor',
  'audio',
  'accessories',
  'gaming',
  'office',
] as const

export const catalogCategoryCodes = [
  ...productCategoryCodes,
  'computing',
] as const
