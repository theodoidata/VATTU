import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, UserCog, Info } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, Empty, Field, Loading, Modal, PageHeader, Switch, useAction, useRpc, usePaged } from '../components/ui';
import { norm } from '../lib/format';
import type { Profile } from '../lib/types';

type Dept = { id: number; code: string; name: string; description: string | null; sort_order: number; active: boolean; user_count: number };
type Perm = { key: string; group_name: string; label: string; description: string | null; sort_order: number };
type PermData = { departments: Dept[]; permissions: Perm[]; matrix: { department_id: number; permission_key: string; enabled: boolean }[] };
type UserRow = Profile & { override_count: number };

export default function AdminPage() {
  const { has } = useApp();
  const [tab, setTab] = useState<'users' | 'perms'>(has('admin_users') ? 'users' : 'perms');
  return (
    <>
      <PageHeader title="Nhân sự & Phân quyền" description="Gán Bộ phận / Vị trí và chi nhánh cho từng nhân viên; bật / tắt quyền theo vị trí hoặc riêng từng người." />
      <section className="panel">
        <div className="tabs">
          {has('admin_users') && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Nhân sự</button>}
          {has('admin_permissions') && <button className={tab === 'perms' ? 'active' : ''} onClick={() => setTab('perms')}>Phân quyền theo Bộ phận / Vị trí</button>}
        </div>
        {tab === 'users' ? <Users /> : <DeptPerms />}
      </section>
    </>
  );
}

function Users() {
  const { branches, has, backend, session } = useApp();
  const users = useRpc<UserRow[]>('admin_list_users');
  const [depts, setDepts] = useState<Dept[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [permUser, setPermUser] = useState<UserRow | null>(null);
  useEffect(() => { backend.rpc<PermData>('admin_get_permissions').then(d => setDepts(d.departments)).catch(() => {}); }, [backend]);
  const rows = useMemo(() => { const n = norm(q.trim()); return (users.data ?? []).filter(u => !n || norm(u.full_name).includes(n) || norm(u.email ?? '').includes(n)); }, [users.data, q]);
  const pending = rows.filter(u => !u.active).length;
  const pg = usePaged(rows, q);
  return (
    <>
      <div className="notice"><Info size={14} style={{ verticalAlign: -2 }} /> <b>Thêm nhân viên:</b> vào Supabase → <b>Authentication → Users → Add user</b> (nhập email + mật khẩu, tick “Auto Confirm User”). Tài khoản sẽ hiện ở đây với trạng thái <i>Chờ kích hoạt</i> — bấm “Sửa” để gán vị trí, chi nhánh và kích hoạt.</div>
      <div className="toolbar"><input className="input" placeholder="Tìm nhân viên…" value={q} onChange={e => setQ(e.target.value)} />{pending > 0 && <Badge tone="warning">{pending} tài khoản chờ kích hoạt</Badge>}</div>
      {users.loading ? <Loading /> : users.error ? <div className="notice danger">{users.error}</div> : !rows.length ? <Empty>Chưa có nhân viên.</Empty> : (
        <><div className="table-wrap"><table className="data">
          <thead><tr><th>Nhân viên</th><th>Bộ phận / Vị trí</th><th>Chi nhánh</th><th>Trạng thái</th><th>Quyền riêng</th><th /></tr></thead>
          <tbody>{pg.shown.map(u => (
            <tr key={u.id}>
              <td><div className="item-name">{u.full_name || '(chưa đặt tên)'}{u.id === session.profile?.id && <> <Badge tone="primary">Bạn</Badge></>}</div><div className="item-code">{u.email}</div></td>
              <td>{u.department_name ?? <span className="muted">—</span>}</td>
              <td>{u.branch_name ?? <span className="muted">{u.department_name === 'BGĐ' ? 'Toàn hệ thống' : '—'}</span>}</td>
              <td>{u.active ? <Badge tone="success">Đang hoạt động</Badge> : <Badge tone="warning">Chờ kích hoạt / đã khóa</Badge>}</td>
              <td>{u.override_count ? <Badge tone="info">{u.override_count} quyền tùy chỉnh</Badge> : <span className="muted small">Theo vị trí</span>}</td>
              <td className="nowrap"><button className="btn btn-sm" onClick={() => setEditing(u)}>Sửa</button>{' '}
                {has('admin_permissions') && <button className="btn btn-sm" onClick={() => setPermUser(u)}><UserCog size={14} /> Quyền riêng</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>{pg.pager}</>
      )}
      {editing && <UserModal u={editing} depts={depts} branches={branches} onClose={() => setEditing(null)} />}
      {permUser && <UserPermModal u={permUser} onClose={() => setPermUser(null)} />}
    </>
  );
}

function UserModal({ u, depts, branches, onClose }: { u: UserRow; depts: Dept[]; branches: { id: number; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ full_name: u.full_name, department_id: u.department_id ?? '', branch_id: u.branch_id ?? '', active: u.active || !u.department_id });
  const { run, busy } = useAction();
  const dep = depts.find(d => d.id === Number(f.department_id));
  return (
    <Modal title="Thông tin nhân viên" size="narrow" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || (f.active && !f.department_id)} onClick={async () => {
        if (await run('admin_update_user', { id: u.id, ...f, department_id: f.department_id || null, branch_id: f.branch_id || null }, 'Đã lưu nhân viên')) onClose();
      }}>Lưu</button></>}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>{u.email}</p>
        <Field label="Họ tên"><input className="input" value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Bộ phận / Vị trí"><select className="select" value={f.department_id} onChange={e => setF({ ...f, department_id: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">— Chọn —</option>{depts.filter(d => d.active || d.id === u.department_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        {dep?.description && <p className="muted small" style={{ margin: 0 }}>{dep.description}</p>}
        <Field label="Chi nhánh làm việc"><select className="select" value={f.branch_id} onChange={e => setF({ ...f, branch_id: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">Không gắn chi nhánh (BGĐ / Kế toán)</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Kích hoạt tài khoản (bỏ chọn để khóa)</label>
        {!f.branch_id && dep && !['BGD', 'KETOAN'].includes(dep.code) && <div className="notice warning" style={{ margin: 0 }}>Nhân viên vị trí này cần được gắn chi nhánh để ghi xuất / nhập.</div>}
      </div>
    </Modal>
  );
}

type UPerm = { key: string; group_name: string; label: string; description: string | null; department_enabled: boolean; override: boolean | null; enabled: boolean };

function UserPermModal({ u, onClose }: { u: UserRow; onClose: () => void }) {
  const p = useRpc<UPerm[]>('admin_get_user_permissions', { user_id: u.id });
  const [ov, setOv] = useState<Record<string, boolean | null>>({});
  const { run, busy } = useAction();
  const rows = p.data ?? [];
  const cur = (r: UPerm) => (r.key in ov ? ov[r.key] : r.override);
  let last = '';
  return (
    <Modal title={`Quyền riêng của ${u.full_name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !Object.keys(ov).length} onClick={async () => {
        if (await run('admin_set_user_permissions', { user_id: u.id, overrides: Object.entries(ov).map(([key, enabled]) => ({ key, enabled })) }, 'Đã lưu quyền riêng')) onClose();
      }}><Save size={16} /> Lưu</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>Vị trí: <b>{u.department_name ?? '—'}</b>. Mặc định nhân viên dùng quyền của vị trí; chọn “Bật” / “Tắt” để ghi đè riêng cho người này.</p>
      {p.loading ? <Loading /> : rows.map(r => {
        const head = r.group_name !== last ? <div className="perm-group">{r.group_name}</div> : null; last = r.group_name;
        const c = cur(r);
        const eff = c == null ? r.department_enabled : c;
        return (
          <div key={r.key}>{head}
            <div className="perm-row">
              <div className="grow"><b>{r.label}</b><small>{c == null ? `Theo vị trí: ${r.department_enabled ? 'bật' : 'tắt'}` : 'Đã ghi đè riêng'}</small></div>
              <Badge tone={eff ? 'success' : 'muted'}>{eff ? 'Có quyền' : 'Không'}</Badge>
              <select className="select sm" value={c == null ? '' : c ? 'on' : 'off'} onChange={e => setOv(o => ({ ...o, [r.key]: e.target.value === '' ? null : e.target.value === 'on' }))}>
                <option value="">Theo vị trí</option><option value="on">Bật</option><option value="off">Tắt</option>
              </select>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function DeptPerms() {
  const p = useRpc<PermData>('admin_get_permissions');
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const { run, busy } = useAction();
  const data = p.data;
  const depId = sel ?? data?.departments[0]?.id ?? null;
  const dep = data?.departments.find(d => d.id === depId);
  const base = useMemo(() => Object.fromEntries((data?.matrix ?? []).filter(m => m.department_id === depId).map(m => [m.permission_key, m.enabled])), [data, depId]);
  useEffect(() => setDraft({}), [depId]);
  const val = (k: string) => (k in draft ? draft[k] : Boolean(base[k]));
  const dirty = Object.keys(draft).some(k => draft[k] !== Boolean(base[k]));
  let last = '';
  if (p.loading && !data) return <Loading />;
  if (p.error || !data) return <div className="notice danger">{p.error}</div>;
  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 3fr)' }}>
      <div className="dept-list">
        {data.departments.map(d => (
          <button key={d.id} className={d.id === depId ? 'active' : ''} onClick={() => setSel(d.id)}>
            <span><b>{d.name}</b><br /><span className="muted small">{d.user_count} nhân viên</span></span>
            {!d.active && <Badge>Chưa dùng</Badge>}
          </button>
        ))}
        <button onClick={() => setAdding(true)}><span className="row"><Plus size={15} /> Thêm vị trí</span></button>
      </div>
      <div>
        {dep && <>
          <div className="panel-head"><div><h2>{dep.name}</h2><span className="muted small">{dep.description}</span></div>
            <div className="row">
              <label className="check small">Đang sử dụng <Switch checked={dep.active} disabled={busy} onChange={v => void run('admin_save_department', { id: dep.id, name: dep.name, description: dep.description, active: v }, v ? 'Đã bật vị trí' : 'Đã tắt vị trí')} /></label>
              <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={async () => {
                if (await run('admin_set_department_permissions', { department_id: dep.id, permissions: Object.entries(draft).map(([key, enabled]) => ({ key, enabled })) }, `Đã lưu quyền cho ${dep.name}`)) setDraft({});
              }}><Save size={14} /> Lưu thay đổi</button>
            </div>
          </div>
          {data.permissions.map(pm => {
            const head = pm.group_name !== last ? <div className="perm-group">{pm.group_name}</div> : null; last = pm.group_name;
            return (
              <div key={pm.key}>{head}
                <div className="perm-row"><div className="grow"><b>{pm.label}</b>{pm.description && <small>{pm.description}</small>}</div>
                  <Switch checked={val(pm.key)} onChange={v => setDraft(d => ({ ...d, [pm.key]: v }))} /></div>
              </div>
            );
          })}
        </>}
      </div>
      {adding && <Modal title="Thêm Bộ phận / Vị trí" size="narrow" onClose={() => setAdding(false)} footer={<>
        <button className="btn" onClick={() => setAdding(false)}>Đóng</button>
        <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={async () => {
          const r = await run<{ id: number }>('admin_save_department', { name: newName, description: newDesc }, 'Đã thêm vị trí — hãy bật quyền cho vị trí này');
          if (r) { setAdding(false); setNewName(''); setNewDesc(''); setSel(r.id); }
        }}>Thêm</button></>}>
        <div className="stack">
          <Field label="Tên vị trí"><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="VD: Điều dưỡng" autoFocus /></Field>
          <Field label="Mô tả"><input className="input" value={newDesc} onChange={e => setNewDesc(e.target.value)} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
