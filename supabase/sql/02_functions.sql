-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 02. Hàm xử lý nghiệp vụ
-- Mọi thao tác của web đều đi qua các hàm RPC trong schema public,
-- mỗi hàm tự kiểm tra quyền + chi nhánh. Hàm nội bộ nằm trong schema app
-- (không mở ra ngoài API).
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Hàm nội bộ
-- ---------------------------------------------------------------------
create or replace function app.today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function app.fmt(n numeric) returns text
language sql immutable as $$ select coalesce(trim_scale(n)::text, '0') $$;

create or replace function app.perms_of(p_uid uuid) returns text[]
language sql stable security definer set search_path = public, app as $$
  select coalesce(array_agg(pm.key order by pm.key), '{}'::text[])
  from permissions pm
  join profiles pr on pr.id = p_uid and pr.active
  left join department_permissions dp
         on dp.department_id = pr.department_id and dp.permission_key = pm.key
  left join user_permission_overrides o
         on o.user_id = p_uid and o.permission_key = pm.key
  where coalesce(o.enabled, dp.enabled, false)
$$;

create or replace function app.has(p_key text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select p_key = any(app.perms_of(auth.uid()))
$$;

create or replace function app.me() returns profiles
language plpgsql stable security definer set search_path = public, app as $$
declare r profiles;
begin
  select * into r from profiles where id = auth.uid();
  if r.id is null then
    raise exception 'Bạn chưa đăng nhập hoặc tài khoản chưa có hồ sơ nhân viên.';
  end if;
  if not r.active then
    raise exception 'Tài khoản đang chờ BGĐ kích hoạt và phân quyền.';
  end if;
  return r;
end $$;

create or replace function app.require(p_key text) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.has(p_key) then
    raise exception 'Bạn chưa được cấp quyền: %',
      coalesce((select label from permissions where key = p_key), p_key);
  end if;
end $$;

create or replace function app.can_act(p_branch smallint) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has('inv_all_branches')
      or exists (select 1 from profiles where id = auth.uid() and branch_id = p_branch)
$$;

create or replace function app.can_view(p_branch smallint) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.can_act(p_branch) or app.has('inv_stock_view_all') or app.has('inv_report_view_all')
$$;

create or replace function app.require_branch(p_branch smallint) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if p_branch is null then
    raise exception 'Vui lòng chọn chi nhánh.';
  end if;
  if not app.can_act(p_branch) then
    raise exception 'Bạn chỉ được thao tác trên chi nhánh của mình.';
  end if;
end $$;

create or replace function app.branch_name(p_id smallint) returns text
language sql stable as $$ select name from branches where id = p_id $$;

create or replace function app.person(p_id uuid) returns text
language sql stable as $$ select nullif(full_name, '') from profiles where id = p_id $$;

create or replace function app.item_label(p_id int) returns text
language sql stable as $$ select name || ' [' || code || ']' from items where id = p_id $$;

-- Cộng tồn vào lô (tạo lô nếu chưa có) + ghi sổ kho
create or replace function app.add_stock(
  p_branch smallint, p_item int, p_lot text, p_exp date, p_qty numeric,
  p_kind text, p_date date, p_reason text, p_doc_type text, p_doc_id bigint
) returns bigint
language plpgsql security definer set search_path = public, app as $$
declare v_id bigint;
begin
  if p_qty is null or p_qty <= 0 then return null; end if;
  select id into v_id from stock_lots
   where branch_id = p_branch and item_id = p_item and lot_no = coalesce(p_lot, '')
     and coalesce(expiry_date, '9999-12-31'::date) = coalesce(p_exp, '9999-12-31'::date)
   for update;
  if v_id is null then
    insert into stock_lots (branch_id, item_id, lot_no, expiry_date, qty)
    values (p_branch, p_item, coalesce(p_lot, ''), p_exp, 0)
    returning id into v_id;
  end if;
  update stock_lots set qty = qty + p_qty where id = v_id;
  insert into movements (movement_date, branch_id, item_id, lot_id, lot_no, expiry_date,
                         qty_change, kind, reason, doc_type, doc_id, user_id)
  values (p_date, p_branch, p_item, v_id, coalesce(p_lot, ''), p_exp,
          p_qty, p_kind, p_reason, p_doc_type, p_doc_id, auth.uid());
  return v_id;
end $$;

-- Trừ tồn: theo lô chỉ định, hoặc tự động lô hết hạn sớm nhất trước (FEFO)
create or replace function app.take_stock(
  p_branch smallint, p_item int, p_qty numeric, p_kind text, p_date date,
  p_reason text, p_doc_type text, p_doc_id bigint,
  p_lot_id bigint default null, p_allow_expired boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_rem   numeric := p_qty;
  v_avail numeric;
  v_take  numeric;
  v_out   jsonb := '[]'::jsonb;
  v_unit  text;
  r       stock_lots;
begin
  if p_qty is null or p_qty <= 0 then return v_out; end if;
  select unit into v_unit from items where id = p_item;
  if v_unit is null then raise exception 'Vật tư không tồn tại.'; end if;

  if p_lot_id is not null then
    select * into r from stock_lots
     where id = p_lot_id and branch_id = p_branch and item_id = p_item for update;
    if r.id is null then raise exception 'Không tìm thấy lô đã chọn của %.', app.item_label(p_item); end if;
    if not p_allow_expired and r.expiry_date is not null and r.expiry_date < p_date then
      raise exception '% — lô % đã hết hạn, không được xuất dùng.', app.item_label(p_item), r.lot_no;
    end if;
    if r.qty < p_qty then
      raise exception '% — lô % chỉ còn % %.', app.item_label(p_item), r.lot_no, app.fmt(r.qty), v_unit;
    end if;
    update stock_lots set qty = qty - p_qty where id = r.id;
    insert into movements (movement_date, branch_id, item_id, lot_id, lot_no, expiry_date,
                           qty_change, kind, reason, doc_type, doc_id, user_id)
    values (p_date, p_branch, p_item, r.id, r.lot_no, r.expiry_date,
            -p_qty, p_kind, p_reason, p_doc_type, p_doc_id, auth.uid());
    return jsonb_build_array(jsonb_build_object('lot_id', r.id, 'lot_no', r.lot_no,
                                                'expiry_date', r.expiry_date, 'qty', p_qty));
  end if;

  select coalesce(sum(qty), 0) into v_avail from stock_lots
   where branch_id = p_branch and item_id = p_item and qty > 0
     and (p_allow_expired or expiry_date is null or expiry_date >= p_date);
  if v_avail < p_qty then
    raise exception '% không đủ tồn: còn % %, cần % %.',
      app.item_label(p_item), app.fmt(v_avail), v_unit, app.fmt(p_qty), v_unit;
  end if;

  for r in
    select * from stock_lots
     where branch_id = p_branch and item_id = p_item and qty > 0
       and (p_allow_expired or expiry_date is null or expiry_date >= p_date)
     order by expiry_date nulls last, id
     for update
  loop
    v_take := least(r.qty, v_rem);
    update stock_lots set qty = qty - v_take where id = r.id;
    insert into movements (movement_date, branch_id, item_id, lot_id, lot_no, expiry_date,
                           qty_change, kind, reason, doc_type, doc_id, user_id)
    values (p_date, p_branch, p_item, r.id, r.lot_no, r.expiry_date,
            -v_take, p_kind, p_reason, p_doc_type, p_doc_id, auth.uid());
    v_out := v_out || jsonb_build_array(jsonb_build_object('lot_id', r.id, 'lot_no', r.lot_no,
                                                           'expiry_date', r.expiry_date, 'qty', v_take));
    v_rem := v_rem - v_take;
    exit when v_rem <= 0;
  end loop;
  return v_out;
end $$;

-- Còn ít nhất 1 người quản trị phân quyền (tránh tự khóa hệ thống)
create or replace function app.ensure_admin_exists() returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from profiles p where p.active
                   and 'admin_permissions' = any(app.perms_of(p.id))) then
    raise exception 'Phải còn ít nhất một tài khoản đang hoạt động có quyền Phân quyền.';
  end if;
end $$;

-- Số còn dùng được (chưa hết hạn) của 1 vật tư tại 1 chi nhánh
create or replace function app.usable_qty(p_branch smallint, p_item int) returns numeric
language sql stable security definer set search_path = public, app as $$
  select coalesce(sum(qty), 0) from stock_lots
   where branch_id = p_branch and item_id = p_item and (expiry_date is null or expiry_date >= app.today())
$$;

create or replace function app.transfer_json(p_id bigint) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select to_jsonb(t) || jsonb_build_object(
    'from_branch_name', app.branch_name(t.from_branch_id),
    'to_branch_name',   app.branch_name(t.to_branch_id),
    'requested_by_name', app.person(t.requested_by),
    'approved_by_name',  app.person(t.approved_by),
    'shipped_by_name',   app.person(t.shipped_by),
    'received_by_name',  app.person(t.received_by),
    'closed_by_name',    app.person(t.closed_by),
    'has_shortage', exists (select 1 from transfer_lines x where x.transfer_id = t.id
                             and x.qty_received is not null and x.qty_received < x.qty_approved),
    -- Chờ hàng về: phiếu chưa gửi mà chi nhánh cấp không đủ hàng (vd Kho tổng đang hết, chờ nhập NCC)
    'awaiting_stock', t.status in ('pending', 'approved') and exists (
      select 1 from transfer_lines x where x.transfer_id = t.id
         and app.usable_qty(t.from_branch_id, x.item_id) < coalesce(x.qty_approved, x.qty_requested)),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object(
               'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
               'src_usable', case when t.status in ('pending', 'approved') then app.usable_qty(t.from_branch_id, l.item_id) end)
             order by l.id)
        from transfer_lines l join items i on i.id = l.item_id
       where l.transfer_id = t.id), '[]'::jsonb))
  from transfers t where t.id = p_id
$$;

-- ---------------------------------------------------------------------
-- PHIÊN LÀM VIỆC
-- ---------------------------------------------------------------------
create or replace function public.get_session(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  return jsonb_build_object(
    'profile', case when me.id is null then null else
      to_jsonb(me) || jsonb_build_object(
        'department_name', (select name from departments where id = me.department_id),
        'branch_name', app.branch_name(me.branch_id)) end,
    'permissions', to_jsonb(app.perms_of(auth.uid())),
    'branches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.sort_order), '[]'::jsonb)
                   from branches b where b.active),
    'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.sort_order), '[]'::jsonb)
                 from item_groups g),
    'today', app.today());
end $$;

-- ---------------------------------------------------------------------
-- DANH MỤC VẬT TƯ
-- ---------------------------------------------------------------------
create or replace function public.list_items(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.me();
  return (
    select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
             'group_name', g.name,
             'mins', coalesce((select jsonb_object_agg(s.branch_id::text, s.min_qty)
                                 from item_branch_settings s where s.item_id = i.id), '{}'::jsonb))
           order by g.sort_order, i.name), '[]'::jsonb)
      from items i left join item_groups g on g.id = i.group_id
     where i.active or app.has('inv_catalog_manage'));
end $$;

create or replace function public.save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_id   int := nullif(p->>'id', '')::int;
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_name text := trim(coalesce(p->>'name', ''));
  v_unit text := trim(coalesce(p->>'unit', ''));
begin
  perform app.me();
  perform app.require('inv_catalog_manage');
  if v_code = '' or v_name = '' or v_unit = '' then
    raise exception 'Mã, tên và đơn vị tính là bắt buộc.';
  end if;
  if exists (select 1 from items where code = v_code and id is distinct from v_id) then
    raise exception 'Mã vật tư % đã tồn tại.', v_code;
  end if;
  if v_id is null then
    insert into items (code, name, group_id, unit, purchase_unit, purchase_factor,
                       track_lot, default_min_qty, note, active)
    values (v_code, v_name, nullif(p->>'group_id', '')::int, v_unit,
            nullif(trim(coalesce(p->>'purchase_unit', '')), ''),
            coalesce(nullif(p->>'purchase_factor', '')::numeric, 1),
            coalesce((p->>'track_lot')::boolean, false),
            coalesce(nullif(p->>'default_min_qty', '')::numeric, 0),
            nullif(p->>'note', ''), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update items set code = v_code, name = v_name,
           group_id = nullif(p->>'group_id', '')::int, unit = v_unit,
           purchase_unit = nullif(trim(coalesce(p->>'purchase_unit', '')), ''),
           purchase_factor = coalesce(nullif(p->>'purchase_factor', '')::numeric, 1),
           track_lot = coalesce((p->>'track_lot')::boolean, false),
           default_min_qty = coalesce(nullif(p->>'default_min_qty', '')::numeric, 0),
           note = nullif(p->>'note', ''),
           active = coalesce((p->>'active')::boolean, true)
     where id = v_id;
    if not found then raise exception 'Không tìm thấy vật tư.'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Tồn tối thiểu của 1 vật tư tại 1 chi nhánh (min_qty = null → dùng mặc định)
create or replace function public.save_min_qty(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_item   int := (p->>'item_id')::int;
  v_branch smallint := (p->>'branch_id')::smallint;
  v_min    numeric := nullif(p->>'min_qty', '')::numeric;
begin
  perform app.me();
  perform app.require('inv_min_manage');
  perform app.require_branch(v_branch);
  if v_min is null then
    delete from item_branch_settings where item_id = v_item and branch_id = v_branch;
  else
    if v_min < 0 then raise exception 'Tồn tối thiểu không được âm.'; end if;
    insert into item_branch_settings (item_id, branch_id, min_qty) values (v_item, v_branch, v_min)
    on conflict (item_id, branch_id) do update set min_qty = excluded.min_qty;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- TỒN KHO
-- ---------------------------------------------------------------------
create or replace function public.get_stock(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  v_branch smallint := coalesce(nullif(p->>'branch_id', '')::smallint, me.branch_id);
  v_today date := app.today();
begin
  perform app.require('inv_stock_view');
  if v_branch is null then raise exception 'Vui lòng chọn chi nhánh.'; end if;
  if not app.can_act(v_branch) then perform app.require('inv_stock_view_all'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit,
             'purchase_unit', i.purchase_unit, 'purchase_factor', i.purchase_factor,
             'group_id', i.group_id, 'group_name', g.name, 'track_lot', i.track_lot,
             'min_qty', coalesce(s.min_qty, i.default_min_qty),
             'min_is_custom', s.min_qty is not null,
             'qty', st.qty, 'usable_qty', st.usable, 'nearest_expiry', st.nearest,
             'lots', st.lots)
           order by g.sort_order, i.name), '[]'::jsonb)
      from items i
      left join item_groups g on g.id = i.group_id
      left join item_branch_settings s on s.item_id = i.id and s.branch_id = v_branch
      cross join lateral (
        select coalesce(sum(l.qty), 0) as qty,
               coalesce(sum(l.qty) filter (where l.expiry_date is null or l.expiry_date >= v_today), 0) as usable,
               min(l.expiry_date) as nearest,
               coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lot_no', l.lot_no,
                          'expiry_date', l.expiry_date, 'qty', l.qty)
                        order by l.expiry_date nulls last, l.id), '[]'::jsonb) as lots
          from stock_lots l
         where l.branch_id = v_branch and l.item_id = i.id and l.qty > 0) st
     where i.active
       -- Tiết kiệm dữ liệu: mặc định chỉ trả vật tư đang có tồn hoặc có đặt mức tối thiểu.
       -- p.all = true để lấy cả danh mục.
       and (coalesce((p->>'all')::boolean, false) or st.qty > 0
            or coalesce(s.min_qty, i.default_min_qty) > 0));
end $$;

-- Tồn 1 vật tư ở mọi chi nhánh (khung chi tiết vật tư → biết xin điều chuyển ở đâu).
-- Ai xem được tồn kho là xem được — chỉ trả số lượng tổng, không lộ chi tiết khác.
create or replace function public.get_item_branches(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_item int := nullif(p->>'item_id', '')::int;
  v_today date := app.today();
begin
  perform app.me();
  perform app.require('inv_stock_view');
  if v_item is null then raise exception 'Thiếu vật tư.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'branch_id', b.id, 'branch_code', b.code, 'branch_name', b.name,
             'qty', coalesce(x.qty, 0), 'usable', coalesce(x.usable, 0),
             'min', coalesce(s.min_qty, i.default_min_qty), 'nearest_expiry', x.nearest)
           order by b.sort_order), '[]'::jsonb)
      from branches b
      join items i on i.id = v_item
      left join item_branch_settings s on s.item_id = i.id and s.branch_id = b.id
      left join lateral (
        select sum(l.qty) as qty,
               sum(l.qty) filter (where l.expiry_date is null or l.expiry_date >= v_today) as usable,
               min(l.expiry_date) filter (where l.expiry_date >= v_today) as nearest
          from stock_lots l where l.item_id = i.id and l.branch_id = b.id and l.qty > 0) x on true
     where b.active);
end $$;

-- Ma trận tồn: vật tư × chi nhánh
create or replace function public.get_stock_matrix(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_today date := app.today();
begin
  perform app.me();
  if not (app.has('inv_stock_view_all') or app.has('inv_report_view_all')) then
    raise exception 'Bạn chưa được cấp quyền xem tồn tất cả chi nhánh.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit,
             'group_id', i.group_id, 'group_name', g.name,
             'by_branch', bb.v)
           order by g.sort_order, i.name), '[]'::jsonb)
      from items i left join item_groups g on g.id = i.group_id
      -- Tiết kiệm dữ liệu: chỉ ghi ô chi nhánh có tồn hoặc có mức tối thiểu (ô thiếu = 0);
      -- bỏ hẳn vật tư không có ô nào.
      cross join lateral (
        select jsonb_object_agg(b.id::text, jsonb_build_object(
                 'qty', coalesce(x.qty, 0), 'usable', coalesce(x.usable, 0),
                 'min', coalesce(s.min_qty, i.default_min_qty))) as v
          from branches b
          left join item_branch_settings s on s.item_id = i.id and s.branch_id = b.id
          left join lateral (
            select sum(l.qty) as qty,
                   sum(l.qty) filter (where l.expiry_date is null or l.expiry_date >= v_today) as usable
              from stock_lots l where l.item_id = i.id and l.branch_id = b.id and l.qty > 0) x on true
         where b.active and (coalesce(x.qty, 0) > 0 or coalesce(s.min_qty, i.default_min_qty) > 0)) bb
     where i.active and bb.v is not null);
end $$;

-- ---------------------------------------------------------------------
-- XUẤT DÙNG HẰNG NGÀY
-- ---------------------------------------------------------------------
create or replace function public.record_usage(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := coalesce(nullif(p->>'branch_id', '')::smallint, me.branch_id);
  v_date   date := coalesce(nullif(p->>'usage_date', '')::date, app.today());
  v_doc    bigint;
  v_reason text;
  v_lots   jsonb;
  l        record;
begin
  perform app.require('inv_usage_create');
  perform app.require_branch(v_branch);
  if v_date > app.today() then raise exception 'Không thể ghi xuất cho ngày trong tương lai.'; end if;
  if v_date < app.today() - 7 then raise exception 'Chỉ được ghi bù tối đa 7 ngày trước.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Chưa chọn vật tư nào.';
  end if;

  insert into usage_docs (branch_id, usage_date, note, created_by)
  values (v_branch, v_date, nullif(p->>'note', ''), me.id) returning id into v_doc;

  for l in select * from jsonb_to_recordset(p->'lines')
             as x(item_id int, qty numeric, reason text, lot_id bigint)
  loop
    if l.item_id is null then raise exception 'Dòng vật tư chưa chọn vật tư.'; end if;
    if l.qty is null or l.qty <= 0 then
      raise exception '% — số lượng phải lớn hơn 0.', app.item_label(l.item_id);
    end if;
    v_reason := coalesce(nullif(trim(l.reason), ''), 'Điều trị');
    v_lots := app.take_stock(v_branch, l.item_id, l.qty, 'usage', v_date, v_reason,
                             'usage', v_doc, l.lot_id, v_reason = 'Hủy hết hạn');
    insert into usage_lines (doc_id, item_id, qty, reason, lots)
    values (v_doc, l.item_id, l.qty, v_reason, v_lots);
  end loop;
  return jsonb_build_object('id', v_doc);
end $$;

create or replace function public.list_usage(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := nullif(p->>'branch_id', '')::smallint;
  v_from   date := coalesce(nullif(p->>'from', '')::date, app.today() - 30);
  v_to     date := coalesce(nullif(p->>'to', '')::date, app.today());
begin
  if v_branch is null then
    if not app.has('inv_report_view_all') then
      v_branch := me.branch_id;
      if v_branch is null then raise exception 'Vui lòng chọn chi nhánh.'; end if;
    end if;
  elsif not app.can_act(v_branch) and not app.has('inv_report_view_all') then
    raise exception 'Bạn chỉ xem được phiếu của chi nhánh mình.';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
             'branch_name', app.branch_name(d.branch_id),
             'created_by_name', app.person(d.created_by),
             'voided_by_name', app.person(d.voided_by),
             'created_date', (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
             'lines', (select coalesce(jsonb_agg(to_jsonb(ul) || jsonb_build_object(
                                'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
                                'group_name', g.name) order by ul.id), '[]'::jsonb)
                         from usage_lines ul join items i on i.id = ul.item_id
                         left join item_groups g on g.id = i.group_id
                        where ul.doc_id = d.id))
           order by d.usage_date desc, d.id desc), '[]'::jsonb)
      from usage_docs d
     where (v_branch is null or d.branch_id = v_branch)
       and d.usage_date between v_from and v_to
       and (coalesce((p->>'include_voided')::boolean, true) or d.voided_at is null));
end $$;

create or replace function public.void_usage(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  d  usage_docs;
  m  movements;
begin
  perform app.require('inv_usage_void');
  select * into d from usage_docs where id = (p->>'id')::bigint for update;
  if d.id is null then raise exception 'Không tìm thấy phiếu xuất.'; end if;
  perform app.require_branch(d.branch_id);
  if d.voided_at is not null then raise exception 'Phiếu này đã được hủy trước đó.'; end if;
  if (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date < app.today()
     and not app.has('inv_all_branches') then
    raise exception 'Chỉ hủy được phiếu xuất tạo trong ngày hôm nay.';
  end if;
  if coalesce(trim(p->>'reason'), '') = '' then raise exception 'Vui lòng nhập lý do hủy phiếu.'; end if;

  for m in select * from movements where doc_type = 'usage' and doc_id = d.id and kind = 'usage' loop
    update stock_lots set qty = qty - m.qty_change where id = m.lot_id;
    insert into movements (movement_date, branch_id, item_id, lot_id, lot_no, expiry_date,
                           qty_change, kind, reason, doc_type, doc_id, user_id)
    values (app.today(), m.branch_id, m.item_id, m.lot_id, m.lot_no, m.expiry_date,
            -m.qty_change, 'void', 'Hủy phiếu xuất #' || d.id, 'usage', d.id, me.id);
  end loop;
  update usage_docs set voided_at = now(), voided_by = me.id, void_reason = trim(p->>'reason')
   where id = d.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- NHẬP KHO (tạm thời chi nhánh tự nhập tay; sau này kế toán phân bổ)
-- ---------------------------------------------------------------------
create or replace function public.record_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := coalesce(nullif(p->>'branch_id', '')::smallint, me.branch_id);
  v_date   date := coalesce(nullif(p->>'receipt_date', '')::date, app.today());
  v_doc    bigint;
  v_item   items;
  v_qty    numeric;
  v_unit   text;
  v_lot    text;
  l        record;
begin
  perform app.require('inv_receipt_create');
  perform app.require_branch(v_branch);
  if v_date > app.today() then raise exception 'Không thể nhập kho cho ngày trong tương lai.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Chưa chọn vật tư nào.';
  end if;

  insert into receipt_docs (branch_id, receipt_date, source, supplier, note, created_by)
  values (v_branch, v_date,
          case when app.has('inv_all_branches') and nullif(p->>'source', '') is not null
               then p->>'source' else 'Nhập tay chi nhánh' end,
          nullif(trim(coalesce(p->>'supplier', '')), ''), nullif(p->>'note', ''), me.id)
  returning id into v_doc;

  for l in select * from jsonb_to_recordset(p->'lines')
             as x(item_id int, qty numeric, unit_mode text, lot_no text, expiry_date date)
  loop
    select * into v_item from items where id = l.item_id;
    if v_item.id is null then raise exception 'Dòng nhập kho chưa chọn vật tư.'; end if;
    if l.qty is null or l.qty <= 0 then
      raise exception '% — số lượng phải lớn hơn 0.', app.item_label(v_item.id);
    end if;
    if l.unit_mode = 'purchase' and v_item.purchase_unit is not null then
      v_qty := l.qty * v_item.purchase_factor; v_unit := v_item.purchase_unit;
    else
      v_qty := l.qty; v_unit := v_item.unit;
    end if;
    v_lot := trim(coalesce(l.lot_no, ''));
    if v_item.track_lot and (v_lot = '' or l.expiry_date is null) then
      raise exception '% bắt buộc nhập số lô và hạn sử dụng.', app.item_label(v_item.id);
    end if;
    if l.expiry_date is not null and l.expiry_date < v_date then
      raise exception '% — lô % đã hết hạn (%), không nhập kho.',
        app.item_label(v_item.id), v_lot, to_char(l.expiry_date, 'DD/MM/YYYY');
    end if;
    insert into receipt_lines (doc_id, item_id, qty, input_qty, input_unit, lot_no, expiry_date)
    values (v_doc, v_item.id, v_qty, l.qty, v_unit, v_lot, l.expiry_date);
    perform app.add_stock(v_branch, v_item.id, v_lot, l.expiry_date, v_qty, 'receipt', v_date,
                          'Nhập kho #' || v_doc, 'receipt', v_doc);
  end loop;
  return jsonb_build_object('id', v_doc);
end $$;

-- Đổi nhanh tên / đơn vị dùng của 1 vật tư (khung chi tiết vật tư, cột đơn vị ở Nhập kho).
-- Chỉ đổi chữ hiển thị, không đổi số lượng tồn.
create or replace function public.update_item_basic(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_id   int := nullif(p->>'id', '')::int;
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
  v_unit text := nullif(trim(coalesce(p->>'unit', '')), '');
begin
  perform app.me();
  perform app.require('inv_catalog_manage');
  if p ? 'name' and v_name is null then raise exception 'Tên vật tư không được để trống.'; end if;
  if p ? 'unit' and v_unit is null then raise exception 'Đơn vị tính không được để trống.'; end if;
  update items set name = coalesce(v_name, name), unit = coalesce(v_unit, unit) where id = v_id;
  if not found then raise exception 'Không tìm thấy vật tư.'; end if;
  return (select jsonb_build_object('id', id, 'name', name, 'unit', unit) from items where id = v_id);
end $$;

-- Đổi tên nhóm danh mục (mặc định chỉ BGĐ có quyền)
create or replace function public.rename_group(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_id   int := nullif(p->>'id', '')::int;
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  perform app.me();
  perform app.require('inv_group_manage');
  if v_name is null then raise exception 'Tên nhóm không được để trống.'; end if;
  if exists (select 1 from item_groups where lower(name) = lower(v_name) and id <> v_id) then
    raise exception 'Đã có nhóm tên “%”.', v_name;
  end if;
  update item_groups set name = v_name where id = v_id;
  if not found then raise exception 'Không tìm thấy nhóm.'; end if;
  return (select to_jsonb(g) from item_groups g where id = v_id);
end $$;

-- Tách đơn vị lẻ: vật tư đang tính theo 1 đơn vị (vd "hộp") → đặt 1 hộp = N đơn vị nhỏ (vd "sợi").
-- Từ đó tồn được đếm theo đơn vị nhỏ (hiển thị gộp "1 hộp 1 sợi"), nên mọi số lượng cũ
-- (tồn, tối thiểu, lịch sử, phiếu đang dở) được nhân N để không lệch.
create or replace function public.set_item_conversion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_id    int := nullif(p->>'item_id', '')::int;
  v_small text := nullif(trim(coalesce(p->>'small_unit', '')), '');
  v_n     numeric := nullif(p->>'factor', '')::numeric;
  v_item  items;
begin
  perform app.me();
  perform app.require('inv_catalog_manage');
  select * into v_item from items where id = v_id for update;
  if not found then raise exception 'Không tìm thấy vật tư.'; end if;
  if v_item.purchase_unit is not null and v_item.purchase_factor <> 1 then
    raise exception 'Vật tư này đã có quy đổi (1 % = % %). Muốn sửa số quy đổi thì vào Danh mục.',
      v_item.purchase_unit, app.fmt(v_item.purchase_factor), v_item.unit;
  end if;
  if v_small is null then raise exception 'Chưa nhập đơn vị nhỏ (vd: sợi, cái).'; end if;
  if lower(v_small) = lower(v_item.unit) then raise exception 'Đơn vị nhỏ phải khác đơn vị hiện tại (%).', v_item.unit; end if;
  if v_n is null or v_n < 2 or v_n <> trunc(v_n) or v_n > 100000 then
    raise exception 'Số quy đổi phải là số nguyên từ 2 trở lên.';
  end if;

  update stock_lots set qty = qty * v_n where item_id = v_id;
  update item_branch_settings set min_qty = min_qty * v_n where item_id = v_id;
  update movements set qty_change = qty_change * v_n where item_id = v_id;
  update receipt_lines set qty = qty * v_n where item_id = v_id;  -- input_qty/input_unit giữ nguyên (vẫn là "hộp")
  update usage_lines set qty = qty * v_n,
         lots = coalesce((select jsonb_agg(x || jsonb_build_object('qty', (x->>'qty')::numeric * v_n)) from jsonb_array_elements(lots) x), '[]'::jsonb)
   where item_id = v_id;
  update transfer_lines set qty_requested = qty_requested * v_n, qty_approved = qty_approved * v_n, qty_received = qty_received * v_n,
         lots = coalesce((select jsonb_agg(x || jsonb_build_object('qty', (x->>'qty')::numeric * v_n)) from jsonb_array_elements(lots) x), '[]'::jsonb)
   where item_id = v_id;
  update stocktake_lines set system_qty = system_qty * v_n, counted_qty = counted_qty * v_n where item_id = v_id;
  update items set purchase_unit = unit, purchase_factor = v_n, unit = v_small, default_min_qty = default_min_qty * v_n
   where id = v_id;

  return (select jsonb_build_object('id', id, 'unit', unit, 'purchase_unit', purchase_unit, 'purchase_factor', purchase_factor)
            from items where id = v_id);
end $$;

-- Sửa phiếu nhập đã lưu (BGĐ / Kế toán). Tồn kho điều chỉnh theo CHÊNH LỆCH từng vật tư + lô:
-- tăng thì cộng thêm, giảm thì trừ đúng lô đó (lô đã dùng / chuyển hết thì không cho giảm).
create or replace function public.edit_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me      profiles := app.me();
  d       receipt_docs;
  v_date  date;
  v_item  items;
  v_qty   numeric;
  v_unit  text;
  v_lot   text;
  v_lotid bigint;
  v_have  numeric;
  v_why   text;
  v_new   jsonb := '[]'::jsonb;
  l       record;
begin
  perform app.require('inv_receipt_edit');
  select * into d from receipt_docs where id = nullif(p->>'id', '')::bigint for update;
  if d.id is null then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  perform app.require_branch(d.branch_id);
  v_date := coalesce(nullif(p->>'receipt_date', '')::date, d.receipt_date);
  if v_date > app.today() then raise exception 'Không thể nhập kho cho ngày trong tương lai.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Phiếu phải còn ít nhất 1 vật tư.';
  end if;
  v_why := 'Sửa phiếu nhập #' || d.id;

  -- Dòng mới, quy về đơn vị dùng
  for l in select * from jsonb_to_recordset(p->'lines')
             as x(item_id int, qty numeric, unit_mode text, lot_no text, expiry_date date)
  loop
    select * into v_item from items where id = l.item_id;
    if v_item.id is null then raise exception 'Dòng nhập kho chưa chọn vật tư.'; end if;
    if l.qty is null or l.qty <= 0 then raise exception '% — số lượng phải lớn hơn 0.', app.item_label(v_item.id); end if;
    if l.unit_mode = 'purchase' and v_item.purchase_unit is not null then
      v_qty := l.qty * v_item.purchase_factor; v_unit := v_item.purchase_unit;
    else
      v_qty := l.qty; v_unit := v_item.unit;
    end if;
    v_lot := trim(coalesce(l.lot_no, ''));
    if v_item.track_lot and (v_lot = '' or l.expiry_date is null) then
      raise exception '% bắt buộc nhập số lô và hạn sử dụng.', app.item_label(v_item.id);
    end if;
    v_new := v_new || jsonb_build_object('item_id', v_item.id, 'qty', v_qty, 'input_qty', l.qty,
                                         'input_unit', v_unit, 'lot_no', v_lot, 'expiry_date', l.expiry_date);
  end loop;

  -- Chênh lệch theo vật tư + lô + hạn dùng
  for l in
    with o as (select item_id, lot_no, expiry_date, sum(qty) q from receipt_lines where doc_id = d.id group by 1, 2, 3),
         n as (select item_id, lot_no, expiry_date, sum(qty) q
                 from jsonb_to_recordset(v_new) as x(item_id int, qty numeric, lot_no text, expiry_date date)
                group by 1, 2, 3)
    select coalesce(n.item_id, o.item_id) item_id, coalesce(n.lot_no, o.lot_no) lot_no,
           coalesce(n.expiry_date, o.expiry_date) expiry_date, coalesce(n.q, 0) - coalesce(o.q, 0) delta
      from o full join n on n.item_id = o.item_id and n.lot_no = o.lot_no
                        and coalesce(n.expiry_date, '9999-12-31'::date) = coalesce(o.expiry_date, '9999-12-31'::date)
  loop
    if l.delta > 0 then
      perform app.add_stock(d.branch_id, l.item_id, l.lot_no, l.expiry_date, l.delta, 'adjust', app.today(), v_why, 'receipt', d.id);
    elsif l.delta < 0 then
      v_lotid := null; v_have := null;
      select id, qty into v_lotid, v_have from stock_lots
       where branch_id = d.branch_id and item_id = l.item_id and lot_no = l.lot_no
         and coalesce(expiry_date, '9999-12-31'::date) = coalesce(l.expiry_date, '9999-12-31'::date);
      if v_lotid is null or v_have < -l.delta then
        raise exception '% — lô % chỉ còn % trong kho (đã xuất dùng / chuyển đi), không giảm được %. Hãy dùng Kiểm kê để điều chỉnh.',
          app.item_label(l.item_id), coalesce(nullif(l.lot_no, ''), '(không số lô)'), app.fmt(coalesce(v_have, 0)), app.fmt(-l.delta);
      end if;
      perform app.take_stock(d.branch_id, l.item_id, -l.delta, 'adjust', app.today(), v_why, 'receipt', d.id, v_lotid, true);
    end if;
  end loop;

  delete from receipt_lines where doc_id = d.id;
  insert into receipt_lines (doc_id, item_id, qty, input_qty, input_unit, lot_no, expiry_date)
  select d.id, item_id, qty, input_qty, input_unit, lot_no, expiry_date
    from jsonb_to_recordset(v_new) as x(item_id int, qty numeric, input_qty numeric, input_unit text, lot_no text, expiry_date date);
  update receipt_docs
     set receipt_date = v_date,
         supplier = nullif(trim(coalesce(p->>'supplier', '')), ''),
         note = nullif(p->>'note', ''),
         source = coalesce(nullif(p->>'source', ''), source),
         updated_by = me.id, updated_at = now()
   where id = d.id;
  return jsonb_build_object('ok', true, 'id', d.id);
end $$;

-- Xóa phiếu nhập (BGĐ / Kế toán): trừ lại đúng số đã nhập theo từng lô rồi xóa phiếu.
-- Lô đã xuất dùng / chuyển đi thì không xóa được (báo lỗi, không đổi gì).
create or replace function public.delete_receipt(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  d       receipt_docs;
  v_why   text;
  v_lotid bigint;
  v_have  numeric;
  l       record;
begin
  perform app.require('inv_receipt_edit');
  select * into d from receipt_docs where id = nullif(p->>'id', '')::bigint for update;
  if d.id is null then raise exception 'Không tìm thấy phiếu nhập.'; end if;
  perform app.require_branch(d.branch_id);
  v_why := 'Xóa phiếu nhập #' || d.id || coalesce(': ' || nullif(trim(coalesce(p->>'reason', '')), ''), '');
  for l in select item_id, lot_no, expiry_date, sum(qty) q from receipt_lines where doc_id = d.id group by 1, 2, 3 loop
    v_lotid := null; v_have := null;
    select id, qty into v_lotid, v_have from stock_lots
     where branch_id = d.branch_id and item_id = l.item_id and lot_no = l.lot_no
       and coalesce(expiry_date, '9999-12-31'::date) = coalesce(l.expiry_date, '9999-12-31'::date);
    if v_lotid is null or v_have < l.q then
      raise exception '% — lô % chỉ còn % trong kho (đã xuất dùng / chuyển đi), không xóa được phiếu. Hãy sửa phiếu hoặc dùng Kiểm kê.',
        app.item_label(l.item_id), coalesce(nullif(l.lot_no, ''), '(không số lô)'), app.fmt(coalesce(v_have, 0));
    end if;
    perform app.take_stock(d.branch_id, l.item_id, l.q, 'adjust', app.today(), v_why, 'receipt', d.id, v_lotid, true);
  end loop;
  delete from receipt_docs where id = d.id;
  return jsonb_build_object('ok', true, 'id', d.id);
end $$;

create or replace function public.list_receipts(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := nullif(p->>'branch_id', '')::smallint;
  v_from   date := coalesce(nullif(p->>'from', '')::date, app.today() - 30);
  v_to     date := coalesce(nullif(p->>'to', '')::date, app.today());
  v_id     bigint := nullif(p->>'id', '')::bigint;          -- lấy 1 phiếu (kèm chi tiết)
  v_lines  boolean := v_id is not null or coalesce((p->>'with_lines')::boolean, false);
begin
  if v_id is not null then
    select branch_id into v_branch from receipt_docs where id = v_id;
    if v_branch is null then raise exception 'Không tìm thấy phiếu nhập.'; end if;
    if not app.can_act(v_branch) and not app.has('inv_report_view_all') then
      raise exception 'Bạn chỉ xem được phiếu của chi nhánh mình.';
    end if;
  elsif v_branch is null then
    if not app.has('inv_report_view_all') then
      v_branch := me.branch_id;
      if v_branch is null then raise exception 'Vui lòng chọn chi nhánh.'; end if;
    end if;
  elsif not app.can_act(v_branch) and not app.has('inv_report_view_all') then
    raise exception 'Bạn chỉ xem được phiếu của chi nhánh mình.';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
             'branch_name', app.branch_name(d.branch_id),
             'created_by_name', app.person(d.created_by),
             'updated_by_name', app.person(d.updated_by),
             -- Danh sách chỉ gửi bản tóm tắt (số dòng + vài tên đầu) để đỡ tốn dữ liệu; chi tiết lấy khi mở phiếu
             'line_count', (select count(*) from receipt_lines rl where rl.doc_id = d.id),
             'preview', (select string_agg(x.name, ', ') from (select i.name from receipt_lines rl join items i on i.id = rl.item_id
                          where rl.doc_id = d.id order by rl.id limit 3) x))
           || case when v_lines then jsonb_build_object(
             'lines', (select coalesce(jsonb_agg(to_jsonb(rl) || jsonb_build_object(
                                'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
                                'group_name', g.name) order by rl.id), '[]'::jsonb)
                         from receipt_lines rl join items i on i.id = rl.item_id
                         left join item_groups g on g.id = i.group_id
                        where rl.doc_id = d.id)) else '{}'::jsonb end
           order by d.receipt_date desc, d.id desc), '[]'::jsonb)
      from receipt_docs d
     where (v_id is not null and d.id = v_id)
        or (v_id is null and (v_branch is null or d.branch_id = v_branch) and d.receipt_date between v_from and v_to));
end $$;

-- ---------------------------------------------------------------------
-- ĐIỀU CHUYỂN: A yêu cầu → B duyệt → B gửi (trừ kho B) → A nhận (cộng kho A)
-- ---------------------------------------------------------------------
create or replace function public.create_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me     profiles := app.me();
  v_to   smallint := coalesce(nullif(p->>'to_branch_id', '')::smallint, me.branch_id);
  v_from smallint := nullif(p->>'from_branch_id', '')::smallint;
  v_id   bigint;
  l      record;
begin
  perform app.require('inv_transfer_request');
  perform app.require_branch(v_to);
  if v_from is null or not exists (select 1 from branches where id = v_from and active) then
    raise exception 'Vui lòng chọn chi nhánh cấp hàng.';
  end if;
  if v_from = v_to then raise exception 'Chi nhánh cấp hàng phải khác chi nhánh yêu cầu.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Chưa chọn vật tư nào.';
  end if;

  insert into transfers (from_branch_id, to_branch_id, note, requested_by)
  values (v_from, v_to, nullif(trim(coalesce(p->>'note', '')), ''), me.id)
  returning id into v_id;
  update transfers
     set code = 'DC' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(v_id::text, 4, '0')
   where id = v_id;

  for l in select * from jsonb_to_recordset(p->'lines') as x(item_id int, qty numeric) loop
    if l.item_id is null then raise exception 'Dòng yêu cầu chưa chọn vật tư.'; end if;
    if l.qty is null or l.qty <= 0 then
      raise exception '% — số lượng phải lớn hơn 0.', app.item_label(l.item_id);
    end if;
    if exists (select 1 from transfer_lines where transfer_id = v_id and item_id = l.item_id) then
      raise exception '% bị chọn trùng.', app.item_label(l.item_id);
    end if;
    insert into transfer_lines (transfer_id, item_id, qty_requested) values (v_id, l.item_id, l.qty);
  end loop;
  return app.transfer_json(v_id);
end $$;

-- Chi nhánh B (vd Kho tổng) chủ động cấp hàng cho chi nhánh A, không cần A xin trước.
-- Tạo phiếu đã duyệt và gửi ngay (trừ kho B); A chỉ cần xác nhận đã nhận.
create or replace function public.push_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me     profiles := app.me();
  v_from smallint := coalesce(nullif(p->>'from_branch_id', '')::smallint, me.branch_id);
  v_to   smallint := nullif(p->>'to_branch_id', '')::smallint;
  v_id   bigint;
  v_avail numeric;
  l      record;
begin
  perform app.require('inv_transfer_ship');
  perform app.require_branch(v_from);
  if v_to is null or not exists (select 1 from branches where id = v_to and active) then
    raise exception 'Vui lòng chọn chi nhánh nhận hàng.';
  end if;
  if v_from = v_to then raise exception 'Chi nhánh nhận phải khác chi nhánh cấp.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Chưa chọn vật tư nào.'; end if;

  insert into transfers (from_branch_id, to_branch_id, note, kind, status, requested_by, approved_by, approved_at)
  values (v_from, v_to, nullif(trim(coalesce(p->>'note', '')), ''), 'push', 'approved', me.id, me.id, now())
  returning id into v_id;
  update transfers
     set code = 'DC' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(v_id::text, 4, '0')
   where id = v_id;

  for l in select * from jsonb_to_recordset(p->'lines') as x(item_id int, qty numeric) loop
    if l.item_id is null then raise exception 'Dòng cấp hàng chưa chọn vật tư.'; end if;
    if l.qty is null or l.qty <= 0 then raise exception '% — số lượng phải lớn hơn 0.', app.item_label(l.item_id); end if;
    if exists (select 1 from transfer_lines where transfer_id = v_id and item_id = l.item_id) then
      raise exception '% bị chọn trùng.', app.item_label(l.item_id);
    end if;
    select coalesce(sum(qty), 0) into v_avail from stock_lots
     where branch_id = v_from and item_id = l.item_id and qty > 0
       and (expiry_date is null or expiry_date >= app.today());
    if v_avail < l.qty then
      raise exception '% — kho % chỉ còn % (còn hạn), không đủ cấp %.',
        app.item_label(l.item_id), app.branch_name(v_from), app.fmt(v_avail), app.fmt(l.qty);
    end if;
    insert into transfer_lines (transfer_id, item_id, qty_requested, qty_approved) values (v_id, l.item_id, l.qty, l.qty);
  end loop;

  perform public.transfer_action(jsonb_build_object('id', v_id, 'action', 'ship'));
  return app.transfer_json(v_id);
end $$;

create or replace function public.list_transfers(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_all    boolean := app.has('inv_all_branches') or app.has('inv_report_view_all');
  v_branch smallint := nullif(p->>'branch_id', '')::smallint;
  v_from   date := nullif(p->>'from', '')::date;
  v_to     date := nullif(p->>'to', '')::date;
  v_status text[] := case when jsonb_typeof(p->'status') = 'array'
                          then array(select jsonb_array_elements_text(p->'status')) end;
begin
  if not v_all and v_branch is not null and v_branch is distinct from me.branch_id then
    raise exception 'Bạn chỉ xem được điều chuyển liên quan đến chi nhánh mình.';
  end if;
  if not v_all then v_branch := me.branch_id; end if;
  return (
    select coalesce(jsonb_agg(app.transfer_json(t.id) order by t.requested_at desc), '[]'::jsonb)
      from (select * from transfers t
             where (v_branch is null or t.from_branch_id = v_branch or t.to_branch_id = v_branch)
               and (v_status is null or t.status = any(v_status))
               and (v_from is null or (t.requested_at at time zone 'Asia/Ho_Chi_Minh')::date >= v_from)
               and (v_to   is null or (t.requested_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to)
             order by t.requested_at desc
             limit coalesce(nullif(p->>'limit', '')::int, 500)) t);
end $$;

create or replace function public.transfer_action(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  t        transfers;
  v_action text := p->>'action';
  v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_qty    numeric;
  v_avail  numeric;
  v_lots   jsonb;
  v_total  numeric := 0;
  l        transfer_lines;
  lot      record;
begin
  select * into t from transfers where id = (p->>'id')::bigint for update;
  if t.id is null then raise exception 'Không tìm thấy phiếu điều chuyển.'; end if;

  if v_action = 'approve' then
    if t.status <> 'pending' then raise exception 'Phiếu không ở trạng thái chờ duyệt.'; end if;
    perform app.require('inv_transfer_approve');
    perform app.require_branch(t.from_branch_id);
    for l in select * from transfer_lines where transfer_id = t.id loop
      v_qty := coalesce((select nullif(x->>'qty_approved', '')::numeric
                           from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x
                          where (x->>'line_id')::bigint = l.id), l.qty_requested);
      if v_qty < 0 then raise exception 'Số lượng duyệt không được âm.'; end if;
      if v_qty > 0 then
        select coalesce(sum(qty), 0) into v_avail from stock_lots
         where branch_id = t.from_branch_id and item_id = l.item_id and qty > 0
           and (expiry_date is null or expiry_date >= app.today());
        if v_avail < v_qty then
          raise exception '% — kho % chỉ còn % (còn hạn), không đủ duyệt %.',
            app.item_label(l.item_id), app.branch_name(t.from_branch_id), app.fmt(v_avail), app.fmt(v_qty);
        end if;
      end if;
      update transfer_lines set qty_approved = v_qty where id = l.id;
      v_total := v_total + v_qty;
    end loop;
    if v_total = 0 then raise exception 'Tất cả số lượng duyệt bằng 0 — hãy dùng Từ chối.'; end if;
    update transfers set status = 'approved', approved_by = me.id, approved_at = now(),
           note = coalesce(note, '') || case when v_reason is null then '' else
                  E'\n[Duyệt] ' || v_reason end
     where id = t.id;

  elsif v_action = 'reject' then
    if t.status not in ('pending', 'approved') then raise exception 'Phiếu không thể từ chối ở trạng thái này.'; end if;
    perform app.require('inv_transfer_approve');
    perform app.require_branch(t.from_branch_id);
    if v_reason is null then raise exception 'Vui lòng nhập lý do từ chối.'; end if;
    update transfers set status = 'rejected', reject_reason = v_reason,
           closed_by = me.id, closed_at = now() where id = t.id;

  elsif v_action = 'ship' then
    if t.status <> 'approved' then raise exception 'Phiếu chưa được duyệt.'; end if;
    perform app.require('inv_transfer_ship');
    perform app.require_branch(t.from_branch_id);
    for l in select * from transfer_lines where transfer_id = t.id and qty_approved > 0 loop
      v_lots := app.take_stock(t.from_branch_id, l.item_id, l.qty_approved, 'transfer_out', app.today(),
                               'Chuyển đến ' || app.branch_name(t.to_branch_id), 'transfer', t.id);
      update transfer_lines set lots = v_lots where id = l.id;
    end loop;
    update transfers set status = 'shipped', shipped_by = me.id, shipped_at = now() where id = t.id;

  elsif v_action = 'receive' then
    if t.status <> 'shipped' then raise exception 'Phiếu chưa được bên cấp gửi hàng.'; end if;
    perform app.require('inv_transfer_receive');
    perform app.require_branch(t.to_branch_id);
    for l in select * from transfer_lines where transfer_id = t.id and qty_approved > 0 order by id loop
      v_avail := (select coalesce(sum((x->>'qty')::numeric), 0) from jsonb_array_elements(l.lots) x);  -- số đã gửi
      -- Số thực nhận từng dòng (không gửi = nhận đủ)
      v_qty := coalesce((select nullif(x->>'qty_received', '')::numeric
                           from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x
                          where (x->>'line_id')::bigint = l.id), v_avail);
      if v_qty < 0 or v_qty > v_avail then
        raise exception '% — số thực nhận phải từ 0 đến % (số đã gửi).', app.item_label(l.item_id), app.fmt(v_avail);
      end if;
      -- Cộng kho A theo đúng lô đã gửi, lô hết hạn sớm nhất trước; phần thiếu không cộng
      v_total := v_qty;
      for lot in select * from jsonb_to_recordset(l.lots) as x(lot_no text, expiry_date date, qty numeric)
                  order by expiry_date nulls last loop
        exit when v_total <= 0;
        perform app.add_stock(t.to_branch_id, l.item_id, lot.lot_no, lot.expiry_date, least(lot.qty, v_total),
                              'transfer_in', app.today(),
                              'Nhận từ ' || app.branch_name(t.from_branch_id), 'transfer', t.id);
        v_total := v_total - least(lot.qty, v_total);
      end loop;
      update transfer_lines set qty_received = v_qty where id = l.id;
      if v_qty < v_avail then
        v_lots := coalesce(v_lots, '[]'::jsonb) || to_jsonb(app.item_label(l.item_id) || ' thiếu ' || app.fmt(v_avail - v_qty));
      end if;
    end loop;
    if v_lots is not null and v_reason is null then
      raise exception 'Nhận thiếu hàng (%) — vui lòng ghi lý do / tình trạng để BGĐ xử lý.',
        (select string_agg(x, '; ') from jsonb_array_elements_text(v_lots) x);
    end if;
    update transfers set status = 'received', received_by = me.id, received_at = now(),
           receive_note = case when v_lots is null then v_reason
                               else '[Nhận thiếu: ' || (select string_agg(x, '; ') from jsonb_array_elements_text(v_lots) x) || '] ' || v_reason end
     where id = t.id;

  elsif v_action = 'cancel' then
    if t.status not in ('pending', 'approved') then raise exception 'Chỉ hủy được phiếu chưa gửi hàng.'; end if;
    perform app.require('inv_transfer_request');
    perform app.require_branch(t.to_branch_id);
    update transfers set status = 'cancelled', closed_by = me.id, closed_at = now(),
           reject_reason = v_reason where id = t.id;
  else
    raise exception 'Thao tác không hợp lệ.';
  end if;
  return app.transfer_json(t.id);
end $$;

-- ---------------------------------------------------------------------
-- KIỂM KÊ
-- ---------------------------------------------------------------------
create or replace function public.create_stocktake(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := coalesce(nullif(p->>'branch_id', '')::smallint, me.branch_id);
  v_group  int := nullif(p->>'group_id', '')::int;
  v_id     bigint;
begin
  perform app.require('inv_stocktake_count');
  perform app.require_branch(v_branch);
  if exists (select 1 from stocktakes where branch_id = v_branch and status in ('draft', 'submitted')) then
    raise exception 'Chi nhánh đang có phiếu kiểm kê chưa chốt. Hãy hoàn tất hoặc hủy phiếu đó trước.';
  end if;
  insert into stocktakes (branch_id, group_id, note, created_by)
  values (v_branch, v_group, nullif(trim(coalesce(p->>'note', '')), ''), me.id) returning id into v_id;
  insert into stocktake_lines (stocktake_id, item_id, lot_no, expiry_date, system_qty)
  select v_id, l.item_id, l.lot_no, l.expiry_date, l.qty
    from stock_lots l join items i on i.id = l.item_id
   where l.branch_id = v_branch and l.qty > 0 and i.active
     and (v_group is null or i.group_id = v_group)
   order by i.name, l.expiry_date nulls last;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.list_stocktakes(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me       profiles := app.me();
  v_branch smallint := coalesce(nullif(p->>'branch_id', '')::smallint, me.branch_id);
begin
  if not app.can_view(v_branch) then raise exception 'Bạn không xem được kiểm kê của chi nhánh này.'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
             'branch_name', app.branch_name(s.branch_id),
             'group_name', (select name from item_groups where id = s.group_id),
             'created_by_name', app.person(s.created_by),
             'submitted_by_name', app.person(s.submitted_by),
             'approved_by_name', app.person(s.approved_by),
             'line_count', (select count(*) from stocktake_lines where stocktake_id = s.id),
             'counted_count', (select count(*) from stocktake_lines where stocktake_id = s.id and counted_qty is not null),
             'diff_count', (select count(*) from stocktake_lines where stocktake_id = s.id
                              and counted_qty is not null and counted_qty <> system_qty))
           order by s.created_at desc), '[]'::jsonb)
      from stocktakes s where s.branch_id = v_branch);
end $$;

create or replace function public.get_stocktake(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare s stocktakes;
begin
  perform app.me();
  select * into s from stocktakes where id = (p->>'id')::bigint;
  if s.id is null then raise exception 'Không tìm thấy phiếu kiểm kê.'; end if;
  if not app.can_view(s.branch_id) then raise exception 'Bạn không xem được phiếu kiểm kê này.'; end if;
  return to_jsonb(s) || jsonb_build_object(
    'branch_name', app.branch_name(s.branch_id),
    'group_name', (select name from item_groups where id = s.group_id),
    'created_by_name', app.person(s.created_by),
    'submitted_by_name', app.person(s.submitted_by),
    'approved_by_name', app.person(s.approved_by),
    'lines', (select coalesce(jsonb_agg(to_jsonb(sl) || jsonb_build_object(
                       'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
                       'group_name', g.name, 'track_lot', i.track_lot)
                     order by g.sort_order, i.name, sl.expiry_date nulls last, sl.id), '[]'::jsonb)
                from stocktake_lines sl join items i on i.id = sl.item_id
                left join item_groups g on g.id = i.group_id
               where sl.stocktake_id = s.id));
end $$;

create or replace function public.save_stocktake(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  s  stocktakes;
  l  record;
  v_item items;
  v_sys numeric;
begin
  perform app.require('inv_stocktake_count');
  select * into s from stocktakes where id = (p->>'id')::bigint for update;
  if s.id is null then raise exception 'Không tìm thấy phiếu kiểm kê.'; end if;
  perform app.require_branch(s.branch_id);
  if s.status <> 'draft' then raise exception 'Phiếu đã nộp, không sửa được. Nhờ quản lý mở lại nếu cần.'; end if;

  for l in select * from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb))
             as x(id bigint, counted_qty numeric, note text) loop
    if l.counted_qty is not null and l.counted_qty < 0 then raise exception 'Số đếm không được âm.'; end if;
    update stocktake_lines set counted_qty = l.counted_qty, note = nullif(trim(coalesce(l.note, '')), '')
     where id = l.id and stocktake_id = s.id;
  end loop;

  for l in select * from jsonb_to_recordset(coalesce(p->'new_lines', '[]'::jsonb))
             as x(item_id int, lot_no text, expiry_date date, counted_qty numeric, note text) loop
    select * into v_item from items where id = l.item_id;
    if v_item.id is null then raise exception 'Dòng bổ sung chưa chọn vật tư.'; end if;
    if l.counted_qty is null or l.counted_qty < 0 then
      raise exception '% — nhập số lượng đếm được.', app.item_label(v_item.id);
    end if;
    if v_item.track_lot and (coalesce(trim(l.lot_no), '') = '' or l.expiry_date is null) then
      raise exception '% bắt buộc nhập số lô và hạn sử dụng.', app.item_label(v_item.id);
    end if;
    select coalesce(sum(qty), 0) into v_sys from stock_lots
     where branch_id = s.branch_id and item_id = v_item.id and lot_no = coalesce(trim(l.lot_no), '')
       and coalesce(expiry_date, '9999-12-31'::date) = coalesce(l.expiry_date, '9999-12-31'::date);
    insert into stocktake_lines (stocktake_id, item_id, lot_no, expiry_date, system_qty, counted_qty, note)
    values (s.id, v_item.id, coalesce(trim(l.lot_no), ''), l.expiry_date, v_sys, l.counted_qty,
            nullif(trim(coalesce(l.note, '')), ''));
  end loop;

  if coalesce((p->>'submit')::boolean, false) then
    -- Dòng để trống khi nộp = không tìm thấy hàng → tính là 0 (web đã hỏi xác nhận trước khi nộp)
    update stocktake_lines set counted_qty = 0,
           note = coalesce(note, 'Không tìm thấy (để trống khi nộp)')
     where stocktake_id = s.id and counted_qty is null;
    update stocktakes set status = 'submitted', submitted_by = me.id, submitted_at = now() where id = s.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.stocktake_action(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  s  stocktakes;
  sl stocktake_lines;
  v_action text := p->>'action';
  v_delta numeric;
  v_lot stock_lots;
begin
  select * into s from stocktakes where id = (p->>'id')::bigint for update;
  if s.id is null then raise exception 'Không tìm thấy phiếu kiểm kê.'; end if;
  perform app.require_branch(s.branch_id);

  if v_action = 'approve' then
    perform app.require('inv_stocktake_approve');
    if s.status <> 'submitted' then raise exception 'Phiếu chưa được nộp.'; end if;
    for sl in select * from stocktake_lines where stocktake_id = s.id and counted_qty is not null
                and counted_qty <> system_qty loop
      v_delta := sl.counted_qty - sl.system_qty;
      if v_delta > 0 then
        perform app.add_stock(s.branch_id, sl.item_id, sl.lot_no, sl.expiry_date, v_delta, 'adjust',
                              app.today(), 'Kiểm kê #' || s.id || ' (thừa)', 'stocktake', s.id);
      else
        select * into v_lot from stock_lots
         where branch_id = s.branch_id and item_id = sl.item_id and lot_no = sl.lot_no
           and coalesce(expiry_date, '9999-12-31'::date) = coalesce(sl.expiry_date, '9999-12-31'::date);
        if v_lot.id is not null and v_lot.qty > 0 then
          perform app.take_stock(s.branch_id, sl.item_id, least(-v_delta, v_lot.qty), 'adjust', app.today(),
                                 'Kiểm kê #' || s.id || ' (thiếu)', 'stocktake', s.id, v_lot.id, true);
        end if;
      end if;
    end loop;
    update stocktakes set status = 'approved', approved_by = me.id, approved_at = now() where id = s.id;
  elsif v_action = 'reopen' then
    perform app.require('inv_stocktake_approve');
    if s.status <> 'submitted' then raise exception 'Chỉ mở lại được phiếu đã nộp.'; end if;
    update stocktakes set status = 'draft', submitted_by = null, submitted_at = null where id = s.id;
  elsif v_action = 'cancel' then
    perform app.require('inv_stocktake_count');
    if s.status not in ('draft', 'submitted') then raise exception 'Phiếu đã chốt, không hủy được.'; end if;
    update stocktakes set status = 'cancelled' where id = s.id;
  else
    raise exception 'Thao tác không hợp lệ.';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- BÁO CÁO
-- ---------------------------------------------------------------------
create or replace function app.report_scope(p jsonb) returns smallint
language plpgsql stable security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  v_branch smallint := nullif(p->>'branch_id', '')::smallint;
begin
  perform app.require('inv_report_view');
  if v_branch is null then
    if not app.has('inv_report_view_all') then
      if me.branch_id is null then raise exception 'Vui lòng chọn chi nhánh.'; end if;
      return me.branch_id;
    end if;
    return null;
  end if;
  if not app.can_act(v_branch) then perform app.require('inv_report_view_all'); end if;
  return v_branch;
end $$;

-- Lịch sử xuất dùng (mỗi dòng 1 vật tư)
create or replace function public.report_usage(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_branch smallint := app.report_scope(p);
  v_from date := coalesce(nullif(p->>'from', '')::date, app.today() - 30);
  v_to   date := coalesce(nullif(p->>'to', '')::date, app.today());
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'doc_id', d.id, 'usage_date', d.usage_date, 'branch_id', d.branch_id,
             'branch_name', app.branch_name(d.branch_id),
             'item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
             'group_name', g.name, 'qty', ul.qty, 'reason', ul.reason, 'lots', ul.lots,
             'note', d.note, 'created_by_name', app.person(d.created_by))
           order by d.usage_date desc, d.id desc, ul.id), '[]'::jsonb)
      from usage_docs d join usage_lines ul on ul.doc_id = d.id
      join items i on i.id = ul.item_id left join item_groups g on g.id = i.group_id
     where d.voided_at is null and d.usage_date between v_from and v_to
       and (v_branch is null or d.branch_id = v_branch));
end $$;

create or replace function public.report_transfers(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_branch smallint := app.report_scope(p);
begin
  return (
    select coalesce(jsonb_agg(app.transfer_json(t.id) order by t.requested_at desc), '[]'::jsonb)
      from transfers t
     where (v_branch is null or t.from_branch_id = v_branch or t.to_branch_id = v_branch)
       and (t.requested_at at time zone 'Asia/Ho_Chi_Minh')::date
           between coalesce(nullif(p->>'from', '')::date, app.today() - 30)
               and coalesce(nullif(p->>'to', '')::date, app.today()));
end $$;

create or replace function public.report_stock(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_branch smallint := app.report_scope(p);
begin
  if v_branch is null then return public.get_stock_matrix(p); end if;
  return (select public.get_stock(jsonb_build_object('branch_id', v_branch)));
end $$;

-- ---------------------------------------------------------------------
-- QUẢN TRỊ: NHÂN SỰ + PHÂN QUYỀN
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.me();
  perform app.require('admin_users');
  return (
    select coalesce(jsonb_agg(to_jsonb(pr) || jsonb_build_object(
             'department_name', d.name, 'branch_name', b.name,
             'override_count', (select count(*) from user_permission_overrides o where o.user_id = pr.id))
           order by pr.active desc, b.sort_order nulls first, pr.full_name), '[]'::jsonb)
      from profiles pr
      left join departments d on d.id = pr.department_id
      left join branches b on b.id = pr.branch_id);
end $$;

create or replace function public.admin_update_user(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me profiles := app.me();
  v_id uuid := (p->>'id')::uuid;
begin
  perform app.require('admin_users');
  if not exists (select 1 from profiles where id = v_id) then raise exception 'Không tìm thấy nhân viên.'; end if;
  if v_id = me.id and not coalesce((p->>'active')::boolean, true) then
    raise exception 'Bạn không thể tự khóa tài khoản của mình.';
  end if;
  update profiles set
    full_name     = coalesce(nullif(trim(p->>'full_name'), ''), full_name),
    department_id = nullif(p->>'department_id', '')::int,
    branch_id     = nullif(p->>'branch_id', '')::smallint,
    active        = coalesce((p->>'active')::boolean, active)
  where id = v_id;
  if coalesce((p->>'active')::boolean, false) and
     (select department_id from profiles where id = v_id) is null then
    raise exception 'Hãy chọn Bộ phận / Vị trí trước khi kích hoạt tài khoản.';
  end if;
  perform app.ensure_admin_exists();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_get_permissions(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.me();
  if not (app.has('admin_permissions') or app.has('admin_users')) then
    raise exception 'Bạn chưa được cấp quyền quản trị.';
  end if;
  return jsonb_build_object(
    'departments', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
                       'user_count', (select count(*) from profiles pr where pr.department_id = d.id and pr.active))
                     order by d.sort_order), '[]'::jsonb) from departments d),
    'permissions', (select coalesce(jsonb_agg(to_jsonb(pm) order by pm.sort_order), '[]'::jsonb) from permissions pm),
    'matrix', (select coalesce(jsonb_agg(jsonb_build_object('department_id', dp.department_id,
                     'permission_key', dp.permission_key, 'enabled', dp.enabled)), '[]'::jsonb)
                 from department_permissions dp));
end $$;

create or replace function public.admin_set_department_permissions(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_dep int := (p->>'department_id')::int;
  r record;
begin
  perform app.me();
  perform app.require('admin_permissions');
  for r in select * from jsonb_to_recordset(coalesce(p->'permissions', '[]'::jsonb)) as x(key text, enabled boolean) loop
    insert into department_permissions (department_id, permission_key, enabled)
    values (v_dep, r.key, coalesce(r.enabled, false))
    on conflict (department_id, permission_key) do update set enabled = excluded.enabled;
  end loop;
  perform app.ensure_admin_exists();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_save_department(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_id int := nullif(p->>'id', '')::int;
begin
  perform app.me();
  perform app.require('admin_permissions');
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Tên vị trí là bắt buộc.'; end if;
  if v_id is null then
    insert into departments (code, name, description, sort_order, active)
    values (upper(coalesce(nullif(trim(p->>'code'), ''), 'VT' || (select coalesce(max(id), 0) + 1 from departments))),
            trim(p->>'name'), nullif(p->>'description', ''),
            coalesce(nullif(p->>'sort_order', '')::int, 99), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    update departments set name = trim(p->>'name'), description = nullif(p->>'description', ''),
           active = coalesce((p->>'active')::boolean, active) where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.admin_get_user_permissions(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare v_uid uuid := (p->>'user_id')::uuid;
begin
  perform app.me();
  perform app.require('admin_permissions');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', pm.key, 'group_name', pm.group_name, 'label', pm.label, 'description', pm.description,
             'department_enabled', coalesce(dp.enabled, false),
             'override', o.enabled,
             'enabled', coalesce(o.enabled, dp.enabled, false))
           order by pm.sort_order), '[]'::jsonb)
      from permissions pm
      left join profiles pr on pr.id = v_uid
      left join department_permissions dp on dp.department_id = pr.department_id and dp.permission_key = pm.key
      left join user_permission_overrides o on o.user_id = v_uid and o.permission_key = pm.key);
end $$;

-- overrides: [{key, enabled}] — enabled = null nghĩa là bỏ ghi đè, theo vị trí
create or replace function public.admin_set_user_permissions(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_uid uuid := (p->>'user_id')::uuid;
  r record;
begin
  perform app.me();
  perform app.require('admin_permissions');
  for r in select * from jsonb_to_recordset(coalesce(p->'overrides', '[]'::jsonb)) as x(key text, enabled boolean) loop
    if r.enabled is null then
      delete from user_permission_overrides where user_id = v_uid and permission_key = r.key;
    else
      insert into user_permission_overrides (user_id, permission_key, enabled) values (v_uid, r.key, r.enabled)
      on conflict (user_id, permission_key) do update set enabled = excluded.enabled;
    end if;
  end loop;
  perform app.ensure_admin_exists();
  return jsonb_build_object('ok', true);
end $$;
