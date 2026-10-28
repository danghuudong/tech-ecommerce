import { ApiError } from '@/shared/api/client'

export async function readOrderUndoDocument(file: File) {
  const mediaType = /\.pdf$/i.test(file.name)
    ? 'application/pdf'
    : /\.png$/i.test(file.name)
      ? 'image/png'
      : /\.jpe?g$/i.test(file.name)
        ? 'image/jpeg'
        : null
  if (
    !mediaType ||
    (file.type && file.type !== mediaType) ||
    file.size < 16 ||
    file.size > 512 * 1024 ||
    file.name.trim().length > 160
  )
    throw new ApiError(422, 'ORDER_UNDO_DOCUMENT_INVALID', 'Invalid document')
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const failed = () =>
      reject(
        new ApiError(
          422,
          'ORDER_UNDO_DOCUMENT_READ_FAILED',
          'Cannot read file',
        ),
      )
    reader.onerror = failed
    reader.onabort = failed
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.includes(',')) return failed()
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
  return { fileName: file.name.trim(), mediaType, contentBase64 }
}
