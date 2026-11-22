import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { EXPIRY_LEVEL, STOCK_LEVEL, expiryLevel, fmtDate, fmtQty, fmtUnits, hasPack, norm, splitPack, stockLevel, type UnitInfo } from '../lib/format';
import type { Item } from '../lib/types';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="td-page-header">
      <div>
        <h1 className="td-page-title">{title}</h1>
        {description && <p className="td-page-description">{description}</p>}
      </div>
      {actions && <div className="td-page-actions">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function StockBadge({ usable, min }: { usable: number; min: number }) {
  const s = STOCK_LEVEL[stockLevel(usable, min)];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ExpiryBadge({ date }: { date: string | null }) {
  const { today } = useApp();
  const lv = expiryLevel(date, today);
  if (lv === 'none') return <span className="muted">—</span>;
  const e = EXPIRY_LEVEL[lv];
  return <Badge tone={e.tone}>{fmtDate(date)}{lv !== 'ok' ? ` · ${e.label}` : ''}</Badge>;
}

export function Kpi({ icon, label, value, sub, tone, onClick }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C className={`kpi-card ${tone ? 'tone-' + tone : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="kpi-icon">{icon}</div>
      <div><span className="td-kpi-label">{label}</span><span className="td-kpi-value">{value}</span>{sub && <span className="kpi-sub">{sub}</span>}</div>
    </C>
  );
}

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' | 'xwide' | 'medium' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <header className="modal-head"><h2>{title}</h2><button className="btn btn-ghost btn-sm icon-only" onClick={onClose} aria-label="Đóng"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className="switch"><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span /></label>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Loading() { return <div className="empty"><Loader2 className="spin" size={18} /> Đang tải…</div>; }

/* Danh mục vật tư (811 dòng) ít khi đổi → nhớ trong phiên để khỏi tải lại mỗi lần mở trang (đỡ tốn dữ liệu).
   Chỉ xóa bộ nhớ khi có thao tác sửa danh mục / mức tối thiểu, hoặc khi đổi người dùng. */
const CACHED_FNS = new Set(['list_items']);
const CATALOG_WRITES = new Set(['save_item', 'save_min_qty', 'update_item_basic', 'set_item_conversion']);
const rpcCache = new Map<string, Promise<unknown>>();
export const clearRpcCache = () => rpcCache.clear();

/** Gọi RPC + tự tải lại khi refreshKey đổi */
export function useRpc<T>(fn: string | null, p: Record<string, unknown> = {}, deps: unknown[] = []) {
  const { backend, refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(p);
  const lastTick = useRef(tick);
  useEffect(() => {
    if (!fn) { setLoading(false); return; }
    let alive = true;
    const ck = fn + key;
    if (CACHED_FNS.has(fn) && lastTick.current !== tick) rpcCache.delete(ck); // bấm "tải lại" thì tải thật
    lastTick.current = tick;
    let req = CACHED_FNS.has(fn) ? rpcCache.get(ck) as Promise<T> | undefined : undefined;
    if (!req) {
      req = backend.rpc<T>(fn, JSON.parse(key));
      if (CACHED_FNS.has(fn)) { rpcCache.set(ck, req); req.catch(() => rpcCache.delete(ck)); }
      setLoading(true);
    }
    req.then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, key, refreshKey, tick, backend, ...deps]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Thực hiện thao tác ghi: báo lỗi/thành công qua toast */
export function useAction() {
  const { backend, toast, bump } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: string, p: Record<string, unknown>, okMsg?: string): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await backend.rpc<T>(fn, p);
      if (CATALOG_WRITES.has(fn)) clearRpcCache();
      if (okMsg) toast(okMsg, 'success');
      bump(fn);
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally { setBusy(false); }
  }, [backend, toast, bump]);
  return { run, busy };
}

export type PickItem = { id: number; code: string; name: string; unit: string; group_name: string | null; extra?: ReactNode };

/** Ô chọn vật tư có tìm kiếm (gõ không dấu cũng được) */
export function ItemPicker({ items, value, onChange, placeholder = 'Tìm vật tư…', exclude = [] }: {
  items: PickItem[]; value: number | null; onChange: (id: number) => void; placeholder?: string; exclude?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const selected = items.find(i => i.id === value);
  const list = useMemo(() => {
    const n = norm(q.trim());
    return items.filter(i => !exclude.includes(i.id) || i.id === value)
      .filter(i => !n || norm(i.name).includes(n) || norm(i.code).includes(n)).slice(0, 80);
  }, [items, q, exclude, value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (id: number) => { onChange(id); setOpen(false); setQ(''); };
  // Danh sách gợi ý dùng vị trí cố định theo màn hình → không bị bảng / popup có thanh cuộn che mất
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return;
      const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
      const width = Math.min(Math.max(r.width, 340), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos(below >= 220 || below >= above
        ? { left, top: r.bottom + 4, width, maxH: Math.min(320, below) }
        : { left, bottom: window.innerHeight - r.top + 4, width, maxH: Math.min(320, above) });
    };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  let lastGroup: string | null | undefined;
  return (
    <div className="combo" ref={ref}>
      <input className="input sm" style={{ width: '100%' }}
        value={open ? q : selected ? `${selected.name}` : ''}
        placeholder={selected ? selected.name : placeholder}
        onFocus={() => { setOpen(true); setHl(0); }}
        onChange={e => { setQ(e.target.value); setOpen(true); setHl(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && list[hl]) { e.preventDefault(); pick(list[hl].id); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && pos && (
        <div className="combo-list" style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, right: 'auto', width: pos.width, maxHeight: pos.maxH, zIndex: 400 }}>
          {list.length === 0 && <div className="empty small">Không tìm thấy vật tư</div>}
          {list.map((i, idx) => {
            const head = i.group_name !== lastGroup ? <div className="grp">{i.group_name ?? 'Khác'}</div> : null;
            lastGroup = i.group_name;
            return (
              <div key={i.id}>{head}
                <button type="button" className={idx === hl ? 'hl' : ''} onMouseDown={e => e.preventDefault()} onClick={() => pick(i.id)}>
                  <span><b>{i.name}</b> <span className="item-code">{i.code}</span></span>
                  <span className="muted small nowrap">{i.extra ?? i.unit}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Hộp nhập lý do (thay cho window.prompt) */
export function ReasonModal({ title, label, required = true, confirmText, tone = 'primary', onClose, onConfirm, busy, children }: {
  title: string; label: string; required?: boolean; confirmText: string; tone?: 'primary' | 'danger' | 'success';
  onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean; children?: ReactNode;
}) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose} size="narrow" footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className={`btn ${tone === 'danger' ? 'btn-danger' : tone === 'success' ? 'btn-success' : 'btn-primary'}`}
        disabled={busy || (required && !v.trim())} onClick={() => onConfirm(v.trim())}>{confirmText}</button>
    </>}>
      {children}
      <Field label={label}><textarea className="input" value={v} onChange={e => setV(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

export function BranchSelect({ value, onChange, includeAll, onlyActable, className = 'select sm' }: {
  value: number | null | ''; onChange: (v: number | null) => void; includeAll?: string; onlyActable?: boolean; className?: string;
}) {
  const { branches, canAct } = useApp();
  return (
    <select className={className} value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
      {includeAll && <option value="">{includeAll}</option>}
      {branches.filter(b => !onlyActable || canAct(b.id)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

/* ---------------- Phân trang dùng chung: 10 / 20 / 50 / 100 dòng, nhớ lựa chọn cho cả hệ thống ---------------- */
const PAGE_SIZES = [10, 20, 50, 100] as const;
const SIZE_KEY = 'kho-page-size-v2'; // đổi tên khóa để mọi máy về mặc định 10 dòng
const readSize = () => { try { const n = Number(localStorage.getItem(SIZE_KEY)); return (PAGE_SIZES as readonly number[]).includes(n) ? n : 10; } catch { return 10; } };
let sharedSize = readSize();
const sizeListeners = new Set<(n: number) => void>();
function setSharedSize(n: number) {
  sharedSize = n;
  try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* trình duyệt chặn lưu → chỉ áp dụng phiên này */ }
  sizeListeners.forEach(f => f(n));
}

/** Chia `rows` thành trang. Về trang 1 khi `resetKey` đổi (bộ lọc, tìm kiếm…); mặc định theo số dòng. */
export function usePaged<T>(rows: readonly T[], resetKey?: unknown) {
  const [size, setSize] = useState(sharedSize);
  const [page, setPage] = useState(1);
  useEffect(() => { sizeListeners.add(setSize); return () => { sizeListeners.delete(setSize); }; }, []);
  const rk = resetKey === undefined ? rows.length : JSON.stringify(resetKey);
  useEffect(() => { setPage(1); }, [rk, size]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages);
  const shown = useMemo(() => rows.slice((cur - 1) * size, cur * size), [rows, cur, size]);
  const pager = rows.length > PAGE_SIZES[0]
    ? <Pager total={rows.length} page={cur} pages={pages} size={size} onPage={setPage} />
    : null;
  return { shown, pager };
}

function Pager({ total, page, pages, size, onPage }: { total: number; page: number; pages: number; size: number; onPage: (p: number) => void }) {
  const from = (page - 1) * size + 1, to = Math.min(total, page * size);
  return (
    <div className="pager">
      <label className="small muted">Hiển thị{' '}
        <select className="select sm" value={size} onChange={e => setSharedSize(Number(e.target.value))}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>{' '}dòng
      </label>
      <span className="small muted">{from}–{to} / {total}</span>
      <span className="spacer" />
      <button className="btn btn-sm icon-only" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước"><ChevronLeft size={16} /></button>
      <select className="select sm" value={page} onChange={e => onPage(Number(e.target.value))} aria-label="Chọn trang">
        {Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}/{pages}</option>)}
      </select>
      <button className="btn btn-sm icon-only" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau"><ChevronRight size={16} /></button>
    </div>
  );
}

/* ---------------- Cột bộ lọc bên trái (kiểu trang Hàng hóa) ---------------- */
export function FilterPanel({ active, onClear, children }: { active: number; onClear: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`filters${open ? ' open' : ''}`}>
      <button type="button" className="filters-toggle btn btn-sm" onClick={() => setOpen(o => !o)}>
        Bộ lọc{active > 0 && <em>{active}</em>}<ChevronRight size={14} className="chev" />
      </button>
      <div className="filters-body">
        {children}
        {active > 0 && <button type="button" className="btn btn-sm btn-ghost filters-clear" onClick={onClear}>Xóa bộ lọc</button>}
      </div>
    </aside>
  );
}

export function FilterBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="filter-block"><h3>{title}</h3>{children}</div>;
}

/** Danh sách nhóm hàng có số lượng, bấm để lọc (thay cho chia tab theo nhóm) */
export function GroupList({ groups, counts, value, onChange }: {
  groups: { id: number; name: string }[]; counts: Map<number | null, number>; value: number | ''; onChange: (v: number | '') => void;
}) {
  const [q, setQ] = useState('');
  const n = norm(q.trim());
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const shown = groups.filter(g => (counts.get(g.id) ?? 0) > 0 && (!n || norm(g.name).includes(n)));
  return (
    <div className="group-list">
      {groups.length > 8 && <input className="input sm" placeholder="Tìm nhóm…" value={q} onChange={e => setQ(e.target.value)} />}
      <ul>
        <li className={value === '' ? 'active' : ''} onClick={() => onChange('')}><span>Tất cả nhóm</span><em>{total}</em></li>
        {shown.map(g => (
          <li key={g.id} className={value === g.id ? 'active' : ''} onClick={() => onChange(value === g.id ? '' : g.id)}>
            <span>{g.name}</span><em>{counts.get(g.id)}</em>
          </li>
        ))}
        {(counts.get(null) ?? 0) > 0 && !n && <li className="muted"><span>Chưa có nhóm</span><em>{counts.get(null)}</em></li>}
      </ul>
    </div>
  );
}

export function Chips<V extends string>({ value, options, onChange }: { value: V; options: readonly (readonly [V, string])[]; onChange: (v: V) => void }) {
  return (
    <div className="chips">
      {options.map(([v, l]) => <button type="button" key={v} className={`chip${value === v ? ' active' : ''}`} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}


/* ---------------- Đơn vị tính ---------------- */
export const UNIT_OPTIONS = ['cái', 'hộp', 'gói', 'sợi', 'vỉ', 'tuýp', 'lọ', 'chai', 'bộ', 'cuộn', 'ống', 'miếng', 'túi', 'cây', 'tấm', 'viên', 'đôi', 'bịch', 'can', 'thùng', 'ml', 'g', 'kg'];

/** Ô đơn vị: chọn trong danh sách (luôn hiện đủ) hoặc "Khác…" để gõ đơn vị mới. Gọi onCommit khi đổi. */
export function UnitInput({ value, onCommit, disabled, width = 84 }: { value: string; onCommit: (v: string) => void; disabled?: boolean; width?: number }) {
  const [typing, setTyping] = useState(false);
  const [v, setV] = useState('');
  const sent = useRef(false);
  const opts = UNIT_OPTIONS.includes(value) ? UNIT_OPTIONS : [value, ...UNIT_OPTIONS];
  const commit = () => { if (sent.current) return; sent.current = true; const t = v.trim(); setTyping(false); if (t && t !== value) onCommit(t); };
  if (typing) return (
    <input className="input sm" style={{ width }} value={v} autoFocus placeholder="gõ đơn vị" disabled={disabled}
      onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { sent.current = true; setTyping(false); } }} />);
  return (
    <select className="select sm" style={{ width }} value={value} disabled={disabled} title="Đổi đơn vị tính của vật tư (áp dụng cho cả danh mục)"
      onChange={e => { const t = e.target.value; if (t === '__other') { sent.current = false; setV(''); setTyping(true); } else if (t !== value) onCommit(t); }}>
      {opts.map(u => <option key={u} value={u}>{u}</option>)}
      <option value="__other">Khác…</option>
    </select>);
}

/** Đơn vị 2 cấp của từng vật tư (lấy từ danh mục đã nhớ trong phiên) → định dạng "1 hộp 1 sợi" */
function useUnitMap() {
  const items = useRpc<Item[]>('list_items');
  return useMemo(() => new Map((items.data ?? []).map(i => [i.id, i as UnitInfo])), [items.data]);
}
export function useUnits() {
  const map = useUnitMap();
  return useCallback((qty: number | string | null | undefined, item: number | UnitInfo | null | undefined, fallbackUnit?: string, opts?: { sign?: boolean; bare?: boolean }) => {
    const fb = fallbackUnit ? { unit: fallbackUnit } : null;
    const u = typeof item === 'number' ? map.get(item) ?? fb : item ?? fb;
    return fmtUnits(qty, u, opts);
  }, [map]);
}

/** Ô số lượng theo vật tư (tự tra quy đổi trong danh mục): 2 ô hộp/sợi hoặc 1 ô + tên đơn vị */
export function ItemQtyInput({ itemId, unit, value, onChange, bad, max, showUnit }: { itemId: number | null | undefined; unit?: string; value: string; onChange: (v: string) => void; bad?: boolean; max?: number; showUnit?: boolean }) {
  const map = useUnitMap();
  const u = itemId ? map.get(itemId) ?? (unit ? { unit } : null) : null;
  if (hasPack(u)) return <QtyInput value={value} onChange={onChange} unit={u} bad={bad} max={max} />;
  const box = <input className="input sm num" type="number" min={0} max={max} step="any" value={value} onChange={e => onChange(e.target.value)}
    style={{ width: 80, textAlign: 'right', ...(bad ? { borderColor: 'var(--td-danger)' } : {}) }} />;
  return showUnit ? <span className="nowrap">{box} <span className="muted small">{u?.unit ?? unit ?? ''}</span></span> : box;
}

/** Ô "Đơn vị" của một dòng phiếu: luôn hiện sẵn ô (chưa chọn vật tư thì để trống).
    Vật tư có quy đổi: ghi "1 hộp = 10 sợi". Người sửa được danh mục: đổi đơn vị ngay tại đây. */
export function UnitCell({ itemId, unit }: { itemId: number | null | undefined; unit?: string }) {
  const { has } = useApp();
  const map = useUnitMap();
  const { run, busy } = useAction();
  const it = itemId ? map.get(itemId) as (UnitInfo & { id?: number; name?: string }) | undefined : undefined;
  const u = it ?? (itemId && unit ? { unit } : null);
  if (!u) return <select className="select sm unit-box" disabled aria-label="Đơn vị"><option /></select>;
  if (hasPack(u)) return <span className="small muted nowrap">1 {u.purchase_unit} = {fmtQty(u.purchase_factor)} {u.unit}</span>;
  if (it && has('inv_catalog_manage')) return <UnitInput value={u.unit} disabled={busy}
    onCommit={v => void run('update_item_basic', { id: itemId, unit: v }, `Đã đổi đơn vị “${it.name ?? ''}”: ${u.unit} → ${v}`)} />;
  return <select className="select sm unit-box" disabled value={u.unit} aria-label="Đơn vị"><option value={u.unit}>{u.unit}</option></select>;
}

/** Ô số lượng: vật tư có quy đổi thì hiện 2 ô [__] hộp [__] sợi, giá trị luôn là tổng theo đơn vị nhỏ. */
export function QtyInput({ value, onChange, unit, placeholder, disabled, max, width = 72, autoFocus, bad }: {
  value: string; onChange: (v: string) => void; unit?: UnitInfo | null; placeholder?: string; disabled?: boolean; max?: number; width?: number; autoFocus?: boolean; bad?: boolean;
}) {
  const st = bad ? { borderColor: 'var(--td-danger)' } : undefined;
  const pack = hasPack(unit);
  const f = pack ? Number(unit.purchase_factor) : 1;
  const split = (v: string): [string, string] => {
    if (v === '' || !pack) return ['', v];
    const [w, r] = splitPack(Number(v), f);
    return [w ? String(w) : '', r ? String(r) : (w ? '' : '0')];
  };
  const [parts, setParts] = useState<[string, string]>(() => split(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setParts(split(value)); } }, [value, f]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pack) return (
    <input className="input sm num" type="number" min={0} max={max} step="any" style={{ width, ...st }} value={value} placeholder={placeholder}
      disabled={disabled} autoFocus={autoFocus} onChange={e => { last.current = e.target.value; onChange(e.target.value); }} />);
  const emit = (p: [string, string]) => {
    setParts(p);
    const v = p[0] === '' && p[1] === '' ? '' : String(Math.round((Number(p[0] || 0) * f + Number(p[1] || 0)) * 100) / 100);
    last.current = v; onChange(v);
  };
  return (
    <span className="qty-pack" title={`1 ${unit.purchase_unit} = ${fmtQty(f)} ${unit.unit} — điền ô nào cũng được, tự cộng lại`}>
      <input className="input sm num" type="number" min={0} step={1} value={parts[0]} disabled={disabled} autoFocus={autoFocus} style={st}
        placeholder={placeholder ? '0' : ''} onChange={e => emit([e.target.value, parts[1]])} />
      <span className="qp-u">{unit.purchase_unit}</span>
      <input className="input sm num" type="number" min={0} step="any" value={parts[1]} disabled={disabled} style={st}
        placeholder={placeholder ? '0' : ''} onChange={e => emit([parts[0], e.target.value])}
        onBlur={() => { if (Number(parts[1]) >= f) setParts(split(last.current)); }} />
      <span className="qp-u">{unit.unit}</span>
    </span>);
}

/* ---------------- Lưu tạm phiếu đang nhập dở (chỉ trên máy này) ---------------- */
type Draft<T> = { at: string; data: T };
export function readDraft<T>(key: string): T | null { try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as Draft<T>).data : null; } catch { return null; } }
export function useFormDraft<T>(key: string, data: T, isEmpty: (d: T) => boolean) {
  const read = (): Draft<T> | null => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as Draft<T> : null; } catch { return null; } };
  const [saved, setSaved] = useState<Draft<T> | null>(read);
  useEffect(() => { setSaved(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tự lưu sau mỗi lần sửa (chờ 0,8 giây) để lỡ tải lại trang / mất mạng cũng không mất
  useEffect(() => {
    if (isEmpty(data)) return;
    const t = window.setTimeout(() => {
      const d = { at: new Date().toISOString(), data };
      try { localStorage.setItem(key, JSON.stringify(d)); setSaved(d); } catch { /* bộ nhớ trình duyệt bị chặn */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [key, JSON.stringify(data)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => { const d = { at: new Date().toISOString(), data }; try { localStorage.setItem(key, JSON.stringify(d)); setSaved(d); return true; } catch { return false; } };
  const clear = () => { try { localStorage.removeItem(key); } catch { /* ignore */ } setSaved(null); };
  return { saved, save, clear };
}
