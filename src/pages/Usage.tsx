import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, Ban, Clock, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, Empty, Field, ItemPicker, Loading, Modal, PageHeader, QtyInput, ReasonModal, UnitCell, readDraft, useAction, useFormDraft, useRpc, usePaged, useUnits, useIsMobile } from '../components/ui';
import { USAGE_REASONS, addDays, fmtDate, fmtDateTime, fmtUnits } from '../lib/format';
import type { StockRow, UsageDoc } from '../lib/types';

type Line = { key: number; item_id: number | null; qty: string; reason: string; lot_id: number | null };
let seq = 1;
const newLine = (): Line => ({ key: seq++, item_id: null, qty: '', reason: 'Điều trị', lot_id: null });

export default function UsagePage() {
  const { branchId, branches, today, canAct, has, session, toast } = useApp();
  const branch = branches.find(b => b.id === branchId);
  const allowed = canAct(branchId);
  const stock = useRpc<StockRow[]>('get_stock', { branch_id: branchId });
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const docs = useRpc<UsageDoc[]>(allowed || has('inv_report_view_all') ? 'list_usage' : null, { branch_id: branchId, from, to });
  // Phiếu đang ghi dở được lưu tạm trên máy này (tự lưu + nút Lưu tạm), mở lại trang sẽ hiện lại
  type UForm = { date: string; note: string; lines: Line[] };
  const draftKey = `kho-draft-usage-${session.profile?.id}-${branchId}`;
  const [initial] = useState(() => readDraft<UForm>(draftKey));
  if (initial) seq = Math.max(seq, ...initial.lines.map(l => l.key + 1));
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? '');
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? [newLine()]);
  const draft = useFormDraft<UForm>(draftKey, { date, note, lines }, f => !f.note.trim() && f.lines.every(l => !l.item_id && !l.qty));
  const [voiding, setVoiding] = useState<UsageDoc | null>(null);
  const { run, busy } = useAction();
  const pg = usePaged(docs.data ?? [], [branchId, from, to]);

  const U = useUnits();
  const isMobile = useIsMobile();
  const [wiz, setWiz] = useState(0); // 0 = đóng, 1..3 = bước của popup trên điện thoại
  const byId = useMemo(() => new Map((stock.data ?? []).map(r => [r.id, r])), [stock.data]);
  const pickItems = useMemo(() => (stock.data ?? []).map(r => ({
    id: r.id, code: r.code, name: r.name, unit: r.unit, group_name: r.group_name,
    extra: <span className={Number(r.usable_qty) > 0 ? '' : 'muted'}>còn {fmtUnits(r.usable_qty, r)}</span>,
  })), [stock.data]);

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);

  async function submit() {
    const r = await run('record_usage', {
      branch_id: branchId, usage_date: date, note,
      lines: valid.map(l => ({ item_id: l.item_id, qty: Number(l.qty), reason: l.reason, lot_id: l.lot_id })),
    }, `Đã ghi xuất ${valid.length} vật tư`);
    if (r) { draft.clear(); setLines([newLine()]); setNote(''); setWiz(0); }
  }
  const needLot = lines.some(l => l.reason === 'Hủy hết hạn' && l.item_id && !l.lot_id);
  const saveDraft = () => toast(draft.save() ? 'Đã lưu tạm phiếu trên máy này. Lần sau mở Xuất dùng sẽ tự hiện lại.' : 'Trình duyệt chặn lưu tạm.', 'success');

  return (
    <>
      <PageHeader title={`Xuất dùng · ${branch?.name ?? ''}`}
        description="Ghi lượng vật tư dùng trong ngày. Hệ thống tự trừ lô hết hạn sớm nhất trước (FEFO)." />
      {!allowed ? (
        <div className="notice warning">Bạn đang xem chi nhánh {branch?.name}. Chỉ được ghi xuất dùng cho chi nhánh của mình.</div>
      ) : isMobile ? (
        <section className="panel">
          <button className="btn btn-primary" style={{ width: '100%', height: 44, justifyContent: 'center', fontSize: 15 }} onClick={() => setWiz(1)}>
            <Plus size={18} /> {valid.length ? `Tiếp tục phiếu đang ghi (${valid.length} vật tư)` : 'Ghi xuất dùng'}</button>
          {draft.saved && valid.length > 0 && <div className="row small muted" style={{ marginTop: 8, justifyContent: 'center' }}><Clock size={13} /> Lưu tạm lúc {fmtDateTime(draft.saved.at)}
            <button className="btn btn-ghost btn-sm" onClick={() => { draft.clear(); setLines([newLine()]); setNote(''); setDate(today); }}><X size={13} /> Bỏ</button></div>}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head"><h2>Phiếu xuất dùng mới</h2>
            {draft.saved && <span className="small muted"><Clock size={13} style={{ verticalAlign: -2 }} /> {initial ? 'Đang mở phiếu lưu tạm' : 'Đã lưu tạm'} lúc {fmtDateTime(draft.saved.at)}
              {' '}<button className="btn btn-ghost btn-sm" onClick={() => { draft.clear(); setLines([newLine()]); setNote(''); setDate(today); }}><X size={13} /> Bỏ phiếu tạm</button></span>}
          </div>
          <div className="form-grid" style={{ marginBottom: 10 }}>
            <Field label="Ngày dùng"><input className="input" type="date" value={date} max={today} min={addDays(today, -7)} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Ghi chú (không bắt buộc)"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: ca chiều, ghế 2…" /></Field>
          </div>
          <div className="table-wrap stack-sm"><table className="data lines-table">
            <thead><tr><th style={{ minWidth: 260 }}>Vật tư</th><th style={{ width: 150 }}>Số lượng</th><th style={{ width: 100 }}>Đơn vị</th><th style={{ width: 160 }}>Lý do</th><th style={{ minWidth: 170 }}>Lô</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>{lines.map(l => {
              const r = l.item_id ? byId.get(l.item_id) : undefined;
              const expiredMode = l.reason === 'Hủy hết hạn';
              const lots = (r?.lots ?? []).filter(x => expiredMode || !x.expiry_date || x.expiry_date >= date);
              const over = r && Number(l.qty) > Number(expiredMode ? r.qty : r.usable_qty);
              return (
                <tr key={l.key}>
                  <td><ItemPicker items={pickItems} value={l.item_id} onChange={id => set(l.key, { item_id: id, lot_id: null })}
                    exclude={lines.filter(x => x.key !== l.key && x.reason === l.reason).map(x => x.item_id!).filter(Boolean)} />
                    {over && <div className="small" style={{ color: 'var(--td-danger)' }}>Vượt tồn còn dùng được ({fmtUnits(expiredMode ? r!.qty : r!.usable_qty, r)})</div>}</td>
                  <td><QtyInput value={l.qty} onChange={v => set(l.key, { qty: v })} unit={r} width={80} /></td>
                  <td><UnitCell itemId={l.item_id} unit={r?.unit} /></td>
                  <td><select className="select sm" value={l.reason} onChange={e => set(l.key, { reason: e.target.value, lot_id: null })}>{USAGE_REASONS.map(x => <option key={x}>{x}</option>)}</select></td>
                  <td>{r && r.lots.length > 0 ? (
                    <select className="select sm" value={l.lot_id ?? ''} onChange={e => set(l.key, { lot_id: e.target.value ? Number(e.target.value) : null })} style={{ width: '100%' }}>
                      {!expiredMode && <option value="">Tự động (hết hạn trước)</option>}
                      {expiredMode && <option value="">— chọn lô —</option>}
                      {lots.map(x => <option key={x.id} value={x.id}>{x.lot_no || 'không số lô'} · HSD {fmtDate(x.expiry_date)} · còn {fmtUnits(x.qty, r)}</option>)}
                    </select>) : <span className="muted small">{r ? 'Hết hàng' : ''}</span>}</td>
                  <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={16} /> Thêm dòng</button>
            <span className="spacer" />
            <span className="muted small">{valid.length} vật tư</span>
            <button className="btn" onClick={saveDraft}><Clock size={16} /> Lưu tạm</button>
            <button className="btn btn-primary" disabled={busy || !valid.length || needLot} onClick={submit}><Save size={16} /> Ghi xuất dùng</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Phiếu xuất đã ghi</h2>
          <div className="row"><input className="input sm" type="date" value={from} onChange={e => setFrom(e.target.value)} /> → <input className="input sm" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        {docs.loading ? <Loading /> : docs.error ? <div className="notice danger">{docs.error}</div> : !docs.data?.length ? <Empty>Chưa có phiếu xuất trong khoảng ngày này.</Empty> : isMobile ? (
          <>{pg.shown.map(d => (
            <div key={d.id} className="wiz-card" style={d.voided_at ? { opacity: .55 } : undefined}>
              <div className="wiz-card-head"><div><b>{fmtDate(d.usage_date)}</b> <span className="item-code">#{d.id}{d.note ? ' · ' + d.note : ''}</span>
                <div className="small muted">{d.created_by_name} · {fmtDateTime(d.created_at)}</div></div>
                {!d.voided_at && has('inv_usage_void') && canAct(d.branch_id) && (d.created_date === today || has('inv_all_branches')) &&
                  <button className="btn btn-danger btn-sm" onClick={() => setVoiding(d)}><Ban size={14} /> Hủy</button>}</div>
              {d.voided_at && <div><Badge tone="danger">Đã hủy: {d.void_reason}</Badge></div>}
              <div style={{ display: 'grid', gap: 4 }}>{d.lines.map(ln => (
                <div key={ln.id} className="row small" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', textDecoration: d.voided_at ? 'line-through' : undefined }}>
                  <span style={{ minWidth: 0 }}>{ln.item_name}{ln.reason !== 'Điều trị' && <> <Badge tone="warning">{ln.reason}</Badge></>}</span>
                  <b className="nowrap">{U(ln.qty, ln.item_id, ln.unit)}</b></div>))}</div>
            </div>))}{pg.pager}</>
        ) : (
          <><div className="table-wrap"><table className="data">
            <thead><tr><th>Ngày</th><th>Vật tư</th><th className="num">SL</th><th>Lý do</th><th>Lô đã trừ</th><th>Người ghi</th><th /></tr></thead>
            <tbody>{pg.shown.flatMap(d => d.lines.map((ln, i) => (
              <tr key={ln.id} style={d.voided_at ? { opacity: .5, textDecoration: 'line-through' } : undefined}>
                {i === 0 && <td rowSpan={d.lines.length} className="nowrap">{fmtDate(d.usage_date)}<div className="item-code">#{d.id}{d.note ? ' · ' + d.note : ''}</div></td>}
                <td><span className="item-name">{ln.item_name}</span> <span className="item-code">{ln.item_code}</span></td>
                <td className="num">{U(ln.qty, ln.item_id, ln.unit)}</td>
                <td><Badge tone={ln.reason === 'Điều trị' ? 'muted' : 'warning'}>{ln.reason}</Badge></td>
                <td className="small mono">{ln.lots.map(x => `${x.lot_no || '—'}×${U(x.qty, ln.item_id, ln.unit)}`).join(', ')}</td>
                {i === 0 && <td rowSpan={d.lines.length} className="small">{d.created_by_name}<div className="item-code">{fmtDateTime(d.created_at)}</div>
                  {d.voided_at && <div style={{ textDecoration: 'none' }}><Badge tone="danger">Đã hủy: {d.void_reason}</Badge></div>}</td>}
                {i === 0 && <td rowSpan={d.lines.length}>{!d.voided_at && has('inv_usage_void') && canAct(d.branch_id) && (d.created_date === today || has('inv_all_branches')) &&
                  <button className="btn btn-danger btn-sm" onClick={() => setVoiding(d)}><Ban size={14} /> Hủy phiếu</button>}</td>}
              </tr>
            )))}</tbody>
          </table></div>{pg.pager}</>
        )}
      </section>
      {wiz > 0 && <Modal onClose={() => setWiz(0)}
        title={<span className="guide-title"><small>XUẤT DÙNG · {(branch?.name ?? '').toUpperCase()} · BƯỚC {wiz}/3</small>{['', 'Vật tư đã dùng', 'Lý do & lô', 'Xác nhận ghi'][wiz]}</span>}
        footer={<>
          {wiz > 1 ? <button className="btn" onClick={() => setWiz(wiz - 1)}><ChevronLeft size={16} /> Quay lại</button> : <button className="btn" onClick={() => setWiz(0)}>Đóng</button>}
          <span className="spacer" />
          {wiz < 3 ? <button className="btn btn-primary" disabled={!valid.length || (wiz === 2 && needLot)} onClick={() => setWiz(wiz + 1)}>Tiếp{wiz === 1 ? ` (${valid.length} vật tư)` : ''} <ChevronRight size={16} /></button>
            : <><button className="btn" onClick={saveDraft}><Clock size={16} /> Lưu tạm</button>
              <button className="btn btn-primary" disabled={busy || !valid.length || needLot} onClick={submit}><Save size={16} /> Ghi</button></>}
        </>}>
        <div className="wiz-steps">{[1, 2, 3].map(i => <span key={i} className={i <= wiz ? 'on' : ''} />)}</div>
        {wiz === 1 && <>
          {lines.map((l, idx) => {
            const r = l.item_id ? byId.get(l.item_id) : undefined;
            const over = r && Number(l.qty) > Number(l.reason === 'Hủy hết hạn' ? r.qty : r.usable_qty);
            return (
              <div key={l.key} className="wiz-card">
                <div className="wiz-card-head">
                  <div><ItemPicker items={pickItems} value={l.item_id} placeholder={`Tìm vật tư ${idx + 1}…`} onChange={id => set(l.key, { item_id: id, lot_id: null })}
                    exclude={lines.filter(x => x.key !== l.key && x.reason === l.reason).map(x => x.item_id!).filter(Boolean)} /></div>
                  <button className="btn btn-ghost btn-sm icon-only" aria-label="Xóa dòng" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [newLine()])}><Trash2 size={15} /></button>
                </div>
                {r && <div className="wiz-row"><span className="small muted">Số lượng</span>
                  <QtyInput value={l.qty} onChange={v => set(l.key, { qty: v })} unit={r} width={80} bad={Boolean(over)} />
                  {!(r.purchase_unit && Number(r.purchase_factor) > 1) && <span className="small muted">{r.unit}</span>}
                  <span className="small muted" style={{ marginLeft: 'auto' }}>còn {fmtUnits(r.usable_qty, r)}</span></div>}
                {over && <div className="small text-danger">Vượt tồn còn dùng được</div>}
              </div>
            );
          })}
          <button className="btn btn-sm" onClick={() => setLines(ls => [...ls, newLine()])}><Plus size={14} /> Thêm vật tư</button>
        </>}
        {wiz === 2 && valid.map(l => {
          const r = byId.get(l.item_id!);
          const expiredMode = l.reason === 'Hủy hết hạn';
          const lots = (r?.lots ?? []).filter(x => expiredMode || !x.expiry_date || x.expiry_date >= date);
          return (
            <div key={l.key} className="wiz-card">
              <div><b>{r?.name}</b> <span className="small muted">· {U(l.qty, l.item_id, r?.unit)}</span></div>
              <div className="chips">{USAGE_REASONS.map(x => <button key={x} className={`chip${l.reason === x ? ' active' : ''}`} onClick={() => set(l.key, { reason: x, lot_id: null })}>{x}</button>)}</div>
              {r && r.lots.length > 0 && <select className="select" value={l.lot_id ?? ''} onChange={e => set(l.key, { lot_id: e.target.value ? Number(e.target.value) : null })}
                style={expiredMode && !l.lot_id ? { borderColor: 'var(--td-danger)' } : undefined}>
                {!expiredMode && <option value="">Lô: tự động (hết hạn trước)</option>}
                {expiredMode && <option value="">— Chọn lô hết hạn cần hủy —</option>}
                {lots.map(x => <option key={x.id} value={x.id}>{x.lot_no || 'không số lô'} · HSD {fmtDate(x.expiry_date)} · còn {fmtUnits(x.qty, r)}</option>)}
              </select>}
            </div>
          );
        })}
        {wiz === 3 && <>
          <div className="wiz-sum"><b>{valid.length} vật tư</b>
            <ul>{valid.map(l => { const r = byId.get(l.item_id!); return <li key={l.key}>{r?.name}: <b>{U(l.qty, l.item_id, r?.unit)}</b>{l.reason !== 'Điều trị' && ` · ${l.reason}`}</li>; })}</ul></div>
          <div className="form-grid">
            <Field label="Ngày dùng"><input className="input" type="date" value={date} max={today} min={addDays(today, -7)} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Ghi chú (không bắt buộc)"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: ca chiều, ghế 2…" /></Field>
          </div>
        </>}
      </Modal>}
      {voiding && <ReasonModal title={`Hủy phiếu xuất #${voiding.id}`} label="Lý do hủy" confirmText="Hủy phiếu & hoàn tồn" tone="danger" busy={busy}
        onClose={() => setVoiding(null)}
        onConfirm={async reason => { if (await run('void_usage', { id: voiding.id, reason }, 'Đã hủy phiếu, tồn đã được hoàn lại')) setVoiding(null); }}>
        <p className="small muted" style={{ marginTop: 0 }}>Số lượng của {voiding.lines.length} vật tư sẽ được cộng trả lại đúng lô đã trừ.</p>
      </ReasonModal>}
    </>
  );
}
