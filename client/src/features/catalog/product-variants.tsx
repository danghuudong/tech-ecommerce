import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { formatMoney } from '@/features/commerce/components'
import type {
  CatalogProductDetail,
  ProductVariant,
} from '@/features/commerce/types'
import { productArt, productImageUrl } from './product-view'

const optionValue = (variant: ProductVariant, name: string) =>
  variant.options.find((option) => option.name === name)?.value

const isColourOption = (name: string) => /màu/i.test(name)
const isCapacityOption = (name: string) =>
  /^(?:dung lượng(?: (?:bộ nhớ|lưu trữ|ổ cứng))?|bộ nhớ trong|ổ cứng|lưu trữ|ssd|rom)$/i.test(
    name.trim(),
  )

function VariantChoiceContent({
  product,
  variant,
  name,
  value,
  selected,
}: {
  product: CatalogProductDetail
  variant: Pick<
    ProductVariant,
    'primaryImageId' | 'priceVnd' | 'availableQuantity'
  >
  name: string
  value: string
  selected: boolean
}) {
  return (
    <>
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
        <small>{formatMoney(variant.priceVnd)}</small>
        {variant.availableQuantity < 1 && <small>Hết hàng</small>}
      </span>
      {selected && (
        <span className="pd-variant__check" aria-hidden="true">
          <Check size={12} />
        </span>
      )}
    </>
  )
}

function SingleProductOptions({ product }: { product: CatalogProductDetail }) {
  const rows = product.specifications.flatMap((group) => group.rows)
  const capacity =
    product.variantOptions.find((option) => isCapacityOption(option.name))
      ?.value ??
    rows.find(
      ({ label, value }) =>
        isCapacityOption(label) && /\d\s*(?:TB|GB|MB)\b/i.test(value),
    )?.value
  const colour =
    product.variantOptions.find((option) => isColourOption(option.name))
      ?.value ??
    rows.find(({ label }) => /^(?:màu|màu sắc)$/i.test(label.trim()))?.value
  const options = [
    ...(capacity ? [{ name: 'Dung lượng', value: capacity }] : []),
    ...(colour ? [{ name: 'Màu sắc', value: colour }] : []),
    ...product.variantOptions.filter(
      ({ name }) => !isCapacityOption(name) && !isColourOption(name),
    ),
  ]
  if (options.length === 0) return null

  return (
    <div className="pd-variants">
      {options.map(({ name, value }) => (
        <div className="pd-variants__group" key={name}>
          <span className="pd-variants__label">
            {name}: {value}
          </span>
          <ul>
            <li>
              <div
                className={`pd-variant is-selected${product.availableQuantity < 1 ? ' is-unavailable' : ''}`}
              >
                <VariantChoiceContent
                  product={product}
                  variant={product}
                  name={name}
                  value={value}
                  selected
                />
              </div>
            </li>
          </ul>
        </div>
      ))}
    </div>
  )
}

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
    ) ?? (isColourOption(name) ? undefined : matches[0])
  )
}

export function ProductVariants({
  product,
}: {
  product: CatalogProductDetail
}) {
  if (product.variants.length < 2)
    return <SingleProductOptions product={product} />
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
                    <VariantChoiceContent
                      product={product}
                      variant={variant}
                      name={name}
                      value={value}
                      selected={value === current}
                    />
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
