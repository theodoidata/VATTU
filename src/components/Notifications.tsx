import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { fmtDateTime } from '../lib/format';

/** Một dòng thông báo: "task" = việc đang chờ mình xử lý, "update" = cập nhật liên quan đến chi nhánh mình */
export type Noti = {
  key: string; kind: 'task' | 'update'; page: string; title: string; sub: string; at?: string | null;
  transferId?: number; stocktakeId?: number;
};

const readKey = (uid: string) => `kho-noti-read-${uid}`;
function loadRead(uid: string): string[] { try { return JSON.parse(localStorage.getItem(readKey(uid)) ?? '[]') as string[]; } catch { return []; } }
function saveRead(uid: string, keys: string[]) { try { localStorage.setItem(readKey(uid), JSON.stringify(keys.slice(-300))); } catch { /* bộ nhớ trình duyệt bị chặn */ } }

/** Chuông thông báo: số đỏ = số thông báo chưa đọc; khung Thông báo có tab Tất cả / Cần xử lý / Cập nhật */
export function NotiBell({ uid, items, onOpen }: { uid: string; items: Noti[]; onOpen: (n: Noti) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'task' | 'update'>('all');
  const [read, setRead] = useState<string[]>(() => loadRead(uid));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setRead(loadRead(uid)); }, [uid]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const isRead = (n: Noti) => read.includes(n.key);
  const unread = items.filter(n => !isRead(n)).length;
  const mark = (keys: string[]) => { const next = [...new Set([...read, ...keys])]; setRead(next); saveRead(uid, next); };
  const shown = items.filter(n => tab === 'all' || n.kind === tab);
  const nTask = items.filter(n => n.kind === 'task').length;
  return (
    <div className="user-menu" ref={ref}>
      <button className="round-btn" onClick={() => setOpen(o => !o)} aria-label="Thông báo" aria-expanded={open}
        title={unread ? `${unread} thông báo chưa đọc` : 'Thông báo'}>
        <Bell size={17} />{unread > 0 && <em>{unread}</em>}</button>
      {open && <div className="user-pop noti-pop">
        <div className="noti-head">
          <b>Thông báo</b>
          <span className="spacer" />
          <small>{unread} chưa đọc</small>
          <button className="link-btn" disabled={!unread} onClick={() => mark(items.map(n => n.key))}>Đã đọc tất cả</button>
        </div>
        <div className="noti-tabs">
          {([['all', 'Tất cả'], ['task', `Cần xử lý${nTask ? ` (${nTask})` : ''}`], ['update', 'Cập nhật']] as const).map(([k, l]) =>
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {shown.length === 0 ? <div className="noti-empty">Chưa có thông báo phù hợp.</div> : (
          <ul>{shown.map(n => (
            <li key={n.key} className={isRead(n) ? '' : 'unread'}>
              <button onClick={() => { mark([n.key]); setOpen(false); onOpen(n); }}>
                <span className="noti-title">{n.kind === 'task' && <i className="noti-tag">Cần xử lý</i>}{n.title}</span>
                <small>{n.sub}</small>
                {n.at && <small className="muted">{fmtDateTime(n.at)}</small>}
              </button>
            </li>))}</ul>
        )}
      </div>}
    </div>
  );
}
