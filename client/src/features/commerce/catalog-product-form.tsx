import { useState } from 'react'
import { z } from 'zod'
import {
  catalogCategoryLabels,
  productCategoryIds,
} from '@/features/catalog/catalog-search'
import { useCommand, write } from './api'
import { Action, ErrorNotice, Field } from './components'
import type { ProductSpecificationGroup, StaffProduct } from './types'

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function parseSpecifications(value: string) {
  const groups: ProductSpecificationGroup[] = []
  for (const line of lines(value)) {
    if (line.startsWith('#')) {
      groups.push({ title: line.replace(/^#+/, '').trim(), rows: [] })
      continue
    }
    const separator = line.indexOf(':')
    const group = groups.at(-1)
    if (!group || separator < 1) return null
    group.rows.push({
      label: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    })
  }
  return groups
}

const formatSpecifications = (groups: ProductSpecificationGroup[]) =>
  groups
    .flatMap((group) => [
      `# ${group.title}`,
      ...group.rows.map((row) => `${row.label}: ${row.value}`),
    ])
    .join('\n')

function parseOptions(value: string) {
  const options: { name: string; value: string }[] = []
  for (const line of lines(value)) {
    const separator = line.indexOf(':')
    if (separator < 1) return null
    options.push({
      name: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    })
  }
  return options
}

const optionalNumber = (value: FormDataEntryValue | null) =>
  String(value ?? '').trim() ? Number(value) : null
const optionalText = (value: FormDataEntryValue | null) =>
  String(value ?? '').trim() || null

const productSchema = z.object({
  name: z.string().trim().min(2, 'Nhập tên từ 2 ký tự.').max(200),
  category: z.enum(productCategoryIds, { error: 'Chọn danh mục.' }),
  priceVnd: z.number().int().min(1, 'Nhập giá bán.'),
  listPriceVnd: z.number().int().min(1).nullable(),
  warrantyMonths: z.number().int().min(1).max(120).nullable(),
  variantRank: z.number().int().min(0).max(9999),
})

export type ProductFormValues = Partial<StaffProduct> & { sku?: string }

export function CatalogProductForm({
  initial,
  productId,
  onSaved,
}: {
  initial: ProductFormValues
  productId?: string | undefined
  onSaved: () => void
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useCommand(
    (body: Record<string, unknown>) =>
      productId
        ? write(`admin/products/${productId}`, body, 'patch')
        : write('admin/products', body),
    ['staff/products'],
  )
  return (
    <form
      className="c-form-section"
      onSubmit={async (event) => {
        event.preventDefault()
        event.stopPropagation()
        const data = new FormData(event.currentTarget)
        const specifications = parseSpecifications(
          String(data.get('specifications')),
        )
        const variantOptions = parseOptions(String(data.get('variantOptions')))
        const parsed = productSchema.safeParse({
          name: data.get('name'),
          category: data.get('category'),
          priceVnd: Number(data.get('priceVnd')),
          listPriceVnd: optionalNumber(data.get('listPriceVnd')),
          warrantyMonths: optionalNumber(data.get('warrantyMonths')),
          variantRank: Number(data.get('variantRank') || 0),
        })
        const nextErrors: Record<string, string> = {}
        if (!parsed.success)
          for (const issue of parsed.error.issues)
            nextErrors[String(issue.path[0])] = issue.message
        if (!specifications)
          nextErrors.specifications =
            'Bắt đầu mỗi nhóm bằng dòng "# Tên nhóm", các dòng sau theo dạng "Tên: Giá trị".'
        if (!variantOptions)
          nextErrors.variantOptions =
            'Mỗi dòng theo dạng "Tên tùy chọn: Giá trị".'
        setErrors(nextErrors)
        if (!parsed.success || !specifications || !variantOptions) return
        const body = {
          ...parsed.data,
          description: String(data.get('description')).trim(),
          overview: optionalText(data.get('overview')),
          brand: optionalText(data.get('brand')),
          highlights: lines(String(data.get('highlights'))),
          packageContents: lines(String(data.get('packageContents'))),
          specifications,
          variantGroup: optionalText(data.get('variantGroup')),
          variantOptions,
          active: data.get('active') === 'true',
        }
        const result = await save.run(
          productId
            ? { ...body, expectedVersion: initial.version }
            : { ...body, sku: String(data.get('sku')).trim() },
        )
        if (result) onSaved()
      }}
    >
      <div className="c-form-grid">
        {!productId && (
          <Field label="Mã SKU *">
            <input
              defaultValue={initial.sku ?? ''}
              maxLength={80}
              name="sku"
              pattern="[a-zA-Z0-9._\-]+"
              required
            />
          </Field>
        )}
        <Field label="Tên sản phẩm *" error={errors.name}>
          <input
            defaultValue={initial.name ?? ''}
            maxLength={200}
            name="name"
            required
          />
        </Field>
        <Field label="Danh mục *" error={errors.category}>
          <select
            defaultValue={initial.category ?? ''}
            name="category"
            required
          >
            <option value="">Chọn danh mục</option>
            {productCategoryIds.map((category) => (
              <option key={category} value={category}>
                {catalogCategoryLabels[category]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Thương hiệu"
          hint="Chữ thường không dấu, ví dụ: apple, asus."
        >
          <input
            defaultValue={initial.brand ?? ''}
            maxLength={80}
            name="brand"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </Field>
        <Field label="Giá bán (đ) *" error={errors.priceVnd}>
          <input
            defaultValue={initial.priceVnd ?? ''}
            min={1}
            name="priceVnd"
            required
            type="number"
          />
        </Field>
        <Field
          label="Giá gốc (đ)"
          hint="Để trống nếu không giảm giá. Phải cao hơn giá bán."
          error={errors.listPriceVnd}
        >
          <input
            defaultValue={initial.listPriceVnd ?? ''}
            min={1}
            name="listPriceVnd"
            type="number"
          />
        </Field>
        <Field label="Bảo hành (tháng)" error={errors.warrantyMonths}>
          <input
            defaultValue={initial.warrantyMonths ?? ''}
            max={120}
            min={1}
            name="warrantyMonths"
            type="number"
          />
        </Field>
        <Field label="Trạng thái bán">
          <select defaultValue={String(initial.active ?? true)} name="active">
            <option value="true">Đang bán</option>
            <option value="false">Ngừng bán</option>
          </select>
        </Field>
      </div>
      <Field label="Mô tả ngắn" hint="Hiển thị trên thẻ sản phẩm." wide>
        <input
          defaultValue={initial.description ?? ''}
          maxLength={200}
          name="description"
        />
      </Field>
      <Field label="Giới thiệu sản phẩm" wide>
        <textarea
          defaultValue={initial.overview ?? ''}
          maxLength={10000}
          name="overview"
          rows={4}
        />
      </Field>
      <Field label="Đặc điểm nổi bật" hint="Mỗi dòng một ý." wide>
        <textarea
          defaultValue={(initial.highlights ?? []).join('\n')}
          name="highlights"
          rows={4}
        />
      </Field>
      <Field label="Bộ sản phẩm gồm" hint="Mỗi dòng một món." wide>
        <textarea
          defaultValue={(initial.packageContents ?? []).join('\n')}
          name="packageContents"
          rows={3}
        />
      </Field>
      <Field
        label="Thông số kỹ thuật"
        hint='Ví dụ: dòng "# Màn hình", rồi dòng "Kích thước: 6,1 inch".'
        error={errors.specifications}
        wide
      >
        <textarea
          defaultValue={formatSpecifications(initial.specifications ?? [])}
          name="specifications"
          rows={8}
        />
      </Field>
      <div className="c-form-grid">
        <Field
          label="Nhóm phiên bản"
          hint="Các sản phẩm cùng mã nhóm là phiên bản của nhau, ví dụ: iphone-15."
        >
          <input
            defaultValue={initial.variantGroup ?? ''}
            maxLength={80}
            name="variantGroup"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </Field>
        <Field
          label="Thứ tự trong nhóm"
          hint="Số nhỏ nhất đại diện cho nhóm ở trang danh sách."
          error={errors.variantRank}
        >
          <input
            defaultValue={initial.variantRank ?? 0}
            max={9999}
            min={0}
            name="variantRank"
            type="number"
          />
        </Field>
      </div>
      <Field
        label="Tùy chọn của phiên bản"
        hint='Mỗi dòng một tùy chọn, ví dụ: "Màu sắc: Đen".'
        error={errors.variantOptions}
        wide
      >
        <textarea
          defaultValue={(initial.variantOptions ?? [])
            .map((option) => `${option.name}: ${option.value}`)
            .join('\n')}
          name="variantOptions"
          rows={3}
        />
      </Field>
      <ErrorNotice error={save.error} />
      <div className="c-actions c-actions--end">
        <Action pending={save.isPending} type="submit">
          {productId ? 'Lưu thay đổi' : 'Tạo sản phẩm'}
        </Action>
      </div>
    </form>
  )
}
