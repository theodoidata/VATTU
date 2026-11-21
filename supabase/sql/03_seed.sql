-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 03. Dữ liệu ban đầu
-- (chạy lại nhiều lần không bị trùng)
-- =====================================================================

insert into branches (id, code, name, sort_order) values
  (1, 'HV', 'Hùng Vương', 1),
  (2, 'MC', 'Móng Cái',   2),
  (3, 'TP', 'Trần Phú',   3),
  (4, 'CP', 'Cẩm Phả',    4),
  (5, 'HL', 'Hạ Long',    5),
  (6, 'QY', 'Quảng Yên',  6),
  (7, 'UB', 'Uông Bí',    7),
  (8, 'MK', 'Mạo Khê',    8),
  (9, 'KT', 'Kho tổng',   0),
  (10, 'HB', 'Hòa Bình',  9),
  (11, 'XR', 'Xưởng răng', 10)
on conflict (id) do nothing;

insert into permissions (key, group_name, label, description, sort_order) values
  ('inv_stock_view',        'Tồn kho',     'Xem tồn kho chi nhánh mình', 'Xem số lượng, lô, hạn dùng, cảnh báo tối thiểu.', 10),
  ('inv_stock_view_all',    'Tồn kho',     'Xem tồn kho tất cả chi nhánh', 'Cần để biết chi nhánh nào còn hàng khi yêu cầu điều chuyển.', 11),
  ('inv_all_branches',      'Tồn kho',     'Thao tác trên mọi chi nhánh', 'Dành cho BGĐ / Kế toán: nhập, xuất, điều chuyển thay cho bất kỳ chi nhánh nào.', 12),
  ('inv_usage_create',      'Xuất dùng',   'Ghi xuất dùng hằng ngày', 'Trừ tồn theo lô hết hạn sớm nhất trước.', 20),
  ('inv_usage_void',        'Xuất dùng',   'Hủy phiếu xuất trong ngày', 'Hoàn lại tồn khi ghi nhầm.', 21),
  ('inv_receipt_create',    'Nhập kho',    'Nhập kho (nhập tay)', 'Tạm thời chi nhánh tự nhập; sau này Kế toán nhập và phân bổ.', 30),
  ('inv_receipt_edit',      'Nhập kho',    'Sửa phiếu nhập đã lưu', 'Dành cho BGĐ / Kế toán: sửa số lượng, lô, hạn dùng, bỏ dòng nhập nhầm; tồn kho tự điều chỉnh theo chênh lệch.', 31),
  ('inv_transfer_request',  'Điều chuyển', 'Tạo / hủy yêu cầu điều chuyển', 'Chi nhánh thiếu hàng (A) xin hàng từ chi nhánh khác (B).', 40),
  ('inv_transfer_approve',  'Điều chuyển', 'Duyệt / từ chối yêu cầu (bên cấp hàng)', 'Chi nhánh B quyết định số lượng đồng ý cấp.', 41),
  ('inv_transfer_ship',     'Điều chuyển', 'Xác nhận đã gửi hàng', 'Trừ kho chi nhánh B.', 42),
  ('inv_transfer_receive',  'Điều chuyển', 'Xác nhận đã nhận hàng', 'Cộng kho chi nhánh A.', 43),
  ('inv_stocktake_count',   'Kiểm kê',     'Tạo phiếu và nhập số đếm kiểm kê', null, 50),
  ('inv_stocktake_approve', 'Kiểm kê',     'Chốt kiểm kê (điều chỉnh tồn)', 'Duyệt chênh lệch, hệ thống tự điều chỉnh tồn.', 51),
  ('inv_catalog_manage',    'Danh mục',    'Thêm / sửa danh mục vật tư', null, 60),
  ('inv_min_manage',        'Danh mục',    'Đặt tồn tối thiểu cho chi nhánh', null, 61),
  ('inv_report_view',       'Báo cáo',     'Xem báo cáo chi nhánh mình', null, 70),
  ('inv_report_view_all',   'Báo cáo',     'Xem báo cáo tất cả chi nhánh', null, 71),
  ('inv_report_export',     'Báo cáo',     'Xuất Excel', null, 72),
  ('admin_users',           'Quản trị',    'Quản lý nhân sự', 'Kích hoạt tài khoản, gán vị trí và chi nhánh.', 80),
  ('admin_permissions',     'Quản trị',    'Phân quyền', 'Bật / tắt quyền theo vị trí và cho từng nhân viên.', 81)
on conflict (key) do update set group_name = excluded.group_name, label = excluded.label,
  description = excluded.description, sort_order = excluded.sort_order;

insert into departments (id, code, name, description, sort_order, active) values
  (1, 'BGD',    'BGĐ',                   'Ban Giám đốc — toàn quyền, xem 8 chi nhánh', 1, true),
  (2, 'QLCN',   'Quản lý chi nhánh',     'Trưởng phòng / Điều dưỡng trưởng — duyệt điều chuyển, chốt kiểm kê', 2, true),
  (3, 'KHO',    'Nhân viên kho / Phụ tá','Ghi xuất dùng, nhập tay, gửi – nhận hàng, đếm kiểm kê', 3, true),
  (4, 'BACSI',  'Bác sĩ',                'Xem tồn, ghi xuất dùng', 4, true),
  (5, 'KETOAN', 'Kế toán',               'Bổ sung sau — nhập hàng và phân bổ cho chi nhánh', 5, false)
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('departments', 'id'), greatest((select max(id) from departments), 1));

-- Quyền mặc định theo vị trí (chỉ thêm nếu chưa cấu hình)
insert into department_permissions (department_id, permission_key, enabled)
select d.id, pm.key,
  case d.code
    when 'BGD' then true
    when 'QLCN' then pm.key in ('inv_stock_view','inv_stock_view_all','inv_usage_create','inv_usage_void',
      'inv_receipt_create','inv_transfer_request','inv_transfer_approve','inv_transfer_ship','inv_transfer_receive',
      'inv_stocktake_count','inv_stocktake_approve','inv_min_manage','inv_report_view','inv_report_export')
    when 'KHO' then pm.key in ('inv_stock_view','inv_stock_view_all','inv_usage_create','inv_receipt_create',
      'inv_transfer_request','inv_transfer_ship','inv_transfer_receive','inv_stocktake_count','inv_report_view')
    when 'BACSI' then pm.key in ('inv_stock_view','inv_usage_create')
    when 'KETOAN' then pm.key in ('inv_stock_view','inv_stock_view_all','inv_all_branches','inv_receipt_create','inv_receipt_edit',
      'inv_catalog_manage','inv_report_view','inv_report_view_all','inv_report_export')
    else false end
from departments d cross join permissions pm
on conflict (department_id, permission_key) do nothing;
