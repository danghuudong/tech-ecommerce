import { benefits } from '../home.data'

export function BenefitsSection() {
  return (
    <section
      aria-label="Quyền lợi mua sắm"
      className="benefit-strip"
      id="benefits"
    >
      {benefits.map(({ title, caption, icon: Icon }) => (
        <div className="benefit-strip__item" key={title}>
          <Icon aria-hidden="true" size={31} strokeWidth={1.8} />
          <span>
            <strong>{title}</strong>
            <small>{caption}</small>
          </span>
        </div>
      ))}
    </section>
  )
}
