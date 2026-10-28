import { env } from '../../config/env.js'
import { MAX_VND } from './commerce.types.js'

export function calculateOrderPricing(subtotalVnd: number) {
  const shippingFeeVnd =
    subtotalVnd >= env.ORDER_FREE_SHIPPING_THRESHOLD_VND
      ? 0
      : env.ORDER_SHIPPING_FEE_VND
  const totalVnd = subtotalVnd + shippingFeeVnd
  return {
    subtotalVnd,
    shippingFeeVnd,
    totalVnd,
    withinAmountLimit:
      Number.isSafeInteger(subtotalVnd) &&
      subtotalVnd > 0 &&
      Number.isSafeInteger(totalVnd) &&
      totalVnd <= MAX_VND,
  }
}
