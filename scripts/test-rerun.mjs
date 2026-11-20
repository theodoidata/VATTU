// Kiểm tra chạy lại supabase/setup.sql lần 2 không lỗi, không mất dữ liệu
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated;`);
await db.exec(fs.readFileSync('src/demo/shim.sql', 'utf8'));
const s = fs.readFileSync('supabase/setup.sql', 'utf8');
await db.exec(s);
await db.exec(`insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'bgd@x.vn')`);
await db.exec(`insert into items(code, name, group_id, unit) values ('TEST-1', 'Vật tư thêm tay', 1, 'cái')`);
const q = async sql => (await db.query(sql)).rows[0];
const before = await q(`select (select count(*) from items) items, (select count(*) from profiles) prof, (select department_id from profiles limit 1) dept`);
await db.exec(s);
const after = await q(`select (select count(*) from items) items, (select count(*) from profiles) prof, (select department_id from profiles limit 1) dept`);
console.log('lần 1', before, '\nlần 2', after);
console.log(JSON.stringify(before) === JSON.stringify(after) ? 'Chạy lại an toàn' : 'KHÁC NHAU');
