import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, BranchSelect, Empty, Loading, PageHeader, StockBadge, useRpc, usePaged, useUnits } from '../components/ui';
import { STOCK_LEVEL, TRANSFER_STATUS, addDays, fmtDate, fmtDateTime, fmtQty, fmtUnits, norm, stockLevel } from '../lib/format';
import type { MatrixRow, StockRow, Transfer, TransferStatus } from '../lib/types';
import { exportExcel, sheet } from '../lib/excel';

type Tab = 'stock' | 'transfers' | 'usage';

export default function ReportsPage() {
  const { has } = useApp();
  const [tab, setTab] = useState<Tab>('stock');
  return (
    <>
      <PageHeader title="Báo cáo" description="Tồn kho theo chi nhánh, lịch sử điều chuyển và lịch sử xuất dùng. Có thể xuất ra Excel." />
      <section className="panel">
        <div className="tabs">
          <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>Tồn kho theo chi nhánh</button>
          <button className={tab === 'transfers' ? 'active' : ''} onClick={() => setTab('transfers')}>Lịch sử điều chuyển</button>
          <button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}>Lịch sử xuất dùng</button>
        </div>
        {tab === 'stock' && (has('inv_report_view_all') ? <StockMatrix /> : <OwnStock />)}
        {tab === 'transfers' && <TransferReport />}
        {tab === 'usage' && <UsageReport />}
      </section>
    </>
  );
}

function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { has } = useApp();
  if (!has('inv_report_export')) return null;
  return <button className="btn" disabled={disabled} onClick={onClick}><Download size={16} /> Xuất Excel</button>;
}

function StockMatrix() {
  const { branches, groups, today } = useApp();
  const m = useRpc<MatrixRow[]>('report_stock', {});
  const U = useUnits();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number | ''>('');
  const [onlyAlert, setOnlyAlert] = useState(false);
  const rows = useMemo(() => {
    const n = norm(q.trim());
    return (m.data ?? []).filter(r => (!group || r.group_id === group) && (!n || norm(r.name).includes(n) || norm(r.code).includes(n))
      && (!onlyAlert || branches.some(b => { const c = r.by_branch[String(b.id)]; return c && ['below', 'out'].includes(stockLevel(c.usable, c.min)) && Number(c.min) > 0; })));
  }, [m.data, q, group, onlyAlert, branches]);
  const pg = usePaged(rows, [q, group, onlyAlert]);
  const cls = (c?: { usable: number; min: number }) => {
    if (!c) return '';
    const lv = stockLevel(c.usable, c.min);
    return lv === 'out' ? 'cell-out' : lv === 'below' ? 'cell-below' : lv === 'low' ? 'cell-low' : '';
  };
  const doExport = () => exportExcel(`Ton-kho-cac-chi-nhanh-${today}`, [
    sheet('Tồn theo chi nhánh', rows, [
      { header: 'Mã', get: r => r.code, width: 12 }, { header: 'Vật tư', get: r => r.name, width: 40 },
      { header: 'Nhóm', get: r => r.group_name, width: 22 }, { header: 'ĐVT', get: r => r.unit, width: 8 },
      ...branches.map(b => ({ header: b.name, get: (r: MatrixRow) => Number(r.by_branch[String(b.id)]?.qty ?? 0), width: 12 })),
      { header: 'Tổng', get: r => branches.reduce((s, b) => s + Number(r.by_branch[String(b.id)]?.qty ?? 0), 0), width: 10 },
      ...branches.map(b => ({ header: 'Tối thiểu ' + b.name, get: (r: MatrixRow) => Number(r.by_branch[String(b.id)]?.min ?? 0), width: 12 })),
    ]),
  ]);
  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Tìm vật tư…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="select" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}><option value="">Tất cả nhóm</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <label className="check"><input type="checkbox" checked={onlyAlert} onChange={e => setOnlyAlert(e.target.checked)} /> Chỉ vật tư có chi nhánh dưới tối thiểu</label>
        <span className="spacer" /><ExportBtn onClick={doExport} disabled={!rows.length} />
      </div>
      {m.loading ? <Loading /> : m.error ? <div className="notice danger">{m.error}</div> : !rows.length ? <Empty>Không có dữ liệu.</Empty> : (
        <><div className="table-wrap" style={{ maxHeight: '70vh' }}><table className="data matrix fixed-cols">
          <thead><tr><th style={{ width: 240 }}>Vật tư</th><th style={{ width: 64 }}>ĐVT</th>{branches.map(b => <th key={b.id} className="num" style={{ width: 84, whiteSpace: 'normal' }}>{b.name}</th>)}<th className="num" style={{ width: 80 }}>Tổng</th></tr></thead>
          <tbody>{pg.shown.map(r => (
            <tr key={r.id}><td><div className="item-name">{r.name}</div><div className="item-code">{r.code} · {r.group_name}</div></td><td className="small">{r.unit}</td>
              {branches.map(b => { const c = r.by_branch[String(b.id)]; return <td key={b.id} className={`num ${cls(c)}`} title={c ? `Còn dùng được ${U(c.usable, r.id, r.unit)} · tối thiểu ${U(c.min, r.id, r.unit)}` : ''}>{U(c?.qty, r.id, r.unit, { bare: true })}</td>; })}
              <td className="num"><b>{U(branches.reduce((s, b) => s + Number(r.by_branch[String(b.id)]?.qty ?? 0), 0), r.id, r.unit, { bare: true })}</b></td></tr>
          ))}</tbody>
        </table></div>{pg.pager}</>
      )}
      <p className="muted small">Ô đỏ: dưới tối thiểu · ô vàng: sắp hết · ô xám: hết hàng. Di chuột vào ô để xem số còn dùng được và mức tối thiểu.</p>
    </>
  );
}

function OwnStock() {
  const { session, today } = useApp();
  const s = useRpc<StockRow[]>('report_stock', {});
  const name = session.profile?.branch_name;
  const pgO = usePaged(s.data ?? []);
  const doExport = () => exportExcel(`Ton-kho-${name}-${today}`, [sheet('Tồn ' + name, s.data ?? [], [
    { header: 'Mã', get: r => r.code, width: 12 }, { header: 'Vật tư', get: r => r.name, width: 40 }, { header: 'Nhóm', get: r => r.group_name, width: 22 },
    { header: 'ĐVT', get: r => r.unit, width: 8 }, { header: 'Tồn', get: r => Number(r.qty), width: 10 }, { header: 'Còn dùng được', get: r => Number(r.usable_qty), width: 14 },
    { header: 'Tối thiểu', get: r => Number(r.min_qty), width: 10 }, { header: 'Trạng thái', get: r => STOCK_LEVEL[stockLevel(r.usable_qty, r.min_qty)].label, width: 16 },
  ])]);
  return (
    <>
      <div className="toolbar"><span className="muted small">Tồn kho chi nhánh {name}</span><span className="spacer" /><ExportBtn onClick={doExport} disabled={!s.data?.length} /></div>
      {s.loading ? <Loading /> : s.error ? <div className="notice danger">{s.error}</div> : (
        <><div className="table-wrap cards-sm"><table className="data fixed-cols">
          <thead><tr><th>Vật tư</th><th className="num" style={{ width: 110 }}>Tồn</th><th className="num" style={{ width: 130 }}>Còn dùng được</th><th className="num" style={{ width: 100 }}>Tối thiểu</th><th style={{ width: 130 }}>Trạng thái</th></tr></thead>
          <tbody>{pgO.shown.map(r => <tr key={r.id}><td><span className="item-name">{r.name}</span> <span className="item-code">{r.code}</span></td><td className="num">{fmtUnits(r.qty, r)}</td><td className="num">{fmtUnits(r.usable_qty, r, { bare: true })}</td><td className="num">{fmtUnits(r.min_qty, r, { bare: true })}</td><td><StockBadge usable={r.usable_qty} min={r.min_qty} /></td></tr>)}</tbody>
        </table></div>{pgO.pager}</>
      )}
    </>
  );
}

function useRange(days = 30) {
  const { today } = useApp();
  const [from, setFrom] = useState(addDays(today, -days));
  const [to, setTo] = useState(today);
  const el = <div className="row date-range"><input className="input sm" type="date" value={from} onChange={e => setFrom(e.target.value)} /> → <input className="input sm" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>;
  return { from, to, el };
}

function TransferReport() {
  const { has } = useApp();
  const r = useRange();
  const [branch, setBranch] = useState<number | null>(null);
  const [status, setStatus] = useState<TransferStatus | ''>('');
  const U = useUnits();
  const t = useRpc<Transfer[]>('report_transfers', { from: r.from, to: r.to, branch_id: branch });
  const rows = (t.data ?? []).filter(x => !status || x.status === status);
  const flat = rows.flatMap(x => x.lines.map(l => ({ t: x, l })));
  const pgT = usePaged(flat, [status, branch, r.from, r.to]);
  const doExport = () => exportExcel(`Lich-su-dieu-chuyen-${r.from}-${r.to}`, [sheet('Điều chuyển', flat, [
    { header: 'Mã phiếu', get: x => x.t.code, width: 16 }, { header: 'Ngày tạo', get: x => fmtDateTime(x.t.requested_at), width: 18 },
    { header: 'CN xin (A)', get: x => x.t.to_branch_name, width: 14 }, { header: 'CN cấp (B)', get: x => x.t.from_branch_name, width: 14 },
    { header: 'Trạng thái', get: x => TRANSFER_STATUS[x.t.status].label, width: 18 },
    { header: 'Mã VT', get: x => x.l.item_code, width: 12 }, { header: 'Vật tư', get: x => x.l.item_name, width: 36 }, { header: 'ĐVT', get: x => x.l.unit, width: 8 },
    { header: 'SL yêu cầu', get: x => Number(x.l.qty_requested), width: 11 }, { header: 'SL duyệt', get: x => (x.l.qty_approved == null ? '' : Number(x.l.qty_approved)), width: 10 },
    { header: 'Lô gửi', get: x => x.l.lots.map(z => `${z.lot_no}(${fmtDate(z.expiry_date)})×${z.qty}`).join('; '), width: 30 },
    { header: 'Người tạo', get: x => x.t.requested_by_name, width: 18 }, { header: 'Người duyệt', get: x => x.t.approved_by_name, width: 18 },
    { header: 'Người gửi', get: x => x.t.shipped_by_name, width: 18 }, { header: 'Ngày gửi', get: x => fmtDateTime(x.t.shipped_at), width: 18 },
    { header: 'Người nhận', get: x => x.t.received_by_name, width: 18 }, { header: 'Ngày nhận', get: x => fmtDateTime(x.t.received_at), width: 18 },
    { header: 'Ghi chú / lý do', get: x => [x.t.note, x.t.reject_reason, x.t.receive_note].filter(Boolean).join(' | '), width: 30 },
  ])]);
  return (
    <>
      <div className="toolbar">
        {r.el}
        {has('inv_report_view_all') && <BranchSelect value={branch} onChange={setBranch} includeAll="Tất cả chi nhánh" />}
        <select className="select sm hide-mobile" value={status} onChange={e => setStatus(e.target.value as TransferStatus | '')}>
          <option value="">Mọi trạng thái</option>{Object.entries(TRANSFER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="spacer" /><ExportBtn onClick={doExport} disabled={!flat.length} />
      </div>
      {t.loading ? <Loading /> : t.error ? <div className="notice danger">{t.error}</div> : !flat.length ? <Empty>Không có điều chuyển trong khoảng thời gian này.</Empty> : (
        <><div className="table-wrap cards-sm"><table className="data">
          <thead><tr><th>Phiếu</th><th>A ← B</th><th>Vật tư</th><th className="num">Yêu cầu</th><th className="num">Duyệt</th><th>Trạng thái</th><th>Hoàn tất</th></tr></thead>
          <tbody>{pgT.shown.map(({ t: x, l }) => (
            <tr key={l.id}><td className="nowrap"><b className="mono">{x.code}</b><div className="item-code">{fmtDateTime(x.requested_at)}</div></td>
              <td className="small nowrap">{x.to_branch_name} ← {x.from_branch_name}</td>
              <td><span className="item-name">{l.item_name}</span></td>
              <td className="num">{U(l.qty_requested, l.item_id, l.unit)}</td><td className="num">{l.qty_approved == null ? '—' : U(l.qty_approved, l.item_id, l.unit, { bare: true })}</td>
              <td><Badge tone={TRANSFER_STATUS[x.status].tone}>{TRANSFER_STATUS[x.status].label}</Badge></td>
              <td className="small">{x.received_at ? fmtDateTime(x.received_at) : x.closed_at ? fmtDateTime(x.closed_at) : '—'}</td></tr>
          ))}</tbody>
        </table></div>{pgT.pager}</>
      )}
    </>
  );
}

type UsageRow = { doc_id: number; usage_date: string; branch_id: number; branch_name: string; item_id: number; item_code: string; item_name: string; unit: string; group_name: string | null; qty: number; reason: string; lots: { lot_no: string; expiry_date: string | null; qty: number }[]; note: string | null; created_by_name: string | null };

function UsageReport() {
  const { has, branches } = useApp();
  const r = useRange(30);
  const [branch, setBranch] = useState<number | null>(null);
  const [view, setView] = useState<'sum' | 'detail'>('sum');
  const U = useUnits();
  const u = useRpc<UsageRow[]>('report_usage', { from: r.from, to: r.to, branch_id: branch });
  const data = u.data ?? [];
  const sum = useMemo(() => {
    const m = new Map<number, { item_id: number; item_code: string; item_name: string; unit: string; group_name: string | null; total: number; by: Record<number, number>; waste: number }>();
    for (const x of data) {
      const e = m.get(x.item_id) ?? { item_id: x.item_id, item_code: x.item_code, item_name: x.item_name, unit: x.unit, group_name: x.group_name, total: 0, by: {}, waste: 0 };
      e.total += Number(x.qty); e.by[x.branch_id] = (e.by[x.branch_id] ?? 0) + Number(x.qty);
      if (x.reason !== 'Điều trị') e.waste += Number(x.qty);
      m.set(x.item_id, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [data]);
  const shownBranches = branch ? branches.filter(b => b.id === branch) : branches.filter(b => data.some(x => x.branch_id === b.id));
  const days = Math.max(1, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1);
  const pgS = usePaged(sum, [branch, r.from, r.to]);
  const pgD = usePaged(data, [branch, r.from, r.to]);
  const doExport = () => exportExcel(`Xuat-dung-${r.from}-${r.to}`, [
    sheet('Tổng hợp', sum, [
      { header: 'Mã', get: x => x.item_code, width: 12 }, { header: 'Vật tư', get: x => x.item_name, width: 40 }, { header: 'Nhóm', get: x => x.group_name, width: 22 }, { header: 'ĐVT', get: x => x.unit, width: 8 },
      ...shownBranches.map(b => ({ header: b.name, get: (x: typeof sum[number]) => x.by[b.id] ?? 0, width: 12 })),
      { header: 'Tổng', get: x => x.total, width: 10 }, { header: 'TB/ngày', get: x => Math.round((x.total / days) * 100) / 100, width: 10 }, { header: 'Hỏng/hủy', get: x => x.waste, width: 10 },
    ]),
    sheet('Chi tiết', data, [
      { header: 'Ngày', get: x => fmtDate(x.usage_date), width: 12 }, { header: 'Chi nhánh', get: x => x.branch_name, width: 14 }, { header: 'Phiếu', get: x => x.doc_id, width: 8 },
      { header: 'Mã', get: x => x.item_code, width: 12 }, { header: 'Vật tư', get: x => x.item_name, width: 40 }, { header: 'ĐVT', get: x => x.unit, width: 8 },
      { header: 'Số lượng', get: x => Number(x.qty), width: 10 }, { header: 'Lý do', get: x => x.reason, width: 14 },
      { header: 'Lô', get: x => x.lots.map(z => `${z.lot_no}×${z.qty}`).join('; '), width: 24 }, { header: 'Người ghi', get: x => x.created_by_name, width: 18 }, { header: 'Ghi chú', get: x => x.note, width: 24 },
    ]),
  ]);
  return (
    <>
      <div className="toolbar">
        {r.el}
        {has('inv_report_view_all') && <BranchSelect value={branch} onChange={setBranch} includeAll="Tất cả chi nhánh" />}
        <select className="select sm" value={view} onChange={e => setView(e.target.value as 'sum' | 'detail')}><option value="sum">Tổng hợp theo vật tư</option><option value="detail">Chi tiết từng dòng</option></select>
        <span className="spacer" /><ExportBtn onClick={doExport} disabled={!data.length} />
      </div>
      {u.loading ? <Loading /> : u.error ? <div className="notice danger">{u.error}</div> : !data.length ? <Empty>Không có dữ liệu xuất dùng.</Empty> : view === 'sum' ? (
        <><div className="table-wrap cards-sm"><table className="data">
          <thead><tr><th>Vật tư</th>{shownBranches.map(b => <th key={b.id} className="num">{b.name}</th>)}<th className="num">Tổng</th><th className="num">TB/ngày</th><th className="num">Hỏng/hủy</th></tr></thead>
          <tbody>{pgS.shown.map(x => (
            <tr key={x.item_id}><td><span className="item-name">{x.item_name}</span> <span className="item-code">{x.unit}</span></td>
              {shownBranches.map(b => <td key={b.id} className="num">{x.by[b.id] ? U(x.by[b.id], x.item_id, x.unit, { bare: true }) : <span className="muted">·</span>}</td>)}
              <td className="num"><b>{U(x.total, x.item_id, x.unit, { bare: true })}</b></td><td className="num">{fmtQty(x.total / days)}</td><td className="num">{x.waste ? U(x.waste, x.item_id, x.unit, { bare: true }) : ''}</td></tr>
          ))}</tbody>
        </table></div>{pgS.pager}</>
      ) : (
        <><div className="table-wrap cards-sm"><table className="data">
          <thead><tr><th>Ngày</th><th>Chi nhánh</th><th>Vật tư</th><th className="num">SL</th><th>Lý do</th><th>Lô</th><th>Người ghi</th></tr></thead>
          <tbody>{pgD.shown.map((x, i) => (
            <tr key={i}><td className="nowrap">{fmtDate(x.usage_date)}</td><td>{x.branch_name}</td><td><span className="item-name">{x.item_name}</span></td>
              <td className="num">{U(x.qty, x.item_id, x.unit)}</td><td><Badge tone={x.reason === 'Điều trị' ? 'muted' : 'warning'}>{x.reason}</Badge></td>
              <td className="small mono">{x.lots.map(z => `${z.lot_no || '—'}×${fmtQty(z.qty)}`).join(', ')}</td><td className="small">{x.created_by_name}</td></tr>
          ))}</tbody>
        </table></div>{pgD.pager}</>
      )}
      <p className="muted small">“TB/ngày” giúp đặt tồn tối thiểu: tối thiểu ≈ TB/ngày × (số ngày chờ hàng + 3).</p>
    </>
  );
}
