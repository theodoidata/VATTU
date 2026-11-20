// Chuyển file Excel "QUẢN LÝ KHO TỔNG" thành SQL nhập danh mục + tồn đầu kỳ.
//   node scripts/import-excel.mjs "C:\...\QUẢN LÝ KHO TỔNG.xlsx"
// Sinh ra: supabase/sql/05_import_excel.sql và BAO-CAO-NHAP-EXCEL.md
// Lưu ý: chỉ dùng cho lần nhập ĐẦU TIÊN. Tồn đầu kỳ chỉ được ghi 1 lần (chạy lại không cộng trùng).
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const file = process.argv[2];
if (!file) { console.error('Cần đường dẫn file .xlsx'); process.exit(1); }

// ---------- Đọc xlsx (là file zip) ----------
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    out[name] = method === 8 ? inflateRawSync(data) : data;
    p += 46 + nl + el + cl;
  }
  return out;
}
const z = unzip(readFileSync(file));
const txt = n => z[n]?.toString('utf8') ?? '';
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, '&');
const tJoin = x => dec([...x.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => tJoin(m[1]));
const colIdx = c => [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const rows = new Map();
for (const r of txt('xl/worksheets/sheet1.xml').matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
  const row = [];
  for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = c[2], body = c[3] || '';
    const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    const is = (body.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
    let val = null;
    if (/t="s"/.test(a) && v != null) val = shared[+v];
    else if (is) val = tJoin(is);
    else if (v != null) val = /t="(str|e)"/.test(a) || isNaN(+v) ? dec(v) : +v;
    if (val !== null && val !== '') row[colIdx(c[1])] = val;
  }
  rows.set(+r[1], row);
}

// ---------- Tìm cột theo tiêu đề ----------
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const hdrRow = [...rows.entries()].find(([, r]) => r.some(c => norm(c).startsWith('ten vat tu')));
if (!hdrRow) { console.error('Không thấy dòng tiêu đề có "Tên vật tư"'); process.exit(1); }
const [hdrNo, hdr] = hdrRow;
const col = pred => hdr.findIndex(c => c != null && pred(norm(c)));
const C = {
  section: col(c => c === 'ma hang'), supplier: col(c => c.startsWith('cong ty')), name: col(c => c.startsWith('ten vat tu')),
  unit: col(c => c === 'don vi'), total: col(c => c.startsWith('tong so luong')), stock: col(c => c.startsWith('so luong ton kho')),
  t10: col(c => c.startsWith('so luong ton thang')),
};
const BR = { 'uong bi': 7, 'mao khe': 8, 'quang yen': 6, 'hoa binh': 10, 'tran phu': 3, 'hung vuong': 1, 'ha long': 5, 'cam pha': 4, 'xuong rang': 11, 'mong cai': 2 };
const branchCols = []; // {id, recv, used}
hdr.forEach((c, i) => {
  const n = norm(c).replace(/^cn\.?\s*/, '');
  if (BR[n]) branchCols.push({ id: BR[n], name: String(c).trim(), recv: i, used: norm(rows.get(hdrNo + 1)?.[i + 1]).includes('tieu hao') ? i + 1 : -1 });
});

// ---------- Nhóm vật tư (theo cột "Mã hàng" = nhãn đầu mỗi khu) ----------
const GROUPS = {
  'tu 6n': ['DC', 'Dụng cụ (Tủ 6N)'], 'mui khoan': ['MKH', 'Mũi khoan'], 'tu 5d': ['V5D', 'Vật liệu (Tủ 5D)'],
  'file may': ['FM', 'File máy'], 'file tay': ['FT', 'File tay'], 'bo tay trang': ['TTR', 'Bộ tẩy trắng'], 'gutta': ['GU', 'Gutta'],
  'day cung': ['DCU', 'Dây cung'], 'copping': ['CO', 'Copping'], 'analog': ['AN', 'Analog'], 'abutment': ['AB', 'Abutment'],
  'chinh nha': ['CN', 'Chỉnh nha'], 'healing': ['HE', 'Healing'], 'tru my': ['TMY', 'Trụ Mỹ'], 'tru core': ['TCO', 'Trụ Core'],
  'tru bio': ['TBI', 'Trụ Bio'], 'sic': ['SIC', 'Trụ SIC'], 'tramem': ['TRA', 'Trụ Tramem'], 'neodent': ['TNE', 'Trụ Neodent'],
  'thuoc': ['TH', 'Thuốc (Tủ 3D)'], '(tu 3d)': ['TH', 'Thuốc (Tủ 3D)'], 'dung cu': ['DCP', 'Dụng cụ & vật tư phẫu thuật'],
  'thuoc truyen': ['TTU', 'Thuốc truyền'], 'dau kim': ['DK', 'Đầu kim'], 'chun': ['CH', 'Chun'], 'do han': ['DH', 'Đồ hàn'],
  '(tu 4n)': ['V4N', 'Vật liệu (Tủ 4N)'], 'tu 3n': ['V3N', 'Vật liệu (Tủ 3N)'], 'tang 2': ['T2', 'Kho tầng 2'],
  'multi': ['MU', 'Multi & vật tư khác'],
};
// "NeoDent" đứng trước 1 dòng Healing → xếp vào Healing
const SECTION_FIX = (label, name) => (norm(label) === 'neodent' && norm(name).startsWith('healing') ? 'healing' : norm(label));

const UNIT_FIX = { 'tuyt': 'tuýp' };
const report = { neg: [], noUnit: [], textQty: [], dup: new Map(), skipped: 0 };
const groups = new Map(); // code -> {name, order}
const seq = {};
const items = [];
const stock = []; // [code, branch, qty]
let group = null;

const lastRow = Math.max(...rows.keys());
for (let i = hdrNo + 2; i <= lastRow; i++) {
  const r = rows.get(i);
  if (!r) continue;
  const name = r[C.name] == null ? '' : String(r[C.name]).replace(/\s+/g, ' ').trim();
  const label = r[C.section] == null ? '' : String(r[C.section]).trim();
  if (label) {
    const key = SECTION_FIX(label, name);
    group = GROUPS[key] ?? [norm(label).replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase() || 'KHAC', label.replace(/[()]/g, '').trim()];
  }
  if (!name) { report.skipped++; continue; }
  const g = group ?? ['KHAC', 'Khác'];
  if (!groups.has(g[0])) groups.set(g[0], { name: g[1], order: groups.size + 1 });
  seq[g[0]] = (seq[g[0]] ?? 0) + 1;
  const code = `${g[0]}-${String(seq[g[0]]).padStart(3, '0')}`;

  let unitRaw = r[C.unit] == null ? '' : String(r[C.unit]).trim();
  const notes = [];
  const m = unitRaw.match(/^(.*?)\s*\((.+)\)$/);
  if (m) { unitRaw = m[1]; notes.push('Quy cách: ' + m[2]); }
  let unit = unitRaw.toLowerCase();
  unit = UNIT_FIX[norm(unit)] ?? unit;
  if (!unit) { unit = 'cái'; notes.push('ĐVT chưa ghi trong file Excel'); report.noUnit.push(`${code} ${name}`); }
  if (r[C.supplier]) notes.push('NCC: ' + String(r[C.supplier]).trim());
  if (C.t10 >= 0 && typeof r[C.t10] === 'string') { notes.push('Ghi chú Excel: ' + r[C.t10].trim()); report.textQty.push(`${code} ${name}: "${r[C.t10].trim()}"`); }
  items.push({ code, name, g: g[0], unit, note: notes.join(' · ') || null });

  const key = norm(name);
  report.dup.set(key, [...(report.dup.get(key) ?? []), `${code} (dòng ${i})`]);

  const ton = typeof r[C.stock] === 'number' ? r[C.stock] : 0;
  if (ton < 0) report.neg.push(`${code} ${name}: tồn kho tổng = ${ton} (tổng ${r[C.total] ?? 0})`);
  if (ton > 0) stock.push([code, 9, ton]);
  for (const b of branchCols) {
    const recv = typeof r[b.recv] === 'number' ? r[b.recv] : 0;
    const used = b.used >= 0 && typeof r[b.used] === 'number' ? r[b.used] : 0;
    if (recv - used > 0) stock.push([code, b.id, recv - used]);
  }
}

// ---------- Sinh SQL ----------
const q = s => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const sql = [];
sql.push(`-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 05. Dữ liệu từ file Excel "${file.split(/[\\/]/).pop()}"
-- Sinh tự động bởi scripts/import-excel.mjs — không sửa tay.
-- ${items.length} vật tư, ${groups.size} nhóm, ${stock.length} dòng tồn đầu kỳ (Kho tổng + chi nhánh)
-- Chạy lại nhiều lần an toàn: vật tư đã có thì bỏ qua, tồn đầu kỳ chỉ ghi 1 lần.
-- =====================================================================
`);
sql.push('insert into item_groups (code, name, sort_order) values\n' +
  [...groups.entries()].map(([c, g]) => `  (${q(c)}, ${q(g.name)}, ${g.order})`).join(',\n') + '\non conflict (code) do nothing;\n');
sql.push('insert into items (code, name, group_id, unit, note)\nselect v.code, v.name, g.id, v.unit, v.note from (values\n' +
  items.map(it => `  (${q(it.code)}, ${q(it.name)}, ${q(it.g)}, ${q(it.unit)}, ${q(it.note)})`).join(',\n') +
  '\n) as v(code, name, gcode, unit, note)\njoin item_groups g on g.code = v.gcode\non conflict (code) do nothing;\n');
sql.push(`do $$
declare r record;
begin
  if exists (select 1 from movements where reason = 'Tồn đầu kỳ từ file Excel') then return; end if;
  for r in
    select i.id as item_id, v.b::smallint as b, v.qty::numeric as qty
    from (values
${stock.map(([c, b, n]) => `      (${q(c)}, ${b}, ${n})`).join(',\n')}
    ) as v(code, b, qty) join items i on i.code = v.code
  loop
    perform app.add_stock(r.b, r.item_id, null, null, r.qty, 'adjust', app.today(), 'Tồn đầu kỳ từ file Excel', null, null);
  end loop;
end $$;
`);
writeFileSync(new URL('../supabase/sql/05_import_excel.sql', import.meta.url), sql.join('\n'));

// ---------- Báo cáo kiểm tra dữ liệu ----------
const dups = [...report.dup.entries()].filter(([, v]) => v.length > 1);
const perBranch = {};
for (const [, b, n] of stock) perBranch[b] = (perBranch[b] ?? 0) + 1;
const BN = { 9: 'Kho tổng', ...Object.fromEntries(branchCols.map(b => [b.id, b.name])) };
const md = `# Báo cáo nhập file Excel

File: **${file.split(/[\\/]/).pop()}** (sheet đầu tiên)

- **${items.length}** vật tư, **${groups.size}** nhóm.
- Số vật tư có tồn đầu kỳ: ${Object.entries(perBranch).map(([b, n]) => `${BN[b] ?? b}: ${n}`).join(' · ')}
- Tồn **Kho tổng** lấy từ cột "Số lượng tồn kho".
- Tồn **chi nhánh** = "Số lượng nhận" − "Số lượng tiêu hao". Cột tiêu hao trong file đang trống, nên tồn chi nhánh đang bằng số đã nhận. Các chi nhánh cần **Kiểm kê** để chốt số thật.
- Chưa có số lô, hạn dùng, mức tối thiểu: bổ sung dần trong **Danh mục**.

## 1. Tồn kho tổng đang âm (${report.neg.length} dòng) — đã nhập là 0, cần kiểm tra lại
${report.neg.map(x => '- ' + x).join('\n') || '- Không có'}

## 2. Tên vật tư bị trùng (${dups.length} tên) — đang để thành các mã riêng, nên gộp hoặc đổi tên
${dups.map(([, v]) => '- ' + v.join(', ') + ' — ' + items.find(it => it.code === v[0].split(' ')[0]).name).join('\n') || '- Không có'}

## 3. Chưa có đơn vị tính (${report.noUnit.length} vật tư) — tạm đặt "cái"
${report.noUnit.length > 40 ? report.noUnit.slice(0, 40).map(x => '- ' + x).join('\n') + `\n- … và ${report.noUnit.length - 40} vật tư khác (lọc trong Danh mục)` : report.noUnit.map(x => '- ' + x).join('\n')}

## 4. Ô số lượng ghi bằng chữ (${report.textQty.length}) — đã lưu vào ghi chú vật tư
${report.textQty.map(x => '- ' + x).join('\n') || '- Không có'}
`;
writeFileSync(new URL('../BAO-CAO-NHAP-EXCEL.md', import.meta.url), md);
console.log(`Đã sinh 05_import_excel.sql: ${items.length} vật tư, ${groups.size} nhóm, ${stock.length} dòng tồn. Âm: ${report.neg.length}, trùng tên: ${dups.length}, thiếu ĐVT: ${report.noUnit.length}`);
console.log('Cột:', JSON.stringify(C), 'Chi nhánh:', branchCols.map(b => `${b.name}->${b.id}(${b.recv},${b.used})`).join(' '));
