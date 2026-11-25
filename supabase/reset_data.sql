-- =====================================================================
-- KHO VẬT TƯ — XÓA DỮ LIỆU PHÁT SINH, ĐƯA TỒN KHO VỀ 0
-- GIỮ LẠI: danh mục vật tư + nhóm, quy đổi đơn vị, mức tồn tối thiểu,
--          chi nhánh, tài khoản nhân viên, vị trí và phân quyền.
-- XÓA HẾT: tồn kho / lô, sổ kho, phiếu nhập, phiếu xuất dùng,
--          phiếu điều chuyển, phiếu kiểm kê.
-- KHÔNG HOÀN TÁC ĐƯỢC. Chạy 1 lần trong Supabase → SQL Editor.
-- =====================================================================
do $$
begin
  -- Chỉ chạy trên database của Kho vật tư
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'stock_lots')
     or not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'transfer_lines') then
    raise exception 'DỪNG: đây không phải database Kho vật tư.';
  end if;
end $$;

begin;
truncate table
  movements, stock_lots,
  receipt_lines, receipt_docs,
  usage_lines, usage_docs,
  transfer_lines, transfers,
  stocktake_lines, stocktakes
restart identity;
commit;

-- Kiểm tra: nhóm "Đã xóa" phải toàn 0, nhóm "Giữ lại" vẫn còn số
select * from (values
  ('Đã xóa',  'Lô tồn kho',              (select count(*) from stock_lots)),
  ('Đã xóa',  'Sổ kho',                  (select count(*) from movements)),
  ('Đã xóa',  'Phiếu nhập',              (select count(*) from receipt_docs)),
  ('Đã xóa',  'Phiếu xuất dùng',         (select count(*) from usage_docs)),
  ('Đã xóa',  'Phiếu điều chuyển',       (select count(*) from transfers)),
  ('Đã xóa',  'Phiếu kiểm kê',           (select count(*) from stocktakes)),
  ('Giữ lại', 'Vật tư trong danh mục',   (select count(*) from items)),
  ('Giữ lại', 'Nhóm danh mục',           (select count(*) from item_groups)),
  ('Giữ lại', 'Mức tối thiểu riêng CN',  (select count(*) from item_branch_settings)),
  ('Giữ lại', 'Chi nhánh',               (select count(*) from branches)),
  ('Giữ lại', 'Tài khoản nhân viên',     (select count(*) from profiles))
) as t(loai, muc, so_dong);
