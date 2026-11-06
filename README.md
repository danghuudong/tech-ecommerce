# TinovaShop

TinovaShop là ứng dụng thương mại điện tử cho cửa hàng thiết bị công nghệ. Repo dùng pnpm workspace để quản lý giao diện React (`client`) và API Express (`server`).

## Chức năng

- **Khách hàng** có thể tìm và lọc sản phẩm, xem thông tin và biến thể, thêm vào giỏ, đặt hàng, thanh toán COD hoặc chuyển khoản ngân hàng, theo dõi đơn và gửi yêu cầu trả hàng.
- **Nhân viên và quản trị viên** quản lý sản phẩm, tồn kho, cửa hàng, đánh giá, phân công và xử lý đơn, vận đơn và giao hàng.
- **Kế toán** ghi nhận và đối soát chuyển khoản, tiền COD và các khoản hoàn tiền.

## Công nghệ và cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| [`client/`](client/) | React, TypeScript, Vite, Tailwind CSS, TanStack Router và TanStack Query |
| [`client/src/features/`](client/src/features/) | Giao diện danh mục, mua hàng và vận hành nội bộ |
| [`server/`](server/) | Express, TypeScript, Better Auth và Zod |
| [`server/src/modules/`](server/src/modules/) | Xác thực, phân quyền và nghiệp vụ thương mại điện tử |
| [`server/src/db/`](server/src/db/) và [`server/drizzle/`](server/drizzle/) | Schema PostgreSQL, migration Drizzle và công cụ quản lý dữ liệu |

PostgreSQL lưu dữ liệu nghiệp vụ và phiên đăng nhập. Redis dùng để giới hạn tần suất gọi API. Hai worker chạy cùng API để xử lý giữ hàng hết hạn và phân công đơn.

## Thiết lập local

Cần Node.js **24.x**, pnpm **12.3.4**, một database PostgreSQL đã tạo và một Redis có thể kết nối. Chạy các lệnh dưới đây từ thư mục gốc của repo.

1. Cài dependencies theo lockfile.

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Tạo `server/.env` và `client/.env` từ file mẫu. Trên PowerShell, dùng hai lệnh sau.

   ```powershell
   Copy-Item server/.env.example server/.env
   Copy-Item client/.env.example client/.env
   ```

   Nếu đã có file `.env`, chỉnh trực tiếp để giữ cấu hình hiện tại. Đặt `DATABASE_URL` và `REDIS_URL` theo dịch vụ đang dùng, rồi thay `BETTER_AUTH_SECRET` bằng chuỗi ngẫu nhiên ít nhất 32 ký tự. Xem các biến còn lại trong [mẫu cấu hình server](server/.env.example) và [mẫu cấu hình client](client/.env.example).

   Cấu hình mẫu dùng `http://localhost:5173` cho giao diện và `http://localhost:5000` cho API. Vite chuyển tiếp `/api` đến `DEV_API_TARGET`. Nếu đổi địa chỉ hoặc cổng, cập nhật `CLIENT_ORIGIN`, `BETTER_AUTH_URL` và `DEV_API_TARGET` tương ứng.

3. Áp dụng migration lên database trong `DATABASE_URL`.

   ```sh
   pnpm --filter server db:migrate
   ```

4. Mở hai terminal và khởi động mỗi phần bằng một lệnh riêng.

   ```sh
   pnpm --filter server dev
   pnpm --filter client dev
   ```

   Mở [giao diện cửa hàng](http://localhost:5173). API có `/health/live` để kiểm tra tiến trình và `/health/ready` để kiểm tra kết nối PostgreSQL cùng trạng thái Redis.

## Tài khoản quản trị và danh mục mẫu

Đăng ký tài khoản ở `/login`, lấy ID của tài khoản trong bảng `user` của PostgreSQL và thêm vào `ORDER_ADMIN_USER_IDS` trong `server/.env`. Dùng dấu phẩy để phân cách nhiều ID. Khởi động lại API rồi đăng nhập tại `/admin/login`.

Sau khi cấp quyền quản trị, có thể nhập danh mục mẫu từ dữ liệu có sẵn trong repo.

```sh
pnpm --filter server db:catalog:import
```

Để bật chuyển khoản ngân hàng ở bước thanh toán, điền đủ `ORDER_BANK_NAME`, `ORDER_BANK_ACCOUNT_NUMBER` và `ORDER_BANK_ACCOUNT_HOLDER`.

## Kiểm tra mã nguồn

```sh
pnpm run lint
pnpm typecheck
```

Hai lệnh kiểm tra cả `client` và `server`. `pnpm check` chạy lần lượt cả hai lệnh.

## Triển khai

Cấu hình triển khai gồm Vercel cho giao diện, Render cho API và Redis, cùng Neon PostgreSQL. Xem [hướng dẫn triển khai](DEPLOYMENT.md), [cấu hình Vercel](client/vercel.ts) và [Render Blueprint](render.yaml).
