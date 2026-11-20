import type { StockRow, TransferStatus } from './types';

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
export const fmtQty = (n: number | string | null | undefined) => nf.format(Number(n ?? 0));

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
export function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000);
}
export function addDays(d: string, n: number) {
  const t = new Date(Date.parse(d.slice(0, 10)) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

// ---- Mức cảnh báo tồn ----
export type StockLevel = 'ok' | 'low' | 'below' | 'out' | 'none';
export const STOCK_LEVEL: Record<StockLevel, { label: string; tone: string }> = {
  ok:    { label: 'Đủ',              tone: 'success' },
  low:   { label: 'Sắp hết',         tone: 'warning' },
  below: { label: 'Dưới tối thiểu',  tone: 'danger' },
  out:   { label: 'Hết hàng',        tone: 'dark' },
  none:  { label: 'Không có',        tone: 'muted' },
};
export function stockLevel(usable: number, min: number): StockLevel {
  const q = Number(usable), m = Number(min);
  if (q <= 0) return m > 0 ? 'out' : 'none'; // chưa đặt tối thiểu + không có hàng: không cảnh báo
  if (m > 0 && q < m) return 'below';
  if (m > 0 && q < m * 1.5) return 'low';
  return 'ok';
}

// ---- Cảnh báo hạn dùng ----
export type ExpiryLevel = 'expired' | 'd30' | 'd90' | 'ok' | 'none';
export const EXPIRY_LEVEL: Record<ExpiryLevel, { label: string; tone: string }> = {
  expired: { label: 'Đã hết hạn',  tone: 'dark' },
  d30:     { label: '≤ 30 ngày',   tone: 'danger' },
  d90:     { label: '≤ 90 ngày',   tone: 'warning' },
  ok:      { label: 'Còn hạn',     tone: 'success' },
  none:    { label: '—',           tone: 'muted' },
};
export function expiryLevel(expiry: string | null | undefined, today: string): ExpiryLevel {
  if (!expiry) return 'none';
  const d = daysBetween(today, expiry);
  if (d < 0) return 'expired';
  if (d <= 30) return 'd30';
  if (d <= 90) return 'd90';
  return 'ok';
}

export function rowAlerts(r: StockRow, today: string) {
  const level = stockLevel(r.usable_qty, r.min_qty);
  const exp = r.lots.reduce<ExpiryLevel>((worst, l) => {
    const e = expiryLevel(l.expiry_date, today);
    const order: ExpiryLevel[] = ['none', 'ok', 'd90', 'd30', 'expired'];
    return order.indexOf(e) > order.indexOf(worst) ? e : worst;
  }, 'none');
  return { level, exp };
}

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; tone: string }> = {
  pending:   { label: 'Chờ duyệt',   tone: 'warning' },
  approved:  { label: 'Đã duyệt · chờ gửi', tone: 'info' },
  shipped:   { label: 'Đã gửi · chờ nhận',  tone: 'primary' },
  received:  { label: 'Đã nhận',     tone: 'success' },
  rejected:  { label: 'Từ chối',     tone: 'danger' },
  cancelled: { label: 'Đã hủy',      tone: 'muted' },
};

export const USAGE_REASONS = ['Điều trị', 'Hỏng / rơi vỡ', 'Hủy hết hạn', 'Khác'];

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
