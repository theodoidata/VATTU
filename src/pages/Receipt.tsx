import { useMemo, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Empty, Field, ItemPicker, Loading, PageHeader, useAction, useRpc } from '../components/ui';
import { addDays, fmtDate, fmtDateTime, fmtQty } from '../lib/format';
import type { Item, ReceiptDoc } from '../lib/types';

type Line = { key: number; item_id: number | null; qty: string; unit_mode: 'base' | 'purchase'; lot_no: string; expiry_date: string };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: null, qty: '', unit_mode: 'purchase', lot_no: '', expiry_date: '' });

export default function ReceiptPage() {
  const { branchId, branches, today, canAct, has } = useApp();
  const branch = branches.find(b => b.id === branchId);
  const allowed = canAct(branchId);
  const items = useRpc<Item[]>('list_items');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const docs = useRpc<ReceiptDoc[]>('list_receipts', { branch_id: branchId, from, to });
  const [date, setDate] = useState(today);
  const [supplier, setSupplier] = useState('');
  const [source, setSource] = useState('Nhập tay chi nhánh');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const { run, busy } = useAction();

  const active = useMemo(() => (items.data ?? []).filter(i => i.active), [items.data]);
  const byId = useMemo(() => new Map(active.map(i => [i.id, i])), [active]);
  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);
  const missingLot = valid.some(l => byId.get(l.item_id!)?.track_lot && (!l.lot_no.trim() || !l.expiry_date));

  async function submit() {
    const r = await run('record_receipt', {
      branch_id: branchId, receipt_date: date, supplier, note, source,
      lines: valid.map(l => ({ item_id: l.item_id, qty: Number(l.qty), unit_mode: l.unit_mode, lot_no: l.lot_no.trim(), expiry_date: l.expiry_date || null })),
    }, `Đã nhập kho ${valid.length} vật tư`);
    if (r) { setLines([newLine()]); setNote(''); setSupplier(''); }
  }

  return (
    <>
      <PageHeader title={`Nhập kho · ${branch?.name ?? ''}`}
        description="Giai đoạn này chi nhánh tự nhập tay khi nhận hàng. Sau này vị trí Kế toán sẽ nhập và phân bổ cho từng chi nhánh." />
      {!allowed ? <div className="notice warning">Bạn chỉ được nhập kho cho chi nhánh của mình.</div> : (
        <section className="panel">
          <div className="panel-head"><h2>Phiếu nhập mới</h2></div>
          <div className="form-grid" style={{ marginBottom: 10 }}>
            <Field label="Ngày nhập"><input className="input" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Nhà cung cấp / nguồn hàng"><input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="VD: Công ty ABC" /></Field>
            {has('inv_all_branches') && <Field label="Loại nhập"><select className="select" value={source} onChange={e => setSource(e.target.value)}>
              <option>Nhập tay chi nhánh</option><option>Kế toán phân bổ</option><option>Tồn đầu kỳ</option></select></Field>}
            <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Số hóa đơn, người giao…" /></Field>
          </div>
          <div className="table-wrap stack-sm"><table className="data lines-table">
            <thead><tr><th style={{ minWidth: 260 }}>Vật tư</th><th style={{ width: 190 }}>Số lượng</th><th style={{ width: 140 }}>Số lô</th><th style={{ width: 160 }}>Hạn sử dụng</th><th className="num" style={{ width: 110 }}>Quy ra</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>{lines.map(l => {
              const it = l.item_id ? byId.get(l.item_id) : undefined;
              const base = it ? Number(l.qty || 0) * (l.unit_mode === 'purchase' && it.purchase_unit ? Number(it.purchase_factor) : 1) : 0;
              const need = it?.track_lot;
              return (
                <tr key={l.key}>
                  <td><ItemPicker items={active} value={l.item_id} onChange={id => set(l.key, { item_id: id, unit_mode: byId.get(id)?.purchase_unit ? 'purchase' : 'base' })} />
                    {need && <div className="item-code">Bắt buộc số lô + hạn dùng</div>}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                    <input className="input sm" type="number" min={0} step="any" style={{ width: 70 }} value={l.qty} onChange={e => set(l.key, { qty: e.target.value })} />
                    {it?.purchase_unit ? (
                      <select className="select sm" value={l.unit_mode} onChange={e => set(l.key, { unit_mode: e.target.value as Line['unit_mode'] })}>
                        <option value="purchase">{it.purchase_unit}</option><option value="base">{it.unit}</option>
                      </select>) : <span className="muted small">{it?.unit}</span>}
                  </div></td>
                  <td><input className="input sm" style={{ width: '100%', borderColor: need && !l.lot_no.trim() && l.qty ? 'var(--td-danger)' : undefined }} value={l.lot_no} onChange={e => set(l.key, { lot_no: e.target.value })} placeholder={need ? 'Bắt buộc' : 'Không bắt buộc'} /></td>
                  <td><input className="input sm" type="date" style={{ width: '100%', borderColor: need && !l.expiry_date && l.qty ? 'var(--td-danger)' : undefined }} value={l.expiry_date} min={date} onChange={e => set(l.key, { expiry_date: e.target.value })} /></td>
                  <td className="num">{it ? <>{fmtQty(base)} <span className="muted">{it.unit}</span></> : ''}</td>
                  <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={16} /> Thêm dòng</button>
            <span className="spacer" />
            {missingLot && <span className="small" style={{ color: 'var(--td-danger)' }}>Còn vật tư thiếu số lô / hạn dùng</span>}
            <button className="btn btn-primary" disabled={busy || !valid.length || missingLot} onClick={submit}><Save size={16} /> Lưu phiếu nhập</button>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head"><h2>Lịch sử nhập kho</h2>
          <div className="row"><input className="input sm" type="date" value={from} onChange={e => setFrom(e.target.value)} /> → <input className="input sm" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        {docs.loading ? <Loading /> : docs.error ? <div className="notice danger">{docs.error}</div> : !docs.data?.length ? <Empty>Chưa có phiếu nhập.</Empty> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Ngày</th><th>Nguồn</th><th>Vật tư</th><th className="num">SL nhập</th><th className="num">Quy ra</th><th>Lô</th><th>Hạn dùng</th><th>Người nhập</th></tr></thead>
            <tbody>{docs.data.flatMap(d => d.lines.map((ln, i) => (
              <tr key={ln.id}>
                {i === 0 && <td rowSpan={d.lines.length} className="nowrap">{fmtDate(d.receipt_date)}<div className="item-code">#{d.id}</div></td>}
                {i === 0 && <td rowSpan={d.lines.length} className="small">{d.source}{d.supplier ? <div className="item-code">{d.supplier}</div> : null}{d.note ? <div className="item-code">{d.note}</div> : null}</td>}
                <td><span className="item-name">{ln.item_name}</span> <span className="item-code">{ln.item_code}</span></td>
                <td className="num">{fmtQty(ln.input_qty)} {ln.input_unit}</td>
                <td className="num">{fmtQty(ln.qty)} {ln.unit}</td>
                <td className="mono small">{ln.lot_no || '—'}</td><td className="small">{fmtDate(ln.expiry_date)}</td>
                {i === 0 && <td rowSpan={d.lines.length} className="small">{d.created_by_name}<div className="item-code">{fmtDateTime(d.created_at)}</div></td>}
              </tr>
            )))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
