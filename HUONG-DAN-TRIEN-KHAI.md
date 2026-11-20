# Hướng dẫn đưa web Kho vật tư lên mạng

Dùng **1 tài khoản Gmail mới** cho cả 3 dịch vụ: GitHub, Supabase và Vercel. Tổng thời gian khoảng 30 phút, không mất phí.

---

## Bước 1. Tạo tài khoản GitHub và kho chứa mã

1. Đăng nhập Gmail mới, vào **github.com** → *Sign up* bằng Gmail đó.
2. Bấm **+** (góc phải) → **New repository**.
   - Repository name: `kho-vat-tu-nha-khoa`
   - Chọn **Private**.
   - Không tick thêm gì → **Create repository**.
3. Đưa mã lên (Claude sẽ làm giúp bước này khi bạn đưa link repo, hoặc bạn tự làm):
   - Trên trang repo vừa tạo, bấm **uploading an existing file**.
   - Kéo thả **tất cả** file và thư mục của dự án vào, **trừ** `node_modules`, `dist` và `.env`.
   - Bấm **Commit changes**.

## Bước 2. Tạo cơ sở dữ liệu Supabase

1. Vào **supabase.com** → *Start your project* → **Continue with GitHub** (dùng tài khoản GitHub vừa tạo).
2. **New project**:
   - Name: `kho-vat-tu`
   - Database Password: bấm *Generate* rồi **lưu lại cẩn thận** (không gửi cho ai, kể cả Claude).
   - Region: **Southeast Asia (Singapore)** (gần Việt Nam nhất).
3. Chờ khoảng 2 phút cho project khởi tạo xong.
4. Menu trái → **SQL Editor** → *New query*.
   - Mở file `supabase/setup.sql`, chọn tất cả (Ctrl+A), copy, dán vào ô soạn thảo.
   - Bấm **Run**. Thấy *Success. No rows returned* là xong.
   - Bước này tạo toàn bộ bảng, phân quyền, Kho tổng + 10 chi nhánh/xưởng, 5 vị trí, và **811 vật tư cùng tồn đầu kỳ lấy từ file "QUẢN LÝ KHO TỔNG.xlsx"**.
   - Các điểm cần soát lại trong file Excel (tồn âm, tên trùng, thiếu đơn vị tính) nằm ở `BAO-CAO-NHAP-EXCEL.md`.
5. Khóa đăng ký tự do: **Authentication → Sign In / Providers → Email**.
   - Tắt **Allow new users to sign up** → *Save*.
   - Từ giờ chỉ BGĐ thêm được người dùng.
6. Tạo tài khoản BGĐ đầu tiên: **Authentication → Users → Add user → Create new user**.
   - Nhập email và mật khẩu của bạn.
   - Tick **Auto Confirm User** → *Create user*.
   - **Người dùng đầu tiên tự động là BGĐ có toàn quyền.**
7. Lấy 2 thông tin kết nối: **Project Settings → API** (hoặc *Data API*).
   - **Project URL**, dạng `https://xxxx.supabase.co`.
   - **anon / publishable key**, là chuỗi dài bắt đầu bằng `eyJ…` hoặc `sb_publishable_…`.
   - ⚠️ **Không** dùng *service_role / secret key*. Khóa đó toàn quyền, không bao giờ đưa vào web hay gửi cho ai.

## Bước 3. Đưa web lên Vercel

1. Vào **vercel.com** → *Sign Up* → **Continue with GitHub** (tài khoản GitHub mới).
2. **Add New… → Project** → chọn repo `kho-vat-tu-nha-khoa` → **Import**.
3. Framework Preset sẽ tự nhận **Vite**. Giữ nguyên Build Command và Output Directory.
4. Mở **Environment Variables** và thêm 2 dòng:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL ở bước 2.7 |
   | `VITE_SUPABASE_ANON_KEY` | anon / publishable key ở bước 2.7 |

5. Bấm **Deploy**. Khoảng 1 phút sau bạn có link dạng `https://kho-vat-tu-nha-khoa.vercel.app`.
6. Quay lại Supabase → **Authentication → URL Configuration** → **Site URL** = link Vercel đó → *Save*. Việc này để email "Quên mật khẩu" trỏ đúng về web.

> **Lưu ý gói miễn phí của Vercel (Hobby):** điều khoản ghi gói này dành cho mục đích *cá nhân, phi thương mại*. Web nội bộ của phòng khám có thể bị coi là thương mại. Nếu muốn chắc chắn, dùng **Cloudflare Pages**, miễn phí và cho phép dùng thương mại. Cách làm tương tự:
> - *Workers & Pages → Create → Pages → Connect to Git* → chọn repo.
> - Framework preset: **Vite**.
> - Build command: `npm run build`, output: `dist`.
> - Thêm 2 biến môi trường giống bảng trên.

## Bước 4. Thêm nhân viên

1. Supabase → **Authentication → Users → Add user**.
   - Nhập email và mật khẩu tạm của nhân viên, tick *Auto Confirm User*.
2. Đăng nhập web bằng tài khoản BGĐ → **Nhân sự & Phân quyền** → bấm vào nhân viên mới.
   - Chọn **Vị trí** (Quản lý chi nhánh / Nhân viên kho – Phụ tá / Bác sĩ…).
   - Chọn **Chi nhánh**.
   - Bật **Đang hoạt động** → *Lưu*.
3. Nhân viên đăng nhập. Nếu muốn đổi mật khẩu, dùng **Quên mật khẩu** ở màn hình đăng nhập.

Muốn chỉnh quyền: tab **Quyền theo vị trí** áp dụng cho cả vị trí, còn nút **Quyền riêng** trên từng người chỉ áp dụng cho người đó.

## Bước 5. Bắt đầu dùng

1. **Danh mục:** sửa hoặc xóa vật tư mẫu cho đúng thực tế, đặt mức tối thiểu.
2. **Nhập kho** tồn đầu kỳ cho từng chi nhánh, hoặc dùng **Kiểm kê** để đếm và chốt số tồn ban đầu.
3. Hằng ngày nhân viên ghi **Xuất dùng**. Thiếu hàng thì tạo **Điều chuyển**.

---

## Ghi chú vận hành

- **Supabase miễn phí tạm dừng project nếu 7 ngày liền không ai dùng.** Dùng hằng ngày thì không bị. Nếu bị dừng, vào supabase.com bấm *Restore*, dữ liệu vẫn còn.
- **Sao lưu:** mỗi tháng vào **Báo cáo** xuất Excel tồn kho, lịch sử điều chuyển và lịch sử xuất dùng.
- **Sửa web về sau:** sửa mã → đưa lên GitHub → Vercel tự build lại trong khoảng 1 phút.
- **Cập nhật cơ sở dữ liệu:** chạy lại `supabase/setup.sql` an toàn, không mất dữ liệu đã nhập. Không tạo lại bảng đã có, chỉ cập nhật hàm và quyền.
- Nút **Xem giao diện demo** trên màn hình đăng nhập chạy dữ liệu mẫu ngay trong trình duyệt, không đụng tới dữ liệu thật. Dùng để tập huấn nhân viên.
