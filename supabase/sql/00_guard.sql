-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 00. Chốt an toàn
-- Từ chối chạy nếu database đang có bảng của ỨNG DỤNG KHÁC (vd web Workspace cũ),
-- vì các bước sau bật RLS cho mọi bảng và thay trigger tạo hồ sơ người dùng.
-- =====================================================================
do $$
declare v_other text;
begin
  select string_agg(tablename, ', ' order by tablename) into v_other
  from pg_tables
  where schemaname = 'public'
    and tablename not in ('branches','departments','permissions','department_permissions','profiles',
      'user_permission_overrides','item_groups','items','item_branch_settings','stock_lots','usage_docs',
      'usage_lines','receipt_docs','receipt_lines','transfers','transfer_lines','stocktakes','stocktake_lines','movements');
  if v_other is not null
     or (exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles')
         and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'stock_lots')) then
    raise exception 'DỪNG: database này đang có dữ liệu của ứng dụng khác (bảng: %). Hãy tạo một Supabase project MỚI riêng cho Kho vật tư rồi chạy file này ở đó.',
      coalesce(v_other, 'profiles');
  end if;
end $$;
