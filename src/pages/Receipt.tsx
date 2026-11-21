import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Pencil, Clock, X } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Empty, Field, ItemPicker, Loading, Modal, PageHeader, UnitInput, readDraft, useAction, useFormDraft, useRpc, usePaged } from '../components/ui';
import { addDays, fmtDate, fmtDateTime, fmtQty } from '../lib/format';
import type { Item, ReceiptDoc } from '../lib/types';

type Line = { key: number; item_id: number | null; qty: string; unit_mode: 'base' | 'purchase'; lot_no: string; expiry_date: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: null, qty: '', unit_mode: 'purchase', lot_no: '', expiry_date: '' });
type Head = { date: string; supplier: string; source: string; note: string };
type FormDraft = Head & { lines: Line[] };

export default function ReceiptPage() {
  const { branchId, branches, today, canAct } = useApp();
  const branch = branches.find(b => b.id === branchId);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const docs = useRpc<ReceiptDoc[]>('list_receipts', { branch_id: branchId, from, to });
  return (
    <>
      <PageHeader title={`Nhập kho · ${branch?.name ?? ''}`}
        description="Dùng cho hàng từ bên ngoài (nhà cung cấp, mua về). Hàng chuyển giữa các chi nhánh / Kho tổng dùng Điều chuyển." />
      {!canAct(branchId) ? <div className="notice warning">Bạn chỉ được nhập kho cho chi nhánh của mình.</div> : <ReceiptForm key={branchId} />}
      <ReceiptHistory docs={docs} from={from} to={to} setFrom={setFrom} setTo={setTo} />
    </>
  );
}

/** Bảng dòng vật tư dùng chung cho phiếu mới và sửa phiếu */
function LinesEditor({ lines, setLines, date }: { lines: Line[]; setLines: (f: (ls: Line[]) => Line[]) => void; date: string }) {
  const { has } = useApp();
  const items = useRpc<Item[]>('list_items');
  const { run } = useAction();
  const active = useMemo(() => (items.data ?? []).filter(i => i.active), [items.data]);
  const byId = useMemo(() => new Map(active.map(i => [i.id, i])), [active]);
  const canUnit = has('inv_catalog_manage');
  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  return (<>
    <div className="table-wrap stack-sm"><table className="data lines-table">
      <thead><tr><th style={{ minWidth: 240 }}>Vật tư</th><th className="num" style={{ width: 100 }}>Số lượng</th><th style={{ width: 120 }}>Đơn vị</th>
        <th style={{ width: 140 }}>Số lô</th><th style={{ width: 160 }}>Hạn sử dụng</th><th className="num" style={{ width: 100 }}>Quy ra</th><th style={{ width: 40 }} /></tr></thead>
      <tbody>{lines.map(l => {
        const it = l.item_id ? byId.get(l.item_id) : undefined;
        const base = it ? Number(l.qty || 0) * (l.unit_mode === 'purchase' && it.purchase_unit ? Number(it.purchase_factor) : 1) : 0;
        const need = it?.track_lot;
        return (
          <tr key={l.key}>
            <td><ItemPicker items={active} value={l.item_id} onChange={id => set(l.key, { item_id: id, unit_mode: byId.get(id)?.purchase_unit ? 'purchase' : 'base' })} />
              {need && <div className="item-code">Bắt buộc số lô + hạn dùng</div>}</td>
            <td className="num"><input className="input sm" type="number" min={0} step="any" style={{ width: 80, textAlign: 'right' }} value={l.qty} onChange={e => set(l.key, { qty: e.target.value })} /></td>
            <td>{!it ? null : it.purchase_unit ? (
              <select className="select sm" value={l.unit_mode} onChange={e => set(l.key, { unit_mode: e.target.value as Line['unit_mode'] })}>
                <option value="purchase">{it.purchase_unit}</option><option value="base">{it.unit}</option>
              </select>
            ) : canUnit ? (
              <UnitInput value={it.unit} onCommit={u => void run('update_item_basic', { id: it.id, unit: u }, `Đã đổi đơn vị “${it.name}”: ${it.unit} → ${u}`)} />
            ) : <span className="muted">{it.unit}</span>}</td>
            <td><input className="input sm" style={{ width: '100%', borderColor: need && !l.lot_no.trim() && l.qty ? 'var(--td-danger)' : undefined }} value={l.lot_no} onChange={e => set(l.key, { lot_no: e.target.value })} placeholder={need ? 'Bắt buộc' : 'Không bắt buộc'} /></td>
            <td><input className="input sm" type="date" style={{ width: '100%', borderColor: need && !l.expiry_date && l.qty ? 'var(--td-danger)' : undefined }} value={l.expiry_date} min={date} onChange={e => set(l.key, { expiry_date: e.target.value })} /></td>
            <td className="num">{it ? <>{fmtQty(base)} <span className="muted">{it.unit}</span></> : ''}</td>
            <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
          </tr>
        );
      })}</tbody>
    </table></div>
    {canUnit && <p className="muted small" style={{ margin: '6px 0 0' }}>Ô <b>Đơn vị</b>: chọn hoặc gõ đơn vị đúng (hộp, gói, sợi, cái…) rồi bấm ra ngoài. Đơn vị được sửa luôn trong danh mục, số lượng tồn giữ nguyên.</p>}
  </>);
}

function useLineCheck(lines: Line[]) {
  const items = useRpc<Item[]>('list_items');
  const byId = useMemo(() => new Map((items.data ?? []).map(i => [i.id, i])), [items.data]);
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);
  const missingLot = valid.some(l => byId.get(l.item_id!)?.track_lot && (!l.lot_no.trim() || !l.expiry_date));
  const payload = valid.map(l => ({ item_id: l.item_id, qty: Number(l.qty), unit_mode: l.unit_mode, lot_no: l.lot_no.trim(), expiry_date: l.expiry_date || null }));
  return { valid, missingLot, payload };
}

function ReceiptForm() {
  const { branchId, today, has, session, toast } = useApp();
  const empty: FormDraft = { date: today, supplier: '', source: 'Nhập tay chi nhánh', note: '', lines: [newLine()] };
  const draftKey = `kho-draft-receipt-${session.profile?.id}-${branchId}`;
  // Mở lại phiếu lưu tạm (nếu có) ngay khi vào trang
  const [initial] = useState(() => readDraft<FormDraft>(draftKey));
  const restored = Boolean(initial);
  const [form, setForm] = useState<FormDraft>(() => {
    if (!initial) return empty;
    seq = Math.max(seq, ...initial.lines.map(l => l.key + 1));
    return initial;
  });
  const draft = useFormDraft<FormDraft>(draftKey, form, f => !f.supplier.trim() && !f.note.trim() && f.lines.every(l => !l.item_id && !l.qty));
  const up = (p: Partial<FormDraft>) => setForm(f => ({ ...f, ...p }));
  const setLines = (fn: (ls: Line[]) => Line[]) => setForm(f => ({ ...f, lines: fn(f.lines) }));
  const { run, busy } = useAction();
  const { valid, missingLot, payload } = useLineCheck(form.lines);

  async function submit() {
    const r = await run('record_receipt', { branch_id: branchId, receipt_date: form.date, supplier: form.supplier, note: form.note, source: form.source, lines: payload },
      `Đã nhập kho ${valid.length} vật tư`);
    if (r) { draft.clear(); setForm({ ...empty, date: form.date }); }
  }
  const discard = () => { draft.clear(); setForm(empty); };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Phiếu nhập mới</h2>
        {draft.saved && <span className="small muted"><Clock size={13} style={{ verticalAlign: -2 }} /> {restored ? 'Đang mở phiếu lưu tạm' : 'Đã lưu tạm'} lúc {fmtDateTime(draft.saved.at)}
          {' '}<button className="btn btn-ghost btn-sm" onClick={discard}><X size={13} /> Bỏ phiếu tạm</button></span>}
      </div>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <Field label="Ngày nhập"><input className="input" type="date" value={form.date} max={today} onChange={e => up({ date: e.target.value })} /></Field>
        <Field label="Nhà cung cấp / nguồn hàng"><input className="input" value={form.supplier} onChange={e => up({ supplier: e.target.value })} placeholder="VD: Công ty ABC" /></Field>
        {has('inv_all_branches') && <Field label="Loại nhập"><select className="select" value={form.source} onChange={e => up({ source: e.target.value })}>
          <option>Nhập tay chi nhánh</option><option>Kế toán phân bổ</option><option>Tồn đầu kỳ</option></select></Field>}
        <Field label="Ghi chú"><input className="input" value={form.note} onChange={e => up({ note: e.target.value })} placeholder="Số hóa đơn, người giao…" /></Field>
      </div>
      <LinesEditor lines={form.lines} setLines={setLines} date={form.date} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={16} /> Thêm dòng</button>
        <span className="spacer" />
        {missingLot && <span className="small" style={{ color: 'var(--td-danger)' }}>Còn vật tư thiếu số lô / hạn dùng</span>}
        <button className="btn" onClick={() => { if (draft.save()) toast('Đã lưu tạm phiếu trên máy này. Lần sau mở Nhập kho sẽ tự hiện lại.', 'success'); else toast('Trình duyệt chặn lưu tạm.', 'danger'); }}>
          <Clock size={16} /> Lưu tạm</button>
        <button className="btn btn-primary" disabled={busy || !valid.length || missingLot} onClick={submit}><Save size={16} /> Lưu phiếu nhập</button>
      </div>
    </section>
  );
}

function ReceiptHistory({ docs, from, to, setFrom, setTo }: {
  docs: { data: ReceiptDoc[] | null; loading: boolean; error: string | null }; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const { branchId, has } = useApp();
  const pg = usePaged(docs.data ?? [], [branchId, from, to]);
  const [editing, setEditing] = useState<ReceiptDoc | null>(null);
  const canEdit = has('inv_receipt_edit');
  return (
    <section className="panel">
      <div className="panel-head"><h2>Lịch sử nhập kho</h2>
        <div className="row"><input className="input sm" type="date" value={from} onChange={e => setFrom(e.target.value)} /> → <input className="input sm" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      {docs.loading ? <Loading /> : docs.error ? <div className="notice danger">{docs.error}</div> : !docs.data?.length ? <Empty>Chưa có phiếu nhập.</Empty> : (
        <><div className="table-wrap"><table className="data">
          <thead><tr><th>Ngày</th><th>Nguồn</th><th>Vật tư</th><th className="num">SL nhập</th><th className="num">Quy ra</th><th>Lô</th><th>Hạn dùng</th><th>Người nhập</th></tr></thead>
          <tbody>{pg.shown.flatMap(d => d.lines.map((ln, i) => (
            <tr key={ln.id}>
              {i === 0 && <td rowSpan={d.lines.length} className="nowrap">{fmtDate(d.receipt_date)}<div className="item-code">#{d.id}</div></td>}
              {i === 0 && <td rowSpan={d.lines.length} className="small">{d.source}{d.supplier ? <div className="item-code">{d.supplier}</div> : null}{d.note ? <div className="item-code">{d.note}</div> : null}</td>}
              <td><span className="item-name">{ln.item_name}</span> <span className="item-code">{ln.item_code}</span></td>
              <td className="num">{fmtQty(ln.input_qty)} {ln.input_unit}</td>
              <td className="num">{fmtQty(ln.qty)} {ln.unit}</td>
              <td className="mono small">{ln.lot_no || '—'}</td><td className="small">{fmtDate(ln.expiry_date)}</td>
              {i === 0 && <td rowSpan={d.lines.length} className="small">{d.created_by_name}<div className="item-code">{fmtDateTime(d.created_at)}</div>
                {d.updated_at && <div className="item-code" style={{ color: 'var(--td-warning, #b45309)' }}>Sửa: {d.updated_by_name} · {fmtDateTime(d.updated_at)}</div>}
                {canEdit && <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => setEditing(d)}><Pencil size={13} /> Sửa</button>}</td>}
            </tr>
          )))}</tbody>
        </table></div>{pg.pager}</>
      )}
      {editing && <EditReceiptModal doc={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** BGĐ / Kế toán sửa phiếu nhập đã lưu: tồn kho điều chỉnh theo chênh lệch */
function EditReceiptModal({ doc, onClose }: { doc: ReceiptDoc; onClose: () => void }) {
  const { today, has } = useApp();
  const items = useRpc<Item[]>('list_items');
  const byId = useMemo(() => new Map((items.data ?? []).map(i => [i.id, i])), [items.data]);
  const [head, setHead] = useState<Head>({ date: doc.receipt_date, supplier: doc.supplier ?? '', source: doc.source, note: doc.note ?? '' });
  const [lines, setLinesState] = useState<Line[] | null>(null);
  // Dựng dòng khi đã có danh mục (cần biết đơn vị nhập của vật tư)
  const ready = lines ?? (items.data ? doc.lines.map(ln => {
    const it = byId.get(ln.item_id);
    const purchase = Boolean(it?.purchase_unit && ln.input_unit === it.purchase_unit);
    return { key: seq++, item_id: ln.item_id, qty: String(purchase ? ln.input_qty : ln.qty), unit_mode: purchase ? 'purchase' : 'base', lot_no: ln.lot_no, expiry_date: ln.expiry_date ?? '' } as Line;
  }) : null);
  const setLines = (fn: (ls: Line[]) => Line[]) => setLinesState(fn(ready ?? []));
  const { run, busy } = useAction();
  const { valid, missingLot, payload } = useLineCheck(ready ?? []);
  async function save() {
    const r = await run('edit_receipt', { id: doc.id, receipt_date: head.date, supplier: head.supplier, note: head.note, source: head.source, lines: payload },
      `Đã sửa phiếu nhập #${doc.id}, tồn kho đã điều chỉnh theo chênh lệch`);
    if (r) onClose();
  }
  return (
    <Modal size="xwide" title={`Sửa phiếu nhập #${doc.id} · ${doc.branch_name}`} onClose={onClose} footer={<>
      <div className="foot-summary small muted">Tồn kho chỉ thay đổi theo phần chênh lệch. Không giảm được số hàng đã xuất dùng / chuyển đi.</div>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !valid.length || missingLot} onClick={save}><Save size={16} /> Lưu thay đổi</button>
    </>}>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <Field label="Ngày nhập"><input className="input" type="date" value={head.date} max={today} onChange={e => setHead(h => ({ ...h, date: e.target.value }))} /></Field>
        <Field label="Nhà cung cấp / nguồn hàng"><input className="input" value={head.supplier} onChange={e => setHead(h => ({ ...h, supplier: e.target.value }))} /></Field>
        {has('inv_all_branches') && <Field label="Loại nhập"><select className="select" value={head.source} onChange={e => setHead(h => ({ ...h, source: e.target.value }))}>
          <option>Nhập tay chi nhánh</option><option>Kế toán phân bổ</option><option>Tồn đầu kỳ</option></select></Field>}
        <Field label="Ghi chú"><input className="input" value={head.note} onChange={e => setHead(h => ({ ...h, note: e.target.value }))} /></Field>
      </div>
      {!ready ? <Loading /> : <>
        <LinesEditor lines={ready} setLines={setLines} date={head.date} />
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={14} /> Thêm dòng</button>
      </>}
    </Modal>
  );
}
