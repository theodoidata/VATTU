import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Pencil, Clock, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Empty, Field, ItemPicker, Loading, Modal, PageHeader, QtyInput, ReasonModal, UnitCell, UnitInput, readDraft, useAction, useFormDraft, useRpc, usePaged, useUnits, useIsMobile } from '../components/ui';
import { addDays, fmtDate, fmtDateTime, fmtQty, fmtUnits, hasPack } from '../lib/format';
import type { Item, ReceiptDoc } from '../lib/types';

type Line = { key: number; item_id: number | null; qty: string; unit_mode: 'base' | 'purchase'; lot_no: string; expiry_date: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: null, qty: '', unit_mode: 'purchase', lot_no: '', expiry_date: '' });
/** Số lượng của dòng quy ra đơn vị nhỏ (dòng cũ có thể đang ghi theo đơn vị nhập) */
const baseQty = (l: Line, it?: Item) => Number(l.qty || 0) * (l.unit_mode === 'purchase' && it?.purchase_unit ? Number(it.purchase_factor) : 1);
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
      <thead><tr><th style={{ minWidth: 240 }}>Vật tư</th><th className="num" style={{ width: 170 }}>Số lượng</th><th style={{ width: 110 }}>Đơn vị</th>
        <th style={{ width: 140 }}>Số lô</th><th style={{ width: 160 }}>Hạn sử dụng</th><th className="num" style={{ width: 100 }}>Quy ra</th><th style={{ width: 40 }} /></tr></thead>
      <tbody>{lines.map(l => {
        const it = l.item_id ? byId.get(l.item_id) : undefined;
        const base = it ? baseQty(l, it) : 0;
        const pack = hasPack(it);
        const need = it?.track_lot;
        return (
          <tr key={l.key}>
            <td><ItemPicker items={active} value={l.item_id} onChange={id => set(l.key, { item_id: id, unit_mode: byId.get(id)?.purchase_unit ? 'purchase' : 'base' })} />
              {need && <div className="item-code">Bắt buộc số lô + hạn dùng</div>}</td>
            <td className="num">{pack
              // Vật tư có quy đổi: 2 ô [hộp] [sợi], lưu thành tổng số sợi
              ? <QtyInput value={l.qty === '' ? '' : String(base)} onChange={v => set(l.key, { qty: v, unit_mode: 'base' })} unit={it} />
              : <input className="input sm" type="number" min={0} step="any" style={{ width: 80, textAlign: 'right' }} value={l.qty} onChange={e => set(l.key, { qty: e.target.value })} />}</td>
            <td>{!it ? <UnitCell itemId={null} /> : pack ? <span className="small muted">1 {it.purchase_unit} = {fmtQty(it.purchase_factor)} {it.unit}</span> : it.purchase_unit ? (
              <select className="select sm" value={l.unit_mode} onChange={e => set(l.key, { unit_mode: e.target.value as Line['unit_mode'] })}>
                <option value="purchase">{it.purchase_unit}</option><option value="base">{it.unit}</option>
              </select>
            ) : canUnit ? (
              <UnitInput value={it.unit} onCommit={u => void run('update_item_basic', { id: it.id, unit: u }, `Đã đổi đơn vị “${it.name}”: ${it.unit} → ${u}`)} />
            ) : <UnitCell itemId={it.id} unit={it.unit} />}</td>
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
  const payload = valid.map(l => {
    const it = byId.get(l.item_id!);
    let qty = Number(l.qty), unit_mode = l.unit_mode;
    if (hasPack(it)) { // tròn hộp thì ghi phiếu theo hộp, có lẻ thì ghi theo đơn vị nhỏ
      const b = baseQty(l, it), f = Number(it.purchase_factor);
      [qty, unit_mode] = b % f === 0 ? [b / f, 'purchase'] : [b, 'base'];
    }
    return { item_id: l.item_id, qty, unit_mode, lot_no: l.lot_no.trim(), expiry_date: l.expiry_date || null };
  });
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
  const isMobile = useIsMobile();
  const [wiz, setWiz] = useState(0);
  const items = useRpc<Item[]>('list_items');
  const active = useMemo(() => (items.data ?? []).filter(i => i.active), [items.data]);
  const byId = useMemo(() => new Map(active.map(i => [i.id, i])), [active]);
  const setL = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    const r = await run('record_receipt', { branch_id: branchId, receipt_date: form.date, supplier: form.supplier, note: form.note, source: form.source, lines: payload },
      `Đã nhập kho ${valid.length} vật tư`);
    if (r) { draft.clear(); setForm({ ...empty, date: form.date }); setWiz(0); }
  }
  const discard = () => { draft.clear(); setForm(empty); };
  const saveDraft = () => { if (draft.save()) toast('Đã lưu tạm phiếu trên máy này. Lần sau mở Nhập kho sẽ tự hiện lại.', 'success'); else toast('Trình duyệt chặn lưu tạm.', 'danger'); };

  // ---------- Điện thoại: nút mở popup 3 bước ----------
  if (isMobile) return (
    <section className="panel">
      <button className="btn btn-primary" style={{ width: '100%', height: 44, justifyContent: 'center', fontSize: 15 }} onClick={() => setWiz(1)}>
        <Plus size={18} /> {valid.length ? `Tiếp tục phiếu đang nhập (${valid.length} vật tư)` : 'Nhập kho'}</button>
      {draft.saved && valid.length > 0 && <div className="row small muted" style={{ marginTop: 8, justifyContent: 'center' }}><Clock size={13} /> Lưu tạm lúc {fmtDateTime(draft.saved.at)}
        <button className="btn btn-ghost btn-sm" onClick={discard}><X size={13} /> Bỏ</button></div>}
      {wiz > 0 && <Modal onClose={() => setWiz(0)}
        title={<span className="guide-title"><small>NHẬP KHO · BƯỚC {wiz}/3</small>{['', 'Vật tư & số lượng', 'Số lô & hạn dùng', 'Thông tin phiếu'][wiz]}</span>}
        footer={<>
          {wiz > 1 ? <button className="btn" onClick={() => setWiz(wiz - 1)}><ChevronLeft size={16} /> Quay lại</button> : <button className="btn" onClick={() => setWiz(0)}>Đóng</button>}
          <span className="spacer" />
          {wiz < 3 ? <button className="btn btn-primary" disabled={!valid.length || (wiz === 2 && missingLot)} onClick={() => setWiz(wiz + 1)}>Tiếp{wiz === 1 ? ` (${valid.length} vật tư)` : ''} <ChevronRight size={16} /></button>
            : <><button className="btn" onClick={saveDraft}><Clock size={16} /> Lưu tạm</button>
              <button className="btn btn-primary" disabled={busy || !valid.length || missingLot} onClick={submit}><Save size={16} /> Lưu phiếu</button></>}
        </>}>
        <div className="wiz-steps">{[1, 2, 3].map(i => <span key={i} className={i <= wiz ? 'on' : ''} />)}</div>
        {wiz === 1 && <>
          {form.lines.map((l, idx) => {
            const it = l.item_id ? byId.get(l.item_id) : undefined;
            const pack = hasPack(it);
            return (
              <div key={l.key} className="wiz-card">
                <div className="wiz-card-head wiz-line">
                  <div><ItemPicker items={active} value={l.item_id} placeholder={`Tìm vật tư ${idx + 1}…`}
                    onChange={id => setL(l.key, { item_id: id, unit_mode: byId.get(id)?.purchase_unit ? 'purchase' : 'base' })}
                    exclude={form.lines.filter(x => x.key !== l.key).map(x => x.item_id!).filter(Boolean)} /></div>
                  {it ? <span className="wiz-qty">{pack ? <QtyInput value={l.qty === '' ? '' : String(baseQty(l, it))} onChange={v => setL(l.key, { qty: v, unit_mode: 'base' })} unit={it} placeholder="0" />
                    : <><input className="input sm num" type="number" min={0} step="any" placeholder="SL" value={l.qty}
                        onChange={e => setL(l.key, { qty: e.target.value, unit_mode: 'base' })} /><span className="qp-u">{it.unit}</span></>}</span> : <span className="wiz-qty"><input className="input sm num" disabled placeholder="SL" aria-label="Số lượng" /><span className="qp-u" /></span>}
                  <button className="btn btn-ghost btn-sm icon-only" aria-label="Xóa dòng" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])}><Trash2 size={15} /></button>
                </div>
                {it?.track_lot && <span className="small text-warning">Cần nhập số lô / hạn dùng ở bước sau</span>}
              </div>
            );
          })}
          <button className="btn btn-sm" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={14} /> Thêm vật tư</button>
        </>}
        {wiz === 2 && valid.map(l => {
          const it = byId.get(l.item_id!);
          const need = it?.track_lot;
          return (
            <div key={l.key} className="wiz-card">
              <div><b>{it?.name}</b> <span className="small muted">· {fmtUnits(baseQty(l, it), it)}</span>{need && <span className="small text-warning"> · bắt buộc</span>}</div>
              <div className="form-grid">
                <Field label={need ? 'Số lô *' : 'Số lô (không bắt buộc)'}><input className="input" value={l.lot_no} onChange={e => setL(l.key, { lot_no: e.target.value })}
                  style={need && !l.lot_no.trim() ? { borderColor: 'var(--td-danger)' } : undefined} /></Field>
                <Field label={need ? 'Hạn sử dụng *' : 'Hạn sử dụng'}><input className="input" type="date" value={l.expiry_date} min={form.date} onChange={e => setL(l.key, { expiry_date: e.target.value })}
                  style={need && !l.expiry_date ? { borderColor: 'var(--td-danger)' } : undefined} /></Field>
              </div>
            </div>
          );
        })}
        {wiz === 3 && <>
          <div className="wiz-sum"><b>{valid.length} vật tư</b>
            <ul>{valid.map(l => { const it = byId.get(l.item_id!); return <li key={l.key}>{it?.name}: <b>{fmtUnits(baseQty(l, it), it)}</b>{l.lot_no ? ` · lô ${l.lot_no}` : ''}</li>; })}</ul></div>
          <div className="form-grid">
            <Field label="Ngày nhập"><input className="input" type="date" value={form.date} max={today} onChange={e => up({ date: e.target.value })} /></Field>
            <Field label="Nhà cung cấp / nguồn hàng"><input className="input" value={form.supplier} onChange={e => up({ supplier: e.target.value })} placeholder="VD: Công ty ABC" /></Field>
            {has('inv_all_branches') && <Field label="Loại nhập"><select className="select" value={form.source} onChange={e => up({ source: e.target.value })}>
              <option>Nhập tay chi nhánh</option><option>Kế toán phân bổ</option><option>Tồn đầu kỳ</option></select></Field>}
            <Field label="Ghi chú"><input className="input" value={form.note} onChange={e => up({ note: e.target.value })} placeholder="Số hóa đơn, người giao…" /></Field>
          </div>
        </>}
      </Modal>}
    </section>
  );

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
        <button className="btn" onClick={saveDraft}><Clock size={16} /> Lưu tạm</button>
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
  const [deleting, setDeleting] = useState<ReceiptDoc | null>(null);
  const { run, busy } = useAction();
  const canEdit = has('inv_receipt_edit');
  const U = useUnits();
  const isMobile = useIsMobile();
  return (
    <section className="panel">
      <div className="panel-head"><h2>Lịch sử nhập kho</h2>
        <div className="row date-range"><input className="input sm" type="date" value={from} onChange={e => setFrom(e.target.value)} /> → <input className="input sm" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      {docs.loading ? <Loading /> : docs.error ? <div className="notice danger">{docs.error}</div> : !docs.data?.length ? <Empty>Chưa có phiếu nhập.</Empty> : isMobile ? (
        <>{pg.shown.map(d => (
          <div key={d.id} className="wiz-card">
            <div className="wiz-card-head"><div><b>{fmtDate(d.receipt_date)}</b> <span className="item-code">#{d.id} · {d.source}</span>
              {(d.supplier || d.note) && <div className="small muted">{[d.supplier, d.note].filter(Boolean).join(' · ')}</div>}
              <div className="small muted">{d.created_by_name} · {fmtDateTime(d.created_at)}{d.updated_at ? ` · sửa bởi ${d.updated_by_name}` : ''}</div></div>
              {canEdit && <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="btn btn-sm" onClick={() => setEditing(d)}><Pencil size={13} /> Sửa</button>
                <button className="btn btn-sm btn-danger" onClick={() => setDeleting(d)} aria-label="Xóa phiếu"><Trash2 size={13} /></button></span>}</div>
            <div style={{ display: 'grid', gap: 4 }}>{d.lines.map(ln => (
              <div key={ln.id} className="row small" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span style={{ minWidth: 0 }}>{ln.item_name}{ln.lot_no ? <span className="muted"> · lô {ln.lot_no}</span> : null}{ln.expiry_date ? <span className="muted"> · HSD {fmtDate(ln.expiry_date)}</span> : null}</span>
                <b className="nowrap">{U(ln.qty, ln.item_id, ln.unit)}</b></div>))}</div>
          </div>))}{pg.pager}</>
      ) : (
        <><div className="table-wrap"><table className="data">
          <thead><tr><th>Ngày</th><th>Nguồn</th><th>Vật tư</th><th className="num">SL nhập</th><th className="num">Quy ra</th><th>Lô</th><th>Hạn dùng</th><th>Người nhập</th></tr></thead>
          <tbody>{pg.shown.flatMap(d => d.lines.map((ln, i) => (
            <tr key={ln.id}>
              {i === 0 && <td rowSpan={d.lines.length} className="nowrap">{fmtDate(d.receipt_date)}<div className="item-code">#{d.id}</div></td>}
              {i === 0 && <td rowSpan={d.lines.length} className="small">{d.source}{d.supplier ? <div className="item-code">{d.supplier}</div> : null}{d.note ? <div className="item-code">{d.note}</div> : null}</td>}
              <td><span className="item-name">{ln.item_name}</span> <span className="item-code">{ln.item_code}</span></td>
              <td className="num" title={`Ghi trên phiếu: ${fmtQty(ln.input_qty)} ${ln.input_unit}`}>{U(ln.qty, ln.item_id, ln.unit)}</td>
              <td className="num">{fmtQty(ln.qty)} {ln.unit}</td>
              <td className="mono small">{ln.lot_no || '—'}</td><td className="small">{fmtDate(ln.expiry_date)}</td>
              {i === 0 && <td rowSpan={d.lines.length} className="small">{d.created_by_name}<div className="item-code">{fmtDateTime(d.created_at)}</div>
                {d.updated_at && <div className="item-code" style={{ color: 'var(--td-warning, #b45309)' }}>Sửa: {d.updated_by_name} · {fmtDateTime(d.updated_at)}</div>}
                {canEdit && <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'nowrap' }}><button className="btn btn-sm" onClick={() => setEditing(d)}><Pencil size={13} /> Sửa</button>
                  <button className="btn btn-sm btn-danger" onClick={() => setDeleting(d)}><Trash2 size={13} /> Xóa</button></div>}</td>}
            </tr>
          )))}</tbody>
        </table></div>{pg.pager}</>
      )}
      {editing && <EditReceiptModal doc={editing} onClose={() => setEditing(null)} />}
      {deleting && <ReasonModal title={`Xóa phiếu nhập #${deleting.id}`} label="Lý do xóa (không bắt buộc)" required={false} confirmText="Xóa phiếu & trừ tồn" tone="danger" busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async reason => { if (await run('delete_receipt', { id: deleting.id, reason }, `Đã xóa phiếu nhập #${deleting.id}, tồn kho đã trừ lại`)) setDeleting(null); }}>
        <p className="small" style={{ marginTop: 0 }}>Phiếu ngày {fmtDate(deleting.receipt_date)} · {deleting.lines.length} vật tư: {deleting.lines.slice(0, 4).map(l => l.item_name).join(', ')}{deleting.lines.length > 4 ? '…' : ''}.</p>
        <p className="small muted">Số đã nhập sẽ được trừ khỏi tồn kho đúng lô. Nếu hàng của phiếu đã xuất dùng / chuyển đi thì không xóa được — khi đó hãy sửa phiếu hoặc kiểm kê.</p>
      </ReasonModal>}
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
