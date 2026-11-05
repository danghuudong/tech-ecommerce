import { Landmark } from 'lucide-react'

const paymentMarks = [
  {
    name: 'Visa',
    mark: (
      <svg aria-hidden="true" width="64" height="40" viewBox="0 0 80 40">
        <text
          x="40"
          y="28"
          fill="#1434cb"
          fontFamily="Arial, sans-serif"
          fontSize="26"
          fontWeight="900"
          fontStyle="italic"
          textAnchor="middle"
          textLength="62"
          lengthAdjust="spacingAndGlyphs"
        >
          VISA
        </text>
      </svg>
    ),
  },
  {
    name: 'Mastercard',
    mark: (
      <svg aria-hidden="true" viewBox="0 0 64 40">
        <circle cx="25" cy="20" r="14" fill="#eb001b" />
        <circle cx="41" cy="20" r="14" fill="#f79e1b" />
        <path
          d="M33 8.51a14 14 0 0 1 0 22.98 14 14 0 0 1 0-22.98Z"
          fill="#ff5f00"
        />
      </svg>
    ),
  },
  {
    name: 'MoMo',
    mark: (
      <svg aria-hidden="true" viewBox="0 0 64 40">
        <rect x="16" y="4" width="32" height="32" rx="5" fill="#a50064" />
        <text
          x="32"
          y="18"
          fill="#fff"
          fontFamily="Arial, sans-serif"
          fontSize="16"
          fontWeight="700"
          textAnchor="middle"
        >
          mo
        </text>
        <text
          x="32"
          y="31"
          fill="#fff"
          fontFamily="Arial, sans-serif"
          fontSize="16"
          fontWeight="700"
          textAnchor="middle"
        >
          mo
        </text>
      </svg>
    ),
  },
  {
    name: 'ZaloPay',
    mark: (
      <svg aria-hidden="true" viewBox="0 0 64 40">
        <text
          x="4"
          y="25"
          fontFamily="Arial, sans-serif"
          fontSize="15"
          fontWeight="700"
          letterSpacing="-0.8"
        >
          <tspan fill="#0068ff">Zalo</tspan>
          <tspan fill="#00a859">Pay</tspan>
        </text>
      </svg>
    ),
  },
  {
    name: 'VNPAY',
    mark: (
      <svg aria-hidden="true" viewBox="0 0 64 40">
        <text
          x="5"
          y="25"
          fontFamily="Arial, sans-serif"
          fontSize="16"
          fontWeight="800"
          letterSpacing="-1"
        >
          <tspan fill="#e31e2f">VN</tspan>
          <tspan fill="#005baa">PAY</tspan>
        </text>
      </svg>
    ),
  },
  {
    name: 'Chuyển khoản ngân hàng',
    mark: <Landmark aria-hidden="true" size={23} />,
  },
]

export function PaymentMarks() {
  return (
    <ul className="store-payment-marks" aria-label="Các phương thức thanh toán">
      {paymentMarks.map(({ name, mark }) => (
        <li key={name} title={name}>
          <span className="sr-only">{name}</span>
          {mark}
        </li>
      ))}
    </ul>
  )
}
