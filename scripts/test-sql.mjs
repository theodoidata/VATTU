// Kiểm thử nghiệp vụ SQL bằng PGlite (Postgres chạy trong Node): npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite();
for (const f of ['../src/demo/shim.sql', '../supabase/sql/01_schema.sql', '../supabase/sql/02_functions.sql',
                 '../supabase/sql/03_seed.sql', '../src/demo/sample_items.sql', '../src/demo/test_seed.sql']) {
  try { await db.exec(read(f)); } catch (e) { console.error('LỖI ở', f, '\n', e.message, e.where || ''); process.exit(1); }
}
const U = n => `00000000-0000-0000-0000-00000000000${n}`;
async function call(uid, fn, p = {}) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  const r = await db.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
  return r.rows[0].r;
}
let pass = 0, fail = 0;
async function ok(name, f) { try { await f(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, '—', e.message); } }
async function err(name, f, expect) {
  try { await f(); fail++; console.log('✗', name, '— không báo lỗi'); }
  catch (e) {
    if (!expect || e.message.includes(expect)) { pass++; console.log('✓', name, '→', e.message); }
    else { fail++; console.log('✗', name, '— lỗi khác:', e.message); }
  }
}
async function throws(f) { try { await f(); return false; } catch { return true; } }
const assert = (c, m) => { if (!c) throw new Error(m); };
const item = async code => (await db.query('select id from items where code=$1', [code])).rows[0].id;
const qty = async (b, code) => Number((await db.query(
  'select coalesce(sum(qty),0) q from stock_lots where branch_id=$1 and item_id=(select id from items where code=$2)', [b, code])).rows[0].q);

await ok('get_session BGĐ có đủ quyền', async () => {
  const s = await call(U(1), 'get_session'); assert(s.permissions.length === 19, 'perm ' + s.permissions.length); assert(s.branches.length === 11);
});
await ok('get_session kho Hạ Long', async () => {
  const s = await call(U(3), 'get_session'); assert(s.profile.branch_name === 'Hạ Long'); assert(!s.permissions.includes('inv_transfer_approve'));
});
await err('Tài khoản chưa kích hoạt bị chặn', () => call(U(8), 'get_stock', { branch_id: 5 }), 'chờ BGĐ');
await ok('get_stock Hạ Long', async () => {
  const s = await call(U(3), 'get_stock'); assert(s.length > 40); const m = s.find(x => x.code === 'TT-MEPI'); assert(Number(m.qty) > Number(m.usable_qty), 'có lô hết hạn');
});
await ok('Kho xem tồn chi nhánh khác (view_all)', async () => { const s = await call(U(3), 'get_stock', { branch_id: 1 }); assert(s.length > 0); });
await err('Bác sĩ không xem được chi nhánh khác', () => call(U(4), 'get_stock', { branch_id: 1 }), 'tất cả chi nhánh');
await ok('Ma trận tồn', async () => { const m = await call(U(3), 'get_stock_matrix'); assert(Object.keys(m[0].by_branch).length === 11); });

const lido = await item('TT-LIDO');
await ok('Xuất dùng trừ theo lô hết hạn trước', async () => {
  const before = await qty(5, 'TT-LIDO');
  const r = await call(U(4), 'record_usage', { lines: [{ item_id: lido, qty: 3 }] });
  assert((await qty(5, 'TT-LIDO')) === before - 3, 'trừ sai');
  const lots = (await db.query('select lots from usage_lines where doc_id=$1', [r.id])).rows[0].lots;
  const first = (await db.query("select lot_no from stock_lots where branch_id=5 and item_id=$1 and expiry_date>=current_date order by expiry_date limit 1", [lido])).rows[0].lot_no;
  assert(lots[0].lot_no === first, 'không lấy lô sớm nhất');
});
await err('Xuất quá tồn bị chặn', () => call(U(3), 'record_usage', { lines: [{ item_id: lido, qty: 99999 }] }), 'không đủ tồn');
await err('Không xuất dùng lô đã hết hạn', async () => {
  const mepi = await item('TT-MEPI'); const usable = (await call(U(3), 'get_stock')).find(x => x.code === 'TT-MEPI').usable_qty;
  await call(U(3), 'record_usage', { lines: [{ item_id: mepi, qty: Number(usable) + 1 }] });
}, 'không đủ tồn');
await ok('Hủy hết hạn trừ đúng lô hết hạn', async () => {
  const mepi = await item('TT-MEPI'); const lot = (await db.query("select id from stock_lots where lot_no='MP2301'")).rows[0].id;
  await call(U(3), 'record_usage', { lines: [{ item_id: mepi, qty: 12, reason: 'Hủy hết hạn', lot_id: lot }] });
  assert(Number((await db.query('select qty from stock_lots where id=$1', [lot])).rows[0].qty) === 0);
});
await err('Bác sĩ ghi xuất chi nhánh khác bị chặn', () => call(U(4), 'record_usage', { branch_id: 1, lines: [{ item_id: lido, qty: 1 }] }), 'chi nhánh của mình');
await err('Kho không có quyền hủy phiếu', async () => {
  const d = (await db.query('select id from usage_docs where branch_id=5 order by id desc limit 1')).rows[0].id;
  await call(U(3), 'void_usage', { id: d, reason: 'x' });
}, 'Hủy phiếu');
await ok('Quản lý hủy phiếu → hoàn tồn', async () => {
  const before = await qty(5, 'TT-LIDO');
  const r = await call(U(3), 'record_usage', { lines: [{ item_id: lido, qty: 2 }] });
  await call(U(2), 'void_usage', { id: r.id, reason: 'Ghi nhầm' });
  assert((await qty(5, 'TT-LIDO')) === before, 'không hoàn');
});
await ok('Nhập kho theo hộp được quy đổi', async () => {
  const before = await qty(5, 'TT-LIDO');
  await call(U(3), 'record_receipt', { lines: [{ item_id: lido, qty: 2, unit_mode: 'purchase', lot_no: 'LD9999', expiry_date: '2028-12-31' }] });
  assert((await qty(5, 'TT-LIDO')) === before + 100, 'quy đổi sai');
});
await err('Nhập thiếu số lô bị chặn', () => call(U(3), 'record_receipt', { lines: [{ item_id: lido, qty: 1 }] }), 'số lô');

await ok('Quy trình điều chuyển 4 bước + phân quyền từng bước', async () => {
  const arti = await item('TT-ARTI');
  const a0 = await qty(8, 'TT-ARTI'), b0 = await qty(5, 'TT-ARTI');
  const t = await call(U(6), 'create_transfer', { from_branch_id: 5, lines: [{ item_id: arti, qty: 10 }] });
  assert(t.status === 'pending' && t.code.startsWith('DC'));
  assert(await throws(() => call(U(3), 'transfer_action', { id: t.id, action: 'approve' })), 'kho không được duyệt');
  assert(await throws(() => call(U(5), 'transfer_action', { id: t.id, action: 'approve' })), 'QL Mạo Khê không duyệt thay Hạ Long');
  const ap = await call(U(2), 'transfer_action', { id: t.id, action: 'approve', lines: [{ line_id: t.lines[0].id, qty_approved: 8 }] });
  assert(ap.status === 'approved' && Number(ap.lines[0].qty_approved) === 8);
  await call(U(3), 'transfer_action', { id: t.id, action: 'ship' });
  assert((await qty(5, 'TT-ARTI')) === b0 - 8, 'chưa trừ B');
  assert(await throws(() => call(U(3), 'transfer_action', { id: t.id, action: 'receive' })), 'B không được tự nhận');
  await call(U(6), 'transfer_action', { id: t.id, action: 'receive' });
  assert((await qty(8, 'TT-ARTI')) === a0 + 8, 'chưa cộng A');
});
await err('Không tự xin hàng chính mình', () => call(U(6), 'create_transfer', { from_branch_id: 8, lines: [{ item_id: lido, qty: 1 }] }), 'khác');
await ok('Danh sách điều chuyển đúng chi nhánh', async () => {
  const l = await call(U(6), 'list_transfers'); assert(l.length > 0 && l.every(t => t.from_branch_id === 8 || t.to_branch_id === 8));
  const all = await call(U(1), 'list_transfers'); assert(all.length > l.length);
});

await ok('Kiểm kê: tạo → đếm → nộp → chốt điều chỉnh tồn', async () => {
  const st = await call(U(6), 'create_stocktake', { group_id: 2 });
  const d = await call(U(6), 'get_stocktake', { id: st.id });
  assert(d.lines.length > 0);
  const l0 = d.lines[0];
  const lines = d.lines.map((l, i) => ({ id: l.id, counted_qty: i === 0 ? Number(l.system_qty) - 1 : Number(l.system_qty) }));
  await call(U(6), 'save_stocktake', { id: st.id, lines, submit: true });
  assert(await throws(() => call(U(6), 'stocktake_action', { id: st.id, action: 'approve' })), 'kho không chốt được');
  const q = async () => Number((await db.query("select coalesce(sum(qty),0) q from stock_lots where branch_id=8 and item_id=$1", [l0.item_id])).rows[0].q);
  const before = await q();
  await call(U(5), 'stocktake_action', { id: st.id, action: 'approve' });
  const after = await q();
  assert(after === before - 1, `điều chỉnh sai ${before} → ${after}`);
});

await ok('Báo cáo xuất dùng / điều chuyển', async () => {
  const u = await call(U(2), 'report_usage', {}); assert(u.length > 0 && u.every(r => r.branch_id === 5));
  const ua = await call(U(1), 'report_usage', {}); assert(new Set(ua.map(r => r.branch_id)).size === 11);
  const t = await call(U(2), 'report_transfers', {}); assert(t.length > 0);
  const s = await call(U(1), 'report_stock', {}); assert(s[0].by_branch);
});
await err('Kho không xem báo cáo chi nhánh khác', () => call(U(3), 'report_usage', { branch_id: 1 }), 'tất cả chi nhánh');

await ok('Phân quyền: tắt theo vị trí, bật riêng từng người', async () => {
  await call(U(1), 'admin_set_department_permissions', { department_id: 4, permissions: [{ key: 'inv_usage_create', enabled: false }] });
  assert(await throws(() => call(U(4), 'record_usage', { lines: [{ item_id: lido, qty: 1 }] })), 'vẫn xuất được');
  await call(U(1), 'admin_set_user_permissions', { user_id: U(4), overrides: [{ key: 'inv_usage_create', enabled: true }] });
  await call(U(4), 'record_usage', { lines: [{ item_id: lido, qty: 1 }] });
  await call(U(1), 'admin_set_department_permissions', { department_id: 4, permissions: [{ key: 'inv_usage_create', enabled: true }] });
  await call(U(1), 'admin_set_user_permissions', { user_id: U(4), overrides: [{ key: 'inv_usage_create', enabled: null }] });
});
await err('Không thể tắt quyền phân quyền cuối cùng', () => call(U(1), 'admin_set_department_permissions',
  { department_id: 1, permissions: [{ key: 'admin_permissions', enabled: false }] }), 'ít nhất một');
await ok('Kích hoạt nhân viên mới', async () => {
  await call(U(1), 'admin_update_user', { id: U(8), department_id: 3, branch_id: 2, active: true });
  const s = await call(U(8), 'get_session'); assert(s.profile.branch_name === 'Móng Cái');
});
await ok('Danh mục + tồn tối thiểu riêng chi nhánh', async () => {
  const r = await call(U(1), 'save_item', { code: 'th-test', name: 'Vật tư thử', unit: 'cái', group_id: 1, default_min_qty: 5 });
  await call(U(2), 'save_min_qty', { item_id: r.id, branch_id: 5, min_qty: 9 });
  const s = (await call(U(2), 'get_stock')).find(x => x.id === r.id); assert(Number(s.min_qty) === 9 && s.min_is_custom);
});
await err('QL Hạ Long không đặt tối thiểu cho Mạo Khê', () => call(U(2), 'save_min_qty', { item_id: 1, branch_id: 8, min_qty: 1 }), 'chi nhánh của mình');
await ok('Không có tồn âm', async () => assert(Number((await db.query('select count(*) c from stock_lots where qty<0')).rows[0].c) === 0));
await ok('Sổ kho khớp tồn từng lô', async () => {
  const bal = (await db.query(`select count(*) c from (select l.id from stock_lots l left join movements m on m.lot_id=l.id
    group by l.id, l.qty having l.qty <> coalesce(sum(m.qty_change),0)) x`)).rows[0].c;
  assert(Number(bal) === 0, bal + ' lô lệch');
});
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
