# Deploy miễn phí: Vercel + Render + Neon

## Kiến trúc

```text
Trình duyệt -> https://<frontend>.vercel.app
                | /api/* (proxy có xác thực, không cache)
                v
              Render Free Web Service
                |-- Express và hai worker đơn hàng
                |-- Neon Free PostgreSQL
                `-- Render Key Value Free (Redis)
```

FE gọi API bằng `/api` trên cùng tên miền. Cookie đăng nhập khách hàng và quản
trị thuộc tên miền FE, không cần mở cookie bên thứ ba. `BETTER_AUTH_URL` và
`CLIENT_ORIGIN` trên Render đều phải là **URL production của FE**, không phải URL
Render, không thêm `/api` và không có dấu `/` cuối.

Chỉ tạo tài nguyên gói **Free/Hobby**. Không thêm phương thức thanh toán hoặc
chọn trial trả phí nếu cần giữ chi phí bằng 0. Vercel Hobby chỉ dành cho mục đích
cá nhân, phi thương mại.

## 1. Chuẩn bị tài khoản và source

- Kết nối GitHub repository `danghuudong/tech-ecommerce` với Vercel và Render.
- Đưa các thay đổi cấu hình deploy lên một branch GitHub. Chọn chính branch đó
  khi import trên cả hai nền tảng.
- Tạo Vercel project trước để lấy **tên miền production cố định**. Chọn Root
  Directory `client`, Framework `Vite` và Node.js `24.x`. Nếu được hỏi, cho phép
  truy cập file ngoài Root Directory để đọc workspace và lockfile ở repo root.
- Lần build FE đầu tiên chỉ thành công sau khi có biến môi trường ở bước 4.
  Không dùng tên miền riêng cho từng preview làm URL xác thực production.

## 2. Tạo PostgreSQL trên Neon Free

1. Tạo project Neon Free, ưu tiên region gần Singapore.
2. Lấy connection string PostgreSQL **direct/unpooled** từ hộp thoại Connect;
   giữ các tham số TLS, ví dụ `sslmode=require`.
3. Nhập connection string vào `DATABASE_URL` trên Render. Không commit vào Git,
   không đưa vào biến `VITE_*`, không gửi mật khẩu trong chat.

Dùng direct endpoint vì migration hiện tại dùng advisory lock theo session.
Không thay bằng endpoint transaction pooler cho lệnh migration.

Database mới sẽ trống sau migration. Deploy không tự sao chép dữ liệu local,
không tạo tài khoản, không nhập sản phẩm mẫu và không bật giả lập ngân hàng.

## 3. Tạo BE trên Render bằng Blueprint

Trong Render chọn **New -> Blueprint**, kết nối repository và branch đã chuẩn
bị, chọn `render.yaml` tại repo root. Kiểm tra cả hai tài nguyên đều có
`plan: free` trước khi tạo:

- `tech-ecommerce-api`: Node.js Web Service.
- `tech-ecommerce-redis`: Key Value Free, chỉ kết nối qua mạng nội bộ.

Điền các biến được hỏi:

| Biến trên Render | Giá trị |
| --- | --- |
| `DATABASE_URL` | Connection string Neon direct, có TLS |
| `CLIENT_ORIGIN` | `https://<frontend>.vercel.app` |
| `BETTER_AUTH_URL` | Cùng giá trị `CLIENT_ORIGIN` |
| `API_PROXY_SECRET` | Chuỗi ngẫu nhiên 64 ký tự hex; lưu cùng giá trị trên Vercel |

Render tự tạo `BETTER_AUTH_SECRET`. Blueprint cũng cấu hình `NODE_ENV=production`,
Node.js 24, `TRUST_PROXY=1`, Redis nội bộ và tắt giả lập chuyển khoản. Không thay
`BETTER_AUTH_SECRET` giữa các lần deploy thông thường.

Có thể tạo secret trên máy cá nhân bằng PowerShell:

```powershell
$deployProxySecret = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

Giữ giá trị trong trình quản lý mật khẩu và nhập vào hai dashboard; không ghi
secret vào repository, ảnh chụp hay log build.

Blueprint dùng toàn bộ repo làm root để giữ đúng pnpm workspace. Các lệnh:

```sh
# Build Command
corepack pnpm install --frozen-lockfile --prod=false --filter server... && corepack pnpm --filter server build

# Start Command
corepack pnpm --filter server start:render
```

`start:render` chạy migration bằng JavaScript đã compile, sau đó mở API và hai
worker. Nếu migration lỗi, API không khởi động. Không chuyển migration sang
Build Command: build có thể chạy khi bản cũ vẫn phục vụ người dùng. Free không
cần dùng Pre-deploy Command hoặc shell trả phí.

Health check dùng `/health/ready`, kiểm tra được PostgreSQL; Redis mất kết nối
có thể trả trạng thái `degraded` mà API vẫn sẵn sàng.

Nếu database có dữ liệu cũ và migration yêu cầu sửa category/brand, xử lý bằng
các lệnh `db:catalog:check` và `db:catalog:classify` theo thông báo rồi deploy
lại. Không bỏ qua migration hoặc tự dùng `drizzle-kit push` thay thế.

## 4. Hoàn tất FE trên Vercel

Trong Settings -> Environment Variables của project, cấu hình **Production**:

| Biến trên Vercel | Giá trị |
| --- | --- |
| `RENDER_API_ORIGIN` | URL BE thực tế, ví dụ `https://<api>.onrender.com`, không thêm `/api` |
| `API_PROXY_SECRET` | Chính xác secret đã nhập trên Render |
| `VITE_API_BASE_URL` | `/api` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Đánh dấu `API_PROXY_SECRET` là Sensitive. Không thêm tiền tố `VITE_` cho secret.
Không cấp secret production cho Preview. Preview cần backend/database riêng nếu
muốn kiểm tra chức năng đăng nhập; config cố ý không build nếu thiếu secret hoặc
URL backend.

`client/vercel.ts` cấu hình install/build, output `dist`, proxy API trước SPA
fallback và tắt cache API. Không tạo thêm `vercel.json` song song. Config chạy
trên Vercel, không nằm trong bundle trình duyệt.

API client chờ tối đa 90 giây để Render Free có thời gian thức dậy ở lần truy
cập đầu. Không tự động retry lệnh ghi; cơ chế idempotency hiện tại được giữ nguyên.

Redeploy FE sau khi nhập các biến. Request `/api/*` sẽ chuyển sang Render và
giữ nguyên tiền tố `/api`. Vercel đính kèm secret để BE từ chối request gọi trực
tiếp vào API Render. BE chỉ tin IP do Vercel chuyển tiếp sau khi xác thực secret;
rate limit áp dụng theo khách truy cập. Health check trên Render không yêu cầu
secret. Khi đổi URL BE hoặc secret, cập nhật hai nền tảng và redeploy phối hợp.

## 5. Tài khoản quản trị và dữ liệu

Đăng ký tài khoản khách hàng đầu tiên từ giao diện FE, xác định ID của chính tài
khoản đó trong Neon rồi thêm vào `ORDER_ADMIN_USER_IDS` trên Render. Biến này là
danh sách ID, không phải email, và không tự tạo tài khoản. Redeploy BE, sau đó
đăng nhập riêng vào trang quản trị bằng tài khoản đã cấp quyền.

Muốn hiện chuyển khoản ngân hàng, cấu hình đủ `ORDER_BANK_NAME`,
`ORDER_BANK_ACCOUNT_NUMBER` và `ORDER_BANK_ACCOUNT_HOLDER` bằng thông tin thật.
Giữ `ORDER_DEMO_BANK_TRANSFER_ENABLED=false`.

## 6. Cập nhật và kiểm tra

Trên máy phát triển chỉ chạy các kiểm tra đã thống nhất:

```sh
pnpm run lint
pnpm typecheck
```

Build và start được thực hiện trên nền tảng hosting. Blueprint tắt auto-deploy
BE để tránh tự chạy migration ngoài ý muốn khi push. Khi có bản mới, deploy BE
từ đúng branch, xem log migration và trạng thái ready, sau đó deploy FE. Backup
database trước các lần cập nhật schema có dữ liệu quan trọng. Thiết kế migration
tương thích bản cũ nếu FE/BE không được cập nhật cùng lúc.

Sau khi cả hai có URL, kiểm tra health, đăng ký/đăng nhập/đăng xuất khách hàng,
đăng nhập quản trị, tải lại trang con và tạo đơn thử. Kiểm tra cả cookie, cache
và IP/rate limit qua proxy. Các kiểm tra trên hosting chỉ chạy khi đã được phép
kiểm tra runtime; lint/typecheck không chứng minh bản deploy hoạt động.

## Giới hạn của phương án 0 đồng

- Render Free ngủ sau 15 phút không có request; lần mở tiếp theo có thể mất
  khoảng một phút. Worker chỉ chạy khi BE thức nên xử lý đơn có thể bị trễ.
- Không dùng ping giữ thức để giả định worker sẽ chạy 24/7. Render có hạn mức
  giờ chạy, bandwidth, build và traffic gọi dịch vụ bên ngoài.
- Worker truy vấn Neon khi BE đang chạy cũng tiêu thụ compute, kể cả khi ít
  người truy cập. Neon Free có hạn mức compute, storage và băng thông.
- Render Key Value Free không lưu bền dữ liệu. Hiện Redis dùng cho rate limit;
  dữ liệu đơn hàng và phiên đăng nhập vẫn nằm trong PostgreSQL.
- Không dùng Render PostgreSQL Free cho dữ liệu cần giữ lâu: gói đó hết hạn
  sau 30 ngày. Neon Free không có mốc hết hạn này nhưng vẫn có quota.
- Không có phương thức thanh toán trên Render thì vượt hạn mức có thể dừng
  dịch vụ hoặc chặn build, thay vì tiếp tục tính phí. Cần theo dõi Usage của
  từng nền tảng; gói miễn phí không bảo đảm tính sẵn sàng cho bán hàng 24/7.

## Tài liệu chính thức

- [Vercel programmatic config](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites và bảo vệ origin](https://vercel.com/docs/routing/rewrites)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Render Blueprint](https://render.com/docs/blueprint-spec)
- [Render Free](https://render.com/docs/free)
- [Neon Free](https://neon.com/pricing)
