import { useState, type FormEvent } from 'react';
import { Field, Modal } from '../components/ui';
import { supabase } from '../lib/backend';
import type { Profile } from '../lib/types';

/** Trang cá nhân: thông tin tài khoản, các mục được dùng, đổi mật khẩu */
export function ProfileModal({ me, pages, demo, onClose }: { me: Profile; pages: string[]; demo: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  async function changePw(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setMsg({ t: 'Mật khẩu mới cần ít nhất 8 ký tự.', ok: false }); return; }
    if (pw !== pw2) { setMsg({ t: 'Hai lần nhập mật khẩu không khớp.', ok: false }); return; }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    setMsg(error ? { t: error.message, ok: false } : { t: 'Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.', ok: true });
    if (!error) { setPw(''); setPw2(''); }
  }
  return (
    <Modal title="Trang cá nhân" onClose={onClose} footer={<button className="btn" onClick={onClose}>Đóng</button>}>
      <div className="detail-grid">
        <div><small>Họ tên</small><b>{me.full_name}</b></div>
        <div><small>Vị trí</small><b>{me.department_name ?? '—'}</b></div>
        <div><small>Chi nhánh</small><b>{me.branch_name ?? 'Tất cả chi nhánh'}</b></div>
        {!demo && <div><small>Email đăng nhập</small><b>{me.email}</b></div>}
      </div>
      <h3 className="sec">Các mục bạn được dùng</h3>
      <p className="small" style={{ marginTop: 0 }}>{pages.join(' · ') || 'Chưa được bật quyền nào, liên hệ BGĐ.'}</p>
      <h3 className="sec">Đổi mật khẩu</h3>
      {demo ? <p className="muted small">Bản demo không đổi được mật khẩu.</p> : (
        <form onSubmit={changePw} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label="Mật khẩu mới"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
          <Field label="Nhập lại mật khẩu mới"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></Field>
          <div><button className="btn btn-primary" disabled={busy || !pw}>{busy ? 'Đang lưu…' : 'Đổi mật khẩu'}</button></div>
        </form>
      )}
      {msg && <div className={`notice ${msg.ok ? '' : 'danger'}`} style={{ marginTop: 10 }}>{msg.t}</div>}
    </Modal>
  );
}

const GUIDE: { page: string; title: string; steps: string[] }[] = [
  { page: 'Tổng quan', title: 'Tổng quan', steps: [
    'Xem nhanh vật tư dưới tối thiểu, lô sắp hết hạn, phiếu điều chuyển đang chờ và lượng xuất dùng hôm nay.',
    'Bấm vào từng ô để mở trang chi tiết tương ứng.'] },
  { page: 'Tồn kho', title: 'Tồn kho', steps: [
    'Lọc theo nhóm hàng, tình trạng tồn, hạn dùng ở cột bên trái; gõ tên hoặc mã (không dấu cũng được) để tìm.',
    'Bấm vào một vật tư để xem lô, hạn dùng và tồn ở các chi nhánh khác; bấm “Xin từ đây” để tạo phiếu xin điều chuyển.',
    'BGĐ / Kế toán: đổi tên, đổi đơn vị, hoặc “Tách đơn vị lẻ” (1 hộp = 10 sợi) ngay trong khung chi tiết.'] },
  { page: 'Xuất dùng', title: 'Xuất dùng', steps: [
    'Mỗi cuối ca / cuối ngày ghi lượng vật tư đã dùng: chọn vật tư, số lượng, lý do.',
    'Hệ thống tự trừ lô hết hạn sớm nhất trước. Lô đã hết hạn chỉ được ghi với lý do “Hủy hết hạn”.',
    'Đang ghi dở có thể bấm “Lưu tạm”, lần sau mở lại sẽ hiện tiếp.'] },
  { page: 'Nhập kho', title: 'Nhập kho', steps: [
    'Dùng cho hàng mua từ nhà cung cấp. Hàng chuyển giữa các chi nhánh dùng Điều chuyển.',
    'Vật tư có quy đổi thì điền vào 2 ô [hộp] [lẻ]; vật tư quản lý lô bắt buộc nhập số lô và hạn dùng.',
    'BGĐ / Kế toán sửa được phiếu đã lưu (nút “Sửa” ở Lịch sử nhập kho).'] },
  { page: 'Điều chuyển', title: 'Điều chuyển', steps: [
    'Chi nhánh thiếu bấm “Tạo yêu cầu”, chọn vật tư và chi nhánh cấp; xin nhiều nơi sẽ tự tách phiếu.',
    'Chi nhánh cấp duyệt → xác nhận đã gửi (trừ kho) → chi nhánh xin xác nhận đã nhận (cộng kho).',
    'Nhận thiếu thì sửa số “Thực nhận” và ghi lý do. Kho tổng có thể “Cấp hàng đi” chủ động không cần chờ xin.',
    'Việc đang chờ bạn hiện ở nút chuông góc phải.'] },
  { page: 'Kiểm kê', title: 'Kiểm kê', steps: [
    'Tạo phiếu kiểm kê (toàn bộ hoặc theo nhóm), đếm thực tế và nhập vào cột Thực đếm; ô để trống khi nộp được tính là 0.',
    'Vật tư có quy đổi: gõ 11 vào ô lẻ sẽ tự nhảy thành 1 hộp 1 lẻ.',
    'Quản lý xem chênh lệch rồi bấm “Chốt & điều chỉnh tồn”.'] },
  { page: 'Báo cáo', title: 'Báo cáo', steps: [
    'Tồn kho theo chi nhánh, lịch sử điều chuyển, lượng xuất dùng theo khoảng ngày; xuất được Excel.'] },
  { page: 'Danh mục', title: 'Danh mục', steps: [
    'Thêm / sửa vật tư, nhóm, đơn vị, quy đổi, mức tồn tối thiểu cho từng chi nhánh.'] },
  { page: 'Nhân sự & Phân quyền', title: 'Nhân sự & Phân quyền', steps: [
    'Kích hoạt tài khoản nhân viên mới, gán vị trí và chi nhánh; bật / tắt quyền theo vị trí hoặc riêng từng người.'] },
];

/** Hướng dẫn sử dụng ngắn — chỉ hiện các mục người dùng được dùng */
export function GuideModal({ pages, onClose }: { pages: string[]; onClose: () => void }) {
  const items = GUIDE.filter(g => pages.includes(g.page));
  return (
    <Modal size="wide" title="Hướng dẫn sử dụng" onClose={onClose} footer={<button className="btn" onClick={onClose}>Đóng</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Góc trên bên phải: chọn chi nhánh đang xem, nút chuông là việc cần bạn xử lý, nút người là tài khoản.</p>
      {items.map(g => (
        <div key={g.page} style={{ marginBottom: 14 }}>
          <h3 className="sec" style={{ marginTop: 0 }}>{g.title}</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ))}
    </Modal>
  );
}
