-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 04. Bảo mật riêng cho Supabase
-- - Khóa truy cập trực tiếp vào bảng (RLS bật, không có policy):
--   web chỉ đọc/ghi qua các hàm RPC đã kiểm tra quyền.
-- - Tự tạo hồ sơ nhân viên khi thêm tài khoản đăng nhập.
-- =====================================================================

alter table profiles drop constraint if exists profiles_id_fkey;
alter table profiles add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on schema app from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Khi BGĐ thêm tài khoản (Supabase → Authentication → Add user), tự tạo hồ sơ
-- ở trạng thái "chờ kích hoạt". Tài khoản ĐẦU TIÊN tự động là BGĐ.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_first boolean;
begin
  v_first := not exists (select 1 from profiles where active);
  insert into profiles (id, email, full_name, department_id, active)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          case when v_first then (select id from departments where code = 'BGD') end,
          v_first)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Tài khoản đã có từ trước khi chạy script
insert into profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

update profiles
   set active = true, department_id = (select id from departments where code = 'BGD')
 where id = (select id from profiles order by created_at limit 1)
   and not exists (select 1 from profiles where active);
