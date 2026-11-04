import { Download } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { useMemo, useRef, useState } from 'react'
import { QRPay } from 'vietnam-qr-pay'
import { Action, formatMoney, Notice } from './components'
import type { OrderDetail } from './types'

function transferQrPayload(
  instructions: OrderDetail['bankInstructions'],
  amountVnd: number,
  reference: string,
) {
  if (
    !instructions?.bankBin ||
    !/^\d{6}$/.test(instructions.bankBin) ||
    !/^\d{6,19}$/.test(instructions.accountNumber) ||
    !Number.isSafeInteger(amountVnd) ||
    amountVnd <= 0 ||
    amountVnd > 9_999_999_999 ||
    !/^TV[1-9][0-9]*$/.test(reference) ||
    reference.length > 25
  )
    return null
  try {
    const payload = QRPay.initVietQR({
      bankBin: instructions.bankBin,
      bankNumber: instructions.accountNumber,
      amount: String(amountVnd),
      purpose: reference,
    }).build()
    const decoded = new QRPay(payload)
    if (
      !decoded.isValid ||
      decoded.consumer.bankBin !== instructions.bankBin ||
      decoded.consumer.bankNumber !== instructions.accountNumber ||
      decoded.currency !== '704' ||
      decoded.nation !== 'VN' ||
      decoded.amount !== String(amountVnd) ||
      decoded.additionalData.purpose !== reference
    )
      return null
    return payload
  } catch {
    return null
  }
}

function qrPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('QR image could not be exported'))
    }, 'image/png')
  })
}

export function OrderTransferQr({
  instructions,
  amountVnd,
  reference,
}: {
  instructions: OrderDetail['bankInstructions']
  amountVnd: number
  reference: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const payload = useMemo(
    () => transferQrPayload(instructions, amountVnd, reference),
    [instructions, amountVnd, reference],
  )
  if (!payload)
    return (
      <div className="c-payment-notice">
        <Notice tone="amber">
          Chưa thể tạo mã QR cho đơn này. Bạn có thể chuyển khoản bằng thông tin
          tài khoản, số tiền và nội dung bên dưới.
        </Notice>
      </div>
    )
  return (
    <div className="c-transfer-qr">
      <div>
        <h3>Quét mã để thanh toán</h3>
        <p>Đơn hàng #{reference}</p>
      </div>
      <div className="c-transfer-qr__code">
        <QRCodeCanvas
          ref={canvas}
          value={payload}
          size={520}
          style={{ width: '100%', height: 'auto' }}
          marginSize={4}
          level="M"
          bgColor="#ffffff"
          fgColor="#000000"
          title={`Mã QR chuyển khoản cho đơn ${reference}`}
          aria-label={`Mã QR chuyển khoản cho đơn ${reference}`}
        />
      </div>
      <div className="c-transfer-qr__amount">
        <small>Số tiền còn phải thanh toán</small>
        <strong>{formatMoney(amountVnd)}</strong>
      </div>
      <small>
        Mở ứng dụng ngân hàng để quét mã. Số tiền và nội dung chuyển khoản đã
        được điền sẵn theo đơn hàng.
      </small>
      <Action
        variant="secondary"
        pending={downloading}
        onClick={async () => {
          if (!canvas.current || downloading) return
          setDownloading(true)
          setDownloadFailed(false)
          try {
            const image = await qrPng(canvas.current)
            const imageUrl = URL.createObjectURL(image)
            const link = document.createElement('a')
            link.href = imageUrl
            link.download = `QR-${reference}.png`
            document.body.append(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(imageUrl), 60_000)
          } catch {
            setDownloadFailed(true)
          } finally {
            setDownloading(false)
          }
        }}
      >
        <Download size={16} />
        Tải mã QR
      </Action>
      {downloadFailed && (
        <small className="c-red" role="alert">
          Chưa tải được ảnh QR. Bạn có thể chụp lại mã đang hiển thị.
        </small>
      )}
    </div>
  )
}
