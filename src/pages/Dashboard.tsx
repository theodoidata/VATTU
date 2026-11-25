import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, ArrowRightLeft, PackageMinus, ArrowRight } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, Empty, ExpiryBadge, Kpi, Loading, PageHeader, StockBadge, useRpc } from '../components/ui';
import { TRANSFER_STATUS, daysBetween, fmtDateTime, fmtUnits, stockLevel } from '../lib/format';
import type { StockRow, Transfer, UsageDoc } from '../lib/types';
import { handoff } from '../lib/handoff';
import { transferNeedsMe } from './Transfers';

export default function Dashboard() {
  const app = useApp();
  const { branchId, branches, today, has, go } = app;
  const branch = branches.find(b => b.id === branchId);
  const stock = useRpc<StockRow[]>('get_stock', { branch_id: branchId });
  const canTransfers = ['inv_transfer_request', 'inv_transfer_approve', 'inv_transfer_ship', 'inv_transfer_receive'].some(has);
  const transfers = useRpc<Transfer[]>(canTransfers ? 'list_transfers' : null, { status: ['pending', 'approved', 'shipped'] });
  const canUsage = app.canAct(branchId) || has('inv_report_view_all');
  const usage = useRpc<UsageDoc[]>(canUsage ? 'list_usage' : null, { branch_id: branchId, from: today, to: today, include_voided: false });

  const s = useMemo(() => {
    const rows = stock.data ?? [];
    const short = rows.filter(r => ['below', 'out'].includes(stockLevel(r.usable_qty, r.min_qty)) && Number(r.min_qty) > 0)
      .sort((a, b) => Number(a.usable_qty) / Math.max(Number(a.min_qty), 1) - Number(b.usable_qty) / Math.max(Number(b.min_qty), 1));
    const lots = rows.flatMap(r => r.lots.filter(l => l.expiry_date && daysBetween(today, l.expiry_date) <= 90)
      .map(l => ({ ...l, item: r }))).sort((a, b) => (a.expiry_date! < b.expiry_date! ? -1 : 1));
    return { short, lots, expired: lots.filter(l => l.expiry_date! < today) };
  }, [stock.data, today]);

  const mine = (transfers.data ?? []).filter(t => (t.from_branch_id === branchId || t.to_branch_id === branchId) && transferNeedsMe(t, app));
  const usedToday = (usage.data ?? []).reduce((n, d) => n + d.lines.length, 0);

  return (
    <>
      <PageHeader title={`Tổng quan kho · ${branch?.name ?? ''}`} description="Cảnh báo tồn tối thiểu, hạn sử dụng và các việc cần xử lý hôm nay." />
      <div className="kpi-grid">
        <Kpi icon={<AlertTriangle size={20} />} tone={s.short.length ? 'danger' : 'success'} label="Dưới tối thiểu / hết hàng"
          value={stock.loading ? '…' : s.short.length} sub="mặt hàng cần bổ sung"
          onClick={() => { handoff.stockFilter = 'below'; go('ton-kho'); }} />
        <Kpi icon={<CalendarClock size={20} />} tone={s.lots.length ? 'warning' : 'success'} label="Lô hết hạn ≤ 90 ngày"
          value={stock.loading ? '…' : s.lots.length} sub={s.expired.length ? `${s.expired.length} lô đã hết hạn` : 'không có lô quá hạn'}
          onClick={() => { handoff.stockFilter = 'expiry'; go('ton-kho'); }} />
        <Kpi icon={<ArrowRightLeft size={20} />} tone={mine.length ? 'warning' : undefined} label="Điều chuyển chờ xử lý"
          value={canTransfers ? (transfers.loading ? '…' : mine.length) : '—'} sub="cần bạn duyệt / gửi / nhận"
          onClick={canTransfers ? () => go('dieu-chuyen') : undefined} />
        <Kpi icon={<PackageMinus size={20} />} label="Dòng xuất dùng hôm nay" value={canUsage ? (usage.loading ? '…' : usedToday) : '—'}
          sub={`${(usage.data ?? []).length} phiếu`} onClick={has('inv_usage_create') ? () => go('xuat-dung') : undefined} />
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Cần bổ sung</h2>
            {s.short.length > 0 && has('inv_transfer_request') && app.canAct(branchId) && (
              <button className="btn btn-sm btn-primary" onClick={() => {
                handoff.transferDraft = { items: s.short.slice(0, 15).map(r => ({ item_id: r.id, qty: Math.max(Math.ceil(Number(r.min_qty) * 1.5 - Number(r.usable_qty)), 1) })) };
                go('dieu-chuyen');
              }}>Tạo yêu cầu điều chuyển <ArrowRight size={14} /></button>
            )}
          </div>
          {stock.loading ? <Loading /> : stock.error ? <div className="notice danger">{stock.error}</div> : s.short.length === 0 ? <Empty>Tất cả vật tư đều trên mức tối thiểu 👍</Empty> : (
            <div className="table-wrap cards-sm"><table className="data">
              <thead><tr><th>Vật tư</th><th className="num">Còn dùng được</th><th className="num">Tối thiểu</th><th>Trạng thái</th></tr></thead>
              <tbody>{s.short.slice(0, 12).map(r => (
                <tr key={r.id}><td><div className="item-name">{r.name}</div><div className="item-code">{r.code} · {r.group_name}</div></td>
                  <td className="num">{fmtUnits(r.usable_qty, r)}</td><td className="num">{fmtUnits(r.min_qty, r)}</td>
                  <td><StockBadge usable={r.usable_qty} min={r.min_qty} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
          {s.short.length > 12 && <p className="muted small">… và {s.short.length - 12} vật tư khác. <a href="#ton-kho" onClick={() => { handoff.stockFilter = 'below'; }}>Xem tất cả</a></p>}
        </section>

        <div className="stack">
          {canTransfers && (
            <section className="panel">
              <div className="panel-head"><h2>Điều chuyển cần bạn xử lý</h2></div>
              {transfers.loading ? <Loading /> : mine.length === 0 ? <Empty>Không có phiếu nào đang chờ bạn.</Empty> : (
                <div className="stack">{mine.slice(0, 6).map(t => (
                  <a key={t.id} href="#dieu-chuyen" className="panel" style={{ padding: '10px 12px', textDecoration: 'none', color: 'inherit', boxShadow: 'none' }}>
                    <div className="row"><b>{t.code}</b><Badge tone={TRANSFER_STATUS[t.status].tone}>{TRANSFER_STATUS[t.status].label}</Badge><span className="spacer" /><span className="muted small">{fmtDateTime(t.requested_at)}</span></div>
                    <div className="small">{t.to_branch_name} xin {t.from_branch_name} · {t.lines.length} vật tư</div>
                  </a>
                ))}</div>
              )}
            </section>
          )}
          <section className="panel">
            <div className="panel-head"><h2>Sắp hết hạn / đã hết hạn</h2></div>
            {stock.loading ? <Loading /> : s.lots.length === 0 ? <Empty>Không có lô nào hết hạn trong 90 ngày tới.</Empty> : (
              <div className="table-wrap cards-sm"><table className="data">
                <thead><tr><th>Vật tư</th><th>Lô</th><th className="num">SL</th><th>Hạn dùng</th></tr></thead>
                <tbody>{s.lots.slice(0, 10).map(l => (
                  <tr key={l.id}><td className="item-name">{l.item.name}</td><td className="mono">{l.lot_no || '—'}</td>
                    <td className="num">{fmtUnits(l.qty, l.item)}</td><td><ExpiryBadge date={l.expiry_date} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
