const MAX_IMAGE_BYTES = 512 * 1024
const IMAGE_SIZES = [1600, 1200, 900]
const QUALITIES = [0.86, 0.76, 0.66]

export type PreparedProductImage = {
  mediaType: 'image/webp' | 'image/jpeg'
  contentBase64: string
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  )
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

// Re-encoding in the browser keeps uploads inside the API's 1 MB JSON limit and
// drops camera metadata such as location before a photo becomes public.
export async function prepareProductImage(
  file: File,
): Promise<PreparedProductImage> {
  const bitmap = await createImageBitmap(file)
  try {
    for (const size of IMAGE_SIZES) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Trình duyệt không xử lý được ảnh này.')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITIES) {
        let blob = await encode(canvas, 'image/webp', quality)
        // Browsers without a WebP encoder silently return PNG.
        if (blob?.type !== 'image/webp')
          blob = await encode(canvas, 'image/jpeg', quality)
        if (blob && blob.size <= MAX_IMAGE_BYTES)
          return {
            mediaType: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg',
            contentBase64: await toBase64(blob),
          }
      }
    }
  } finally {
    bitmap.close()
  }
  throw new Error('Ảnh quá lớn, vui lòng chọn ảnh khác.')
}
