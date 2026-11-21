import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Send, Check, X, PackageCheck, Truck, Lightbulb } from 'lucide-react';
import { useApp, type AppCtx } from '../lib/app-context';
import { Badge, Empty, Field, ItemPicker, Loading, Modal, PageHeader, ReasonModal, useAction, useRpc, usePaged } from '../components/ui';
import { TRANSFER_STATUS, fmtDate, fmtDateTime, fmtQty } from '../lib/format';
import type { Item, MatrixRow, Transfer } from '../lib/types';
import { handoff } from '../lib/handoff';

/** Phiếu đang chờ chính người dùng này làm bước tiếp theo */
export function transferNeedsMe(t: Transfer, ctx: Pick<AppCtx, 'has' | 'session' | 'branchId'>) {
  const mine = (b: number) => ctx.session.profile?.branch_id === b || (ctx.has('inv_all_branches') && b === ctx.branchId);
  if (t.status === 'pending') return mine(t.from_branch_id) && ctx.has('inv_transfer_approve');
  if (t.status === 'approved') return mine(t.from_branch_id) && ctx.has('inv_transfer_ship');
  if (t.status === 'shipped') return mine(t.to_branch_id) && ctx.has('inv_transfer_receive');
  return false;
}

type Tab = 'todo' | 'in' | 'out' | 'all';

export default function TransfersPage() {
  const app = useApp();
  const { branchId, branches, has, canAct } = app;
  const branch = branches.find(b => b.id === branchId);
  const list = useRpc<Transfer[]>('list_transfers', { limit: 300 });
  const [tab, setTab] = useState<Tab>('todo');
  const [creating, setCreating] = useState(() => Boolean(handoff.transferDraft));
  const [openId, setOpenId] = useState<number | null>(null);

  const all = list.data ?? [];
  const groups = useMemo(() => ({
    todo: all.filter(t => transferNeedsMe(t, app)),
    in: all.filter(t => t.to_branch_id === branchId),
    out: all.filter(t => t.from_branch_id === branchId),
    all,
  }), [all, app, branchId]);
  const rows = groups[tab];
  const open = all.find(t => t.id === openId) ?? null;
  const pg = usePaged(rows, [tab, branchId]);

  return (
    <>
      <PageHeader title="Điều chuyển vật tư"
        description={<>Quy trình: <b>chi nhánh thiếu (A)</b> tạo yêu cầu → <b>chi nhánh cấp (B)</b> duyệt → B xác nhận <b>đã gửi</b> (trừ kho B) → A xác nhận <b>đã nhận</b> (cộng kho A).</>}
        actions={has('inv_transfer_request') && canAct(branchId) && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Tạo yêu cầu cho {branch?.name}</button>} />
      <section className="panel">
        <div className="tabs">
          {([['todo', 'Cần tôi xử lý'], ['in', `${branch?.name} xin hàng`], ['out', `${branch?.name} cấp hàng`], ['all', 'Tất cả']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{k === 'todo' && groups.todo.length > 0 && <em>{groups.todo.length}</em>}</button>
          ))}
        </div>
        {list.loading ? <Loading /> : list.error ? <div className="notice danger">{list.error}</div> : rows.length === 0 ? <Empty>Không có phiếu điều chuyển.</Empty> : (
          <><div className="table-wrap"><table className="data">
            <thead><tr><th>Mã phiếu</th><th>Chi nhánh xin (A)</th><th>Chi nhánh cấp (B)</th><th>Vật tư</th><th>Trạng thái</th><th>Ngày tạo</th><th>Người tạo</th></tr></thead>
            <tbody>{pg.shown.map(t => (
              <tr key={t.id} className="clickable" onClick={() => setOpenId(t.id)}>
                <td><b className="mono">{t.code}</b>{transferNeedsMe(t, app) && <div><Badge tone="danger">Cần bạn xử lý</Badge></div>}</td>
                <td>{t.to_branch_name}</td><td>{t.from_branch_name}</td>
                <td className="small">{t.lines.slice(0, 2).map(l => `${l.item_name} ×${fmtQty(l.qty_approved ?? l.qty_requested)}`).join('; ')}{t.lines.length > 2 && ` … +${t.lines.length - 2}`}</td>
                <td><Badge tone={TRANSFER_STATUS[t.status].tone}>{TRANSFER_STATUS[t.status].label}</Badge></td>
                <td className="small nowrap">{fmtDateTime(t.requested_at)}</td><td className="small">{t.requested_by_name}</td>
              </tr>
            ))}</tbody>
          </table></div>{pg.pager}</>
        )}
      </section>
      {creating && <CreateModal onClose={() => { handoff.transferDraft = undefined; setCreating(false); }} onCreated={id => { setCreating(false); setOpenId(id); setTab('in'); }} />}
      {open && <DetailModal t={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

type Line = { key: number; item_id: number | null; qty: string };
let seq = 1;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { branchId, branches, canViewAll } = useApp();
  const items = useRpc<Item[]>('list_items');
  const matrix = useRpc<MatrixRow[]>(canViewAll ? 'get_stock_matrix' : null);
  const [draft] = useState(() => { const d = handoff.transferDraft; handoff.transferDraft = undefined; return d; });
  const [lines, setLines] = useState<Line[]>(() => draft?.items.length
    ? draft.items.map(x => ({ key: seq++, item_id: x.item_id, qty: String(x.qty) })) : [{ key: seq++, item_id: null, qty: '' }]);
  const [from, setFrom] = useState<number | ''>(draft?.from_branch_id && draft.from_branch_id !== branchId ? draft.from_branch_id : '');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const others = branches.filter(b => b.id !== branchId);
  const mx = useMemo(() => new Map((matrix.data ?? []).map(r => [r.id, r])), [matrix.data]);
  const valid = lines.filter(l => l.item_id && Number(l.qty) > 0);

  // Gợi ý chi nhánh đáp ứng được nhiều nhất (vẫn còn trên mức tối thiểu sau khi cấp)
  const ranking = useMemo(() => {
    if (!matrix.data || !valid.length) return [];
    return others.map(b => {
      let full = 0, spare = 0;
      for (const l of valid) {
        const c = mx.get(l.item_id!)?.by_branch[String(b.id)];
        if (!c) continue;
        const surplus = Number(c.usable) - Number(c.min);
        if (Number(c.usable) >= Number(l.qty)) full++;
        spare += Math.max(0, Math.min(surplus, Number(l.qty)));
      }
      return { b, full, spare };
    }).sort((a, b) => b.full - a.full || b.spare - a.spare);
  }, [matrix.data, valid, others, mx]);
  useEffect(() => { if (from === '' && ranking[0]?.full) setFrom(ranking[0].b.id); }, [ranking, from]);

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  async function submit() {
    const r = await run<Transfer>('create_transfer', { to_branch_id: branchId, from_branch_id: from, note, lines: valid.map(l => ({ item_id: l.item_id, qty: Number(l.qty) })) }, 'Đã gửi yêu cầu điều chuyển');
    if (r) onCreated(r.id);
  }
  const activeItems = (items.data ?? []).filter(i => i.active);
  return (
    <Modal size="wide" title={`Yêu cầu điều chuyển về ${branches.find(b => b.id === branchId)?.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !valid.length || !from} onClick={submit}><Send size={16} /> Gửi yêu cầu</button>
    </>}>
      <div className="table-wrap"><table className="data lines-table">
        <thead><tr><th style={{ minWidth: 240 }}>Vật tư cần</th><th style={{ width: 110 }}>Số lượng</th>
          {canViewAll && others.map(b => <th key={b.id} className="num small" style={{ background: from === b.id ? 'var(--td-color-selected)' : undefined }}>{b.name}</th>)}<th style={{ width: 36 }} /></tr></thead>
        <tbody>{lines.map(l => {
          const it = activeItems.find(i => i.id === l.item_id);
          return (
            <tr key={l.key}>
              <td><ItemPicker items={activeItems} value={l.item_id} onChange={id => set(l.key, { item_id: id })} exclude={lines.filter(x => x.key !== l.key).map(x => x.item_id!).filter(Boolean)} /></td>
              <td><div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}><input className="input sm" type="number" min={0} step="any" style={{ width: 70 }} value={l.qty} onChange={e => set(l.key, { qty: e.target.value })} /><span className="muted small">{it?.unit}</span></div></td>
              {canViewAll && others.map(b => {
                const c = l.item_id ? mx.get(l.item_id)?.by_branch[String(b.id)] : undefined;
                const enough = c && Number(c.usable) >= Number(l.qty || 0) && Number(l.qty) > 0;
                return <td key={b.id} className="num small" style={{ background: from === b.id ? 'var(--td-color-selected)' : undefined, color: c ? (enough ? 'var(--td-success)' : 'var(--td-text-muted)') : undefined, fontWeight: enough ? 700 : 400 }}>
                  {c ? fmtQty(c.usable) : ''}</td>;
              })}
              <td><button className="btn btn-ghost btn-sm icon-only" onClick={() => setLines(ls => ls.length > 1 ? ls.filter(x => x.key !== l.key) : ls)} aria-label="Xóa dòng"><Trash2 size={15} /></button></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setLines(ls => [...ls, { key: seq++, item_id: null, qty: '' }])}><Plus size={14} /> Thêm vật tư</button>
      {canViewAll && ranking.length > 0 && ranking[0].full > 0 && (
        <div className="notice" style={{ marginTop: 12 }}><Lightbulb size={14} style={{ verticalAlign: -2 }} /> Gợi ý: <b>{ranking[0].b.name}</b> có đủ {ranking[0].full}/{valid.length} vật tư
          {ranking[1]?.full ? <>, tiếp theo là {ranking[1].b.name} ({ranking[1].full}/{valid.length})</> : null}. Số trong bảng là lượng còn dùng được ở từng chi nhánh.</div>
      )}
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Xin hàng từ chi nhánh (B)">
          <select className="select" value={from} onChange={e => setFrom(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— Chọn chi nhánh cấp hàng —</option>{others.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú / lý do"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: cần gấp cho ca implant thứ 7" /></Field>
      </div>
    </Modal>
  );
}

function DetailModal({ t, onClose }: { t: Transfer; onClose: () => void }) {
  const app = useApp();
  const { has, session } = app;
  const { run, busy } = useAction();
  const [approveQty, setApproveQty] = useState<Record<number, string>>(() => Object.fromEntries(t.lines.map(l => [l.id, String(l.qty_approved ?? l.qty_requested)])));
  const [ask, setAsk] = useState<null | 'reject' | 'cancel' | 'receive'>(null);
  const mine = (b: number) => session.profile?.branch_id === b || has('inv_all_branches');
  const act = async (action: string, extra: Record<string, unknown> = {}, msg = 'Đã cập nhật phiếu') => {
    const r = await run('transfer_action', { id: t.id, action, ...extra }, msg);
    if (r) setAsk(null);
  };
  const s = t.status;
  const steps = [
    { label: '1. Tạo yêu cầu', who: t.requested_by_name, at: t.requested_at, done: true },
    { label: '2. B duyệt', who: t.approved_by_name, at: t.approved_at, done: ['approved', 'shipped', 'received'].includes(s) },
    { label: '3. B đã gửi', who: t.shipped_by_name, at: t.shipped_at, done: ['shipped', 'received'].includes(s) },
    { label: '4. A đã nhận', who: t.received_by_name, at: t.received_at, done: s === 'received' },
  ];
  const currentIdx = steps.findIndex(x => !x.done);
  const bad = s === 'rejected' || s === 'cancelled';

  return (
    <Modal size="wide" onClose={onClose} title={<>{t.code} <Badge tone={TRANSFER_STATUS[s].tone}>{TRANSFER_STATUS[s].label}</Badge></>} footer={<>
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
        <span><b>{t.to_branch_name}</b> (A) xin hàng từ <b>{t.from_branch_name}</b> (B)</span>
        {t.note && <span className="muted">· {t.note}</span>}
      </div>
      <div className="steps">{steps.map((x, i) => (
        <div key={i} className={`step ${x.done ? 'done' : bad ? '' : i === currentIdx ? 'current' : ''}`}>
          <b>{x.label}</b>{x.done ? <>{x.who}<br />{fmtDateTime(x.at)}</> : bad ? '—' : i === currentIdx ? 'Đang chờ' : ''}
        </div>
      ))}</div>
      {bad && <div className="notice danger">{s === 'rejected' ? 'Bị từ chối' : 'Đã hủy'} bởi {t.closed_by_name} lúc {fmtDateTime(t.closed_at)}{t.reject_reason ? `: ${t.reject_reason}` : ''}</div>}
      {t.receive_note && <div className="notice">Ghi chú khi nhận: {t.receive_note}</div>}
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Vật tư</th><th className="num">Yêu cầu</th><th className="num">Duyệt cấp</th><th>Lô đã gửi</th></tr></thead>
        <tbody>{t.lines.map(l => (
          <tr key={l.id}>
            <td><span className="item-name">{l.item_name}</span> <span className="item-code">{l.item_code}</span></td>
            <td className="num">{fmtQty(l.qty_requested)} {l.unit}</td>
            <td className="num">{s === 'pending' && has('inv_transfer_approve') && mine(t.from_branch_id)
              ? <input className="input sm" type="number" min={0} step="any" style={{ width: 80, textAlign: 'right' }} value={approveQty[l.id]} onChange={e => setApproveQty(q => ({ ...q, [l.id]: e.target.value }))} />
              : l.qty_approved == null ? '—' : `${fmtQty(l.qty_approved)} ${l.unit}`}</td>
            <td className="small mono">{l.lots.length ? l.lots.map(x => `${x.lot_no || '—'} (HSD ${fmtDate(x.expiry_date)}) ×${fmtQty(x.qty)}`).join('; ') : '—'}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {s === 'pending' && has('inv_transfer_approve') && mine(t.from_branch_id) && <p className="muted small">Có thể sửa số lượng duyệt (nhập 0 nếu không cấp vật tư đó). Hệ thống kiểm tra kho {t.from_branch_name} còn đủ hàng còn hạn.</p>}
      {s === 'approved' && <p className="muted small">Khi bấm “Đã gửi”, hệ thống tự trừ kho {t.from_branch_name} theo lô hết hạn sớm nhất trước, và lô/hạn dùng sẽ được chuyển nguyên sang {t.to_branch_name}.</p>}

      {ask === 'reject' && <ReasonModal title="Từ chối yêu cầu" label="Lý do từ chối" confirmText="Từ chối" tone="danger" busy={busy} onClose={() => setAsk(null)} onConfirm={r => act('reject', { reason: r }, 'Đã từ chối yêu cầu')} />}
      {ask === 'cancel' && <ReasonModal title="Hủy yêu cầu" label="Lý do (không bắt buộc)" required={false} confirmText="Hủy yêu cầu" tone="danger" busy={busy} onClose={() => setAsk(null)} onConfirm={r => act('cancel', { reason: r }, 'Đã hủy yêu cầu')} />}
      {ask === 'receive' && <ReasonModal title="Xác nhận đã nhận hàng" label="Ghi chú (không bắt buộc)" required={false} confirmText="Đã nhận đủ hàng" tone="success" busy={busy} onClose={() => setAsk(null)} onConfirm={r => act('receive', { reason: r }, `Đã nhận hàng — kho ${t.to_branch_name} đã được cộng`)}>
        <p className="small muted" style={{ marginTop: 0 }}>Kho {t.to_branch_name} sẽ được cộng đúng số lượng, số lô và hạn dùng bên {t.from_branch_name} đã gửi.</p>
      </ReasonModal>}
    </Modal>
  );
}
