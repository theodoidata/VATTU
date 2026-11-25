import { useMemo, useState } from 'react';
import { Plus, ArrowLeft, Save, Send, CheckCheck, Undo2, Download, Trash2 } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, Empty, Field, ItemPicker, Loading, Modal, PageHeader, QtyInput, UnitCell, useAction, useRpc, usePaged, useUnits } from '../components/ui';
import { fmtDate, fmtDateTime, hasPack, norm } from '../lib/format';
import type { Item, Stocktake } from '../lib/types';
import { exportExcel, sheet } from '../lib/excel';
import { handoff } from '../lib/handoff';

const ST: Record<Stocktake['status'], { label: string; tone: string }> = {
  draft: { label: 'Đang đếm', tone: 'info' },
  submitted: { label: 'Chờ quản lý chốt', tone: 'warning' },
  approved: { label: 'Đã chốt', tone: 'success' },
  cancelled: { label: 'Đã hủy', tone: 'muted' },
};

export default function StocktakePage() {
  const { branchId, branches, groups, has, canAct } = useApp();
  const branch = branches.find(b => b.id === branchId);
  const list = useRpc<Stocktake[]>('list_stocktakes', { branch_id: branchId });
  const [openId, setOpenId] = useState<number | null>(() => { const id = handoff.openStocktakeId ?? null; handoff.openStocktakeId = undefined; return id; });
  const [creating, setCreating] = useState(false);
  const [group, setGroup] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const hasOpen = (list.data ?? []).some(s => s.status === 'draft' || s.status === 'submitted');
  const pg = usePaged(list.data ?? [], branchId);

  if (openId) return <StocktakeDetail id={openId} onBack={() => setOpenId(null)} />;
  return (
    <>
      <PageHeader title={`Kiểm kê · ${branch?.name ?? ''}`}
        description="Nhân viên đếm thực tế từng lô → nộp phiếu → Quản lý chi nhánh chốt, hệ thống tự điều chỉnh tồn theo chênh lệch."
        actions={has('inv_stocktake_count') && canAct(branchId) && <button className="btn btn-primary" disabled={hasOpen} title={hasOpen ? 'Đang có phiếu chưa chốt' : ''} onClick={() => setCreating(true)}><Plus size={16} /> Tạo phiếu kiểm kê</button>} />
      <section className="panel">
        {list.loading ? <Loading /> : list.error ? <div className="notice danger">{list.error}</div> : !list.data?.length ? <Empty>Chưa có phiếu kiểm kê nào.</Empty> : (
          <><div className="table-wrap cards-sm"><table className="data">
            <thead><tr><th>Phiếu</th><th>Phạm vi</th><th>Trạng thái</th><th className="num">Đã đếm</th><th className="num">Dòng lệch</th><th>Tạo bởi</th><th>Chốt bởi</th></tr></thead>
            <tbody>{pg.shown.map(s => (
              <tr key={s.id} className="clickable" onClick={() => setOpenId(s.id)}>
                <td><b>KK #{s.id}</b><div className="item-code">{fmtDateTime(s.created_at)}{s.note ? ' · ' + s.note : ''}</div></td>
                <td>{s.group_name ?? 'Toàn bộ vật tư'}</td>
                <td><Badge tone={ST[s.status].tone}>{ST[s.status].label}</Badge></td>
                <td className="num">{s.counted_count}/{s.line_count}</td>
                <td className="num">{s.diff_count ? <Badge tone="warning">{s.diff_count}</Badge> : 0}</td>
                <td className="small">{s.created_by_name}</td>
                <td className="small">{s.approved_by_name ? <>{s.approved_by_name}<div className="item-code">{fmtDateTime(s.approved_at)}</div></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>{pg.pager}</>
        )}
      </section>
      {creating && <Modal title="Tạo phiếu kiểm kê" size="narrow" onClose={() => setCreating(false)} footer={<>
        <button className="btn" onClick={() => setCreating(false)}>Đóng</button>
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          const r = await run<{ id: number }>('create_stocktake', { branch_id: branchId, group_id: group || null, note }, 'Đã tạo phiếu kiểm kê');
          if (r) { setCreating(false); setOpenId(r.id); }
        }}>Tạo phiếu</button></>}>
        <div className="stack">
          <Field label="Phạm vi kiểm kê"><select className="select" value={group} onChange={e => setGroup(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Toàn bộ vật tư</option>{groups.map(g => <option key={g.id} value={g.id}>Nhóm: {g.name}</option>)}</select></Field>
          <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Kiểm kê cuối tháng 11" /></Field>
          <p className="muted small" style={{ margin: 0 }}>Phiếu sẽ liệt kê mọi lô đang có tồn tại thời điểm tạo. Vật tư tìm thấy mà chưa có trong danh sách có thể thêm khi đếm.</p>
        </div>
      </Modal>}
    </>
  );
}

type NewLine = { key: number; item_id: number | null; lot_no: string; expiry_date: string; counted_qty: string };
let seq = 1;

function StocktakeDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { has, canAct, today } = useApp();
  const st = useRpc<Stocktake>('get_stocktake', { id });
  const items = useRpc<Item[]>('list_items');
  const U = useUnits();
  const byId = useMemo(() => new Map((items.data ?? []).map(i => [i.id, i])), [items.data]);
  // Vật tư có quy đổi (1 hộp = 10 sợi): 2 ô [hộp] [sợi], tự cộng thành số sợi
  const qtyBox = (itemId: number | null, unit: string, value: string, onChange: (v: string) => void) => {
    const it = itemId ? byId.get(itemId) : undefined;
    return hasPack(it) ? <QtyInput value={value} onChange={onChange} unit={it} />
      : <input className="input sm num" type="number" min={0} step="any" style={{ width: 80, textAlign: 'right' }} value={value} onChange={e => onChange(e.target.value)} aria-label={`Thực đếm (${it?.unit ?? unit})`} />;
  };
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState<NewLine[]>([]);
  const [showSys, setShowSys] = useState(false);
  const [q, setQ] = useState('');
  const { run, busy } = useAction();
  const s = st.data;
  const editable = s?.status === 'draft' && has('inv_stocktake_count') && canAct(s.branch_id);
  const lines = s?.lines ?? [];
  const val = (l: NonNullable<Stocktake['lines']>[number]) => counts[l.id] ?? (l.counted_qty == null ? '' : String(l.counted_qty));
  const filtered = useMemo(() => { const n = norm(q.trim()); return lines.filter(l => !n || norm(l.item_name).includes(n) || norm(l.item_code).includes(n) || norm(l.lot_no).includes(n)); }, [lines, q]);
  const counted = lines.filter(l => val(l) !== '').length;
  const diffs = lines.filter(l => val(l) !== '' && Number(val(l)) !== Number(l.system_qty));
  const showSystem = showSys || !editable;
  const [confirmBlank, setConfirmBlank] = useState(false);
  const pgL = usePaged(filtered, q);

  const payload = (submit: boolean) => ({
    id, submit,
    lines: lines.filter(l => counts[l.id] !== undefined || notes[l.id] !== undefined)
      .map(l => ({ id: l.id, counted_qty: val(l) === '' ? null : Number(val(l)), note: notes[l.id] ?? l.note })),
    new_lines: extra.filter(x => x.item_id && x.counted_qty !== '').map(x => ({ item_id: x.item_id, lot_no: x.lot_no, expiry_date: x.expiry_date || null, counted_qty: Number(x.counted_qty) })),
  });
  const save = async (submit: boolean) => {
    if (await run('save_stocktake', payload(submit), submit ? 'Đã nộp phiếu kiểm kê, chờ quản lý chốt' : 'Đã lưu số đếm')) { setCounts({}); setNotes({}); setExtra([]); st.reload(); }
  };
  const action = async (a: string, msg: string) => { if (await run('stocktake_action', { id, action: a }, msg)) st.reload(); };

  async function doExport() {
    if (!s) return;
    await exportExcel(`Kiem-ke-${s.id}-${s.branch_name}`, [sheet('Kiểm kê #' + s.id, lines, [
      { header: 'Mã', get: l => l.item_code, width: 12 }, { header: 'Vật tư', get: l => l.item_name, width: 40 },
      { header: 'ĐVT', get: l => l.unit, width: 8 }, { header: 'Số lô', get: l => l.lot_no, width: 12 },
      { header: 'Hạn dùng', get: l => fmtDate(l.expiry_date), width: 12 }, { header: 'Sổ sách', get: l => Number(l.system_qty), width: 10 },
      { header: 'Thực đếm', get: l => (l.counted_qty == null ? '' : Number(l.counted_qty)), width: 10 },
      { header: 'Chênh lệch', get: l => (l.counted_qty == null ? '' : Number(l.counted_qty) - Number(l.system_qty)), width: 10 },
      { header: 'Ghi chú', get: l => l.note ?? '', width: 24 },
    ])]);
  }

  if (st.loading && !s) return <Loading />;
  if (st.error || !s) return <div className="notice danger">{st.error}</div>;
  return (
    <>
      <PageHeader title={`Kiểm kê #${s.id} · ${s.branch_name}`}
        description={<>{s.group_name ?? 'Toàn bộ vật tư'} · tạo {fmtDateTime(s.created_at)} bởi {s.created_by_name} <Badge tone={ST[s.status].tone}>{ST[s.status].label}</Badge></>}
        actions={<>
          <button className="btn" onClick={onBack}><ArrowLeft size={16} /> Danh sách</button>
          {has('inv_report_export') && <button className="btn" onClick={doExport}><Download size={16} /> Excel</button>}
          {editable && <button className="btn" disabled={busy} onClick={() => save(false)}><Save size={16} /> Lưu nháp</button>}
          {editable && <button className="btn btn-primary" disabled={busy} onClick={() => (counted < lines.length ? setConfirmBlank(true) : save(true))}><Send size={16} /> Nộp phiếu</button>}
          {s.status === 'submitted' && has('inv_stocktake_approve') && canAct(s.branch_id) && <>
            <button className="btn" disabled={busy} onClick={() => action('reopen', 'Đã mở lại phiếu để đếm tiếp')}><Undo2 size={16} /> Trả lại đếm</button>
            <button className="btn btn-success" disabled={busy} onClick={() => action('approve', 'Đã chốt kiểm kê và điều chỉnh tồn')}><CheckCheck size={16} /> Chốt & điều chỉnh tồn</button></>}
          {(s.status === 'draft' || s.status === 'submitted') && has('inv_stocktake_count') && canAct(s.branch_id) &&
            <button className="btn btn-danger" disabled={busy} onClick={() => action('cancel', 'Đã hủy phiếu kiểm kê')}>Hủy phiếu</button>}
        </>} />
      {s.status === 'submitted' && <div className="notice warning">Có {diffs.length} dòng chênh lệch. Khi chốt, tồn kho sẽ được điều chỉnh bằng <b>(thực đếm − sổ sách lúc tạo phiếu)</b> cho từng lô.</div>}
      {s.status === 'approved' && <div className="notice">Đã chốt bởi {s.approved_by_name} lúc {fmtDateTime(s.approved_at)}. Tồn kho đã được điều chỉnh.</div>}
      <section className="panel">
        <div className="toolbar">
          <input className="input" placeholder="Tìm vật tư / số lô…" value={q} onChange={e => setQ(e.target.value)} />
          {editable && <label className="check"><input type="checkbox" checked={showSys} onChange={e => setShowSys(e.target.checked)} /> Hiện số sổ sách</label>}
          <span className="muted small">Đã đếm {counted}/{lines.length} · lệch {diffs.length}</span>
        </div>
        {editable && !showSys && <p className="muted small" style={{ marginTop: 0 }}>Đang ẩn số sổ sách để đếm khách quan. Không còn hàng thì nhập 0.</p>}
        <><div className="table-wrap cards-sm"><table className="data lines-table">
          <thead><tr><th>Vật tư</th><th style={{ width: 120 }}>Số lô</th><th style={{ width: 110 }}>Hạn dùng</th>{showSystem && <th className="num" style={{ width: 90 }}>Sổ sách</th>}<th className="num" style={{ width: 160 }}>Thực đếm</th>{editable && <th style={{ width: 100 }}>Đơn vị</th>}{showSystem && <th className="num" style={{ width: 90 }}>Lệch</th>}<th style={{ width: '22%' }}>Ghi chú</th></tr></thead>
          <tbody>{pgL.shown.map(l => {
            const v = val(l); const d = v === '' ? null : Number(v) - Number(l.system_qty);
            return (
              <tr key={l.id}>
                <td><span className="item-name">{l.item_name}</span> <span className="item-code">{l.item_code}</span></td>
                <td className="mono small">{l.lot_no || '—'}</td>
                <td className="small" style={{ color: l.expiry_date && l.expiry_date < today ? 'var(--td-danger)' : undefined }}>{fmtDate(l.expiry_date)}</td>
                {showSystem && <td className="num">{U(l.system_qty, l.item_id, l.unit)}</td>}
                <td className="num">{editable
                  ? qtyBox(l.item_id, l.unit, v, nv => setCounts(c => ({ ...c, [l.id]: nv })))
                  : v === '' ? '—' : U(v, l.item_id, l.unit)}</td>
                {editable && <td><UnitCell itemId={l.item_id} unit={l.unit} /></td>}
                {showSystem && <td className="num">{d == null ? '' : d === 0 ? <span className="muted">0</span> : <b style={{ color: d < 0 ? 'var(--td-danger)' : 'var(--td-success)' }}>{U(d, l.item_id, l.unit, { sign: true })}</b>}</td>}
                <td>{editable ? <input className="input sm" style={{ width: '100%' }} value={notes[l.id] ?? l.note ?? ''} onChange={e => setNotes(n => ({ ...n, [l.id]: e.target.value }))} /> : <span className="small">{l.note}</span>}</td>
              </tr>
            );
          })}
          {editable && extra.map(x => (
            <tr key={x.key} style={{ background: 'var(--td-info-soft)' }}>
              <td><ItemPicker items={(items.data ?? []).filter(i => i.active)} value={x.item_id} onChange={id => setExtra(es => es.map(e => e.key === x.key ? { ...e, item_id: id } : e))} /></td>
              <td><input className="input sm" style={{ width: 100 }} value={x.lot_no} placeholder="Số lô" onChange={e => setExtra(es => es.map(y => y.key === x.key ? { ...y, lot_no: e.target.value } : y))} /></td>
              <td><input className="input sm" type="date" value={x.expiry_date} onChange={e => setExtra(es => es.map(y => y.key === x.key ? { ...y, expiry_date: e.target.value } : y))} /></td>
              {showSystem && <td className="num muted">mới</td>}
              <td className="num">{qtyBox(x.item_id, '', x.counted_qty, nv => setExtra(es => es.map(y => y.key === x.key ? { ...y, counted_qty: nv } : y)))}</td>
              <td><UnitCell itemId={x.item_id} /></td>
              {showSystem && <td />}
              <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setExtra(es => es.filter(y => y.key !== x.key))} aria-label="Xóa dòng"><Trash2 size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table></div>{pgL.pager}</>
        {editable && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setExtra(es => [...es, { key: seq++, item_id: null, lot_no: '', expiry_date: '', counted_qty: '' }])}><Plus size={14} /> Thêm vật tư / lô tìm thấy ngoài danh sách</button>}
      </section>
      {confirmBlank && <Modal size="narrow" title="Nộp phiếu kiểm kê" onClose={() => setConfirmBlank(false)} footer={<>
        <button className="btn" onClick={() => setConfirmBlank(false)}>Quay lại đếm tiếp</button>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { setConfirmBlank(false); await save(true); }}><Send size={16} /> Nộp, tính dòng trống là 0</button>
      </>}>
        <p style={{ marginTop: 0 }}>Còn <b>{lines.length - counted}</b> dòng chưa nhập số đếm.</p>
        <p className="muted small">Các dòng này sẽ được tính là <b>0 (không tìm thấy hàng)</b>. Khi quản lý chốt phiếu, tồn của chúng sẽ về 0. Nếu chỉ là chưa đếm tới, bấm “Quay lại đếm tiếp”.</p>
      </Modal>}
    </>
  );
}
