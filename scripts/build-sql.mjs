// Gộp các file SQL thành 1 file setup.sql để dán vào Supabase → SQL Editor
import { readFileSync, writeFileSync } from 'node:fs';
const files = ['01_schema.sql', '02_functions.sql', '03_seed.sql', '04_supabase_security.sql', '05_import_excel.sql'];
const out = ['-- FILE TỰ SINH — chạy toàn bộ file này trong Supabase → SQL Editor.\n-- Nguồn: supabase/sql/*.sql (npm run sql)\n']
  .concat(files.map(f => `\n-- ===== ${f} =====\n` + readFileSync(new URL(`../supabase/sql/${f}`, import.meta.url), 'utf8')));
writeFileSync(new URL('../supabase/setup.sql', import.meta.url), out.join('\n'));
console.log('Đã tạo supabase/setup.sql');
