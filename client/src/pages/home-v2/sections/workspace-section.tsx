import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

export function WorkspaceSection() {
  return (
    <section aria-labelledby="workspace-title" className="hv2-workspace-banner">
      <img
        alt=""
        className="hv2-workspace-banner__photo"
        height="768"
        loading="lazy"
        src="/images/workspace-banner.webp"
        width="2048"
      />
      <div className="hv2-workspace-banner__copy">
        <span className="hv2-home-eyebrow">GÓC LÀM VIỆC TRUYỀN CẢM HỨNG</span>
        <h2 id="workspace-title">
          Không gian làm việc,
          <br />
          cảm hứng mỗi ngày
        </h2>
        <p>
          Hoàn thiện góc làm việc với màn hình, bàn phím và phụ kiện phù hợp.
        </p>
        <Link
          className="hv2-red-action"
          to="/products"
          search={{ category: 'computing' }}
        >
          Chọn màn hình và PC <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </div>
    </section>
  )
}
