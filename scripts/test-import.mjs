// Kiểm tra: setup.sql (có dữ liệu Excel) + demo chạy được, số liệu khớp file Excel
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite();
await db.exec('create role anon; create role authenticated;');
await db.exec(read('../src/demo/shim.sql'));
await db.exec(read('../supabase/setup.sql'));
const one = async s => (await db.query(s)).rows[0];
console.log('Lần 1:', await one(`select (select count(*) from items) items, (select count(*) from item_groups) groups,
  (select count(*) from stock_lots where branch_id = 9) kho_tong_items, (select sum(qty) from stock_lots where branch_id = 9) kho_tong_qty,
  (select count(*) from stock_lots where branch_id <> 9) cn_lines, (select count(*) from movements) moves`));
console.log('Mẫu:', (await db.query(`select i.code, i.name, i.unit, l.qty from stock_lots l join items i on i.id = l.item_id
  where l.branch_id = 9 and i.code in ('DC-001','TCO-004','FM-001') order by 1`)).rows);
await db.exec(read('../supabase/setup.sql'));
console.log('Chạy lại:', await one(`select (select count(*) from items) items, (select count(*) from movements) moves`));
await db.exec(read('../src/demo/demo_seed.sql'));
console.log('Demo:', await one(`select (select count(*) from transfers) transfers, (select string_agg(status, ',') from transfers) st, (select count(*) from usage_docs) usage`));
