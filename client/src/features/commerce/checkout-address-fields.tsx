import { useQuery } from '@tanstack/react-query'
import ky from 'ky'
import { Check, ChevronDown } from 'lucide-react'
import { Select } from 'radix-ui'
import { useId, useRef } from 'react'
import { type UseFormReturn, useController } from 'react-hook-form'
import { z } from 'zod'
import { storeProvinces } from '@/shared/components/store-layout/store-location.data'
import type { Recipient } from './types'

const directoryUrl = 'https://provinces.open-api.vn/api'
const directoryCache = { staleTime: 24 * 60 * 60_000, retry: false }
const unit = z.object({ code: z.number().int(), name: z.string() })
const units = z.array(unit)
const provinceWithWards = z.object({ wards: units })
const legacyWards = z.array(z.object({ district_code: z.number().int() }))
const noDistrict = '__none'

async function getDirectory<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
) {
  const response = await ky.get(`${directoryUrl}/${path}`, {
    credentials: 'omit',
    retry: 0,
    signal,
    timeout: 6000,
  })
  return schema.parse(await response.json())
}

function shortProvince(name: string) {
  return name.replace(/^(Tỉnh|Thành phố) /i, '')
}

function wardLabel(name: string) {
  return name.replace(/^(Phường|Xã|Đặc khu|Thị trấn) /i, '')
}

export function CheckoutAddressFields({
  form,
  disabled,
}: {
  form: UseFormReturn<Recipient>
  disabled: boolean
}) {
  const province = useController({
    control: form.control,
    name: 'province',
    rules: { required: 'Chọn tỉnh / thành phố.' },
  })
  const ward = useController({
    control: form.control,
    name: 'ward',
    rules: { required: 'Chọn hoặc nhập phường / xã.' },
  })
  const district = useController({ control: form.control, name: 'district' })
  const provinces = useQuery({
    ...directoryCache,
    queryKey: ['address-directory', 'provinces'],
    queryFn: ({ signal }) => getDirectory('v2/p/', units, signal),
  })
  const provinceCode = provinces.data?.find(
    ({ name }) => shortProvince(name) === shortProvince(province.field.value),
  )?.code
  const wards = useQuery({
    ...directoryCache,
    enabled: provinceCode !== undefined,
    queryKey: ['address-directory', 'wards', provinceCode],
    queryFn: ({ signal }) =>
      getDirectory(`v2/p/${provinceCode}?depth=2`, provinceWithWards, signal),
  })
  const currentWards = wards.data?.wards ?? []
  const shortWardMatches = currentWards.filter(
    ({ name }) => wardLabel(name) === ward.field.value,
  )
  const wardCode = (
    currentWards.find(({ name }) => name === ward.field.value) ??
    (shortWardMatches.length === 1 ? shortWardMatches[0] : undefined)
  )?.code
  const previousWards = useQuery({
    ...directoryCache,
    enabled: wardCode !== undefined,
    queryKey: ['address-directory', 'previous-wards', wardCode],
    queryFn: ({ signal }) =>
      getDirectory(`v2/w/${wardCode}/to-legacies/`, legacyWards, signal),
  })
  const districts = useQuery({
    ...directoryCache,
    enabled: wardCode !== undefined,
    queryKey: ['address-directory', 'districts'],
    queryFn: ({ signal }) => getDirectory('v1/d/', units, signal),
  })
  const districtCodes = new Set(
    previousWards.data?.map(({ district_code }) => district_code),
  )
  const districtOptions = districts.data
    ?.filter(({ code }) => districtCodes.has(code))
    .map(({ name }) => name)
  const loadingWards = provinces.isLoading || wards.isLoading
  const loadingDistricts =
    loadingWards || previousWards.isLoading || districts.isLoading
  const selectWard =
    loadingWards || !province.field.value || currentWards.length > 0
  const selectDistrict =
    loadingDistricts || !ward.field.value || Boolean(districtOptions?.length)

  function changeProvince(value: string) {
    province.field.onChange(value)
    form.setValue('ward', '', { shouldDirty: true })
    form.setValue('district', '', { shouldDirty: true })
  }

  function changeWard(value: string) {
    ward.field.onChange(value)
    form.setValue('district', '', { shouldDirty: true })
  }

  return (
    <div className="c-form-grid c-form-grid--three c-field--wide">
      <AddressField
        {...province.field}
        disabled={disabled}
        error={province.fieldState.error?.message}
        label="Tỉnh / Thành phố *"
        onChange={changeProvince}
        options={
          provinces.data?.map(({ name }) => shortProvince(name)) ??
          storeProvinces
        }
        placeholder="Chọn tỉnh / thành phố"
      />
      <AddressField
        {...ward.field}
        disabled={disabled || !province.field.value || loadingWards}
        error={ward.fieldState.error?.message}
        label="Phường / Xã *"
        onChange={changeWard}
        options={selectWard ? currentWards.map(({ name }) => name) : undefined}
        placeholder={
          loadingWards
            ? 'Đang tải…'
            : selectWard
              ? 'Chọn phường / xã'
              : 'Nhập phường / xã'
        }
      />
      <AddressField
        {...district.field}
        clearable
        disabled={disabled || !ward.field.value || loadingDistricts}
        error={district.fieldState.error?.message}
        label="Quận / Huyện cũ (không bắt buộc)"
        options={selectDistrict ? (districtOptions ?? []) : undefined}
        placeholder={
          loadingDistricts
            ? 'Đang tải…'
            : selectDistrict
              ? 'Chọn quận / huyện cũ'
              : 'Nhập quận / huyện cũ'
        }
      />
    </div>
  )
}

function AddressField({
  clearable,
  disabled,
  error,
  label,
  onBlur,
  onChange,
  options,
  placeholder,
  ref,
  value,
}: {
  clearable?: boolean
  disabled: boolean
  error?: string
  label: string
  onBlur: () => void
  onChange: (value: string) => void
  options?: readonly string[]
  placeholder: string
  ref: (element: HTMLElement | null) => void
  value: string
}) {
  const id = useId()
  const errorId = `${id}-error`
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = options?.includes(value) ? value : ''
  const a11y = {
    id,
    'aria-describedby': error ? errorId : undefined,
    'aria-invalid': Boolean(error),
    'aria-required': !clearable,
  }

  return (
    <div className="c-field">
      <label htmlFor={id}>{label}</label>
      {options ? (
        <Select.Root
          disabled={disabled}
          onOpenChange={(open) => {
            const button = trigger.current
            if (
              open &&
              button &&
              window.innerHeight - button.getBoundingClientRect().bottom < 240
            ) {
              button.scrollIntoView({ block: 'center', behavior: 'instant' })
            }
          }}
          onValueChange={(next) => onChange(next === noDistrict ? '' : next)}
          value={selected}
        >
          <Select.Trigger
            {...a11y}
            className="checkout-address-trigger"
            onBlur={onBlur}
            ref={(button) => {
              trigger.current = button
              ref(button)
            }}
          >
            <Select.Value placeholder={value || placeholder} />
            <Select.Icon asChild>
              <ChevronDown aria-hidden="true" size={16} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              align="start"
              aria-label={label}
              avoidCollisions={false}
              className="checkout-address-list"
              position="popper"
              side="bottom"
              sideOffset={6}
            >
              <Select.Viewport className="checkout-address-list__viewport">
                {clearable && (
                  <AddressOption value={noDistrict} label="Không chọn" />
                )}
                {options.map((item) => (
                  <AddressOption key={item} value={item} label={item} />
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      ) : (
        <input
          {...a11y}
          disabled={disabled}
          maxLength={100}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          ref={ref}
          value={value}
        />
      )}
      {error && (
        <small className="c-error-text" id={errorId} role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

function AddressOption({ label, value }: { label: string; value: string }) {
  return (
    <Select.Item className="checkout-address-option" value={value}>
      <Select.ItemText>{label}</Select.ItemText>
      <Select.ItemIndicator>
        <Check aria-hidden="true" size={15} />
      </Select.ItemIndicator>
    </Select.Item>
  )
}
