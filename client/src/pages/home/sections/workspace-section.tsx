import { ArrowRight } from 'lucide-react'

export function WorkspaceSection() {
  return (
    <section aria-labelledby="workspace-title" className="workspace-banner">
      <img
        alt=""
        className="workspace-banner__photo"
        height="512"
        src="/images/workspace-banner.png"
        width="2048"
      />
      <div className="workspace-banner__copy">
        <span>GÓC LÀM VIỆC TRUYỀN CẢM HỨNG</span>
        <h2 id="workspace-title">
          Không gian làm việc,
          <br />
          cảm hứng mỗi ngày
        </h2>
        <p>
          Hoàn thiện góc làm việc với màn hình, bàn phím và phụ kiện phù hợp.
        </p>
        <div className="workspace-banner__tags">
          <span>Làm việc</span>
          <span>Sáng tạo</span>
          <span>Giải trí</span>
        </div>
        <a className="red-action" href="#suggestions">
          Khám phá bộ sưu tập <ArrowRight aria-hidden="true" size={15} />
        </a>
      </div>
    </section>
  )
}
