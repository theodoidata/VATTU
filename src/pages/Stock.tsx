import { useMemo, useState } from 'react';
import { ArrowRightLeft, Download, Pencil } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Chips, Empty, ExpiryBadge, Field, FilterBlock, FilterPanel, GroupList, Loading, Modal, PageHeader, StockBadge, useAction, useRpc, usePaged } from '../components/ui';
import { EXPIRY_LEVEL, STOCK_LEVEL, fmtDate, fmtQty, norm, rowAlerts } from '../lib/format';
import type { Lot, StockRow } from '../lib/types';
import { handoff } from '../lib/handoff';
import { exportExcel, sheet } from '../lib/excel';

type StockSel = 'all' | 'in' | 'out' | 'below' | 'alert';
type ExpSel = 'all' | 'expiry' | 'd30' | 'expired';
type LotSel = 'all' | 'yes' | 'no';

export default function StockPage() {
  const { branchId, branches, groups, today, has, canAct } = useApp();
  const branch = branches.find(b => b.id === branchId);
  // Mặc định chỉ tải vật tư đang có tồn / có mức tối thiểu (đỡ tốn dữ liệu); bật "showAll" để tải cả danh mục
  const [showAll, setShowAll] = useState(false);
  const { data, loading, error } = useRpc<StockRow[]>('get_stock', showAll ? { branch_id: branchId, all: true } : { branch_id: branchId });
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number | ''>('');
  const [init] = useState(() => { const f = handoff.stockFilter; handoff.stockFilter = undefined; return f; });
  const [stockSel, setStockSel] = useState<StockSel>(init === 'below' ? 'below' : init === 'alert' ? 'alert' : 'all');
  const [expSel, setExpSel] = useState<ExpSel>(init === 'expiry' ? 'expiry' : 'all');
  const [lotSel, setLotSel] = useState<LotSel>('all');
  const [detail, setDetail] = useState<StockRow | null>(null);
  const [editMin, setEditMin] = useState<StockRow | null>(null);
  const canMin = has('inv_min_manage') && canAct(branchId);

  const rows = useMemo(() => {
    const n = norm(q.trim());
    return (data ?? []).filter(r => {
      if (group && r.group_id !== group) return false;
      if (lotSel !== 'all' && r.track_lot !== (lotSel === 'yes')) return false;
      if (n && !norm(r.name).includes(n) && !norm(r.code).includes(n)) return false;
      const { level, exp } = rowAlerts(r, today);
      const expBad = ['expired', 'd30', 'd90'].includes(exp);
      if (stockSel === 'in' && !(Number(r.qty) > 0)) return false;
      if (stockSel === 'out' && Number(r.usable_qty) > 0) return false;
      if (stockSel === 'below' && !(level === 'below' || level === 'out')) return false;
      if (stockSel === 'alert' && ['ok', 'none'].includes(level) && !expBad) return false;
      if (expSel === 'expiry' && !expBad) return false;
      if (expSel === 'd30' && exp !== 'd30') return false;
      if (expSel === 'expired' && exp !== 'expired') return false;
      return true;
    });
  }, [data, q, group, stockSel, expSel, lotSel, today]);
  const pg = usePaged(rows, [q, group, stockSel, expSel, lotSel, showAll, branchId]);

  const counts = useMemo(() => {
    const c = { below: 0, expiry: 0, alert: 0, out: 0 };
    for (const r of data ?? []) {
      const { level, exp } = rowAlerts(r, today);
      const b = level === 'below' || level === 'out', e = ['expired', 'd30', 'd90'].includes(exp);
      if (b) c.below++; if (e) c.expiry++; if (b || e || level === 'low') c.alert++;
      if (!(Number(r.usable_qty) > 0)) c.out++;
    }
    return c;
  }, [data, today]);

  const groupCounts = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const r of data ?? []) m.set(r.group_id, (m.get(r.group_id) ?? 0) + 1);
    return m;
  }, [data]);

  const activeFilters = [group !== '', stockSel !== 'all', expSel !== 'all', lotSel !== 'all', showAll].filter(Boolean).length;
  const clear = () => { setGroup(''); setStockSel('all'); setExpSel('all'); setLotSel('all'); setShowAll(false); };

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
        description="Bấm vào một vật tư để xem lô, hạn dùng và tồn ở các chi nhánh khác."
        actions={has('inv_report_export') && <button className="btn" onClick={doExport} disabled={!rows.length}><Download size={16} /> Xuất Excel</button>} />
      <div className="list-layout">
        <FilterPanel active={activeFilters} onClear={clear}>
          <FilterBlock title="Nhóm hàng">
            <GroupList groups={groups} counts={groupCounts} value={group} onChange={setGroup} />
          </FilterBlock>
          <FilterBlock title="Tồn kho">
            <select className="select" value={stockSel} onChange={e => setStockSel(e.target.value as StockSel)}>
              <option value="all">Tất cả</option>
              <option value="in">Còn hàng</option>
              <option value="out">Hết hàng dùng được ({counts.out})</option>
              <option value="below">Dưới tối thiểu ({counts.below})</option>
              <option value="alert">Cần chú ý ({counts.alert})</option>
            </select>
          </FilterBlock>
          <FilterBlock title="Hạn sử dụng">
            <Chips value={expSel} onChange={setExpSel} options={[['all', 'Tất cả'], ['expiry', `Sắp / đã hết (${counts.expiry})`], ['d30', '≤ 30 ngày'], ['expired', 'Đã hết hạn']] as const} />
          </FilterBlock>
          <FilterBlock title="Quản lý lô / HSD">
            <Chips value={lotSel} onChange={setLotSel} options={[['all', 'Tất cả'], ['yes', 'Có'], ['no', 'Không']] as const} />
          </FilterBlock>
          <FilterBlock title="Phạm vi">
            <label className="check small"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Hiện cả vật tư không có tồn</label>
          </FilterBlock>
        </FilterPanel>

        <section className="panel">
          <div className="toolbar">
            <input className="input" placeholder="Tìm theo mã, tên vật tư (gõ không dấu được)…" value={q} onChange={e => setQ(e.target.value)} />
            <span className="muted small">{rows.length} vật tư</span>
          </div>
          {loading ? <Loading /> : error ? <div className="notice danger">{error}</div> : rows.length === 0 ? <Empty>{showAll ? 'Không có vật tư phù hợp.' : 'Không có vật tư phù hợp. Vật tư chưa có tồn đang được ẩn, tick “Hiện cả vật tư không có tồn” để xem.'}</Empty> : (
            <><div className="table-wrap"><table className="data fixed-cols">
              <thead><tr><th style={{ width: 84 }}>Mã</th><th>Tên vật tư</th><th className="hide-sm" style={{ width: 130 }}>Nhóm</th><th className="num" style={{ width: 80 }}>Tồn</th><th className="num" style={{ width: 104 }}>Còn dùng được</th><th className="num" style={{ width: 96 }}>Tối thiểu</th><th style={{ width: 104 }}>Trạng thái</th><th style={{ width: 112 }}>Hạn gần nhất</th></tr></thead>
              <tbody>{pg.shown.map(r => (
                <tr key={r.id} className="clickable" onClick={() => setDetail(r)}>
                  <td className="mono small nowrap">{r.code}</td>
                  <td><div className="item-name">{r.name}</div>{(r.track_lot || r.purchase_unit) && <div className="item-code">{[r.track_lot ? 'quản lý lô/HSD' : '', r.purchase_unit ? `1 ${r.purchase_unit} = ${fmtQty(r.purchase_factor)} ${r.unit}` : ''].filter(Boolean).join(' · ')}</div>}</td>
                  <td className="small hide-sm">{r.group_name}</td>
                  <td className="num">{fmtQty(r.qty)} <span className="muted">{r.unit}</span></td>
                  <td className="num"><b>{fmtQty(r.usable_qty)}</b></td>
                  <td className="num nowrap">
                    {fmtQty(r.min_qty)}{r.min_is_custom && <span className="muted small" title="Đặt riêng cho chi nhánh"> *</span>}
                    {canMin && <button className="btn btn-ghost btn-sm icon-only" title="Sửa tồn tối thiểu" onClick={e => { e.stopPropagation(); setEditMin(r); }}><Pencil size={13} /></button>}
                  </td>
                  <td><StockBadge usable={r.usable_qty} min={r.min_qty} /></td>
                  <td><ExpiryBadge date={r.nearest_expiry} /></td>
                </tr>
              ))}</tbody>
            </table></div>{pg.pager}</>
          )}
          <p className="muted small">
            Mức cảnh báo: <b>Sắp hết</b> khi còn dưới 1,5 lần tối thiểu · <b>Dưới tối thiểu</b> · <b>Hết hàng</b>.
            Hạn dùng: {EXPIRY_LEVEL.d90.label} (vàng), {EXPIRY_LEVEL.d30.label} (đỏ), đã hết hạn (đen, chỉ được ghi “Hủy hết hạn”). Dấu * = tối thiểu đặt riêng cho chi nhánh.
          </p>
        </section>
      </div>
      {detail && <ItemDetail row={detail} onClose={() => setDetail(null)} />}
      {editMin && <MinModal row={editMin} branchId={branchId} onClose={() => setEditMin(null)} />}
    </>
  );
}

type BranchStock = { branch_id: number; branch_code: string; branch_name: string; qty: number; usable: number; min: number; nearest_expiry: string | null };

/** Chi tiết 1 vật tư: lô tại chi nhánh đang xem + tồn ở mọi chi nhánh → xin điều chuyển nhanh */
function ItemDetail({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { branchId, branches, has, canAct, go } = useApp();
  const here = branches.find(b => b.id === branchId);
  const all = useRpc<BranchStock[]>('get_item_branches', { item_id: row.id });
  const canRequest = has('inv_transfer_request') && canAct(branchId);
  const need = Math.max(Math.ceil(Number(row.min_qty) * 1.5 - Number(row.usable_qty)), 1);
  const spare = (b: BranchStock) => Math.max(0, Number(b.usable) - Number(b.min));
  const best = (all.data ?? []).filter(b => b.branch_id !== branchId && Number(b.usable) > 0)
    .sort((a, b) => spare(b) - spare(a) || Number(b.usable) - Number(a.usable))[0];
  const request = (from?: number) => {
    handoff.transferDraft = { from_branch_id: from, items: [{ item_id: row.id, qty: need }] };
    onClose(); go('dieu-chuyen');
  };
  return (
    <Modal size="wide" title={row.name} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      {canRequest && <button className="btn btn-primary" onClick={() => request(best?.branch_id)}>
        <ArrowRightLeft size={16} /> Xin điều chuyển về {here?.name}</button>}
    </>}>
      <div className="detail-grid">
        <div><small>Mã</small><b className="mono">{row.code}</b></div>
        <div><small>Nhóm</small><b>{row.group_name ?? '—'}</b></div>
        <div><small>Đơn vị dùng</small><b>{row.unit}</b>{row.purchase_unit && <div className="small muted">1 {row.purchase_unit} = {fmtQty(row.purchase_factor)} {row.unit}</div>}</div>
        <div><small>Tồn tại {here?.name}</small><b>{fmtQty(row.qty)}</b> <span className="muted small">dùng được {fmtQty(row.usable_qty)}</span></div>
        <div><small>Tối thiểu</small><b>{fmtQty(row.min_qty)}</b> <StockBadge usable={row.usable_qty} min={row.min_qty} /></div>
      </div>

      {row.lots.length > 0 && <>
        <h3 className="sec">Lô tại {here?.name}</h3>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Số lô</th><th>Hạn dùng</th><th className="num">Số lượng</th><th>Tình trạng</th></tr></thead>
          <tbody>{row.lots.map(l => <tr key={l.id}><td className="mono">{l.lot_no || '(không số lô)'}</td><td>{fmtDate(l.expiry_date)}</td><td className="num">{fmtQty(l.qty)} {row.unit}</td><td><ExpiryBadge date={l.expiry_date} /></td></tr>)}</tbody>
        </table></div>
      </>}

      <h3 className="sec">Tồn ở các chi nhánh</h3>
      {all.loading ? <Loading /> : all.error ? <div className="notice danger">{all.error}</div> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Chi nhánh</th><th className="num">Tồn</th><th className="num">Còn dùng được</th><th className="num">Tối thiểu</th><th className="num" title="Còn dùng được trừ tối thiểu">Có thể cấp</th><th>Hạn gần nhất</th>{canRequest && <th />}</tr></thead>
          <tbody>{(all.data ?? []).map(b => {
            const isHere = b.branch_id === branchId;
            return (
              <tr key={b.branch_id} className={isHere ? 'current' : undefined}>
                <td><b>{b.branch_name}</b>{isHere && <span className="muted small"> (đang xem)</span>}</td>
                <td className="num">{Number(b.qty) ? fmtQty(b.qty) : <span className="muted">0</span>}</td>
                <td className="num">{fmtQty(b.usable)}</td>
                <td className="num">{fmtQty(b.min)}</td>
                <td className="num">{isHere ? '' : spare(b) > 0 ? <b style={{ color: 'var(--td-success)' }}>{fmtQty(spare(b))}</b> : <span className="muted">0</span>}</td>
                <td><ExpiryBadge date={b.nearest_expiry} /></td>
                {canRequest && <td className="nowrap">{!isHere && Number(b.usable) > 0 &&
                  <button className="btn btn-sm" onClick={() => request(b.branch_id)}>Xin từ đây</button>}</td>}
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="muted small">“Có thể cấp” = còn dùng được trừ mức tối thiểu của chi nhánh đó, để chi nhánh cấp không bị thiếu. Số lượng xin mặc định {fmtQty(need)} {row.unit} (đủ lên 1,5 lần tối thiểu), sửa được ở bước sau.</p>
    </Modal>
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
