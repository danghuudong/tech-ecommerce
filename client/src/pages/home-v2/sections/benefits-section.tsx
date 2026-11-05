import { benefits } from '../home-v2.data'

export function BenefitsSection() {
  return (
    <section
      aria-label="Quyền lợi mua sắm"
      className="hv2-benefit-strip"
      id="benefits"
    >
      {benefits.map(({ title, caption, icon: Icon }) => (
        <div className="hv2-benefit-strip__item" key={title}>
          <span className="hv2-benefit-strip__icon">
            <Icon aria-hidden="true" size={22} strokeWidth={1.9} />
          </span>
          <span>
            <strong>{title}</strong>
            <small>{caption}</small>
          </span>
        </div>
      ))}
    </section>
  )
}
