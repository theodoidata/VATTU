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
  const s = await call(U(1), 'get_session'); assert(s.permissions.length === 21, 'perm ' + s.permissions.length); assert(s.branches.length === 11);
});
await ok('get_session kho Hạ Long', async () => {
  const s = await call(U(3), 'get_session'); assert(s.profile.branch_name === 'Hạ Long'); assert(!s.permissions.includes('inv_transfer_approve'));
});
await err('Tài khoản chưa kích hoạt bị chặn', () => call(U(8), 'get_stock', { branch_id: 5 }), 'chờ BGĐ');
await ok('get_stock Hạ Long', async () => {
  const s = await call(U(3), 'get_stock'); assert(s.length > 5);
  assert(s.every(x => Number(x.qty) > 0 || Number(x.min_qty) > 0), 'mặc định chỉ trả vật tư có tồn / có mức tối thiểu');
  const all = await call(U(3), 'get_stock', { all: true }); assert(all.length > 40 && all.length >= s.length, 'all=true trả cả danh mục ' + all.length + '/' + s.length);
  const m = s.find(x => x.code === 'TT-MEPI'); assert(Number(m.qty) > Number(m.usable_qty), 'có lô hết hạn');
});
await ok('Kho xem tồn chi nhánh khác (view_all)', async () => { const s = await call(U(3), 'get_stock', { branch_id: 1 }); assert(s.length > 0); });
await err('Bác sĩ không xem được chi nhánh khác', () => call(U(4), 'get_stock', { branch_id: 1 }), 'tất cả chi nhánh');
await ok('Tồn 1 vật tư ở mọi chi nhánh', async () => {
  const id = (await call(U(4), 'get_stock')).find(x => Number(x.qty) > 0).id;
  const r = await call(U(4), 'get_item_branches', { item_id: id });
  assert(r.length === 11 && r.some(x => Number(x.qty) > 0) && r.every(x => 'usable' in x && 'min' in x));
});
await err('Chưa kích hoạt không xem tồn chi nhánh', () => call(U(8), 'get_item_branches', { item_id: 1 }), 'chờ BGĐ');
await ok('Ma trận tồn', async () => { const m = await call(U(3), 'get_stock_matrix'); assert(m.length > 0 && m.every(r => Object.keys(r.by_branch).length > 0));
  assert(m.every(r => Object.values(r.by_branch).every(c => Number(c.qty) > 0 || Number(c.min) > 0)), 'chỉ ô có tồn / có tối thiểu'); });

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

await ok('Đổi tên / đơn vị vật tư (BGĐ)', async () => {
  const id = await item('TT-LIDO');
  const r = await call(U(1), 'update_item_basic', { id, name: 'Lidocain 2% (đổi tên)', unit: 'ống' });
  assert(r.name === 'Lidocain 2% (đổi tên)' && r.unit === 'ống');
});
await err('Kho không được đổi tên vật tư', async () => call(U(3), 'update_item_basic', { id: await item('TT-LIDO'), name: 'x' }), 'quyền');
await err('Không cho tên rỗng', async () => call(U(1), 'update_item_basic', { id: await item('TT-LIDO'), name: '  ' }), 'không được để trống');

await ok('Tách đơn vị lẻ: 1 gói = 10 miếng, tồn/tối thiểu/lịch sử nhân 10', async () => {
  const id = await item('TH-BONG');
  const q = async () => Number((await db.query('select coalesce(sum(qty),0) q from stock_lots where branch_id=5 and item_id=$1', [id])).rows[0].q);
  await call(U(2), 'record_receipt', { branch_id: 5, lines: [{ item_id: id, qty: 4, unit_mode: 'base' }] });
  const before = await q();
  const mins0 = Number((await db.query('select default_min_qty m from items where id=$1', [id])).rows[0].m);
  assert(await throws(() => call(U(3), 'set_item_conversion', { item_id: id, small_unit: 'miếng', factor: 10 })), 'kho không được tách');
  const r = await call(U(1), 'set_item_conversion', { item_id: id, small_unit: 'miếng', factor: 10 });
  assert(r.unit === 'miếng' && r.purchase_unit === 'gói' && Number(r.purchase_factor) === 10, 'quy đổi sai');
  assert(await q() === before * 10, `tồn ${before} phải thành ${before * 10}, đang ${await q()}`);
  assert(Number((await db.query('select default_min_qty m from items where id=$1', [id])).rows[0].m) === mins0 * 10, 'tối thiểu chưa nhân');
  const ln = (await db.query('select qty, input_qty, input_unit from receipt_lines where item_id=$1 order by id desc limit 1', [id])).rows[0];
  assert(Number(ln.qty) === 40 && Number(ln.input_qty) === 4 && ln.input_unit === 'gói', 'phiếu nhập cũ: ' + JSON.stringify(ln));
  const mv = Number((await db.query('select coalesce(sum(qty_change),0) s from movements where branch_id=5 and item_id=$1', [id])).rows[0].s);
  assert(mv === await q(), `sổ kho ${mv} phải khớp tồn`);
  assert(await throws(() => call(U(1), 'set_item_conversion', { item_id: id, small_unit: 'sợi', factor: 5 })), 'tách lần 2 phải báo');
  // nhập 1 gói (đơn vị nhập) → cộng 10 miếng
  await call(U(2), 'record_receipt', { branch_id: 5, lines: [{ item_id: id, qty: 1, unit_mode: 'purchase' }] });
  assert(await q() === before * 10 + 10, 'nhập 1 gói phải cộng 10 miếng');
});
await err('Số quy đổi phải nguyên ≥ 2', async () => call(U(1), 'set_item_conversion', { item_id: await item('TH-GAC'), small_unit: 'x', factor: 1.5 }), 'đã có quy đổi');

await ok('BGĐ đổi tên nhóm danh mục', async () => {
  const g = (await db.query("select id from item_groups order by id limit 1")).rows[0].id;
  const r = await call(U(1), 'rename_group', { id: g, name: 'Nhóm đổi tên' });
  assert(r.name === 'Nhóm đổi tên', 'chưa đổi tên');
  const s = await call(U(1), 'get_session');
  assert(s.groups.some(x => x.name === 'Nhóm đổi tên'), 'session chưa có tên mới');
});
await err('Quản lý chi nhánh không đổi tên nhóm được', async () => call(U(2), 'rename_group', { id: 1, name: 'x' }), 'quyền');

await ok('Xin hàng khi Kho tổng hết: phiếu đánh dấu Chờ hàng về, nhập hàng xong thì hết đánh dấu', async () => {
  const id = await item('TH-BONG');
  const have = Number((await call(U(1), 'get_stock', { branch_id: 1, all: true })).find(x => x.id === id)?.usable_qty ?? 0);
  const t = await call(U(3), 'create_transfer', { to_branch_id: 5, from_branch_id: 1, lines: [{ item_id: id, qty: have + 7 }] });
  assert(t.awaiting_stock === true, 'phải đánh dấu chờ hàng về');
  assert(Number(t.lines[0].src_usable) === have, 'src_usable sai ' + t.lines[0].src_usable);
  await call(U(1), 'record_receipt', { branch_id: 1, lines: [{ item_id: id, qty: 7, unit_mode: 'base' }] });
  const t2 = (await call(U(1), 'list_transfers', { status: ['pending'] })).find(x => x.id === t.id);
  assert(t2.awaiting_stock === false, 'nhập đủ rồi vẫn còn đánh dấu');
  await call(U(3), 'transfer_action', { id: t.id, action: 'cancel' });
});

await ok('Sửa phiếu nhập: tăng / giảm / bỏ dòng, tồn điều chỉnh theo chênh lệch', async () => {
  const a = await item('TT-LIDO'), b = await item('TT-MEPI');
  const r = await call(U(2), 'record_receipt', { branch_id: 5, supplier: 'NCC A', lines: [
    { item_id: a, qty: 5, unit_mode: 'base', lot_no: 'SUA1', expiry_date: '2030-01-01' },
    { item_id: b, qty: 4, unit_mode: 'base', lot_no: 'SUA2', expiry_date: '2030-01-01' }] });
  const docId = r.id ?? r.doc_id ?? (await db.query('select max(id) id from receipt_docs')).rows[0].id;
  const lot = async (code, lotNo) => Number((await db.query("select coalesce(sum(qty),0) q from stock_lots where branch_id=5 and lot_no=$1 and item_id=(select id from items where code=$2)", [lotNo, code])).rows[0].q);
  assert(await lot('TT-LIDO', 'SUA1') === 5 && await lot('TT-MEPI', 'SUA2') === 4, 'nhập ban đầu sai');
  assert(await throws(() => call(U(2), 'edit_receipt', { id: docId, lines: [] })), 'QL chi nhánh không được sửa');
  await call(U(1), 'edit_receipt', { id: docId, supplier: 'NCC B', lines: [{ item_id: a, qty: 8, unit_mode: 'base', lot_no: 'SUA1', expiry_date: '2030-01-01' }] });
  assert(await lot('TT-LIDO', 'SUA1') === 8, 'tăng 5 → 8 chưa đúng');
  assert(await lot('TT-MEPI', 'SUA2') === 0, 'bỏ dòng phải trừ hết lô SUA2');
  const d = (await call(U(1), 'list_receipts', { branch_id: 5 })).find(x => x.id === docId);
  assert(d.supplier === 'NCC B' && d.lines.length === 1 && d.updated_by_name, 'phiếu chưa cập nhật');
  // dùng bớt 7 rồi giảm phiếu về 1 → kho chỉ còn 1, giảm 7 là không được
  await call(U(3), 'record_usage', { branch_id: 5, lines: [{ item_id: a, qty: 7, reason: 'Điều trị', lot_id: (await db.query("select id from stock_lots where branch_id=5 and lot_no='SUA1'")).rows[0].id }] });
  assert(await throws(() => call(U(1), 'edit_receipt', { id: docId, lines: [{ item_id: a, qty: 1, unit_mode: 'base', lot_no: 'SUA1', expiry_date: '2030-01-01' }] })), 'giảm quá số còn phải báo lỗi');
  assert(await lot('TT-LIDO', 'SUA1') === 1, 'lỗi giữa chừng không được làm đổi tồn');
});

await ok('Cấp hàng chủ động: Hạ Long cấp cho Mạo Khê, trừ kho ngay, Mạo Khê nhận', async () => {
  const s = (await call(U(3), 'get_stock')).find(x => Number(x.usable_qty) >= 3 && !x.lots.some(l => l.expiry_date && l.expiry_date < '2000'));
  const hl0 = Number(s.qty); const mk0 = Number((await db.query('select coalesce(sum(qty),0) q from stock_lots where branch_id=8 and item_id=$1', [s.id])).rows[0].q);
  const t = await call(U(3), 'push_transfer', { to_branch_id: 8, note: 'bổ sung', lines: [{ item_id: s.id, qty: 3 }] });
  assert(t.kind === 'push' && t.status === 'shipped', 'phải gửi ngay: ' + t.status);
  const hl1 = Number((await call(U(3), 'get_stock', { all: true })).find(x => x.id === s.id).qty);
  assert(hl1 === hl0 - 3, `kho cấp chưa trừ ${hl0} → ${hl1}`);
  await call(U(6), 'transfer_action', { id: t.id, action: 'receive' });
  const mk1 = Number((await db.query('select coalesce(sum(qty),0) q from stock_lots where branch_id=8 and item_id=$1', [s.id])).rows[0].q);
  assert(mk1 === mk0 + 3, `kho nhận sai ${mk0} → ${mk1}`);
});
await err('Bác sĩ không cấp hàng chủ động được', () => call(U(4), 'push_transfer', { to_branch_id: 8, lines: [{ item_id: 1, qty: 1 }] }), 'quyền');
await err('Không cấp quá số còn dùng được', async () => {
  const s = (await call(U(3), 'get_stock')).find(x => Number(x.usable_qty) > 0);
  await call(U(3), 'push_transfer', { to_branch_id: 8, lines: [{ item_id: s.id, qty: Number(s.usable_qty) + 100 }] });
}, 'không đủ cấp');

await ok('Nhận thiếu: chỉ cộng số thực nhận, bắt buộc ghi lý do, đánh dấu thiếu', async () => {
  const s = (await call(U(3), 'get_stock')).find(x => Number(x.usable_qty) >= 4);
  const mk = async () => Number((await db.query('select coalesce(sum(qty),0) q from stock_lots where branch_id=8 and item_id=$1', [s.id])).rows[0].q);
  const before = await mk();
  const t = await call(U(3), 'push_transfer', { to_branch_id: 8, lines: [{ item_id: s.id, qty: 4 }] });
  const lines = [{ line_id: t.lines[0].id, qty_received: 1 }];
  assert(await throws(() => call(U(6), 'transfer_action', { id: t.id, action: 'receive', lines })), 'thiếu mà không ghi lý do phải báo lỗi');
  assert(await throws(() => call(U(6), 'transfer_action', { id: t.id, action: 'receive', lines: [{ line_id: t.lines[0].id, qty_received: 9 }], reason: 'x' })), 'nhận quá số gửi phải báo lỗi');
  const r = await call(U(6), 'transfer_action', { id: t.id, action: 'receive', lines, reason: 'rơi vỡ khi vận chuyển' });
  assert(r.status === 'received' && r.has_shortage && Number(r.lines[0].qty_received) === 1, 'chưa đánh dấu nhận thiếu');
  assert(r.receive_note.includes('thiếu 3'), 'ghi chú chưa có phần thiếu: ' + r.receive_note);
  assert(await mk() === before + 1, 'chỉ được cộng 1');
});

await ok('Kiểm kê: nộp khi còn dòng trống → dòng trống tính là 0', async () => {
  const st = await call(U(6), 'create_stocktake', { group_id: 2 });
  const d = await call(U(6), 'get_stocktake', { id: st.id });
  assert(d.lines.length > 1);
  await call(U(6), 'save_stocktake', { id: st.id, lines: [{ id: d.lines[0].id, counted_qty: 1 }], submit: true });
  const d2 = await call(U(6), 'get_stocktake', { id: st.id });
  assert(d2.status === 'submitted' && d2.lines.every(l => l.counted_qty !== null));
  assert(d2.lines.filter(l => l.id !== d.lines[0].id).every(l => Number(l.counted_qty) === 0), 'dòng trống phải = 0');
  await call(U(5), 'stocktake_action', { id: st.id, action: 'cancel' });
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
