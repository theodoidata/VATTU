// Kiểm thử supabase/reset_data.sql trên PGlite: xóa dữ liệu phát sinh, giữ danh mục
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite();
for (const f of ['../src/demo/shim.sql', '../supabase/sql/01_schema.sql', '../supabase/sql/02_functions.sql',
                 '../supabase/sql/03_seed.sql', '../src/demo/sample_items.sql', '../src/demo/test_seed.sql']) await db.exec(read(f));
const n = async t => Number((await db.query(`select count(*) c from ${t}`)).rows[0].c);
const before = { items: await n('items'), groups: await n('item_groups'), lots: await n('stock_lots'), mins: await n('item_branch_settings') };
await db.exec(read('../supabase/reset_data.sql'));
const after = { items: await n('items'), groups: await n('item_groups'), lots: await n('stock_lots'), mins: await n('item_branch_settings'),
  docs: await n('receipt_docs') + await n('usage_docs') + await n('transfers') + await n('stocktakes') + await n('movements') };
console.log({ before, after });
if (!(before.lots > 0 && after.lots === 0 && after.docs === 0 && after.items === before.items && after.groups === before.groups && after.mins === before.mins)) { console.error('SAI'); process.exit(1); }
console.log('reset_data.sql: đạt');
