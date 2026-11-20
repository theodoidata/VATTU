-- Dữ liệu mẫu cho bản DEMO (chỉ chạy trong trình duyệt, không dùng cho Supabase thật)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'bgd@demo.vn'),
  ('00000000-0000-0000-0000-000000000002', 'ql.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000003', 'kho.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000004', 'bs.halong@demo.vn'),
  ('00000000-0000-0000-0000-000000000005', 'ql.maokhe@demo.vn'),
  ('00000000-0000-0000-0000-000000000006', 'kho.maokhe@demo.vn'),
  ('00000000-0000-0000-0000-000000000007', 'kho.hungvuong@demo.vn'),
  ('00000000-0000-0000-0000-000000000008', 'moi@demo.vn');

insert into profiles (id, email, full_name, department_id, branch_id, active) values
  ('00000000-0000-0000-0000-000000000001', 'bgd@demo.vn',          'Nguyễn Văn An',    1, null, true),
  ('00000000-0000-0000-0000-000000000002', 'ql.halong@demo.vn',    'Trần Thị Bình',    2, 5,    true),
  ('00000000-0000-0000-0000-000000000003', 'kho.halong@demo.vn',   'Lê Minh Châu',     3, 5,    true),
  ('00000000-0000-0000-0000-000000000004', 'bs.halong@demo.vn',    'BS. Đỗ Quang Hải', 4, 5,    true),
  ('00000000-0000-0000-0000-000000000005', 'ql.maokhe@demo.vn',    'Phạm Thu Dung',    2, 8,    true),
  ('00000000-0000-0000-0000-000000000006', 'kho.maokhe@demo.vn',   'Hoàng Văn Em',     3, 8,    true),
  ('00000000-0000-0000-0000-000000000007', 'kho.hungvuong@demo.vn','Vũ Thị Giang',     3, 1,    true),
  ('00000000-0000-0000-0000-000000000008', 'moi@demo.vn',          'Ngô Văn Mới',      null, null, false);

do $$
declare
  b       record;
  i       record;
  d       int;
  v_lines jsonb;
  v_q     numeric;
  v_scale numeric;
  v_t     jsonb;
  v_today date := app.today();
begin
  perform setseed(0.42);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

  -- Tồn đầu kỳ cho 8 chi nhánh
  for b in select * from branches order by id loop
    v_scale := case b.code when 'HL' then 1.5 when 'HV' then 1.3 when 'MK' then 0.6 when 'QY' then 0.7 else 1 end;
    v_lines := '[]'::jsonb;
    for i in select * from items order by id loop
      continue when random() < 0.06;
      v_q := ceil(greatest(i.default_min_qty, 1) * v_scale * (0.3 + random() * 3.2));
      if i.track_lot then
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('item_id', i.id, 'qty', ceil(v_q * 0.4),
            'lot_no', upper(left(i.code, 2)) || to_char(2500 + floor(random() * 900), 'FM0000'),
            'expiry_date', v_today + (12 + floor(random() * 150))::int),
          jsonb_build_object('item_id', i.id, 'qty', greatest(v_q - ceil(v_q * 0.4), 1),
            'lot_no', upper(left(i.code, 2)) || to_char(3500 + floor(random() * 900), 'FM0000'),
            'expiry_date', v_today + (220 + floor(random() * 500))::int));
      else
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', i.id, 'qty', v_q));
      end if;
    end loop;
    perform public.record_receipt(jsonb_build_object('branch_id', b.id, 'receipt_date', v_today - 20,
      'supplier', 'Tồn đầu kỳ', 'note', 'Nhập tồn đầu kỳ (dữ liệu demo)', 'lines', v_lines));
  end loop;

  -- Một lô đã hết hạn ở Hạ Long để thấy cảnh báo
  perform app.add_stock(5::smallint, (select id from items where code = 'TT-MEPI'), 'MP2301',
                        v_today - 10, 12, 'receipt', v_today - 60, 'Tồn đầu kỳ', null, null);

  -- Xuất dùng 7 ngày gần nhất
  for d in reverse 6..0 loop
    for b in select * from branches order by id loop
      v_lines := '[]'::jsonb;
      for i in
        select it.*, (select coalesce(sum(l.qty), 0) from stock_lots l
                       where l.branch_id = b.id and l.item_id = it.id
                         and (l.expiry_date is null or l.expiry_date >= v_today - d)) as avail
          from items it order by random() limit 7
      loop
        v_q := case when i.track_lot then 1 + floor(random() * 3)
                    when i.default_min_qty >= 100 then 10 + floor(random() * 40)
                    else 1 + floor(random() * 2) end;
        v_q := least(v_q, i.avail);
        continue when v_q <= 0;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', i.id, 'qty', v_q, 'reason', 'Điều trị'));
      end loop;
      if jsonb_array_length(v_lines) > 0 then
        perform public.record_usage(jsonb_build_object('branch_id', b.id, 'usage_date', v_today - d, 'lines', v_lines));
      end if;
    end loop;
  end loop;

  -- Điều chuyển mẫu: Mạo Khê (8) xin hàng Hạ Long (5) ở nhiều trạng thái
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
  v_t := public.create_transfer(jsonb_build_object('from_branch_id', 5, 'note', 'Sắp hết thuốc tê, cần gấp',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from items where code = 'TT-ARTI'), 'qty', 20),
                               jsonb_build_object('item_id', (select id from items where code = 'TH-GT-M'), 'qty', 100))));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'approve'));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'ship'));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'receive', 'reason', 'Đã nhận đủ'));

  v_t := public.create_transfer(jsonb_build_object('from_branch_id', 5, 'note', 'Ca implant thứ 7',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from items where code = 'IM-4010'), 'qty', 2),
                               jsonb_build_object('item_id', (select id from items where code = 'IM-XUONG'), 'qty', 1))));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'approve'));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'ship'));

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
  perform public.create_transfer(jsonb_build_object('from_branch_id', 5, 'note', 'Bổ sung composite',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from items where code = 'TR-COMP-A2'), 'qty', 2),
                               jsonb_build_object('item_id', (select id from items where code = 'TR-BOND'), 'qty', 1))));

  v_t := public.create_transfer(jsonb_build_object('from_branch_id', 1, 'note', 'Xin găng tay size S',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from items where code = 'TH-GT-S'), 'qty', 200))));
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  perform public.transfer_action(jsonb_build_object('id', v_t->'id', 'action', 'reject',
    'reason', 'Hùng Vương cũng sắp hết, chờ kế toán nhập'));

  -- Hạ Long xin hàng Hùng Vương (chờ Hùng Vương duyệt)
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  perform public.create_transfer(jsonb_build_object('from_branch_id', 1, 'note', '',
    'lines', jsonb_build_array(jsonb_build_object('item_id', (select id from items where code = 'LD-ALG'), 'qty', 2))));

  perform set_config('request.jwt.claim.sub', '', false);
end $$;
