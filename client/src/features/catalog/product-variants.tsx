import { Link } from '@tanstack/react-router'
import { formatMoney } from '@/features/commerce/components'
import type {
  CatalogProductDetail,
  ProductVariant,
} from '@/features/commerce/types'
import { productArt, productImageUrl } from './product-view'

const optionValue = (variant: ProductVariant, name: string) =>
  variant.options.find((option) => option.name === name)?.value

const isColourOption = (name: string) => /màu/i.test(name)

// Keep the other choices when possible: switching colour stays on the same storage.
function closestVariant(
  product: CatalogProductDetail,
  name: string,
  value: string,
) {
  const matches = product.variants.filter(
    (variant) => optionValue(variant, name) === value,
  )
  return (
    matches.find((variant) =>
      product.variantOptions.every(
        (option) =>
          option.name === name ||
          optionValue(variant, option.name) === option.value,
      ),
    ) ?? matches[0]
  )
}

export function ProductVariants({
  product,
}: {
  product: CatalogProductDetail
}) {
  if (product.variants.length < 2) return null
  const names = [
    ...new Set(
      product.variants.flatMap((variant) =>
        variant.options.map((option) => option.name),
      ),
    ),
  ]
  return (
    <div className="pd-variants">
      {names.map((name) => {
        const current = product.variantOptions.find(
          (option) => option.name === name,
        )?.value
        const choices = [
          ...new Set(
            product.variants.flatMap(
              (variant) => optionValue(variant, name) ?? [],
            ),
          ),
        ].flatMap((value) => {
          const variant = closestVariant(product, name, value)
          return variant ? [{ value, variant }] : []
        })
        return (
          <div className="pd-variants__group" key={name}>
            <span className="pd-variants__label">
              {name}
              {current && `: ${current}`}
            </span>
            <ul>
              {choices.map(({ value, variant }) => (
                <li key={value}>
                  <Link
                    aria-current={value === current ? 'true' : undefined}
                    className={`pd-variant${value === current ? ' is-selected' : ''}${variant.availableQuantity < 1 ? ' is-unavailable' : ''}`}
                    params={{ productId: variant.id }}
                    to="/products/$productId"
                  >
                    {isColourOption(name) &&
                      (variant.primaryImageId ? (
                        <img
                          alt=""
                          className="product-photo pd-variant__thumb"
                          loading="lazy"
                          src={productImageUrl(variant.primaryImageId)}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`pd-variant__thumb product-art product-art--${productArt(product)}`}
                        />
                      ))}
                    <span className="pd-variant__text">
                      <strong>{value}</strong>
                      <small>
                        {variant.availableQuantity < 1
                          ? 'Hết hàng'
                          : formatMoney(variant.priceVnd)}
                      </small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
