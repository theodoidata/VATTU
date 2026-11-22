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

type Rule = { title: string; text: string };
const COMMON_INTRO = 'Mỗi vị trí chỉ xem và thao tác trong phạm vi quyền đã được BGĐ cấp. Mọi thao tác nhập, xuất, điều chuyển, kiểm kê đều được lưu theo tài khoản thực hiện.';
const NOTI: Rule = { title: 'Thông báo', text: 'Kiểm tra chuông để nhận việc cần xử lý (duyệt, gửi, nhận hàng, chốt kiểm kê) và các cập nhật điều chuyển của chi nhánh.' };
const RULES: { match: RegExp; role: string; rules: Rule[] }[] = [
  { match: /bgđ|bgd|giám đốc/i, role: 'BGĐ', rules: [
    NOTI,
    { title: 'Theo dõi toàn hệ thống', text: 'Chọn chi nhánh ở góc trên để xem tồn, cảnh báo dưới tối thiểu và hạn dùng của từng nơi; Báo cáo xem tổng hợp tất cả chi nhánh.' },
    { title: 'Duyệt & điều phối', text: 'Duyệt yêu cầu điều chuyển, cấp hàng chủ động từ Kho tổng, xử lý các phiếu nhận thiếu.' },
    { title: 'Danh mục & phân quyền', text: 'Sửa danh mục, tách đơn vị lẻ, sửa phiếu nhập; kích hoạt tài khoản và cấp quyền cho nhân viên.' },
  ] },
  { match: /kế toán|ke toan/i, role: 'Kế toán', rules: [
    NOTI,
    { title: 'Nhập hàng', text: 'Nhập đúng số lượng, số lô, hạn dùng theo hóa đơn; ghi sai thì dùng nút “Sửa” ở Lịch sử nhập kho.' },
    { title: 'Phân bổ cho chi nhánh', text: 'Dùng “Cấp hàng đi” để chuyển hàng chủ động; hộp không đủ chia thì “Tách đơn vị lẻ” rồi cấp theo đơn vị nhỏ.' },
    { title: 'Báo cáo', text: 'Đối chiếu tồn, lượng xuất dùng và điều chuyển theo kỳ; xuất Excel khi cần.' },
  ] },
  { match: /quản lý|quan ly|trưởng/i, role: 'Quản lý chi nhánh', rules: [
    NOTI,
    { title: 'Duyệt điều chuyển', text: 'Duyệt hoặc từ chối yêu cầu xin hàng gửi đến chi nhánh mình; chỉ duyệt khi chi nhánh vẫn đủ mức tối thiểu.' },
    { title: 'Kiểm kê', text: 'Xem chênh lệch sau khi nhân viên nộp phiếu, kiểm tra lại các dòng lệch lớn rồi mới “Chốt & điều chỉnh tồn”.' },
    { title: 'Tồn tối thiểu', text: 'Đặt mức tối thiểu phù hợp lượng dùng của chi nhánh để cảnh báo sắp hết đúng lúc.' },
  ] },
  { match: /kho|phụ tá|phu ta/i, role: 'Nhân viên kho / Phụ tá', rules: [
    NOTI,
    { title: 'Xuất dùng hằng ngày', text: 'Ghi lượng vật tư đã dùng mỗi cuối ca; làm dở thì bấm “Lưu tạm”, không để dồn nhiều ngày.' },
    { title: 'Gửi – nhận hàng', text: 'Đếm hàng thực tế trước khi xác nhận; nhận thiếu thì sửa số “Thực nhận” và ghi rõ lý do.' },
    { title: 'Kiểm kê', text: 'Đếm theo từng lô, không còn hàng thì để 0; vật tư có quy đổi điền số hộp và số lẻ.' },
  ] },
  { match: /bác sĩ|bac si/i, role: 'Bác sĩ', rules: [
    NOTI,
    { title: 'Xem tồn trước khi dùng', text: 'Kiểm tra tồn và hạn dùng ở Tồn kho trước ca điều trị cần vật tư đặc biệt.' },
    { title: 'Ghi xuất dùng', text: 'Ghi đúng vật tư và số lượng đã dùng; hỏng / rơi vỡ chọn đúng lý do.' },
    { title: 'Báo thiếu', text: 'Thấy vật tư sắp hết thì báo Quản lý chi nhánh để xin điều chuyển kịp thời.' },
  ] },
];

/** Nút "?" — Quy tắc theo vị trí công việc của người đang đăng nhập */
export function RoleGuideModal({ me, onClose, onDetail }: { me: Profile; onClose: () => void; onDetail: () => void }) {
  const dept = me.department_name ?? '';
  const r = RULES.find(x => x.match.test(dept));
  const [contact, setContact] = useState(false);
  const rules = r?.rules ?? [NOTI];
  return (
    <Modal size="medium" title={<span className="guide-title"><small>HƯỚNG DẪN SỬ DỤNG</small>Quy tắc dành cho {r?.role ?? (dept || 'bạn')}</span>} onClose={onClose}>
      <p className="guide-intro">{COMMON_INTRO}</p>
      <div className="guide-cards">
        {rules.map(x => <div key={x.title} className="guide-card"><b>{x.title}</b><span>{x.text}</span></div>)}
        <div className="guide-card"><b>Bảo mật</b><span>Không chia sẻ tài khoản; thông tin vật tư, nhà cung cấp chỉ dùng cho công việc được giao.</span></div>
      </div>
      {contact && <div className="notice" style={{ marginTop: 12 }}>Cần thêm quyền, báo lỗi số liệu hoặc quên mật khẩu: liên hệ BGĐ hoặc người phụ trách phân quyền của hệ thống.</div>}
      <button className="btn btn-primary guide-btn" onClick={() => setContact(true)}>Liên hệ Admin</button>
      <button className="btn btn-ghost btn-sm guide-more" onClick={onDetail}>Xem hướng dẫn chi tiết từng trang</button>
    </Modal>
  );
}
