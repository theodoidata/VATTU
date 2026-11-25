import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Send, Check, X, PackageCheck, Truck, Lightbulb, Download } from 'lucide-react';
import { useApp, type AppCtx } from '../lib/app-context';
import { Badge, Empty, Field, ItemPicker, ItemQtyInput, Loading, UnitCell, Modal, PageHeader, ReasonModal, useAction, useRpc, usePaged, useUnits } from '../components/ui';
import { TRANSFER_STATUS, fmtDate, fmtDateTime, fmtQty, fmtUnits } from '../lib/format';
import type { Item, MatrixRow, StockRow, Transfer, TransferLine } from '../lib/types';
import { handoff } from '../lib/handoff';
import { exportExcel, sheet } from '../lib/excel';

/** Phiếu đang chờ chính người dùng này làm bước tiếp theo */
export function transferNeedsMe(t: Transfer, ctx: Pick<AppCtx, 'has' | 'session' | 'branchId'>) {
  const mine = (b: number) => ctx.session.profile?.branch_id === b || (ctx.has('inv_all_branches') && b === ctx.branchId);
  if (t.status === 'pending') return mine(t.from_branch_id) && ctx.has('inv_transfer_approve');
  if (t.status === 'approved') return mine(t.from_branch_id) && ctx.has('inv_transfer_ship');
  if (t.status === 'shipped') return mine(t.to_branch_id) && ctx.has('inv_transfer_receive');
  return false;
}

type Tab = 'todo' | 'in' | 'out' | 'all' | 'buy';

export default function TransfersPage() {
  const app = useApp();
  const { branchId, branches, has, canAct } = app;
  const U = useUnits();
  const branch = branches.find(b => b.id === branchId);
  const list = useRpc<Transfer[]>('list_transfers', { limit: 300 });
  const [tab, setTab] = useState<Tab>('todo');
  const [creating, setCreating] = useState(() => Boolean(handoff.transferDraft));
  const [openId, setOpenId] = useState<number | null>(() => { const id = handoff.openTransferId ?? null; handoff.openTransferId = undefined; return id; });
  const [pushing, setPushing] = useState(false);

  const all = list.data ?? [];
  const groups = useMemo(() => ({
    todo: all.filter(t => transferNeedsMe(t, app)),
    in: all.filter(t => t.to_branch_id === branchId),
    out: all.filter(t => t.from_branch_id === branchId),
    all,
  }), [all, app, branchId]);
  const rows = tab === 'buy' ? [] : groups[tab];
  // Tab "Cần mua": cho chi nhánh cấp hàng (thường là Kho tổng) biết phải nhập thêm bao nhiêu từ NCC
  const canBuy = canAct(branchId) && (has('inv_transfer_approve') || has('inv_receipt_create'));
  const open = all.find(t => t.id === openId) ?? null;
  const pg = usePaged(rows, [tab, branchId]);

  return (
    <>
      <PageHeader title="Điều chuyển vật tư"
        description={<>Quy trình: <b>chi nhánh thiếu (A)</b> tạo yêu cầu → <b>chi nhánh cấp (B)</b> duyệt → B xác nhận <b>đã gửi</b> (trừ kho B) → A xác nhận <b>đã nhận</b> (cộng kho A). B cũng có thể <b>cấp hàng chủ động</b> không cần A xin.</>}
        actions={<>
          {has('inv_transfer_ship') && canAct(branchId) && <button className="btn" onClick={() => setPushing(true)}><Truck size={16} /> {branch?.name} cấp hàng đi</button>}
          {has('inv_transfer_request') && canAct(branchId) && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Tạo yêu cầu cho {branch?.name}</button>}
        </>} />
      <section className="panel">
        <div className="tabs">
          {([['todo', 'Cần tôi xử lý'], ['in', `${branch?.name} xin hàng`], ['out', `${branch?.name} cấp hàng`], ['all', 'Tất cả'],
             ...(canBuy ? [['buy', 'Cần mua']] as const : [])] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{k === 'todo' && groups.todo.length > 0 && <em>{groups.todo.length}</em>}</button>
          ))}
        </div>
        {tab === 'buy' ? <BuyList branchId={branchId} branchName={branch?.name ?? ''} onOpen={setOpenId} /> : list.loading ? <Loading /> : list.error ? <div className="notice danger">{list.error}</div> : rows.length === 0 ? <Empty>Không có phiếu điều chuyển.</Empty> : (
          <><div className="table-wrap"><table className="data">
            <thead><tr><th>Mã phiếu</th><th>Chi nhánh xin (A)</th><th>Chi nhánh cấp (B)</th><th>Vật tư</th><th>Trạng thái</th><th>Ngày tạo</th><th>Người tạo</th></tr></thead>
            <tbody>{pg.shown.map(t => (
              <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
                <td><b className="mono">{t.code}</b>{transferNeedsMe(t, app) && <div><Badge tone="danger">Cần bạn xử lý</Badge></div>}</td>
                <td>{t.to_branch_name}</td><td>{t.from_branch_name}</td>
                <td className="small">{t.lines.slice(0, 2).map(l => `${l.item_name} ×${U(l.qty_approved ?? l.qty_requested, l.item_id, l.unit)}`).join('; ')}{t.lines.length > 2 && ` … +${t.lines.length - 2}`}</td>
                <td><Badge tone={TRANSFER_STATUS[t.status].tone}>{TRANSFER_STATUS[t.status].label}</Badge>
                  {t.kind === 'push' && <div><Badge tone="info">Cấp chủ động</Badge></div>}{t.has_shortage && <div><Badge tone="danger">Nhận thiếu</Badge></div>}
                  {t.awaiting_stock && <div><Badge tone="warning">Chờ hàng về</Badge></div>}</td>
                <td className="small nowrap">{fmtDateTime(t.requested_at)}</td><td className="small">{t.requested_by_name}</td>
              </tr>
            ))}</tbody>
          </table></div>{pg.pager}</>
        )}
      </section>
      {creating && <CreateModal onClose={() => { handoff.transferDraft = undefined; setCreating(false); }} onCreated={id => { setCreating(false); setOpenId(id); setTab('in'); }} />}
      {pushing && <PushModal onClose={() => setPushing(false)} onCreated={id => { setPushing(false); setOpenId(id); setTab('out'); }} />}
      {open && <DetailModal t={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Tổng hợp các phiếu xin hàng đang chờ gửi từ chi nhánh này → số cần mua thêm từ NCC */
function BuyList({ branchId, branchName, onOpen }: { branchId: number; branchName: string; onOpen: (id: number) => void }) {
  const { today, has } = useApp();
  const U = useUnits();
  const open = useRpc<Transfer[]>('list_transfers', { status: ['pending', 'approved'], branch_id: branchId });
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const m = new Map<number, { item_id: number; code: string; name: string; unit: string; total: number; usable: number;
      by: Map<string, number>; docs: { id: number; code: string }[] }>();
    for (const t of open.data ?? []) {
      if (t.from_branch_id !== branchId) continue;
      for (const l of t.lines) {
        const q = Number(l.qty_approved ?? l.qty_requested);
        const e = m.get(l.item_id) ?? { item_id: l.item_id, code: l.item_code, name: l.item_name, unit: l.unit, total: 0,
          usable: Number(l.src_usable ?? 0), by: new Map<string, number>(), docs: [] as { id: number; code: string }[] };
        e.total += q; e.by.set(t.to_branch_name, (e.by.get(t.to_branch_name) ?? 0) + q);
        if (!e.docs.some(d => d.id === t.id)) e.docs.push({ id: t.id, code: t.code });
        m.set(l.item_id, e);
      }
    }
    return [...m.values()].map(e => ({ ...e, need: Math.max(0, e.total - e.usable) }))
      .sort((a, b) => b.need - a.need || a.name.localeCompare(b.name, 'vi'));
  }, [open.data, branchId]);
  const shown = showAll ? rows : rows.filter(r => r.need > 0);
  const pg = usePaged(shown, [branchId, showAll]);
  const doExport = () => exportExcel(`Can-mua-${branchName}-${today}`, [sheet('Cần mua', shown, [
    { header: 'Mã', get: r => r.code, width: 12 }, { header: 'Vật tư', get: r => r.name, width: 40 }, { header: 'ĐVT', get: r => r.unit, width: 8 },
    { header: 'Các chi nhánh xin', get: r => [...r.by].map(([b, q]) => `${b}: ${U(q, r.item_id, r.unit)}`).join('; '), width: 40 },
    { header: 'Tổng xin', get: r => r.total, width: 10 }, { header: 'Kho còn dùng được', get: r => r.usable, width: 16 },
    { header: 'Cần mua', get: r => r.need, width: 10 }, { header: 'Cần mua (hộp + lẻ)', get: r => U(r.need, r.item_id, r.unit), width: 18 },
  ])]);
  return (<>
    <div className="toolbar">
      <span className="small muted">Cộng các phiếu xin hàng <b>đang chờ duyệt / chờ gửi</b> từ {branchName}, trừ đi số {branchName} còn dùng được.</span>
      <span className="spacer" />
      <label className="check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Hiện cả vật tư đủ hàng</label>
      {has('inv_report_export') && <button className="btn" disabled={!shown.length} onClick={doExport}><Download size={16} /> Xuất Excel</button>}
    </div>
    {open.loading ? <Loading /> : open.error ? <div className="notice danger">{open.error}</div> : !shown.length
      ? <Empty>{rows.length ? `${branchName} đủ hàng cho tất cả phiếu đang chờ.` : `Không có phiếu nào đang xin hàng từ ${branchName}.`}</Empty> : (
      <><div className="table-wrap"><table className="data fixed-cols">
        <thead><tr><th>Vật tư</th><th style={{ width: '30%' }}>Các chi nhánh xin</th><th className="num" style={{ width: 110 }}>Tổng xin</th>
          <th className="num" style={{ width: 120 }}>{branchName} còn</th><th className="num" style={{ width: 120 }}>Cần mua</th><th style={{ width: 150 }}>Phiếu</th></tr></thead>
        <tbody>{pg.shown.map(r => (
          <tr key={r.item_id}>
            <td><span className="item-name">{r.name}</span> <span className="item-code">{r.code}</span></td>
            <td className="small">{[...r.by].map(([b, q]) => <div key={b}>{b}: <b>{U(q, r.item_id, r.unit)}</b></div>)}</td>
            <td className="num">{U(r.total, r.item_id, r.unit)}</td>
            <td className="num">{r.usable > 0 ? U(r.usable, r.item_id, r.unit) : <span className="text-danger">0</span>}</td>
            <td className="num">{r.need > 0 ? <b className="text-danger">{U(r.need, r.item_id, r.unit)}</b> : <span className="muted">Đủ</span>}</td>
            <td className="small">{r.docs.map(d => <button key={d.id} className="link-btn mono" style={{ marginRight: 6 }} onClick={() => onOpen(d.id)}>{d.code}</button>)}</td>
          </tr>))}</tbody>
      </table></div>{pg.pager}</>
    )}
    <p className="muted small">Sau khi hàng NCC về: ghi <b>Nhập kho</b> cho {branchName}, rồi mở từng phiếu để <b>Duyệt → Gửi hàng</b>. Nhãn “Chờ hàng về” trên phiếu tự mất khi đủ hàng.</p>
  </>);
}

type Line = { key: number; item_id: number | null; qty: string; src: number | null; manual: boolean };
let seq = 1;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number | null) => void }) {
  const { branchId, branches, canViewAll } = useApp();
  const U = useUnits();
  const items = useRpc<Item[]>('list_items');
  const matrix = useRpc<MatrixRow[]>(canViewAll ? 'get_stock_matrix' : null);
  const [draft] = useState(() => { const d = handoff.transferDraft; handoff.transferDraft = undefined; return d; });
  const draftFrom = draft?.from_branch_id && draft.from_branch_id !== branchId ? draft.from_branch_id : null;
  const [lines, setLines] = useState<Line[]>(() => draft?.items.length
    ? draft.items.map(x => ({ key: seq++, item_id: x.item_id, qty: String(x.qty), src: draftFrom, manual: Boolean(draftFrom) }))
    : [{ key: seq++, item_id: null, qty: '', src: null, manual: false }]);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const others = branches.filter(b => b.id !== branchId);
  const mx = useMemo(() => new Map((matrix.data ?? []).map(r => [r.id, r])), [matrix.data]);
  // Ô không có trong ma trận = chi nhánh đó tồn 0 (máy chủ bỏ ô trống để đỡ tốn dữ liệu)
  const cell = (itemId: number | null, b: number) => (itemId ? mx.get(itemId)?.by_branch[String(b)] : undefined) ?? { qty: 0, usable: 0, min: 0 };

  // Tự chọn chi nhánh cấp cho từng dòng: đủ hàng và còn dư nhiều nhất sau khi cấp (dòng người dùng tự chọn thì giữ nguyên)
  const bestFor = (l: Line): number | null => {
    if (!l.item_id || !matrix.data) return null;
    const need = Number(l.qty) || 0;
    const scored = others.map(b => { const c = cell(l.item_id, b.id); return { id: b.id, usable: Number(c.usable), spare: Number(c.usable) - Number(c.min) }; })
      .filter(x => x.usable > 0)
      .sort((a, b) => Number(b.usable >= need) - Number(a.usable >= need) || b.spare - a.spare || b.usable - a.usable);
    return scored[0]?.id ?? null;
  };
  useEffect(() => {
    if (!matrix.data) return;
    setLines(ls => { let changed = false; const n = ls.map(l => { if (l.manual) return l; const b = bestFor(l); if (b === l.src) return l; changed = true; return { ...l, src: b }; }); return changed ? n : ls; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix.data, lines.map(l => `${l.item_id}:${l.qty}`).join('|')]);

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);
  const noSrc = valid.filter(l => !l.src);
  const short = canViewAll ? valid.filter(l => l.src && Number(cell(l.item_id, l.src).usable) < Number(l.qty)) : [];
  const bySrc = useMemo(() => {
    const m = new Map<number, Line[]>();
    for (const l of valid) if (l.src) m.set(l.src, [...(m.get(l.src) ?? []), l]);
    return [...m.entries()];
  }, [valid]);
  const nameOf = (id: number) => branches.find(b => b.id === id)?.name ?? '';

  async function submit() {
    let lastId: number | null = null, ok = 0;
    for (const [src, ls] of bySrc) {
      const last = ok === bySrc.length - 1;
      const r = await run<Transfer>('create_transfer', { to_branch_id: branchId, from_branch_id: src, note, lines: ls.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })) },
        last ? (bySrc.length > 1 ? `Đã gửi ${bySrc.length} phiếu yêu cầu điều chuyển` : 'Đã gửi yêu cầu điều chuyển') : undefined);
      if (!r) break;
      ok++; lastId = r.id;
      setLines(cur => cur.filter(l => !ls.some(x => x.key === l.key))); // phiếu đã gửi thì bỏ khỏi bảng, lỗi giữa chừng không bị gửi trùng
    }
    if (ok === bySrc.length) onCreated(bySrc.length === 1 ? lastId : null);
  }
  const activeItems = (items.data ?? []).filter(i => i.active);
  return (
    <Modal size="xwide" title={`Yêu cầu điều chuyển về ${nameOf(branchId)}`} onClose={onClose} footer={<>
      <div className="foot-summary small">
        {bySrc.length > 0 ? <>Sẽ gửi <b>{bySrc.length} phiếu</b>: {bySrc.map(([src, ls]) => `${nameOf(src)} (${ls.length} vật tư)`).join(' · ')}</> : <span className="muted">Chọn vật tư và nhập số lượng cần xin.</span>}
        {noSrc.length > 0 && <div className="text-danger">{noSrc.length} dòng chưa chọn chi nhánh cấp.</div>}
        {short.length > 0 && <div className="text-warning">{short.length} dòng chi nhánh cấp không đủ hàng, nên chọn chi nhánh khác.</div>}
      </div>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !valid.length || noSrc.length > 0} onClick={submit}><Send size={16} /> Gửi yêu cầu</button>
    </>}>
      <div className="table-wrap"><table className="data lines-table transfer-lines">
        <thead><tr>
          <th style={{ minWidth: 200 }}>Vật tư cần</th><th className="num" style={{ width: 110 }}>Số lượng</th><th style={{ width: 96 }}>Đơn vị</th>
          <th style={{ width: 130 }}>Xin từ chi nhánh</th><th style={{ width: 40 }} />
          {canViewAll && others.map(b => <th key={b.id} className="num br-col" title={`Còn dùng được ở ${b.name}`}>{b.name}</th>)}
        </tr></thead>
        <tbody>{lines.map(l => {
          const it = activeItems.find(i => i.id === l.item_id);
          return (
            <tr key={l.key}>
              <td><ItemPicker items={activeItems} value={l.item_id} onChange={id => set(l.key, { item_id: id, manual: false })} exclude={lines.filter(x => x.key !== l.key).map(x => x.item_id!).filter(Boolean)} /></td>
              <td className="num"><ItemQtyInput itemId={l.item_id} unit={it?.unit} value={l.qty} onChange={v => set(l.key, { qty: v })} /></td>
              <td><UnitCell itemId={l.item_id} unit={it?.unit} /></td>
              <td><select className="select sm" style={{ width: '100%' }} value={l.src ?? ''} onChange={e => set(l.key, { src: e.target.value ? Number(e.target.value) : null, manual: true })}>
                <option value="">— Chọn —</option>{others.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></td>
              <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [{ key: seq++, item_id: null, qty: '', src: null, manual: false }])} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
              {canViewAll && others.map(b => {
                const c = cell(l.item_id, b.id), u = Number(c.usable);
                const enough = u > 0 && u >= Number(l.qty || 0);
                const picked = l.src === b.id;
                return <td key={b.id} className={`num br-col${picked ? ' picked' : ''}${l.item_id && u > 0 ? ' pickable' : ''}`}
                  title={l.item_id ? `${b.name}: còn dùng được ${U(u, l.item_id)}${Number(c.min) ? ` · tối thiểu ${U(c.min, l.item_id)}` : ''}${u > 0 ? ' — bấm để xin từ đây' : ''}` : ''}
                  onClick={() => { if (l.item_id && u > 0) set(l.key, { src: b.id, manual: true }); }}>
                  {!l.item_id ? '' : u > 0 ? <span style={{ color: enough ? 'var(--td-success)' : undefined, fontWeight: enough ? 700 : 400 }}>{fmtQty(u)}</span> : <span className="muted">0</span>}
                </td>;
              })}
            </tr>
          );
        })}</tbody>
      </table></div>
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, { key: seq++, item_id: null, qty: '', src: null, manual: false }])}><Plus size={14} /> Thêm vật tư</button>
      {canViewAll && <p className="muted small" style={{ marginBottom: 0 }}><Lightbulb size={13} style={{ verticalAlign: -2 }} /> Số trong bảng là lượng <b>còn dùng được</b> ở từng chi nhánh (0 = hết hàng), <b style={{ color: 'var(--td-success)' }}>xanh</b> là đủ số lượng cần.
        Hệ thống tự chọn chi nhánh đủ hàng và còn dư nhiều nhất; bấm vào ô số của chi nhánh khác để đổi. Vật tư xin từ nhiều chi nhánh sẽ tự tách thành nhiều phiếu.</p>}
      <div style={{ marginTop: 12 }}>
        <Field label="Ghi chú / lý do"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: cần gấp cho ca implant thứ 7" /></Field>
      </div>
    </Modal>
  );
}

type PushLine = { key: number; item_id: number | null; qty: string };

/** Chi nhánh đang xem (B) chủ động cấp hàng cho chi nhánh khác: trừ kho ngay, bên nhận chỉ cần xác nhận */
function PushModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { branchId, branches } = useApp();
  const stock = useRpc<StockRow[]>('get_stock', { branch_id: branchId });
  const [to, setTo] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<PushLine[]>([{ key: seq++, item_id: null, qty: '' }]);
  const { run, busy } = useAction();
  const others = branches.filter(b => b.id !== branchId);
  const byId = useMemo(() => new Map((stock.data ?? []).map(r => [r.id, r])), [stock.data]);
  const pickItems = useMemo(() => (stock.data ?? []).filter(r => Number(r.usable_qty) > 0).map(r => ({
    id: r.id, code: r.code, name: r.name, unit: r.unit, group_name: r.group_name,
    extra: <span>còn {fmtUnits(r.usable_qty, r)}</span>,
  })), [stock.data]);
  const set = (key: number, patch: Partial<PushLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);
  const over = valid.filter(l => Number(l.qty) > Number(byId.get(l.item_id!)?.usable_qty ?? 0));
  const fromName = branches.find(b => b.id === branchId)?.name;
  async function submit() {
    const r = await run<Transfer>('push_transfer', { from_branch_id: branchId, to_branch_id: to, note, lines: valid.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })) },
      `Đã gửi hàng, kho ${fromName} đã được trừ`);
    if (r) onCreated(r.id);
  }
  return (
    <Modal size="wide" title={`${fromName} cấp hàng chủ động`} onClose={onClose} footer={<>
      <div className="foot-summary small">
        {over.length > 0 ? <span className="text-danger">{over.length} dòng vượt số còn dùng được.</span>
          : valid.length > 0 && to ? <>Gửi <b>{valid.length} vật tư</b> đến <b>{branches.find(b => b.id === to)?.name}</b>, kho {fromName} bị trừ ngay.</> : <span className="muted">Chọn chi nhánh nhận và vật tư cần gửi.</span>}
      </div>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !valid.length || !to || over.length > 0} onClick={submit}><Truck size={16} /> Gửi hàng</button>
    </>}>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="Gửi đến chi nhánh">
          <select className="select" value={to} onChange={e => setTo(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— Chọn chi nhánh nhận —</option>{others.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: bổ sung định kỳ tháng 11" /></Field>
      </div>
      {stock.loading ? <Loading /> : (
        <div className="table-wrap"><table className="data lines-table">
          <thead><tr><th style={{ minWidth: 260 }}>Vật tư gửi đi</th><th className="num" style={{ width: 150 }}>Số lượng</th><th style={{ width: 100 }}>Đơn vị</th><th className="num" style={{ width: 140 }}>Còn dùng được</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>{lines.map(l => {
            const r = l.item_id ? byId.get(l.item_id) : undefined;
            const bad = r && Number(l.qty) > Number(r.usable_qty);
            return (
              <tr key={l.key}>
                <td><ItemPicker items={pickItems} value={l.item_id} onChange={id => set(l.key, { item_id: id })} exclude={lines.filter(x => x.key !== l.key).map(x => x.item_id!).filter(Boolean)} /></td>
                <td className="num"><ItemQtyInput itemId={l.item_id} unit={r?.unit} value={l.qty} onChange={v => set(l.key, { qty: v })} bad={Boolean(bad)} /></td>
                <td><UnitCell itemId={l.item_id} unit={r?.unit} /></td>
                <td className="num">{r ? <span className={bad ? 'text-danger' : ''}>{fmtUnits(r.usable_qty, r)}</span> : ''}</td>
                <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : [{ key: seq++, item_id: null, qty: '' }])} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, { key: seq++, item_id: null, qty: '' }])}><Plus size={14} /> Thêm vật tư</button>
      <p className="muted small" style={{ marginBottom: 0 }}>Bấm “Gửi hàng” là kho {fromName} bị trừ ngay (lô hết hạn sớm nhất trước). Chi nhánh nhận kiểm hàng rồi bấm “Đã nhận”, nếu thiếu thì nhập số thực nhận.</p>
    </Modal>
  );
}

/** A xác nhận nhận hàng: nhập số thực nhận từng dòng, thiếu thì bắt buộc ghi lý do */
function ReceiveModal({ t, busy, onClose, onConfirm }: { t: Transfer; busy: boolean; onClose: () => void; onConfirm: (lines: { line_id: number; qty_received: number }[], note: string, short: boolean) => void }) {
  const U = useUnits();
  const shipped = (l: TransferLine) => l.lots.reduce((s, x) => s + Number(x.qty), 0);
  const sent = t.lines.filter(l => shipped(l) > 0);
  const [got, setGot] = useState<Record<number, string>>(() => Object.fromEntries(sent.map(l => [l.id, String(shipped(l))])));
  const [note, setNote] = useState('');
  const rows = sent.map(l => { const s = shipped(l), g = got[l.id] === '' ? NaN : Number(got[l.id]); return { l, s, g, bad: !(g >= 0 && g <= s), short: g >= 0 && g < s ? s - g : 0 }; });
  const anyBad = rows.some(r => r.bad), shortRows = rows.filter(r => r.short > 0);
  return (
    <Modal size="wide" title="Xác nhận đã nhận hàng" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Quay lại</button>
      <button className={`btn ${shortRows.length ? 'btn-danger' : 'btn-success'}`} disabled={busy || anyBad || (shortRows.length > 0 && !note.trim())}
        onClick={() => onConfirm(rows.map(r => ({ line_id: r.l.id, qty_received: r.g })), note.trim(), shortRows.length > 0)}>
        <PackageCheck size={16} /> {shortRows.length ? `Xác nhận nhận thiếu ${shortRows.length} vật tư` : 'Đã nhận đủ hàng'}
      </button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>Kiểm đếm hàng thực tế. Đủ thì giữ nguyên số; thiếu thì sửa <b>Thực nhận</b>. Kho {t.to_branch_name} chỉ được cộng đúng số thực nhận, phần thiếu được ghi lại để BGĐ xử lý.</p>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Vật tư</th><th className="num" style={{ width: 120 }}>Đã gửi</th><th className="num" style={{ width: 150 }}>Thực nhận</th><th style={{ width: 100 }}>Đơn vị</th><th className="num" style={{ width: 100 }}>Thiếu</th></tr></thead>
        <tbody>{rows.map(({ l, s, bad, short }) => (
          <tr key={l.id}>
            <td><span className="item-name">{l.item_name}</span> <span className="item-code">{l.item_code}</span></td>
            <td className="num">{U(s, l.item_id, l.unit)}</td>
            <td className="num"><ItemQtyInput itemId={l.item_id} unit={l.unit} value={got[l.id]} max={s} onChange={v => setGot(g => ({ ...g, [l.id]: v }))} bad={bad} /></td>
            <td><UnitCell itemId={l.item_id} unit={l.unit} /></td>
            <td className="num">{short > 0 ? <b className="text-danger">{U(short, l.item_id, l.unit)}</b> : <span className="muted">0</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div style={{ marginTop: 12 }}>
        <Field label={shortRows.length ? 'Lý do thiếu / tình trạng (bắt buộc)' : 'Ghi chú (không bắt buộc)'}>
          <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={shortRows.length ? 'VD: thiếu 1 hộp, bên gửi đóng nhầm / rơi vỡ khi vận chuyển' : ''} />
        </Field>
      </div>
    </Modal>
  );
}

function DetailModal({ t, onClose }: { t: Transfer; onClose: () => void }) {
  const app = useApp();
  const { has, session } = app;
  const U = useUnits();
  const { run, busy } = useAction();
  const [approveQty, setApproveQty] = useState<Record<number, string>>(() => Object.fromEntries(t.lines.map(l => [l.id, String(l.qty_approved ?? l.qty_requested)])));
  const [ask, setAsk] = useState<null | 'reject' | 'cancel' | 'receive'>(null);
  const mine = (b: number) => session.profile?.branch_id === b || has('inv_all_branches');
  const act = async (action: string, extra: Record<string, unknown> = {}, msg = 'Đã cập nhật phiếu') => {
    const r = await run('transfer_action', { id: t.id, action, ...extra }, msg);
    if (r) setAsk(null);
  };
  const s = t.status;
  const steps = t.kind === 'push' ? [
    { label: '1. B cấp chủ động', who: t.requested_by_name, at: t.requested_at, done: true },
    { label: '2. B đã gửi', who: t.shipped_by_name, at: t.shipped_at, done: ['shipped', 'received'].includes(s) },
    { label: '3. A đã nhận', who: t.received_by_name, at: t.received_at, done: s === 'received' },
  ] : [
    { label: '1. Tạo yêu cầu', who: t.requested_by_name, at: t.requested_at, done: true },
    { label: '2. B duyệt', who: t.approved_by_name, at: t.approved_at, done: ['approved', 'shipped', 'received'].includes(s) },
    { label: '3. B đã gửi', who: t.shipped_by_name, at: t.shipped_at, done: ['shipped', 'received'].includes(s) },
    { label: '4. A đã nhận', who: t.received_by_name, at: t.received_at, done: s === 'received' },
  ];
  const currentIdx = steps.findIndex(x => !x.done);
  const bad = s === 'rejected' || s === 'cancelled';

  return (
    <Modal size="wide" onClose={onClose} title={<>{t.code} <Badge tone={TRANSFER_STATUS[s].tone}>{TRANSFER_STATUS[s].label}</Badge>{t.awaiting_stock && <> <Badge tone="warning">Chờ hàng về</Badge></>}</>} footer={<>
      {(s === 'pending' || s === 'approved') && has('inv_transfer_request') && mine(t.to_branch_id) && <button className="btn btn-danger" disabled={busy} onClick={() => setAsk('cancel')}>Hủy yêu cầu</button>}
      {(s === 'pending' || s === 'approved') && has('inv_transfer_approve') && mine(t.from_branch_id) && <button className="btn btn-danger" disabled={busy} onClick={() => setAsk('reject')}><X size={16} /> Từ chối</button>}
      <span className="spacer" />
      <button className="btn" onClick={onClose}>Đóng</button>
      {s === 'pending' && has('inv_transfer_approve') && mine(t.from_branch_id) &&
        <button className="btn btn-primary" disabled={busy} onClick={() => act('approve', { lines: t.lines.map(l => ({ line_id: l.id, qty_approved: Number(approveQty[l.id] || 0) })) }, 'Đã duyệt yêu cầu')}><Check size={16} /> Duyệt</button>}
      {s === 'approved' && has('inv_transfer_ship') && mine(t.from_branch_id) &&
        <button className="btn btn-primary" disabled={busy} onClick={() => act('ship', {}, `Đã gửi hàng — kho ${t.from_branch_name} đã được trừ`)}><Truck size={16} /> Xác nhận đã gửi hàng</button>}
      {s === 'shipped' && has('inv_transfer_receive') && mine(t.to_branch_id) &&
        <button className="btn btn-success" disabled={busy} onClick={() => setAsk('receive')}><PackageCheck size={16} /> Xác nhận đã nhận hàng</button>}
    </>}>
      <div className="row small" style={{ marginBottom: 10 }}>
        {t.kind === 'push' ? <span><b>{t.from_branch_name}</b> (B) chủ động cấp hàng cho <b>{t.to_branch_name}</b> (A)</span>
          : <span><b>{t.to_branch_name}</b> (A) xin hàng từ <b>{t.from_branch_name}</b> (B)</span>}
        {t.note && <span className="muted">· {t.note}</span>}
      </div>
      <div className="steps">{steps.map((x, i) => (
        <div key={i} className={`step ${x.done ? 'done' : bad ? '' : i === currentIdx ? 'current' : ''}`}>
          <b>{x.label}</b>{x.done ? <>{x.who}<br />{fmtDateTime(x.at)}</> : bad ? '—' : i === currentIdx ? 'Đang chờ' : ''}
        </div>
      ))}</div>
      {bad && <div className="notice danger">{s === 'rejected' ? 'Bị từ chối' : 'Đã hủy'} bởi {t.closed_by_name} lúc {fmtDateTime(t.closed_at)}{t.reject_reason ? `: ${t.reject_reason}` : ''}</div>}
      {t.receive_note && <div className={`notice${t.has_shortage ? ' danger' : ''}`}>Ghi chú khi nhận: {t.receive_note}</div>}
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Vật tư</th><th className="num">{t.kind === 'push' ? 'Cấp' : 'Yêu cầu'}</th><th className="num">Duyệt cấp</th><th>Lô đã gửi</th>{s === 'received' && <th className="num">Thực nhận</th>}</tr></thead>
        <tbody>{t.lines.map(l => (
          <tr key={l.id}>
            <td><span className="item-name">{l.item_name}</span> <span className="item-code">{l.item_code}</span></td>
            <td className="num">{U(l.qty_requested, l.item_id, l.unit)}</td>
            <td className="num">{s === 'pending' && has('inv_transfer_approve') && mine(t.from_branch_id)
              ? <ItemQtyInput itemId={l.item_id} unit={l.unit} value={approveQty[l.id]} onChange={v => setApproveQty(q => ({ ...q, [l.id]: v }))} showUnit />
              : l.qty_approved == null ? '—' : U(l.qty_approved, l.item_id, l.unit)}</td>
            <td className="small mono">{l.lots.length ? l.lots.map(x => `${x.lot_no || '—'} (HSD ${fmtDate(x.expiry_date)}) ×${U(x.qty, l.item_id, l.unit)}`).join('; ') : '—'}</td>
            {s === 'received' && <td className="num">{l.qty_received == null || Number(l.qty_received) >= Number(l.qty_approved ?? 0)
              ? U(l.qty_received ?? l.qty_approved, l.item_id, l.unit)
              : <b className="text-danger">{U(l.qty_received, l.item_id, l.unit)} (thiếu {U(Number(l.qty_approved) - Number(l.qty_received), l.item_id, l.unit)})</b>}</td>}
          </tr>
        ))}</tbody>
      </table></div>
      {s === 'pending' && has('inv_transfer_approve') && mine(t.from_branch_id) && <p className="muted small">Có thể sửa số lượng duyệt (nhập 0 nếu không cấp vật tư đó). Hệ thống kiểm tra kho {t.from_branch_name} còn đủ hàng còn hạn.</p>}
      {s === 'approved' && <p className="muted small">Khi bấm “Đã gửi”, hệ thống tự trừ kho {t.from_branch_name} theo lô hết hạn sớm nhất trước, và lô/hạn dùng sẽ được chuyển nguyên sang {t.to_branch_name}.</p>}

      {ask === 'reject' && <ReasonModal title="Từ chối yêu cầu" label="Lý do từ chối" confirmText="Từ chối" tone="danger" busy={busy} onClose={() => setAsk(null)} onConfirm={r => act('reject', { reason: r }, 'Đã từ chối yêu cầu')} />}
      {ask === 'cancel' && <ReasonModal title="Hủy yêu cầu" label="Lý do (không bắt buộc)" required={false} confirmText="Hủy yêu cầu" tone="danger" busy={busy} onClose={() => setAsk(null)} onConfirm={r => act('cancel', { reason: r }, 'Đã hủy yêu cầu')} />}
      {ask === 'receive' && <ReceiveModal t={t} busy={busy} onClose={() => setAsk(null)}
        onConfirm={(lines, note, short) => act('receive', { lines, reason: note },
          short ? `Đã nhận thiếu, kho ${t.to_branch_name} được cộng theo số thực nhận` : `Đã nhận hàng, kho ${t.to_branch_name} đã được cộng`)} />}
    </Modal>
  );
}
