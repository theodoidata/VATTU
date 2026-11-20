import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { EXPIRY_LEVEL, STOCK_LEVEL, expiryLevel, fmtDate, norm, stockLevel } from '../lib/format';

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

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
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

/** Gọi RPC + tự tải lại khi refreshKey đổi */
export function useRpc<T>(fn: string | null, p: Record<string, unknown> = {}, deps: unknown[] = []) {
  const { backend, refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(p);
  useEffect(() => {
    if (!fn) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    backend.rpc<T>(fn, JSON.parse(key)).then(d => { if (alive) { setData(d); setError(null); } })
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
      if (okMsg) toast(okMsg, 'success');
      bump();
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
      {open && (
        <div className="combo-list">
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
