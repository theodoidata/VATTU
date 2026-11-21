import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Pencil } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Empty, ExpiryBadge, Field, Loading, Modal, PageHeader, StockBadge, useAction, useRpc, usePaged } from '../components/ui';
import { EXPIRY_LEVEL, STOCK_LEVEL, fmtDate, fmtQty, norm, rowAlerts } from '../lib/format';
import type { Lot, StockRow } from '../lib/types';
import { handoff } from '../lib/handoff';
import { exportExcel, sheet } from '../lib/excel';

type Filter = 'all' | 'alert' | 'below' | 'expiry';

export default function StockPage() {
  const { branchId, branches, groups, today, has, canAct } = useApp();
  const branch = branches.find(b => b.id === branchId);
  // Mặc định chỉ tải vật tư đang có tồn / có mức tối thiểu (đỡ tốn dữ liệu); bật "showAll" để tải cả danh mục
  const [showAll, setShowAll] = useState(false);
  const { data, loading, error } = useRpc<StockRow[]>('get_stock', showAll ? { branch_id: branchId, all: true } : { branch_id: branchId });
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number | ''>('');
  const [filter, setFilter] = useState<Filter>(() => { const f = handoff.stockFilter ?? 'all'; handoff.stockFilter = undefined; return f; });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editMin, setEditMin] = useState<StockRow | null>(null);
  const canMin = has('inv_min_manage') && canAct(branchId);

  const rows = useMemo(() => {
    const n = norm(q.trim());
    return (data ?? []).filter(r => {
      if (group && r.group_id !== group) return false;
      if (n && !norm(r.name).includes(n) && !norm(r.code).includes(n)) return false;
      const { level, exp } = rowAlerts(r, today);
      if (filter === 'below') return level === 'below' || level === 'out';
      if (filter === 'expiry') return ['expired', 'd30', 'd90'].includes(exp);
      if (filter === 'alert') return !['ok', 'none'].includes(level) || ['expired', 'd30', 'd90'].includes(exp);
      return true;
    });
  }, [data, q, group, filter, today]);
  const pg = usePaged(rows, [q, group, filter, showAll, branchId]);

  const counts = useMemo(() => {
    const c = { below: 0, expiry: 0, alert: 0 };
    for (const r of data ?? []) {
      const { level, exp } = rowAlerts(r, today);
      const b = level === 'below' || level === 'out', e = ['expired', 'd30', 'd90'].includes(exp);
      if (b) c.below++; if (e) c.expiry++; if (b || e || level === 'low') c.alert++;
    }
    return c;
  }, [data, today]);

  const toggle = (id: number) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function doExport() {
    const flat = rows.flatMap<{ r: StockRow; l: Lot | null }>(r => (r.lots.length ? r.lots.map(l => ({ r, l })) : [{ r, l: null }]));
    await exportExcel(`Ton-kho-${branch?.code}-${today}`, [
      sheet('Tồn kho ' + branch?.name, flat, [
        { header: 'Mã', get: x => x.r.code, width: 12 },
        { header: 'Tên vật tư', get: x => x.r.name, width: 40 },
        { header: 'Nhóm', get: x => x.r.group_name, width: 22 },
        { header: 'ĐVT', get: x => x.r.unit, width: 8 },
        { header: 'Số lô', get: x => x.l?.lot_no ?? '', width: 12 },
        { header: 'Hạn dùng', get: x => x.l?.expiry_date ? fmtDate(x.l.expiry_date) : '', width: 12 },
        { header: 'SL lô', get: x => x.l ? Number(x.l.qty) : 0, width: 10 },
        { header: 'Tổng tồn', get: x => Number(x.r.qty), width: 10 },
        { header: 'Tối thiểu', get: x => Number(x.r.min_qty), width: 10 },
        { header: 'Trạng thái', get: x => STOCK_LEVEL[rowAlerts(x.r, today).level].label, width: 16 },
      ]),
    ]);
  }

  return (
    <>
      <PageHeader title={`Tồn kho · ${branch?.name ?? ''}`}
        description="Số lượng theo đơn vị dùng. Lô hết hạn không được tính vào “còn dùng được”."
        actions={has('inv_report_export') && <button className="btn" onClick={doExport} disabled={!rows.length}><Download size={16} /> Xuất Excel</button>} />
      <section className="panel">
        <div className="tabs">
          {([['all', 'Tất cả', 0], ['alert', 'Cần chú ý', counts.alert], ['below', 'Dưới tối thiểu', counts.below], ['expiry', 'Sắp / đã hết hạn', counts.expiry]] as const).map(([k, l, c]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}{c > 0 && <em>{c}</em>}</button>
          ))}
        </div>
        <div className="toolbar">
          <input className="input" placeholder="Tìm theo tên hoặc mã (gõ không dấu được)…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="select" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Tất cả nhóm</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <label className="check small"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Hiện cả vật tư không có tồn</label>
        </div>
        {loading ? <Loading /> : error ? <div className="notice danger">{error}</div> : rows.length === 0 ? <Empty>{showAll ? 'Không có vật tư phù hợp.' : 'Không có vật tư phù hợp. Vật tư chưa có tồn đang được ẩn — tick “Hiện cả vật tư không có tồn” để xem.'}</Empty> : (
          <><div className="table-wrap"><table className="data">
            <thead><tr><th style={{ width: 28 }} /><th>Vật tư</th><th className="hide-sm">Nhóm</th><th className="num">Tồn</th><th className="num">Còn dùng được</th><th className="num">Tối thiểu</th><th>Trạng thái</th><th>Hạn gần nhất</th></tr></thead>
            <tbody>{pg.shown.map(r => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => r.lots.length && toggle(r.id)}>
                    <td>{r.lots.length > 0 && (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}</td>
                    <td><div className="item-name">{r.name}</div><div className="item-code">{r.code}{r.track_lot ? ' · quản lý lô/HSD' : ''}{r.purchase_unit ? ` · 1 ${r.purchase_unit} = ${fmtQty(r.purchase_factor)} ${r.unit}` : ''}</div></td>
                    <td className="small hide-sm">{r.group_name}</td>
                    <td className="num">{fmtQty(r.qty)} <span className="muted">{r.unit}</span></td>
                    <td className="num"><b>{fmtQty(r.usable_qty)}</b></td>
                    <td className="num">
                      {fmtQty(r.min_qty)}{r.min_is_custom && <span className="muted small" title="Đặt riêng cho chi nhánh"> *</span>}
                      {canMin && <button className="btn btn-ghost btn-sm icon-only" title="Sửa tồn tối thiểu" onClick={e => { e.stopPropagation(); setEditMin(r); }}><Pencil size={13} /></button>}
                    </td>
                    <td><StockBadge usable={r.usable_qty} min={r.min_qty} /></td>
                    <td><ExpiryBadge date={r.nearest_expiry} /></td>
                  </tr>
                  {isOpen && r.lots.map(l => (
                    <tr key={l.id} className="sub"><td /><td>Lô <b className="mono">{l.lot_no || '(không số lô)'}</b></td><td className="hide-sm" />
                      <td className="num">{fmtQty(l.qty)}</td><td colSpan={3} /><td><ExpiryBadge date={l.expiry_date} /></td></tr>
                  ))}
                </Fragment>
              );
            })}</tbody>
          </table></div>{pg.pager}</>
        )}
        <p className="muted small">
          Mức cảnh báo: <b>Sắp hết</b> khi còn dưới 1,5 lần tối thiểu · <b>Dưới tối thiểu</b> · <b>Hết hàng</b>.
          Hạn dùng: {EXPIRY_LEVEL.d90.label} (vàng), {EXPIRY_LEVEL.d30.label} (đỏ), đã hết hạn (đen — chỉ được ghi “Hủy hết hạn”). Dấu * = tối thiểu đặt riêng cho chi nhánh.
        </p>
      </section>
      {editMin && <MinModal row={editMin} branchId={branchId} onClose={() => setEditMin(null)} />}
    </>
  );
}

function MinModal({ row, branchId, onClose }: { row: StockRow; branchId: number; onClose: () => void }) {
  const [v, setV] = useState(String(row.min_qty));
  const { run, busy } = useAction();
  const save = async (val: string | null) => {
    if (await run('save_min_qty', { item_id: row.id, branch_id: branchId, min_qty: val }, 'Đã lưu tồn tối thiểu') !== null) onClose();
  };
  return (
    <Modal title="Tồn tối thiểu" onClose={onClose} size="narrow" footer={<>
      {row.min_is_custom && <button className="btn" disabled={busy} onClick={() => save(null)}>Về mức mặc định</button>}
      <button className="btn btn-primary" disabled={busy || v === '' || Number(v) < 0} onClick={() => save(v)}>Lưu</button>
    </>}>
      <p style={{ marginTop: 0 }}><b>{row.name}</b><br /><span className="muted small">Áp dụng riêng cho chi nhánh đang xem. Gợi ý: lượng dùng TB/ngày × (số ngày chờ hàng + 3).</span></p>
      <Field label={`Tối thiểu (${row.unit})`}><input className="input" type="number" min={0} value={v} onChange={e => setV(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
