-- Bản DEMO (chỉ chạy trong trình duyệt): người dùng mẫu + vài thao tác mẫu trên DANH MỤC THẬT từ file Excel.
-- Không dùng cho Supabase thật.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'bgd@demo.vn'),
  ('00000000-0000-0000-0000-000000000002', 'ql.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000003', 'kho.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000004', 'bs.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000005', 'ql.maokhe@demo.vn'),
  ('00000000-0000-0000-0000-000000000006', 'kho.maokhe@demo.vn'),
  ('00000000-0000-0000-0000-000000000007', 'khotong@demo.vn'),
  ('00000000-0000-0000-0000-000000000008', 'moi@demo.vn')
on conflict (id) do nothing;

insert into profiles (id, email, full_name, department_id, branch_id, active) values
  ('00000000-0000-0000-0000-000000000001', 'bgd@demo.vn',        'Nguyễn Văn An',    1, null, true),
  ('00000000-0000-0000-0000-000000000002', 'ql.halong@demo.vn',  'Trần Thị Bình',    2, 5,    true),
  ('00000000-0000-0000-0000-000000000003', 'kho.halong@demo.vn', 'Lê Minh Châu',     3, 5,    true),
  ('00000000-0000-0000-0000-000000000004', 'bs.halong@demo.vn',  'BS. Đỗ Quang Hải', 4, 5,    true),
  ('00000000-0000-0000-0000-000000000005', 'ql.maokhe@demo.vn',  'Phạm Thu Dung',    2, 8,    true),
  ('00000000-0000-0000-0000-000000000006', 'kho.maokhe@demo.vn', 'Hoàng Văn Em',     3, 8,    true),
  ('00000000-0000-0000-0000-000000000007', 'khotong@demo.vn',    'Vũ Thị Giang',     2, 9,    true),
  ('00000000-0000-0000-0000-000000000008', 'moi@demo.vn',        'Ngô Văn Mới',      null, null, false)
on conflict (id) do update set full_name = excluded.full_name, department_id = excluded.department_id,
  branch_id = excluded.branch_id, active = excluded.active;

do $$
declare
  v_t   jsonb;
  -- k-th vật tư nhiều tồn nhất ở Kho tổng
  kt    int[] := array(select item_id from stock_lots where branch_id = 9 and qty >= 10 order by qty desc, item_id limit 12);
  hl    int[] := array(select item_id from stock_lots where branch_id = 5 and qty >= 2 order by qty desc, item_id limit 6);
begin
  -- Mức tối thiểu mẫu để thấy cảnh báo (bản thật: tự đặt trong Danh mục)
  update items set default_min_qty = 5 where id = any(hl);

  -- Bác sĩ Hạ Long ghi xuất dùng hôm nay
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
  perform public.record_usage(jsonb_build_object('branch_id', 5, 'lines', jsonb_build_array(
    jsonb_build_object('item_id', hl[1], 'qty', 2, 'reason', 'Điều trị'),
    jsonb_build_object('item_id', hl[2], 'qty', 1, 'reason', 'Điều trị'))));

  -- Mạo Khê xin Kho tổng → Kho tổng đã duyệt và đã gửi, chờ Mạo Khê nhận
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
  v_t := public.create_transfer(jsonb_build_object('from_branch_id', 9, 'note', 'Bổ sung cuối tuần',
    'lines', jsonb_build_array(jsonb_build_object('item_id', kt[1], 'qty', 5), jsonb_build_object('item_id', kt[2], 'qty', 3))));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'approve'));
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'ship'));

  -- Hạ Long xin Kho tổng → chờ Kho tổng duyệt
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  perform public.create_transfer(jsonb_build_object('from_branch_id', 9, 'note', 'Ca implant tuần sau',
    'lines', jsonb_build_array(jsonb_build_object('item_id', kt[3], 'qty', 4), jsonb_build_object('item_id', kt[4], 'qty', 2))));

  perform set_config('request.jwt.claim.sub', '', false);
end $$;
