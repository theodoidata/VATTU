import { useMemo, useState } from 'react';
import { Plus, Download, FolderPen } from 'lucide-react';
import { useApp } from '../lib/app-context';
import { Badge, Chips, Empty, Field, FilterBlock, FilterPanel, GroupList, Loading, Modal, PageHeader, useAction, useRpc, usePaged } from '../components/ui';
import { fmtQty, fmtUnits, norm } from '../lib/format';
import type { Item } from '../lib/types';
import { exportExcel, sheet } from '../lib/excel';

export default function CatalogPage() {
  const { groups, has, branches } = useApp();
  const list = useRpc<Item[]>('list_items');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number | ''>('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const canEdit = has('inv_catalog_manage');
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [lotSel, setLotSel] = useState<'all' | 'yes' | 'no'>('all');
  const [actSel, setActSel] = useState<'all' | 'on' | 'off'>('all');
  const [minSel, setMinSel] = useState<'all' | 'set' | 'none'>('all');
  const hasMin = (i: Item) => Number(i.default_min_qty) > 0 || Object.values(i.mins).some(v => Number(v) > 0);
  const rows = useMemo(() => {
    const n = norm(q.trim());
    return (list.data ?? []).filter(i => (!group || i.group_id === group) && (!n || norm(i.name).includes(n) || norm(i.code).includes(n))
      && (lotSel === 'all' || i.track_lot === (lotSel === 'yes'))
      && (actSel === 'all' || i.active === (actSel === 'on'))
      && (minSel === 'all' || hasMin(i) === (minSel === 'set')));
  }, [list.data, q, group, lotSel, actSel, minSel]);
  const pg = usePaged(rows, [q, group, lotSel, actSel, minSel]);
  const groupCounts = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const i of list.data ?? []) m.set(i.group_id, (m.get(i.group_id) ?? 0) + 1);
    return m;
  }, [list.data]);
  const activeFilters = [group !== '', lotSel !== 'all', actSel !== 'all', minSel !== 'all'].filter(Boolean).length;
  const clear = () => { setGroup(''); setLotSel('all'); setActSel('all'); setMinSel('all'); };
  const doExport = () => exportExcel('Danh-muc-vat-tu', [sheet('Danh mục', rows, [
    { header: 'Mã', get: i => i.code, width: 12 }, { header: 'Tên vật tư', get: i => i.name, width: 40 }, { header: 'Nhóm', get: i => i.group_name, width: 24 },
    { header: 'ĐV dùng', get: i => i.unit, width: 9 }, { header: 'ĐV nhập', get: i => i.purchase_unit ?? '', width: 9 }, { header: 'Quy đổi', get: i => Number(i.purchase_factor), width: 9 },
    { header: 'Quản lý lô/HSD', get: i => (i.track_lot ? 'Có' : 'Không'), width: 14 }, { header: 'Tối thiểu mặc định', get: i => Number(i.default_min_qty), width: 16 },
    ...branches.map(b => ({ header: 'Tối thiểu ' + b.name, get: (i: Item) => Number(i.mins[String(b.id)] ?? i.default_min_qty), width: 14 })),
    { header: 'Đang dùng', get: i => (i.active ? 'Có' : 'Ngưng'), width: 10 },
  ])]);
  return (
    <>
      <PageHeader title="Danh mục vật tư" description="Tên – đơn vị tính – nhóm – quản lý số lô/hạn dùng – tồn tối thiểu (mặc định và riêng từng chi nhánh)."
        actions={<>{has('inv_report_export') && <button className="btn" onClick={doExport}><Download size={16} /> Xuất Excel</button>}
          {has('inv_group_manage') && <button className="btn" onClick={() => setGroupsOpen(true)}><FolderPen size={16} /> Sửa tên nhóm</button>}
          {canEdit && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Thêm vật tư</button>}</>} />
      <div className="list-layout">
      <FilterPanel active={activeFilters} onClear={clear}>
        <FilterBlock title="Nhóm hàng"><GroupList groups={groups} counts={groupCounts} value={group} onChange={setGroup} /></FilterBlock>
        <FilterBlock title="Quản lý lô / HSD"><Chips value={lotSel} onChange={setLotSel} options={[['all', 'Tất cả'], ['yes', 'Có'], ['no', 'Không']] as const} /></FilterBlock>
        <FilterBlock title="Tồn tối thiểu"><Chips value={minSel} onChange={setMinSel} options={[['all', 'Tất cả'], ['set', 'Đã đặt'], ['none', 'Chưa đặt']] as const} /></FilterBlock>
        <FilterBlock title="Trạng thái"><Chips value={actSel} onChange={setActSel} options={[['all', 'Tất cả'], ['on', 'Đang dùng'], ['off', 'Ngưng dùng']] as const} /></FilterBlock>
      </FilterPanel>
      <section className="panel">
        <div className="toolbar">
          <input className="input" placeholder="Tìm theo mã, tên vật tư (gõ không dấu được)…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="muted small">{rows.length} vật tư</span>
        </div>
        {list.loading ? <Loading /> : list.error ? <div className="notice danger">{list.error}</div> : !rows.length ? <Empty>Chưa có vật tư.</Empty> : (
          <><div className="table-wrap cards-sm"><table className="data fixed-cols">
            <thead><tr><th style={{ width: 84 }}>Mã</th><th>Tên vật tư</th><th style={{ width: 120 }}>Nhóm</th><th style={{ width: 64 }}>ĐV dùng</th><th style={{ width: 96 }}>ĐV nhập</th><th style={{ width: 80 }}>Lô / HSD</th><th className="num" style={{ width: 96 }}>Tối thiểu mặc định</th><th style={{ width: 90 }}>Riêng chi nhánh</th></tr></thead>
            <tbody>{pg.shown.map(i => (
              <tr key={i.id} className="clickable" onClick={() => setEditing(i)} style={i.active ? undefined : { opacity: .5 }}>
                <td className="mono small">{i.code}</td><td className="item-name">{i.name}{!i.active && <> <Badge>Ngưng dùng</Badge></>}</td>
                <td className="small">{i.group_name}</td><td>{i.unit}</td>
                <td className="small">{i.purchase_unit ? `${i.purchase_unit} = ${fmtQty(i.purchase_factor)} ${i.unit}` : '—'}</td>
                <td>{i.track_lot ? <Badge tone="primary">Bắt buộc</Badge> : <span className="muted small">Không</span>}</td>
                <td className="num">{fmtUnits(i.default_min_qty, i, { bare: true })}</td>
                <td className="small">{Object.keys(i.mins).length ? `${Object.keys(i.mins).length} chi nhánh` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>{pg.pager}</>
        )}
      </section>
      </div>
      {groupsOpen && <GroupsModal counts={groupCounts} onClose={() => setGroupsOpen(false)} />}
      {editing && <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ItemModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { groups, has, branches, canAct, toast } = useApp();
  const canEdit = has('inv_catalog_manage');
  const canMin = has('inv_min_manage');
  const [f, setF] = useState(() => ({
    code: item?.code ?? '', name: item?.name ?? '', group_id: item?.group_id ?? groups[0]?.id ?? null, unit: item?.unit ?? '',
    purchase_unit: item?.purchase_unit ?? '', purchase_factor: String(item?.purchase_factor ?? 1), track_lot: item?.track_lot ?? false,
    default_min_qty: String(item?.default_min_qty ?? 0), note: item?.note ?? '', active: item?.active ?? true,
  }));
  const [mins, setMins] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(item?.mins ?? {}).map(([k, v]) => [k, String(v)])));
  const { run, busy } = useAction();
  const up = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));

  async function save() {
    let id = item?.id;
    if (canEdit) {
      const r = await run<{ id: number }>('save_item', { ...f, id: item?.id ?? null });
      if (!r) return;
      id = r.id;
    }
    if (canMin && id) {
      for (const b of branches) {
        if (!canAct(b.id)) continue;
        const before = item?.mins[String(b.id)];
        const now = mins[String(b.id)];
        const changed = (before == null ? '' : String(before)) !== (now ?? '');
        if (changed && !(await run('save_min_qty', { item_id: id, branch_id: b.id, min_qty: now === '' || now == null ? null : Number(now) }))) return;
      }
    }
    toast('Đã lưu vật tư', 'success');
    onClose();
  }
  return (
    <Modal title={item ? `Vật tư ${item.code}` : 'Thêm vật tư'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      {(canEdit || canMin) && <button className="btn btn-primary" disabled={busy || (canEdit && (!f.code.trim() || !f.name.trim() || !f.unit.trim()))} onClick={save}>Lưu</button>}
    </>}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Field label="Mã vật tư"><input className="input" value={f.code} onChange={e => up({ code: e.target.value.toUpperCase() })} placeholder="VD: TT-LIDO" /></Field>
          <Field label="Nhóm"><select className="select" value={f.group_id ?? ''} onChange={e => up({ group_id: Number(e.target.value) })}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        </div>
        <div style={{ marginTop: 10 }}><Field label="Tên vật tư (gồm hãng, quy cách)"><input className="input" value={f.name} onChange={e => up({ name: e.target.value })} placeholder="VD: Lidocaine 2% 1.8ml" /></Field></div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label="Đơn vị dùng (tính tồn)"><input className="input" value={f.unit} onChange={e => up({ unit: e.target.value })} placeholder="ống, cái, tuýp…" /></Field>
          <Field label="Đơn vị nhập (không bắt buộc)"><input className="input" value={f.purchase_unit} onChange={e => up({ purchase_unit: e.target.value })} placeholder="hộp, vỉ…" /></Field>
          <Field label={`1 ${f.purchase_unit || 'đơn vị nhập'} = ? ${f.unit || 'đơn vị dùng'}`}><input className="input" type="number" min={1} value={f.purchase_factor} onChange={e => up({ purchase_factor: e.target.value })} /></Field>
          <Field label={`Tồn tối thiểu mặc định (${f.unit || 'đv dùng'})`}><input className="input" type="number" min={0} value={f.default_min_qty} onChange={e => up({ default_min_qty: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 18 }}>
          <label className="check"><input type="checkbox" checked={f.track_lot} onChange={e => up({ track_lot: e.target.checked })} /> Bắt buộc nhập số lô và hạn sử dụng</label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={e => up({ active: e.target.checked })} /> Đang sử dụng</label>
        </div>
        <div style={{ marginTop: 10 }}><Field label="Ghi chú"><input className="input" value={f.note} onChange={e => up({ note: e.target.value })} /></Field></div>
      </fieldset>
      {item && (
        <>
          <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>Tồn tối thiểu riêng từng chi nhánh</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Để trống = dùng mức mặc định ({fmtQty(f.default_min_qty)}). Chi nhánh đông khách nên đặt cao hơn.</p>
          <div className="form-grid">
            {branches.map(b => (
              <Field key={b.id} label={b.name}>
                <input className="input sm" type="number" min={0} placeholder={`mặc định ${fmtQty(f.default_min_qty)}`} disabled={!canMin || !canAct(b.id)}
                  value={mins[String(b.id)] ?? ''} onChange={e => setMins(m => ({ ...m, [String(b.id)]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Đổi tên nhóm danh mục (quyền inv_group_manage — mặc định BGĐ) */
function GroupsModal({ counts, onClose }: { counts: Map<number | null, number>; onClose: () => void }) {
  const { groups, reloadSession, toast } = useApp();
  const { run, busy } = useAction();
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(groups.map(g => [g.id, g.name])));
  const changed = groups.filter(g => (names[g.id] ?? '').trim() && names[g.id].trim() !== g.name);
  const save = async () => {
    let n = 0;
    for (const g of changed) if (await run('rename_group', { id: g.id, name: names[g.id].trim() })) n++;
    if (n) { await reloadSession(); toast(`Đã đổi tên ${n} nhóm`, 'success'); }
    if (n === changed.length) onClose();
  };
  return (
    <Modal title="Sửa tên nhóm danh mục" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={busy || !changed.length} onClick={() => void save()}>Lưu {changed.length ? `(${changed.length} nhóm)` : ''}</button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>Đổi tên chỉ thay chữ hiển thị; vật tư trong nhóm giữ nguyên.</p>
      <div className="table-wrap"><table className="data">
        <thead><tr><th style={{ width: 90 }}>Mã</th><th>Tên nhóm</th><th className="num" style={{ width: 90 }}>Số vật tư</th></tr></thead>
        <tbody>{groups.map(g => (
          <tr key={g.id}>
            <td className="mono small">{g.code}</td>
            <td><input className="input sm" style={{ width: '100%', borderColor: names[g.id]?.trim() !== g.name ? 'var(--td-color-primary)' : undefined }}
              value={names[g.id] ?? ''} onChange={e => setNames(v => ({ ...v, [g.id]: e.target.value }))} /></td>
            <td className="num">{counts.get(g.id) ?? 0}</td>
          </tr>))}</tbody>
      </table></div>
    </Modal>
  );
}
