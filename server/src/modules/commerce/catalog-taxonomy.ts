export const productCategoryCodes = [
  'laptop',
  'phone',
  'desktop',
  'monitor',
  'audio',
  'accessories',
  'gaming',
  'office',
  'tablet',
  'watch',
  'television',
  'appliance',
] as const

export const catalogCategoryCodes = [
  ...productCategoryCodes,
  'computing',
] as const
