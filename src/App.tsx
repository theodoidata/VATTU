import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  LayoutDashboard, Boxes, PackageMinus, PackagePlus, ArrowRightLeft, ClipboardCheck, BarChart3,
  BookOpen, ShieldCheck, LogOut, Loader2, CircleHelp, CircleUserRound,
} from 'lucide-react';
import { DEMO_USERS, demoBackend, preloadDemo, supabase, supabaseBackend, supabaseConfigured, type Backend } from './lib/backend';
import { Ctx, type AppCtx } from './lib/app-context';
import { clearRpcCache } from './components/ui';
import { handoff } from './lib/handoff';
import { GuideModal, ProfileModal, RoleGuideModal } from './pages/Account';
import { NotiBell, type Noti } from './components/Notifications';
import type { Session, Stocktake, Transfer } from './lib/types';
import Dashboard from './pages/Dashboard';
import StockPage from './pages/Stock';
import UsagePage from './pages/Usage';
import ReceiptPage from './pages/Receipt';
import TransfersPage, { transferNeedsMe } from './pages/Transfers';
import StocktakePage from './pages/Stocktake';
import ReportsPage from './pages/Reports';
import CatalogPage from './pages/Catalog';
import AdminPage from './pages/Admin';

type PageDef = { key: string; label: string; icon: typeof Boxes; perms: string[]; el: () => ReactNode };
const PAGES: PageDef[] = [
  { key: 'tong-quan',   label: 'Tổng quan',   icon: LayoutDashboard, perms: ['inv_stock_view'], el: () => <Dashboard /> },
  { key: 'ton-kho',     label: 'Tồn kho',     icon: Boxes,           perms: ['inv_stock_view'], el: () => <StockPage /> },
  { key: 'xuat-dung',   label: 'Xuất dùng',   icon: PackageMinus,    perms: ['inv_usage_create'], el: () => <UsagePage /> },
  { key: 'nhap-kho',    label: 'Nhập kho',    icon: PackagePlus,     perms: ['inv_receipt_create'], el: () => <ReceiptPage /> },
  { key: 'dieu-chuyen', label: 'Điều chuyển', icon: ArrowRightLeft,  perms: ['inv_transfer_request', 'inv_transfer_approve', 'inv_transfer_ship', 'inv_transfer_receive'], el: () => <TransfersPage /> },
  { key: 'kiem-ke',     label: 'Kiểm kê',     icon: ClipboardCheck,  perms: ['inv_stocktake_count', 'inv_stocktake_approve'], el: () => <StocktakePage /> },
  { key: 'bao-cao',     label: 'Báo cáo',     icon: BarChart3,       perms: ['inv_report_view'], el: () => <ReportsPage /> },
  { key: 'danh-muc',    label: 'Danh mục',    icon: BookOpen,        perms: ['inv_catalog_manage', 'inv_min_manage'], el: () => <CatalogPage /> },
  { key: 'quan-tri',    label: 'Nhân sự & Phân quyền', icon: ShieldCheck, perms: ['admin_users', 'admin_permissions'], el: () => <AdminPage /> },
];

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export default function App() {
  const [mode, setMode] = useState<'loading' | 'login' | 'supabase' | 'demo'>('loading');
  const [demoUid, setDemoUid] = useState(store.get('demo-uid') || DEMO_USERS[0].id);
  const demoUidRef = useRef(demoUid);
  demoUidRef.current = demoUid;

  useEffect(() => {
    if (store.get('mode') === 'demo') { setMode('demo'); return; }
    if (!supabase) { setMode('login'); return; }
    supabase.auth.getSession().then(({ data }) => setMode(data.session ? 'supabase' : 'login'));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (store.get('mode') === 'demo') return;
      setMode(s ? 'supabase' : 'login');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const backend = useMemo<Backend | null>(() => {
    if (mode === 'demo') return demoBackend(() => demoUidRef.current);
    if (mode === 'supabase') return supabaseBackend;
    return null;
  }, [mode]);

  const enterDemo = () => { store.set('mode', 'demo'); setMode('demo'); };
  const signOut = async () => {
    if (mode === 'demo') { store.del('mode'); setMode('login'); return; }
    await supabase?.auth.signOut();
    setMode('login');
  };

  if (mode === 'loading') return <div className="loading"><Loader2 className="spin" /></div>;
  if (mode === 'login' || !backend) return <Login onDemo={enterDemo} />;
  return (
    <Shell key={mode + demoUid} backend={backend} onSignOut={signOut}
      demo={mode === 'demo' ? { uid: demoUid, setUid: (id: string) => { store.set('demo-uid', id); setDemoUid(id); } } : null} />
  );
}

function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ t: string; tone: 'danger' | 'info' } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { preloadDemo(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg({ t: /invalid/i.test(error.message) ? 'Email hoặc mật khẩu không đúng.' : error.message, tone: 'danger' });
  }
  async function forgot() {
    if (!supabase) return;
    if (!email.trim()) { setMsg({ t: 'Nhập email trước, rồi bấm "Quên mật khẩu?".', tone: 'info' }); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setMsg(error ? { t: error.message, tone: 'danger' } : { t: 'Đã gửi email đặt lại mật khẩu.', tone: 'info' });
  }
  return (
    <div className="login-shell">
      <div className="login-card">
        <img className="login-brand" src="/logo.png" alt="THEODOIVATTU — Theo dõi vật tư, quản lý hiệu quả" />
        {supabaseConfigured ? (
          <form onSubmit={submit}>
            <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Mật khẩu</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
            {msg && <div className={`notice ${msg.tone === 'danger' ? 'danger' : ''}`} style={{ margin: 0 }}>{msg.t}</div>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'center' }} onClick={forgot}>Quên mật khẩu?</button>
          </form>
        ) : (
          <div className="notice warning" style={{ marginTop: 16 }}>
            Chưa kết nối Supabase (thiếu biến VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Bạn vẫn có thể xem bản demo.
          </div>
        )}
        <div className="divider">HOẶC</div>
        <button className="btn" style={{ width: '100%' }} onClick={onDemo}>Xem giao diện demo</button>
        <p className="muted small" style={{ textAlign: 'center', marginBottom: 0 }}>Demo dùng dữ liệu mẫu, chạy ngay trên trình duyệt.</p>
      </div>
    </div>
  );
}

function Shell({ backend, onSignOut, demo }: { backend: Backend; onSignOut: () => void; demo: { uid: string; setUid: (id: string) => void } | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ msg: string; tone: string } | null>(null);
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'tong-quan');
  const [branchId, setBranchIdState] = useState<number>(0);
  const [inbox, setInbox] = useState(0);
  const [notis, setNotis] = useState<Noti[]>([]);
  const [navKey, setNavKey] = useState(0);
  const [dialog, setDialog] = useState<'profile' | 'guide' | 'rules' | null>(null);

  const [transferTick, setTransferTick] = useState(0);

  useEffect(() => {
    clearRpcCache();
    backend.rpc<Session>('get_session').then(s => {
      setSession(s);
      const saved = Number(store.get('branch-' + (s.profile?.id ?? '')));
      const all = s.permissions.some(p => ['inv_stock_view_all', 'inv_all_branches', 'inv_report_view_all'].includes(p));
      const def = s.profile?.branch_id ?? s.branches[0]?.id ?? 1;
      setBranchIdState(all && saved && s.branches.some(b => b.id === saved) ? saved : def);
    }).catch(e => setError((e as Error).message));
  }, [backend]);

  useEffect(() => {
    const h = () => setPage(window.location.hash.slice(1) || 'tong-quan');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const toast = useCallback((msg: string, tone: 'success' | 'danger' | 'info' = 'info') => {
    setToastMsg({ msg, tone });
    window.setTimeout(() => setToastMsg(t => (t?.msg === msg ? null : t)), tone === 'danger' ? 6000 : 3000);
  }, []);

  const ctx = useMemo<AppCtx | null>(() => {
    if (!session?.profile?.active) return null;
    const perms = new Set(session.permissions);
    const has = (p: string) => perms.has(p);
    const canAct = (b: number) => has('inv_all_branches') || session.profile?.branch_id === b;
    return {
      backend, session, has, branches: session.branches, groups: session.groups, today: session.today,
      branchId, setBranchId: (id: number) => { store.set('branch-' + session.profile!.id, String(id)); setBranchIdState(id); },
      canAct, canViewAll: has('inv_stock_view_all') || has('inv_all_branches') || has('inv_report_view_all'),
      toast, refreshKey,
      bump: (fn?: string) => { setRefreshKey(k => k + 1); if (!fn || fn.includes('transfer') || fn.includes('stocktake')) setTransferTick(t => t + 1); },
      go: (p: string) => { window.location.hash = p; },
    };
  }, [session, backend, branchId, toast, refreshKey]);

  // Việc đang chờ mình xử lý: phiếu điều chuyển (duyệt / gửi / nhận) + phiếu kiểm kê chờ chốt
  useEffect(() => {
    if (!ctx) return;
    const canSee = ['inv_transfer_request', 'inv_transfer_approve', 'inv_transfer_ship', 'inv_transfer_receive'].some(ctx.has);
    const STEP: Record<string, string> = { pending: 'Duyệt yêu cầu', approved: 'Gửi hàng', shipped: 'Xác nhận đã nhận' };
    const tr: Promise<Noti[]> = canSee
      ? backend.rpc<Transfer[]>('list_transfers', { status: ['pending', 'approved', 'shipped'] })
        .then(l => l.filter(t => transferNeedsMe(t, ctx)).map(t => ({
          key: `t${t.id}-${t.status}`, kind: 'task' as const, page: 'dieu-chuyen', transferId: t.id,
          at: t.shipped_at ?? t.approved_at ?? t.requested_at,
          title: `${STEP[t.status]} · ${t.code}`,
          sub: `${t.to_branch_name} ← ${t.from_branch_name} · ${t.lines.length} vật tư`,
        }))).catch(() => [])
      : Promise.resolve([]);
    const st: Promise<Noti[]> = ctx.has('inv_stocktake_approve') && ctx.canAct(branchId)
      ? backend.rpc<Stocktake[]>('list_stocktakes', { branch_id: branchId })
        .then(l => l.filter(s => s.status === 'submitted').map(s => ({
          key: `s${s.id}-submitted`, kind: 'task' as const, page: 'kiem-ke', stocktakeId: s.id, at: s.submitted_at,
          title: `Chốt kiểm kê #${s.id}`, sub: `${s.branch_name} · ${s.group_name ?? 'Toàn bộ vật tư'}${s.submitted_by_name ? ' · nộp bởi ' + s.submitted_by_name : ''}`,
        }))).catch(() => [])
      : Promise.resolve([]);
    // Cập nhật điều chuyển của chi nhánh mình trong 30 ngày (bên kia đã duyệt / gửi / nhận / từ chối / hủy)
    const mine = (b: number) => session?.profile?.branch_id === b || (ctx.has('inv_all_branches') && b === branchId);
    const up: Promise<Noti[]> = canSee
      ? backend.rpc<Transfer[]>('list_transfers', { status: ['approved', 'shipped', 'received', 'rejected', 'cancelled'], from: addDaysISO(session?.today ?? new Date().toISOString(), -30), limit: 40 })
        .then(l => l.flatMap((t): Noti[] => {
          if (transferNeedsMe(t, ctx)) return [];
          const base = { kind: 'update' as const, page: 'dieu-chuyen', transferId: t.id, key: `u${t.id}-${t.status}` };
          const sub = `${t.to_branch_name} ← ${t.from_branch_name} · ${t.lines.length} vật tư`;
          if (t.status === 'approved' && mine(t.to_branch_id)) return [{ ...base, title: `${t.from_branch_name} đã duyệt yêu cầu ${t.code}`, sub, at: t.approved_at }];
          if (t.status === 'shipped' && mine(t.to_branch_id)) return [{ ...base, title: `${t.from_branch_name} đã gửi hàng ${t.code}`, sub, at: t.shipped_at }];
          if (t.status === 'received' && mine(t.from_branch_id)) return [{ ...base, title: `${t.to_branch_name} đã nhận hàng ${t.code}${t.has_shortage ? ' (nhận thiếu)' : ''}`, sub, at: t.received_at }];
          if (t.status === 'rejected' && mine(t.to_branch_id)) return [{ ...base, title: `${t.from_branch_name} từ chối yêu cầu ${t.code}`, sub: t.reject_reason ? `Lý do: ${t.reject_reason}` : sub, at: t.closed_at }];
          if (t.status === 'cancelled' && mine(t.from_branch_id)) return [{ ...base, title: `${t.to_branch_name} đã hủy yêu cầu ${t.code}`, sub, at: t.closed_at }];
          return [];
        })).catch(() => [])
      : Promise.resolve([]);
    void Promise.all([tr, st, up]).then(([a, b, c]) => {
      const byTime = (x: Noti, y: Noti) => String(y.at ?? '').localeCompare(String(x.at ?? ''));
      setNotis([...[...a, ...b].sort(byTime), ...c.sort(byTime)]); setInbox(a.length);
    });
    // Chỉ đếm lại khi mở web, đổi chi nhánh hoặc vừa thao tác điều chuyển — không tải lại sau mọi thao tác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, backend, branchId, transferTick]);

  const demoBar = demo && (
    <div className="demo-bar">
      CHẾ ĐỘ DEMO · Đang xem với vai trò:
      <select value={demo.uid} onChange={e => demo.setUid(e.target.value)}>
        {DEMO_USERS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select>
      <span style={{ fontWeight: 400 }}>Dữ liệu mẫu, tải lại trang sẽ khôi phục ban đầu.</span>
    </div>
  );

  if (error) return <div className="login-shell"><div className="login-card"><div className="notice danger">{error}</div><button className="btn" onClick={onSignOut}>Đăng xuất</button></div></div>;
  if (!session) return <div className="loading"><div><Loader2 className="spin" /> {demo ? 'Đang chuẩn bị dữ liệu demo…' : 'Đang tải…'}</div></div>;
  if (!session.profile || !session.profile.active || !ctx) {
    return (
      <div className="login-shell">{demoBar}
        <div className="login-card">
          <h1>Tài khoản chờ kích hoạt</h1>
          <p className="muted">{session.profile?.email}</p>
          <div className="notice warning">BGĐ cần vào <b>Nhân sự &amp; Phân quyền</b> để gán Bộ phận / Vị trí, chi nhánh và kích hoạt tài khoản của bạn.</div>
          <button className="btn" onClick={onSignOut}><LogOut size={16} /> Đăng xuất</button>
        </div>
      </div>
    );
  }

  const visible = PAGES.filter(p => p.perms.some(ctx.has));
  const current = visible.find(p => p.key === page) ?? visible[0];
  const me = session.profile;

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <div className="brand"><img src="/logo-white.png" alt="" /><div><b>THEODOIVATTU</b><span>THEO DÕI VẬT TƯ - QUẢN LÝ HIỆU QUẢ</span></div></div>
        <nav className="nav">
          {visible.map(p => (
            <button key={p.key} className={current?.key === p.key ? 'active' : ''} onClick={() => ctx.go(p.key)} title={p.label}>
              <p.icon size={16} /><span className="nav-label">{p.label}</span>{p.key === 'dieu-chuyen' && inbox > 0 && <em>{inbox}</em>}
            </button>
          ))}
        </nav>
        <div className="topbar-tools">
          {ctx.canViewAll ? (
            <select className="branch-pill" value={branchId} onChange={e => ctx.setBranchId(Number(e.target.value))} aria-label="Chi nhánh đang xem">
              {session.branches.map(b => <option key={b.id} value={b.id}>{branchLabel(b.name)}{b.id === me.branch_id ? ' (của tôi)' : ''}</option>)}
            </select>
          ) : <span className="branch-pill">{branchLabel(me.branch_name ?? '')}</span>}
          <button className="round-btn" title="Hướng dẫn sử dụng" aria-label="Hướng dẫn sử dụng" onClick={() => setDialog('rules')}><CircleHelp size={17} /></button>
          <NotiBell uid={me.id} items={notis} onOpen={t => {
            if (t.transferId) handoff.openTransferId = t.transferId;
            if (t.stocktakeId) handoff.openStocktakeId = t.stocktakeId;
            ctx.go(t.page); setNavKey(k => k + 1);
          }} />
          <UserMenu name={me.full_name} role={`${me.department_name ?? ''}${me.branch_name ? ' · ' + me.branch_name : ''}`}
            onProfile={() => setDialog('profile')} onGuide={() => setDialog('rules')} onSignOut={onSignOut} />
        </div>
      </header>
      {demoBar}
      <main className={`main ${demo ? 'with-demo' : ''}`}>
        {current ? <Fragment key={navKey}>{current.el()}</Fragment> : <div className="notice warning">Tài khoản của bạn chưa được bật quyền nào. Liên hệ BGĐ.</div>}
      </main>
      {dialog === 'profile' && <ProfileModal me={me} pages={visible.map(p => p.label)} demo={Boolean(demo)} onClose={() => setDialog(null)} />}
      {dialog === 'rules' && <RoleGuideModal me={me} onClose={() => setDialog(null)} onDetail={() => setDialog('guide')} />}
      {dialog === 'guide' && <GuideModal pages={['Tổng quan', ...visible.map(p => p.label)]} onClose={() => setDialog(null)} />}
      {toastMsg && <div className={`toast ${toastMsg.tone}`} onClick={() => setToastMsg(null)}>{toastMsg.msg}</div>}
    </Ctx.Provider>
  );
}

/** Nút tài khoản: bấm mở khung Tên, Vị trí, Trang cá nhân, Hướng dẫn sử dụng, Đăng xuất */
function UserMenu({ name, role, onProfile, onGuide, onSignOut }: { name: string; role: string; onProfile: () => void; onGuide: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="user-menu" ref={ref}>
      <button className="round-btn" onClick={() => setOpen(o => !o)} title={name} aria-label="Tài khoản" aria-expanded={open}><CircleUserRound size={18} /></button>
      {open && <div className="user-pop menu-pop">
        <div className="menu-head"><b>{name}</b><span>{role}</span></div>
        <hr />
        <button className="menu-item" onClick={() => { setOpen(false); onProfile(); }}>Trang cá nhân</button>
        <button className="menu-item" onClick={() => { setOpen(false); onGuide(); }}>Hướng dẫn sử dụng</button>
        <hr />
        <button className="menu-item danger" onClick={onSignOut}>Đăng xuất</button>
      </div>}
    </div>
  );
}

const addDaysISO = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10)) + n * 86400000).toISOString().slice(0, 10);

/** Kho tổng / Xưởng răng giữ nguyên tên, chi nhánh thường thêm "CN" */
function branchLabel(name: string) {
  return /^(kho|xưởng)/i.test(name) ? name : 'CN ' + name;
}
