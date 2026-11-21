-- FILE TỰ SINH — chạy toàn bộ file này trong Supabase → SQL Editor.
-- Nguồn: supabase/sql/*.sql (npm run sql)


-- ===== 00_guard.sql =====
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


-- ===== 01_schema.sql =====
-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 01. Bảng dữ liệu
-- =====================================================================

create table if not exists branches (
  id          smallint primary key,
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true
);

-- Bộ phận / Vị trí làm việc (giống web Workspace)
create table if not exists departments (
  id          serial primary key,
  code        text not null unique,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true
);

-- Danh mục quyền
create table if not exists permissions (
  key         text primary key,
  group_name  text not null,
  label       text not null,
  description text,
  sort_order  int not null default 0
);

-- Quyền bật/tắt theo Bộ phận / Vị trí
create table if not exists department_permissions (
  department_id  int  not null references departments(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  enabled        boolean not null default false,
  primary key (department_id, permission_key)
);

-- Nhân viên (id = id tài khoản đăng nhập Supabase)
create table if not exists profiles (
  id            uuid primary key,
  email         text,
  full_name     text not null default '',
  department_id int references departments(id),
  branch_id     smallint references branches(id),
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Quyền riêng cho từng nhân viên (ghi đè quyền theo vị trí)
create table if not exists user_permission_overrides (
  user_id        uuid not null references profiles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  enabled        boolean not null,
  primary key (user_id, permission_key)
);

-- ---------------------------------------------------------------------
-- Danh mục vật tư
-- ---------------------------------------------------------------------
create table if not exists item_groups (
  id          serial primary key,
  code        text not null unique,
  name        text not null,
  sort_order  int not null default 0
);

create table if not exists items (
  id               serial primary key,
  code             text not null unique,
  name             text not null,
  group_id         int references item_groups(id),
  unit             text not null,                 -- đơn vị dùng / tính tồn (ống, cái, tuýp…)
  purchase_unit    text,                          -- đơn vị nhập (hộp, vỉ…)
  purchase_factor  numeric(12,2) not null default 1 check (purchase_factor > 0), -- 1 đơn vị nhập = ? đơn vị dùng
  track_lot        boolean not null default false, -- bắt buộc số lô + hạn dùng
  default_min_qty  numeric(12,2) not null default 0 check (default_min_qty >= 0),
  note             text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Tồn tối thiểu riêng từng chi nhánh (nếu không có dùng default_min_qty)
create table if not exists item_branch_settings (
  item_id   int not null references items(id) on delete cascade,
  branch_id smallint not null references branches(id),
  min_qty   numeric(12,2) not null check (min_qty >= 0),
  primary key (item_id, branch_id)
);

-- Tồn kho theo lô tại từng chi nhánh
create table if not exists stock_lots (
  id          bigserial primary key,
  branch_id   smallint not null references branches(id),
  item_id     int not null references items(id),
  lot_no      text not null default '',
  expiry_date date,
  qty         numeric(12,2) not null default 0 check (qty >= 0),
  created_at  timestamptz not null default now()
);
create unique index if not exists stock_lots_key
  on stock_lots (branch_id, item_id, lot_no, coalesce(expiry_date, '9999-12-31'::date));
create index if not exists stock_lots_item on stock_lots (item_id);

-- ---------------------------------------------------------------------
-- Chứng từ
-- ---------------------------------------------------------------------
create table if not exists usage_docs (
  id           bigserial primary key,
  branch_id    smallint not null references branches(id),
  usage_date   date not null,
  note         text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references profiles(id),
  void_reason  text
);
create index if not exists usage_docs_branch_date on usage_docs (branch_id, usage_date);

create table if not exists usage_lines (
  id       bigserial primary key,
  doc_id   bigint not null references usage_docs(id) on delete cascade,
  item_id  int not null references items(id),
  qty      numeric(12,2) not null check (qty > 0),
  reason   text not null default 'Điều trị',
  lots     jsonb not null default '[]'::jsonb
);

create table if not exists receipt_docs (
  id            bigserial primary key,
  branch_id     smallint not null references branches(id),
  receipt_date  date not null,
  source        text not null default 'Nhập tay chi nhánh',
  supplier      text,
  note          text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

-- Người / lúc sửa phiếu nhập gần nhất
alter table receipt_docs add column if not exists updated_by uuid references profiles(id);
alter table receipt_docs add column if not exists updated_at timestamptz;

create table if not exists receipt_lines (
  id           bigserial primary key,
  doc_id       bigint not null references receipt_docs(id) on delete cascade,
  item_id      int not null references items(id),
  qty          numeric(12,2) not null check (qty > 0),   -- theo đơn vị dùng
  input_qty    numeric(12,2) not null,
  input_unit   text not null,
  lot_no       text not null default '',
  expiry_date  date
);

create table if not exists transfers (
  id              bigserial primary key,
  code            text unique,
  from_branch_id  smallint not null references branches(id),  -- chi nhánh cấp hàng (B)
  to_branch_id    smallint not null references branches(id),  -- chi nhánh yêu cầu (A)
  status          text not null default 'pending'
                  check (status in ('pending','approved','shipped','received','rejected','cancelled')),
  note            text,
  requested_by    uuid references profiles(id),
  requested_at    timestamptz not null default now(),
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  shipped_by      uuid references profiles(id),
  shipped_at      timestamptz,
  received_by     uuid references profiles(id),
  received_at     timestamptz,
  closed_by       uuid references profiles(id),
  closed_at       timestamptz,
  reject_reason   text,
  receive_note    text,
  check (from_branch_id <> to_branch_id)
);
-- request = chi nhánh A xin hàng; push = chi nhánh B chủ động cấp (bỏ qua bước xin + duyệt)
alter table transfers add column if not exists kind text not null default 'request' check (kind in ('request', 'push'));
create index if not exists transfers_from on transfers (from_branch_id, status);
create index if not exists transfers_to on transfers (to_branch_id, status);

create table if not exists transfer_lines (
  id             bigserial primary key,
  transfer_id    bigint not null references transfers(id) on delete cascade,
  item_id        int not null references items(id),
  qty_requested  numeric(12,2) not null check (qty_requested > 0),
  qty_approved   numeric(12,2) check (qty_approved >= 0),
  lots           jsonb not null default '[]'::jsonb   -- lô đã gửi [{lot_no, expiry_date, qty}]
);
-- Số A thực nhận (null = phiếu cũ, coi như nhận đủ). Nhỏ hơn số đã gửi = nhận thiếu, phần thiếu ghi lại để BGĐ xử lý.
alter table transfer_lines add column if not exists qty_received numeric(12,2) check (qty_received >= 0);

create table if not exists stocktakes (
  id            bigserial primary key,
  branch_id     smallint not null references branches(id),
  status        text not null default 'draft' check (status in ('draft','submitted','approved','cancelled')),
  note          text,
  group_id      int references item_groups(id),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  submitted_by  uuid references profiles(id),
  submitted_at  timestamptz,
  approved_by   uuid references profiles(id),
  approved_at   timestamptz
);

create table if not exists stocktake_lines (
  id            bigserial primary key,
  stocktake_id  bigint not null references stocktakes(id) on delete cascade,
  item_id       int not null references items(id),
  lot_no        text not null default '',
  expiry_date   date,
  system_qty    numeric(12,2) not null default 0,
  counted_qty   numeric(12,2) check (counted_qty >= 0),
  note          text
);

-- Sổ kho: mọi biến động tồn
create table if not exists movements (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  movement_date  date not null,
  branch_id      smallint not null references branches(id),
  item_id        int not null references items(id),
  lot_id         bigint references stock_lots(id),
  lot_no         text,
  expiry_date    date,
  qty_change     numeric(12,2) not null,
  kind           text not null check (kind in ('receipt','usage','transfer_out','transfer_in','adjust','void')),
  reason         text,
  doc_type       text,
  doc_id         bigint,
  user_id        uuid
);
create index if not exists movements_branch_date on movements (branch_id, movement_date);
create index if not exists movements_doc on movements (doc_type, doc_id);


-- ===== 02_functions.sql =====
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
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object(
               'item_code', i.code, 'item_name', i.name, 'unit', i.unit) order by l.id)
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

create or replace function public.list_receipts(p jsonb default '{}'::jsonb) returns jsonb
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
             'updated_by_name', app.person(d.updated_by),
             'lines', (select coalesce(jsonb_agg(to_jsonb(rl) || jsonb_build_object(
                                'item_code', i.code, 'item_name', i.name, 'unit', i.unit,
                                'group_name', g.name) order by rl.id), '[]'::jsonb)
                         from receipt_lines rl join items i on i.id = rl.item_id
                         left join item_groups g on g.id = i.group_id
                        where rl.doc_id = d.id))
           order by d.receipt_date desc, d.id desc), '[]'::jsonb)
      from receipt_docs d
     where (v_branch is null or d.branch_id = v_branch)
       and d.receipt_date between v_from and v_to);
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


-- ===== 03_seed.sql =====
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


-- ===== 04_supabase_security.sql =====
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


-- ===== 05_import_excel.sql =====
-- =====================================================================
-- KHO VẬT TƯ NHA KHOA — 05. Dữ liệu từ file Excel "QUẢN LÝ KHO TỔNG.xlsx"
-- Sinh tự động bởi scripts/import-excel.mjs — không sửa tay.
-- 811 vật tư, 29 nhóm, 1073 dòng tồn đầu kỳ (Kho tổng + chi nhánh)
-- Chạy lại nhiều lần an toàn: vật tư đã có thì bỏ qua, tồn đầu kỳ chỉ ghi 1 lần.
-- =====================================================================

insert into item_groups (code, name, sort_order) values
  ('DC', 'Dụng cụ (Tủ 6N)', 1),
  ('MKH', 'Mũi khoan', 2),
  ('V5D', 'Vật liệu (Tủ 5D)', 3),
  ('FM', 'File máy', 4),
  ('FT', 'File tay', 5),
  ('TTR', 'Bộ tẩy trắng', 6),
  ('GU', 'Gutta', 7),
  ('DCU', 'Dây cung', 8),
  ('CO', 'Copping', 9),
  ('AN', 'Analog', 10),
  ('AB', 'Abutment', 11),
  ('CN', 'Chỉnh nha', 12),
  ('HE', 'Healing', 13),
  ('TMY', 'Trụ Mỹ', 14),
  ('TCO', 'Trụ Core', 15),
  ('TBI', 'Trụ Bio', 16),
  ('SIC', 'Trụ SIC', 17),
  ('TRA', 'Trụ Tramem', 18),
  ('TNE', 'Trụ Neodent', 19),
  ('TH', 'Thuốc (Tủ 3D)', 20),
  ('DCP', 'Dụng cụ & vật tư phẫu thuật', 21),
  ('TTU', 'Thuốc truyền', 22),
  ('DK', 'Đầu kim', 23),
  ('CH', 'Chun', 24),
  ('DH', 'Đồ hàn', 25),
  ('V4N', 'Vật liệu (Tủ 4N)', 26),
  ('V3N', 'Vật liệu (Tủ 3N)', 27),
  ('T2', 'Kho tầng 2', 28),
  ('MU', 'Multi & vật tư khác', 29)
on conflict (code) do nothing;

insert into items (code, name, group_id, unit, note)
select v.code, v.name, g.id, v.unit, v.note from (values
  ('DC-001', 'Dao phẫu size 11', 'DC', 'hộp', null),
  ('DC-002', 'Dao phẫu size 12', 'DC', 'hộp', null),
  ('DC-003', 'Dao phẫu size 15', 'DC', 'hộp', null),
  ('DC-004', 'Gương hình R', 'DC', 'cái', null),
  ('DC-005', 'Kéo cắt chỉ', 'DC', 'cái', null),
  ('DC-006', 'Banh kẹp kim', 'DC', 'cái', null),
  ('DC-007', 'Bẩy sung to', 'DC', 'cái', null),
  ('DC-008', 'Thám trâm', 'DC', 'cái', null),
  ('DC-009', 'Kẹp gắp', 'DC', 'cái', null),
  ('DC-010', 'Nạo răng cưa', 'DC', 'cái', null),
  ('DC-011', 'Bộ HA', 'DC', 'bộ', null),
  ('DC-012', 'Ống hút thường', 'DC', 'gói', null),
  ('MKH-001', 'mũi cắt tay nhanh', 'MKH', 'cái', null),
  ('V5D-001', 'File máy F1 - 21', 'V5D', 'vỉ', null),
  ('FM-001', 'File máy F1 - 25', 'FM', 'vỉ', null),
  ('FM-002', 'File máy F2- 21', 'FM', 'vỉ', null),
  ('FM-003', 'File máy F2- 25', 'FM', 'vỉ', null),
  ('FM-004', 'File máy S1 - 25', 'FM', 'vỉ', null),
  ('FM-005', 'File máy S2 - 25', 'FM', 'vỉ', null),
  ('FM-006', 'EEX- 40EF', 'FM', 'vỉ', null),
  ('FM-007', 'EX SS 33EF', 'FM', 'vỉ', null),
  ('FM-008', 'EX SS 14 EF', 'FM', 'vỉ', null),
  ('FM-009', 'TR 11 EF', 'FM', 'vỉ', null),
  ('FM-010', 'TR 25 F', 'FM', 'vỉ', null),
  ('FM-011', 'TR 256 C', 'FM', 'vỉ', null),
  ('FM-012', 'EX 12C', 'FM', 'vỉ', null),
  ('FM-013', 'TR 11', 'FM', 'vỉ', null),
  ('FM-014', 'TR12', 'FM', 'vỉ', null),
  ('FM-015', 'Pro 1 EF', 'FM', 'vỉ', null),
  ('FM-016', 'Pro 2 EF', 'FM', 'vỉ', null),
  ('FM-017', 'F0 - 21 EF', 'FM', 'vỉ', null),
  ('FM-018', 'F0- 22 EF', 'FM', 'vỉ', null),
  ('FM-019', 'F0 - 20 EF', 'FM', 'vỉ', null),
  ('FM-020', 'TR25', 'FM', 'vỉ', null),
  ('FM-021', 'TR 13 EF', 'FM', 'vỉ', null),
  ('FM-022', 'TR 25 EF', 'FM', 'vỉ', null),
  ('FM-023', 'EX 12', 'FM', 'vỉ', null),
  ('FM-024', 'BC 42C', 'FM', 'vỉ', null),
  ('FM-025', 'BC 31', 'FM', 'vỉ', null),
  ('FM-026', 'SI47C', 'FM', 'vỉ', null),
  ('FM-027', 'EX 12C', 'FM', 'vỉ', null),
  ('FM-028', 'CE 15 EF', 'FM', 'vỉ', null),
  ('FM-029', 'CE 13 EF', 'FM', 'vỉ', null),
  ('FM-030', 'F0 27C', 'FM', 'vỉ', null),
  ('FM-031', 'SR 11C', 'FM', 'vỉ', null),
  ('FM-032', 'Pro - 2F', 'FM', 'vỉ', null),
  ('FM-033', 'F0 - 25C', 'FM', 'vỉ', null),
  ('FM-034', 'SI -S46', 'FM', 'vỉ', null),
  ('FM-035', 'F0- 23EF', 'FM', 'vỉ', null),
  ('FM-036', 'F0-27', 'FM', 'vỉ', null),
  ('FM-037', 'RS-SS31EF', 'FM', 'vỉ', null),
  ('FM-038', 'SIS48', 'FM', 'vỉ', null),
  ('FM-039', 'BC 42', 'FM', 'vỉ', null),
  ('FM-040', 'F0 - 25', 'FM', 'vỉ', null),
  ('FM-041', 'TC - 73F', 'FM', 'vỉ', null),
  ('FM-042', 'FG 198C016', 'FM', 'vỉ', null),
  ('FM-043', 'FG 198x 014', 'FM', 'vỉ', null),
  ('FM-044', 'FG 166F014', 'FM', 'vỉ', null),
  ('FM-045', 'EX 11 EF', 'FM', 'vỉ', null),
  ('FM-046', 'FFG198x016', 'FM', 'vỉ', null),
  ('FM-047', 'TR25C', 'FM', 'vỉ', null),
  ('FM-048', 'BR40C', 'FM', 'vỉ', null),
  ('FM-049', 'EX11', 'FM', 'vỉ', null),
  ('FM-050', 'EX26', 'FM', 'vỉ', null),
  ('FM-051', 'EX12', 'FM', 'vỉ', null),
  ('FM-052', 'EX13', 'FM', 'vỉ', null),
  ('FM-053', 'CE 15F', 'FM', 'vỉ', null),
  ('FM-054', 'SR 11', 'FM', 'vỉ', null),
  ('FM-055', 'TC 72C', 'FM', 'vỉ', null),
  ('FM-056', 'FG171014', 'FM', 'mũi', null),
  ('FM-057', 'TC 21F', 'FM', 'vỉ', null),
  ('FM-058', 'CE 13F', 'FM', 'vỉ', null),
  ('FM-059', 'RS11', 'FM', 'mũi', null),
  ('FM-060', 'EX24', 'FM', 'mũi', null),
  ('FM-061', 'BR- 49', 'FM', 'vỉ', null),
  ('FM-062', 'Pro 3F', 'FM', 'vỉ', null),
  ('FM-063', 'TF 11', 'FM', 'vỉ', null),
  ('FM-064', 'TC 11 EF', 'FM', 'vỉ', null),
  ('FM-065', 'Đầu cao R nhỏ', 'FM', 'cái', null),
  ('FM-066', 'Mũi máy nhổ R', 'FM', 'mũi', null),
  ('FM-067', 'Đầu cao R to', 'FM', 'mũi', null),
  ('FM-068', 'Mũi cắt xương tay nhanh', 'FM', 'vỉ', null),
  ('FM-069', 'Bộ mũi chỉnh sứ', 'FM', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('FM-070', 'Mũi đánh bóng sứ đen', 'FM', 'mũi', null),
  ('FM-071', 'Đĩa cắt', 'FM', 'cái', null),
  ('FM-072', 'Đĩa đánh bóng', 'FM', 'cái', null),
  ('FM-073', 'Đánh bóng sứ xanh', 'FM', 'cái', null),
  ('FM-074', 'Đánh bóng xứ vàng', 'FM', 'cái', null),
  ('FM-075', 'Mũi quả dứa to', 'FM', 'cái', null),
  ('FM-076', 'Mũi quả dứa bé', 'FM', 'cái', null),
  ('FM-077', 'Mũi cao su đánh bóng', 'FM', 'cái', null),
  ('FM-078', 'Mũi ngọn lửa nhỏ', 'FM', 'mũi', null),
  ('FM-079', 'Mũi cắt xương tay chậm ngắn', 'FM', 'mũi', null),
  ('FM-080', 'Mũi cắt xương tay chậm dài', 'FM', 'mũi', null),
  ('FM-081', 'Mũi mài xương zico tròn nhỏ', 'FM', 'cái', null),
  ('FM-082', 'Mài xương zico trám nhỏ', 'FM', 'mũi', null),
  ('FM-083', 'Mài xương zico trám to', 'FM', 'mũi', null),
  ('FM-084', 'Mũi cắt xương tay chậm tròn to', 'FM', 'mũi', null),
  ('FM-085', 'Mũi cắt xương tay chậm tròn nhỏ', 'FM', 'mũi', null),
  ('FM-086', 'Mài xương zico trám nhỏ', 'FM', 'mũi', null),
  ('FM-087', 'Mài xương zico trám to', 'FM', 'mũi', null),
  ('FM-088', 'Mũi cắt xương tay chậm tròn to', 'FM', 'mũi', null),
  ('FM-089', 'Mũi cắt xương tay chậm tròn nhỏ', 'FM', 'mũi', null),
  ('FM-090', 'Bộ đánh bóng Composite', 'FM', 'bộ', null),
  ('FM-091', 'Chổi chải bóng cước ( chổi cước)', 'FM', 'hộp', null),
  ('FM-092', 'Chổi đánh bóng Composite', 'FM', 'cái', null),
  ('FM-093', 'Kéo dán veneer', 'FM', 'tuýp', null),
  ('FM-094', 'Tăm dán veneer', 'FM', 'hộp', null),
  ('FM-095', 'Keo gắn mắc cài', 'FM', 'hộp', null),
  ('FM-096', 'Bôi chống sâu R', 'FM', 'gói', null),
  ('FM-097', 'Keo dán R tạm', 'FM', 'hộp', null),
  ('FM-098', 'Keo gắn che cùi', 'FM', 'tuýp', null),
  ('FM-099', 'Kéo dán mắc cài sứ', 'FM', 'lọ', null),
  ('FM-100', 'Keo tháo lắp', 'FM', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V5D-002', 'Etching sứ', 'V5D', 'tuýp', null),
  ('V5D-003', 'Canxi', 'V5D', 'tuýp', null),
  ('V5D-004', 'Bond sứ', 'V5D', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V5D-005', 'Gly bôi trơn ống tủy', 'V5D', 'tuýp', null),
  ('V5D-006', 'MTA hàn ống tủy', 'V5D', 'hộp', null),
  ('V5D-007', 'Cortisomol ( trám bít ống tủy)', 'V5D', 'hộp', null),
  ('V5D-008', 'Ulorhexidine Digluconate 2%', 'V5D', 'lọ', null),
  ('V5D-009', 'Cevitron', 'V5D', 'lọ', null),
  ('V5D-010', 'Eugenol', 'V5D', 'lọ', null),
  ('V5D-011', 'Chốt tạo cùi thạch anh', 'V5D', 'hộp', null),
  ('V5D-012', 'Chốt tạo cùi KL', 'V5D', 'hộp', null),
  ('V5D-013', 'Trâm gai vàng', 'V5D', 'vỉ', null),
  ('V5D-014', 'Trâm gai trắng', 'V5D', 'vỉ', null),
  ('V5D-015', 'Trâm gai xanh', 'V5D', 'vỉ', null),
  ('FT-001', 'File K10 - 25 mm', 'FT', 'vỉ', null),
  ('FT-002', 'File K10 - 21 mm', 'FT', 'vỉ', null),
  ('FT-003', 'File K20 - 21 mm', 'FT', 'vỉ', null),
  ('FT-004', 'File K20 - 25 mm', 'FT', 'vỉ', null),
  ('FT-005', 'File K23 - 21 mm', 'FT', 'vỉ', null),
  ('FT-006', 'File K23 - 25 mm', 'FT', 'vỉ', null),
  ('FT-007', 'File K30 - 21 mm', 'FT', 'vỉ', null),
  ('FT-008', 'File K30 - 25 mm', 'FT', 'vỉ', null),
  ('FT-009', 'File H30 - 21 mm', 'FT', 'vỉ', null),
  ('FT-010', 'File H30 - 25 mm', 'FT', 'vỉ', null),
  ('FT-011', 'File H35 - 21 mm', 'FT', 'vỉ', null),
  ('FT-012', 'File H35 - 25 mm', 'FT', 'vỉ', null),
  ('FT-013', 'File H25 - 21 mm', 'FT', 'vỉ', null),
  ('FT-014', 'File H25 - 25 mm', 'FT', 'vỉ', null),
  ('FT-015', 'File H10 - 21 mm', 'FT', 'vỉ', null),
  ('FT-016', 'File H10 - 25 mm', 'FT', 'vỉ', null),
  ('FT-017', 'File H8 - 25 mm', 'FT', 'vỉ', null),
  ('FT-018', 'File K35 - 21 mm', 'FT', 'vỉ', null),
  ('FT-019', 'File K35 - 25 mm', 'FT', 'vỉ', null),
  ('FT-020', 'File K15 - 21 mm', 'FT', 'vỉ', null),
  ('FT-021', 'File K15 - 25 mm', 'FT', 'vỉ', null),
  ('FT-022', 'File K8 - 21 mm', 'FT', 'vỉ', null),
  ('FT-023', 'File K8 - 25 mm', 'FT', 'vỉ', null),
  ('FT-024', 'Thước đo nội nha', 'FT', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TTR-001', 'tuýp che lợi', 'TTR', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TTR-002', 'Bột tẩy trắng', 'TTR', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TTR-003', 'Nước', 'TTR', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-001', 'F1', 'GU', 'hộp', null),
  ('GU-002', 'F2', 'GU', 'hộp', null),
  ('GU-003', 'F3', 'GU', 'hộp', null),
  ('GU-004', 'H8- 21', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-005', 'H15-21', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-006', 'H15-25', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-007', 'HH20 - 25', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-008', 'Châm gai vàng', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-009', 'Mũi gate', 'GU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('GU-010', 'Lentinol', 'GU', 'vỉ', null),
  ('GU-011', 'Chỉ nilong 5/0', 'GU', 'hộp', null),
  ('DCU-001', 'DC niti 17x25 trên', 'DCU', 'cái', null),
  ('DCU-002', 'Dây cung I - arch 16x14 dưới', 'DCU', 'hộp', null),
  ('DCU-003', 'Dây cung I - arch 16x14 trên', 'DCU', 'hộp', 'Quy cách: 5 dây/hộp'),
  ('DCU-004', 'Dây cung I - arch 18x14 dưới ( giao nhầm hàng)', 'DCU', 'hộp', 'Quy cách: 5 dây/hộp'),
  ('DCU-005', 'Dây cung I - arch 18x14 trên', 'DCU', 'hộp', 'Quy cách: 5 dây/hộp'),
  ('DCU-006', 'Dây cung I - arch 16x16 dưới', 'DCU', 'hộp', 'Quy cách: 5 dây/hộp'),
  ('DCU-007', 'Dây cung I - arch 16x16 trên', 'DCU', 'hộp', 'Quy cách: 5 dây/hộp'),
  ('DCU-008', 'Dây cung mặt lưỡi 12 x4', 'DCU', 'sợi', null),
  ('DCU-009', 'Dây cung mặt lưỡi 16 x5', 'DCU', 'sợi', null),
  ('DCU-010', 'Dây cung mặt lưỡi 14 x5', 'DCU', 'sợi', null),
  ('DCU-011', 'Dây Premium Smart 0,18 trên', 'DCU', 'gói', null),
  ('DCU-012', 'Dây Premium Smart 0,18 dưới', 'DCU', 'gói', null),
  ('DCU-013', 'Niti 12 dưới', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-014', 'Niti 12 trên', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-015', 'Niti 18 dưới', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-016', 'Niti 18 trên', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-017', 'Niti 17x25 trên', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-018', 'Niti 17 x 25 dưới', 'DCU', 'dây', null),
  ('DCU-019', 'Niti 19 x 25 trên', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-020', 'Niti 19 x 25 dưới', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-021', 'Niti 14 x 25 R24', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-022', 'Niti 14 x 25 R26', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-023', 'Niti 14 x 25 R28', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-024', 'Niti 18 x 25 R24', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-025', 'Niti 18 x 25 R26', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-026', 'Niti 18 x 25 R28', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-027', 'Dây cung Sialoy 16x22 trên', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-028', 'Dây cung Sialoy 16x22 dưới', 'DCU', 'sợi', null),
  ('DCU-029', 'NNiti3M 016x22 hàm dưới', 'DCU', 'sợi', null),
  ('DCU-030', 'Dây SS 16 trên', 'DCU', 'sợi', null),
  ('DCU-031', 'Dây SS 16 dưới', 'DCU', 'sợi', null),
  ('DCU-032', 'Dây SS 18 trên', 'DCU', 'sợi', null),
  ('DCU-033', 'Dây SS 18 dưới', 'DCU', 'sợi', null),
  ('DCU-034', 'Dây SS 16 x22 dưới', 'DCU', 'sợi', null),
  ('DCU-035', 'Dây SS 17 x25 trên', 'DCU', 'sợi', null),
  ('DCU-036', 'Dây SS 17 x25 dưới', 'DCU', 'sợi', null),
  ('DCU-037', 'Dây SS 19 x25 dưới', 'DCU', 'sợi', null),
  ('DCU-038', 'Dây SS 19 x25 trên', 'DCU', 'sợi', null),
  ('DCU-039', 'DC Ultra Form SS Archwire 19x25 trên/dưới', 'DCU', 'vỉ', null),
  ('DCU-040', 'DC Ultra Form SS Archwire 16x22 trên/dưới', 'DCU', 'vỉ', null),
  ('DCU-041', 'DC Ultra Form SS Archwire 17x25 trên/dưới', 'DCU', 'vỉ', null),
  ('DCU-042', 'DC Ultra Form SS Archwire 18x25 trên/dưới', 'DCU', 'vỉ', null),
  ('DCU-043', 'DC Niti reverse Curve II Archwire 18 trên', 'DCU', 'vỉ', null),
  ('DCU-044', 'DC Niti reverse Curve II Archwire 18 dưới', 'DCU', 'vỉ', null),
  ('DCU-045', 'DC Niti reverse Curve II Archwire 17x25 trên', 'DCU', 'vỉ', null),
  ('DCU-046', 'DC Niti reverse Curve II Archwire 17x25 dưới', 'DCU', 'vỉ', null),
  ('DCU-047', 'Niti Reverse Curve II đuôi thẳng 16x22 trên', 'DCU', 'vỉ', null),
  ('DCU-048', 'Niti Reverse Curve II đuôi thẳng 16x22 dưới', 'DCU', 'vỉ', null),
  ('DCU-049', 'Niti Reverse Curve II đuôi thẳng 16 trên', 'DCU', 'vỉ', null),
  ('DCU-050', 'Niti Reverse Curve II đuôi thẳng 16 dưới', 'DCU', 'vỉ', null),
  ('DCU-051', 'Niti Reverse Curve I 0,16', 'DCU', 'hộp', null),
  ('DCU-052', 'Niti Reverse Curve I 0,18', 'DCU', 'hộp', null),
  ('DCU-053', 'Nickel Titanium Ultra form Archwire 16x22 trên', 'DCU', 'vỉ', null),
  ('DCU-054', 'Nickel Titanium Ultra form Archwire 16x22 dưới', 'DCU', 'vỉ', null),
  ('DCU-055', 'Nickel Titanium Ultra form Archwire 16 trên', 'DCU', 'vỉ', null),
  ('DCU-056', 'Nickel Titanium Ultra form Archwire 16 dưới', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-057', 'Nickel Titanium Ultra form Archwire 14 trên', 'DCU', 'vỉ', null),
  ('DCU-058', 'Niti 14 dưới', 'DCU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DCU-059', 'Nickel Titanium Opti form Archwire 16x16 Universal', 'DCU', 'vỉ', null),
  ('DCU-060', 'Niti Reverse Curve Archwier 0,17x0,25 dưới', 'DCU', 'gói', null),
  ('DCU-061', 'Niti Reverse Curve Archwier 0,17x0,25 trên', 'DCU', 'gói', null),
  ('DCU-062', 'Niti Reverse Curve II dưới', 'DCU', 'gói', null),
  ('DCU-063', 'Reverse Curve II Archwire 0,18 dưới', 'DCU', 'gói', null),
  ('DCU-064', 'Reverse Curve II Archwire 0,18 trên', 'DCU', 'gói', null),
  ('DCU-065', 'Niti Reverse Curve II 0,16 trên', 'DCU', 'gói', null),
  ('DCU-066', 'Ultra-Form Archwire 0,18x0,25 trên', 'DCU', 'gói', null),
  ('DCU-067', 'Ultra-Form Archwire 0,18x0,25 dưới', 'DCU', 'gói', null),
  ('DCU-068', 'Form Archwire 0,18x0,25 Universal', 'DCU', 'gói', null),
  ('DCU-069', 'Dây CNA 0,17*0,25 trên', 'DCU', 'gói', null),
  ('DCU-070', 'Dây CNA 0,17*0,25 dưới', 'DCU', 'gói', null),
  ('DCU-071', 'Dây CNA 0,16*0,22 trên', 'DCU', 'gói', null),
  ('DCU-072', 'Dây CNA 0,16*0,22 dưới', 'DCU', 'gói', null),
  ('DCU-073', 'Dây CNA 0,16 x 22', 'DCU', 'ống', null),
  ('DCU-074', 'Dây Sialoy 16*22 trên', 'DCU', 'gói', null),
  ('DCU-075', 'Dây Sialoy 16*22 dưới', 'DCU', 'gói', null),
  ('DCU-076', 'Dây Sialoy 17*25 trên', 'DCU', 'gói', null),
  ('DCU-077', 'Dây I-arch 16*16 trên', 'DCU', 'gói', null),
  ('DCU-078', 'Dây I-arch 16*16 dưới', 'DCU', 'gói', null),
  ('CO-001', 'Mini 4,5 x 15', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-002', 'Mini 4,5 x 11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-003', 'Mini 4,0 x 11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-004', 'Multi 4,8 x 12', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-005', 'Multi 4,8 x 10', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-006', 'Mini Vis 2,0 x 14', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-007', 'Mini Vis 2,0 x 12', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-008', 'Mini Vis 1,6 x 10', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-009', 'Mini Vis 1,6 x 8', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-010', 'Mini Vis 2,0 x 10', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-011', 'Mini Vis 1,6 x 6', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-012', 'Mini Vis 1,8 x 10', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-013', 'Mini nghiêng 30 cao 3,5', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-014', 'Mini nghiêng 30 cao 3', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-015', 'Mini nghiêng 30 cao 5', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-016', 'Mini nghiêng 30 cao 4', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-017', 'Regular 4 x 17', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-018', 'Regular 4 x 30', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-019', 'Regular 3 x 30', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-020', 'Regular 3 x 17', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-021', 'Regular 5 x 17', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-022', 'Regular 5 x 30', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-023', 'Regular 5,0 x11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-024', 'Regular 4,0 x11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-025', 'Regular 4,0 x 8', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-026', 'Regular 4,0 x15', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-027', 'Coping ren', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-028', 'Coping mini', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-029', 'Copping thường 4,5 x 11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-030', 'Copping thường 4,5 x 15', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-031', 'Copping thường 4,0 x 15', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CO-032', 'Copping thường 4,0 x 11', 'CO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AN-001', 'Analog Mini', 'AN', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AN-002', 'Analog Regular', 'AN', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-001', 'Abutment Regular 5,0 x 7', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-002', 'Abutment Regular 4,5 x 7', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-003', 'Abutment Regular 5,0 x 2', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-004', 'Abutment Regular 5,0 x 5,0', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-005', 'Abutment Regular 4,8 x 12', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-006', 'Abutment 45 x 6 x 45', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-007', 'Abutment 45 x 6 x 55', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-008', 'Abutment 35 x 6 x 2,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-009', 'Abutment 33 x 4 x 35', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-010', 'Abutment 45 x 4 x 1,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-011', 'Abutment 45 x 4 x 2,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-012', 'Abutment 33 x 6 x 2,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-013', 'Abutment 45 x 6 x 3,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-014', 'Abutment 45 x 6 x 5,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-015', 'Abutment 45 x 6 x 2,5', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-016', 'Abutment', 'AB', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('AB-017', 'Ultra Form 18*0,25 trên', 'AB', 'gói', null),
  ('AB-018', 'Ultra Form 18*0,25 dưới', 'AB', 'gói', null),
  ('AB-019', 'Ultra- Form 0,19* 0,25 trên', 'AB', 'gói', null),
  ('AB-020', 'Ultra- Form 0,19* 0,25 dưới', 'AB', 'gói', null),
  ('AB-021', 'Ultra-Form 0,16*0,22 trên', 'AB', 'gói', null),
  ('AB-022', 'Ultra-Form 0,16*0,22 dưới', 'AB', 'gói', null),
  ('AB-023', 'Ultra-Form 0,17*0,22 dưới', 'AB', 'gói', null),
  ('AB-024', 'Ultra-Form 0,17*0,22 trên', 'AB', 'gói', null),
  ('CN-001', 'Art size L', 'CN', 'túi', null),
  ('CN-002', 'Art size M', 'CN', 'túi', null),
  ('CN-003', 'Art size S', 'CN', 'túi', null),
  ('CN-004', 'Art Big', 'CN', 'túi', null),
  ('CN-005', 'Battut núm', 'CN', 'cái', null),
  ('CN-006', 'Húc móc 5,5 phải', 'CN', 'túi', null),
  ('CN-007', 'Nút chặn lưỡi', 'CN', 'túi', null),
  ('CN-008', 'Húc 2,2', 'CN', 'túi', null),
  ('CN-009', 'Húc 5,5 trái', 'CN', 'túi', null),
  ('CN-010', 'Healing Cáp', 'CN', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CN-011', 'Cylinder 48x12', 'CN', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-001', 'Healing Mini 33 x 11,5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-002', 'Healing Mini 2', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-003', 'Healing Mini 45 x 35', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-004', 'Healing mini 4,3x5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-005', 'Healing mini 4,3 x7', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-006', 'Healing mini 4,3 x9', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-007', 'Healing mini 4x4', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-008', 'Healing mini 4,5 x 4', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-009', 'Healing mini 4 x 5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-010', 'Healing mini 4,5 x 5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-011', 'Healing mini 4 x 3', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-012', 'Healing mini 4,5 x 3', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-013', 'Healing mini 4 x 7', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-014', 'Healing mini 4,0 x 3,5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-015', 'Healing mini 4,0 x 15', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-016', 'Healing mini 4,0 x 9', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-017', 'Healing mini 4,5 x 9', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-018', 'Healing mini 4,5 x 15', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-019', 'Healing mini 4,0 x 12', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-020', 'Healing mini 4,5 x 12', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-021', 'Healing mini 4,5 x 7', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-022', 'Healing thường 5,0 x 7,0', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-023', 'Healing thường 4,5 x 7,0', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-024', 'Healing thường 5,0 x 5,0', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-025', 'Bộ MCKL (slot 18)', 'HE', 'bộ', null),
  ('HE-026', 'Healing 505', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-027', 'Healing 407', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-028', 'Healing 606', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-029', 'Healing 607', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-030', 'Healing 605', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-031', 'Healing 457', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-032', 'Healing 506', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-033', 'Healing 507', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-034', 'Healing 509', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-035', 'Healing 609', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-036', 'Healing 405', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-037', 'Healing 406', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-038', 'Healing 455', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-039', 'Con vặn tay', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-040', 'Lab Analog', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-041', 'Healing 705', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-042', 'Healing 706', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-043', 'Healing 707', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-044', 'Healing 7015', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-045', 'Healing 7012', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-046', 'Ốc munti', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-047', 'Healing 4012', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-048', 'Healing 4015', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-049', 'Healing mini 3536', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-050', 'Healing mini 48*50', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-051', 'Healing bio 42*4', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-052', 'Healing bio 42*5', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-053', 'Healing bio 47*4', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-054', 'Healing 6015', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-055', 'Healing 5015', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('HE-056', 'Healing 709', 'HE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-001', 'Trụ mỹ 5.0x7', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-002', 'Trụ mỹ 5.0x10', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-003', 'Trụ mỹ 4.5x11.5', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-004', 'Trụ mỹ 4.5x10', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-005', 'trụ mỹ 4.5x8.5', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-006', 'Trụ mỹ 4.5x13', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-007', 'Trụ mỹ 4.5x7', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-008', 'Trụ mỹ 4.0x13', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-009', 'Trụ mỹ 4.0x8.5', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-010', 'Trụ mỹ 4.0x10', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-011', 'Trụ mỹ 4.0x7', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-012', 'Trụ mỹ 4.0x11.7', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-013', 'Trụ mỹ 3.5x10', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-014', 'Trụ mỹ 3.5x11.5', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TMY-015', 'Trụ mỹ 3.5x13', 'TMY', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-001', 'Trụ Core 4.0x11.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel · NCC: Jootis'),
  ('TCO-002', 'Trụ Core 4.0x8.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-003', 'Trụ Core 4.0x8', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-004', 'Trụ Core 4.0x10', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-005', 'Trụ Core 4.0x11.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-006', 'Trụ Core 4.0x13', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-007', 'Trụ Core 4.5x10', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-008', 'Trụ Core 4.5x11,5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-009', 'Trụ Core 4.5x8.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-010', 'Trụ Core 3.0x10', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-011', 'Trụ Core 3.0x13', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-012', 'Trụ Core 3.0x11.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-013', 'Trụ Core 3.5x10', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-014', 'Trụ Core 3.5x13', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-015', 'Trụ Core 3.5x11.5', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-016', 'Trụ Core 4.5x7', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TCO-017', 'Trụ Core 5.0x7.0', 'TCO', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-001', 'Trụ Bio 5.0x13', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-002', 'Trụ Bio 5.0x11.5', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-003', 'Trụ Bio 5.0x7', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-004', 'Trụ Bio 5.0x5.5', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-005', 'Trụ Bio 4.0x7', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-006', 'Trụ Bio 4.0x5.5', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TBI-007', 'Trụ Bio 4.5x13', 'TBI', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-001', 'Trụ SIC 4.2x9.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-002', 'Trụ SIC 4.2x7.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-003', 'Trụ SIC 4.2x13', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-004', 'Trụ SIC 4.2x11.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-005', 'Trụ SIC 4.7x13', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-006', 'Trụ SIC 4.7x7.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-007', 'Trụ SIC 4.7x9.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-008', 'Trụ SIC 5.2x7.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-009', 'Trụ SIC 5.2x9.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-010', 'Trụ SIC 5.2x11.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('SIC-011', 'Trụ SIC 3.7x9.5', 'SIC', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TRA-001', 'Trụ Tramem 4.1x10', 'TRA', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TRA-002', 'Trụ Tramem 4.8x12', 'TRA', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TRA-003', 'Trụ Tramem 4.1x8', 'TRA', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-001', 'Trụ Neodent 5.0x10', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-002', 'Trụ Neodent 4.0x11.5', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-003', 'Trụ Neodent 3.75x10', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-004', 'Trụ Neodent 4.3x11.5', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-005', 'Trụ Neodent 3.5x11.5', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-006', 'Trụ Neodent 4.0x10', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-007', 'Trụ Neodent 5.0x11.5', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-008', 'Trụ Neodent 4.3x10', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-009', 'Nắp đậy', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-010', 'Nắp đậy mini', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-011', 'SIC healing ren 6x9', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-012', 'SIC healing 43x4 mini', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-013', 'SIC Healing 6x4', 'TNE', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TNE-014', 'Lá cắt kẽ', 'TNE', 'gói', null),
  ('TNE-015', 'chỉ B', 'TNE', 'cuộn', null),
  ('TNE-016', 'Côn giấy 15', 'TNE', 'hộp', null),
  ('TNE-017', 'Côn giấy 20', 'TNE', 'hộp', null),
  ('TNE-018', 'Côn giấy 25', 'TNE', 'hộp', null),
  ('TNE-019', 'Côn giấy 30', 'TNE', 'hộp', null),
  ('TNE-020', 'Côn giấy 35', 'TNE', 'hộp', null),
  ('TNE-021', 'Côn giấy 40', 'TNE', 'hộp', null),
  ('TNE-022', 'Côn nên 15', 'TNE', 'hộp', null),
  ('TNE-023', 'Côn nên 20', 'TNE', 'hộp', null),
  ('TNE-024', 'Côn nên 25', 'TNE', 'hộp', null),
  ('TNE-025', 'Côn nên 30', 'TNE', 'hộp', null),
  ('TNE-026', 'Côn nên 35', 'TNE', 'hộp', null),
  ('TNE-027', 'đầu trộn silicon lỏng to', 'TNE', 'cái', null),
  ('TNE-028', 'đầu trộn silicon lỏng nhỏ', 'TNE', 'cái', null),
  ('TH-001', 'Covensyl', 'TH', 'lọ', null),
  ('TH-002', 'Arcoxia', 'TH', 'hộp', null),
  ('TH-003', 'Clorpheniramin', 'TH', 'vỉ', null),
  ('TH-004', 'Medrol', 'TH', 'hộp', null),
  ('TH-005', 'Alaxan', 'TH', 'vỉ', null),
  ('TH-006', 'Efferalgan', 'TH', 'vỉ', null),
  ('TH-007', 'Transamin', 'TH', 'vỉ', null),
  ('TH-008', 'Panadol', 'TH', 'hộp', null),
  ('TH-009', 'Solu - Medol', 'TH', 'lọ', null),
  ('TH-010', 'Methylpresisolne ( phải pha nước cất)', 'TH', 'lọ', null),
  ('TH-011', 'Adenamin', 'TH', 'ống', null),
  ('TH-012', 'Dimedrol', 'TH', 'ống', null),
  ('TH-013', 'Ventolin', 'TH', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TH-014', 'Amoxicillin', 'TH', 'vỉ', null),
  ('TH-015', 'X - chozy', 'TH', 'vỉ', null),
  ('TH-016', 'Nifedipin T20', 'TH', 'vỉ', null),
  ('TH-017', 'Kim luồn 24G', 'TH', 'cái', null),
  ('DCP-001', 'Dây chuyền dịch', 'DCP', 'cái', null),
  ('DCP-002', 'Muối truyền', 'DCP', 'thùng', null),
  ('DCP-003', 'Bông Cầm máu', 'DCP', 'hộp', null),
  ('DCP-004', 'Mũ phẫu', 'DCP', 'gói', null),
  ('DCP-005', 'Băng dính bọc đồ phẫu', 'DCP', 'cuộn', null),
  ('DCP-006', 'Sáp lá', 'DCP', 'hộp', null),
  ('DCP-007', 'Sáp cây', 'DCP', 'cây', null),
  ('DCP-008', 'Oxy già', 'DCP', 'lọ', 'NCC: Thiên Minh'),
  ('DCP-009', 'Nước nhựa tự cứng', 'DCP', 'lọ', null),
  ('DCP-010', 'Chất lấy dấu (Aroma GC)', 'DCP', 'gói', 'Ghi chú Excel: còn 18 sau khi xuất'),
  ('DCP-011', 'Siêu cứng ( thạch cao Nori)', 'DCP', 'gói', null),
  ('DCP-012', 'Cứng thường ( Thạch cao planet)', 'DCP', 'gói', null),
  ('DCP-013', 'Thạch cao bùn', 'DCP', 'gói', null),
  ('DCP-014', 'Thạch Cao vàng', 'DCP', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('TTU-001', 'Paracetanol truyền', 'TTU', 'chai', null),
  ('TTU-002', 'Metronidazol Kabi', 'TTU', 'chai', null),
  ('TTU-003', 'Lipit 10%', 'TTU', 'chai', null),
  ('DK-001', '27G ( Đầu kim)', 'DK', 'hộp', null),
  ('DK-002', '30G', 'DK', 'hộp', null),
  ('DK-003', 'Sindonol', 'DK', 'lọ', null),
  ('DK-004', 'Foramen', 'DK', 'túi', null),
  ('DK-005', 'Foramen ( Keo đệm)', 'DK', 'tuýp', null),
  ('DK-006', 'Hộp đựng máng nha chu', 'DK', 'cái', null),
  ('DK-007', 'Dầu tra tay khoan đổ máy', 'DK', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DK-008', 'Dầu tra tay khoan xì tay', 'DK', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('DK-009', 'Vặn máy', 'DK', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CH-001', 'Chun 3/16 (6 OZ - 4,6 mm( gói)', 'CH', 'gói', null),
  ('CH-002', 'Chun 3/16 (4 OZ)', 'CH', 'gói', null),
  ('CH-003', 'Chun 3/16 (3,5 OZ)', 'CH', 'gói', null),
  ('CH-004', 'Chun 3/8 (4,5 OZ)', 'CH', 'gói', null),
  ('CH-005', 'Chun 3/8 (6,5 OZ)', 'CH', 'gói', null),
  ('CH-006', 'Chun 1/4 (4,5 OZ)', 'CH', 'gói', null),
  ('CH-007', 'Chun 1/4 (6,5 OZ)', 'CH', 'gói', null),
  ('CH-008', 'Chun 1/4 (4 OZ)', 'CH', 'gói', null),
  ('CH-009', 'Chun 1/4 (3.5 OZ)', 'CH', 'gói', null),
  ('CH-010', 'Chun1/4 (6 OZ)', 'CH', 'gói', null),
  ('CH-011', 'Chun 1/8 (45 OZ)', 'CH', 'gói', null),
  ('CH-012', 'Chun 1/8 (3,5 OZ)', 'CH', 'gói', null),
  ('CH-013', 'Chun 1/8 (6 OZ)', 'CH', 'gói', null),
  ('CH-014', 'Chun 1/8 (4 OZ)', 'CH', 'gói', null),
  ('CH-015', 'Chun 1/8 ( 3,5 OZ)', 'CH', 'gói', null),
  ('CH-016', 'Chun 5/16 (3,5 OZ)', 'CH', 'gói', null),
  ('CH-017', 'Chun 5/16 (4,5 OZ)', 'CH', 'gói', null),
  ('CH-018', 'Chun chuỗi mắt thưa', 'CH', 'gói', null),
  ('CH-019', 'Chun chuỗi mắt mau', 'CH', 'cuộn', null),
  ('CH-020', 'Cây móc chun liên hàm', 'CH', 'gói', null),
  ('CH-021', 'Banh cao su', 'CH', 'gói', null),
  ('CH-022', 'Chun tách kẽ', 'CH', 'thanh', null),
  ('CH-023', 'Sáp MC', 'CH', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('CH-024', 'Chun đơn', 'CH', 'gói', null),
  ('CH-025', 'Chun đơn 7 màu', 'CH', 'hộp', null),
  ('CH-026', 'Chun đơn mắt lưỡi', 'CH', 'cái', null),
  ('CH-027', 'Chun đơn mắt lưỡi', 'CH', 'thanh', null),
  ('CH-028', 'Miếng ép hàm duy trì (1,5)', 'CH', 'gói', null),
  ('CH-029', 'Miếng ép hàm duy trì (1,0)', 'CH', 'gói', null),
  ('CH-030', 'Dây Morelli 16x22 dưới', 'CH', 'gói', null),
  ('CH-031', 'Dây Morelli 16x22 trên', 'CH', 'gói', null),
  ('CH-032', 'Dây Morelli 17x25 dưới', 'CH', 'gói', null),
  ('CH-033', 'Dây Morelli 17x25 trên', 'CH', 'gói', null),
  ('CH-034', 'Dây Morelli đuôi thẳng 16x22 trên', 'CH', 'gói', null),
  ('DH-001', 'Giấy cắn', 'DH', 'hộp', null),
  ('V4N-001', 'Chỉ nha khoa C', 'V4N', 'cuộn', null),
  ('V4N-002', 'Chỉ nha khoa B', 'V4N', 'cuộn', null),
  ('V4N-003', 'Luxatemp (làm R tạm)', 'V4N', 'hộp', null),
  ('V4N-004', 'Tăm bond', 'V4N', 'hộp', null),
  ('V4N-005', 'Com đặc beautiful A2', 'V4N', 'tuýp', null),
  ('V4N-006', 'Com đặc beautiful A3', 'V4N', 'tuýp', null),
  ('V4N-007', 'Com đặc Asia A2 ( Com vàng)', 'V4N', 'tuýp', null),
  ('V4N-008', 'Com đặc Asia A3 ( Com vàng)', 'V4N', 'tuýp', null),
  ('V4N-009', 'Com lỏng Es flow A3', 'V4N', 'tuýp', null),
  ('V4N-010', 'Com lỏng Es flow A2', 'V4N', 'tuýp', null),
  ('V4N-011', 'Com lỏng Es flow A1', 'V4N', 'tuýp', null),
  ('V4N-012', 'Com lỏng xanh A1 (TM)', 'V4N', 'tuýp', null),
  ('V4N-013', 'Com lỏng xanh A2', 'V4N', 'tuýp', null),
  ('V4N-014', 'Com lỏng xanh A3', 'V4N', 'tuýp', null),
  ('V4N-015', 'Com lỏng đen A2, A3', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-016', 'Cục cắn trắng', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-017', 'Cục cắn xanh', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-018', 'Cát chải bóng ( Sò đánh bóng)', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-019', 'Bond ê buốt Nanoseal', 'V4N', 'hộp', null),
  ('V4N-020', 'Bond ê buốt Esbond', 'V4N', 'hộp', null),
  ('V4N-021', 'Bond không etching', 'V4N', 'hộp', null),
  ('V4N-022', 'Bond cam', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-023', 'Etching', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-024', 'Fuji9', 'V4N', 'hộp', null),
  ('V4N-025', 'MTA che tủy', 'V4N', 'hộp', null),
  ('V4N-026', 'Bàn chải kẽ', 'V4N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V4N-027', 'Băng dính lụa y tế', 'V4N', 'cuộn', null),
  ('V4N-028', 'Màng xương', 'V4N', 'miếng', null),
  ('V4N-029', 'Màng xương', 'V4N', 'hộp', null),
  ('V4N-030', 'Mặt gương', 'V4N', 'hộp', null),
  ('V3N-001', 'Fuji1', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V3N-002', 'Fuji Plus', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V3N-003', 'Luting', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('V3N-004', 'Silicon lỏng ( Fanta nhẹ)', 'V3N', 'hộp', null),
  ('V3N-005', 'Silicon đặc ( Fanta nặng)', 'V3N', 'hộp', null),
  ('V3N-006', 'Obite ( chất lấy dấu khớp)', 'V3N', 'tuýp', null),
  ('V3N-007', 'Chỉ co nướu vàng 00', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel · Ghi chú Excel: sau xuất còn 2'),
  ('V3N-008', 'Chỉ co nướu tím 0', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel · Ghi chú Excel: sau khi xuất còn 8'),
  ('V3N-009', 'Chỉ co nướu xanh 000', 'V3N', 'cái', 'ĐVT chưa ghi trong file Excel · Ghi chú Excel: sau khi xuất 13'),
  ('V3N-010', 'Đầu trộn obit', 'V3N', 'gói', null),
  ('V3N-011', 'Đầu trộn Silicon to', 'V3N', 'gói', null),
  ('V3N-012', 'Đầu trộn Silicon nhỏ', 'V3N', 'gói', null),
  ('T2-001', 'Nạo ngà đầu nhỏ', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-002', 'Hexan', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-003', 'Bông cuộn', 'T2', 'cuộn nhỏ', null),
  ('T2-004', 'Thìa nhựa Invis', 'T2', 'cái', null),
  ('T2-005', 'Banh miệng kéo', 'T2', 'cái', null),
  ('T2-006', 'Que đánh', 'T2', 'cái', null),
  ('T2-007', 'Que vén môi', 'T2', 'cái', null),
  ('T2-008', 'Banh miệng cao su', 'T2', 'cái', null),
  ('T2-009', 'Chụp cằm', 'T2', 'cái', null),
  ('T2-010', 'Kẹp phẫu tích có mấu', 'T2', 'cái', null),
  ('T2-011', 'Kẹp phẫu tích không mấu', 'T2', 'cái', null),
  ('T2-012', 'Bộ thước đo magic guide', 'T2', 'cái', null),
  ('T2-013', 'Banh miệng thép', 'T2', 'cái', null),
  ('T2-014', 'Kéo cắt cong 5CD to', 'T2', 'cái', null),
  ('T2-015', 'Cây bóc tách to', 'T2', 'cái', null),
  ('T2-016', 'thước đo MC Morelli to', 'T2', 'cái', null),
  ('T2-017', 'thước đo MC Morelli bé', 'T2', 'cái', null),
  ('T2-018', 'Kéo cắt chỉ đầu cong (12 cm)', 'T2', 'cái', null),
  ('T2-019', 'Cây đặt chỉ', 'T2', 'cái', null),
  ('T2-020', 'Kìm tháo band', 'T2', 'cái', null),
  ('T2-021', 'Banh kẹp chun', 'T2', 'cái', null),
  ('T2-022', 'Banh kẹp kim đầu', 'T2', 'cái', null),
  ('T2-023', 'Kìm bẻ đuôi đuôi', 'T2', 'cái', null),
  ('T2-024', 'Kìm cắt xa', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-025', 'Kẹp gắp MCR6.7', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-026', 'Kìm cắt gần', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-027', 'Kìm bậc thang', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-028', 'Kéo cắt chỉ 16cm đầu thẳng', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-029', 'Kim luồn dây', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-030', 'Kìm 2 mấu', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-031', 'Kìm tháo MC', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-032', 'Kìm hollow (Kìm lông máng)', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-033', 'Kìm 3 mấu', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-034', 'Kìm luồn dây Paskitan', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-035', 'Kìm nhổ chân R cán vàng', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-036', 'Dao 3', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-037', 'Kéo cắt chỉ thẳng (12 cm)', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('T2-038', 'Kẹp gấp', 'T2', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-001', 'Mini thẳng cao 3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-002', 'Mini thẳng cao 1', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-003', 'Mini thẳng cao 2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-004', 'Mini thẳng cao 4', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-005', 'Mini thẳng cao 5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-006', 'Muti thẳng cao 5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-007', 'Muti thẳng cao 1', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-008', 'Muti thẳng cao 4', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-009', 'Muti thẳng cao 3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-010', 'Muti thường thẳng H3, H4', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-011', 'Tay vặn tay ngắn', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-012', 'Tay vặn tay dài', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-013', 'Tay vặn lực dài', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-014', 'Tay vặn lực ngắn', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-015', 'Tay vặn lực', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-016', 'Con vặn tay', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-017', 'Con vặn Multi', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-018', 'Multi nghiêng Mini17 cao 3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-019', 'Multi nghiêng Mini17 cao 2,5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-020', 'Multi nghiêng Mini17 cao 4,5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-021', 'Multi nghiêng Mini17 cao 4', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-022', 'Multi nghiêng Mini17 cao 2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-023', 'Multi nghiêng 17 cao 2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-024', 'Multi nghiêng 17 cao 3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-025', 'Multi nghiêng 17 cao 5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-026', 'Cove mini', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-027', 'Cove regular', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-028', 'Analog mini', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-029', 'Mini vis 1,6 x6', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-030', 'Mini vis 1,6 x8', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-031', 'Mini vis 2,0x12', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-032', 'Hàm trainer for kids', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-033', 'Hàm EF Line', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-034', 'Hàm Uconcept', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-035', 'MC R6 (2 ống) slot 0,22', 'MU', 'vỉ', null),
  ('MU-036', 'MC R6 (2 ống) slot 0,18', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-037', '6C R7 (slot 0,22', 'MU', 'vỉ', null),
  ('MU-038', 'MC R6 (1 ống) slot 0,22', 'MU', 'vỉ', 'Ghi chú Excel: 22 + 2 hộp'),
  ('MU-039', 'MC R6 (1 ống slot 0,18', 'MU', 'vỉ', 'Ghi chú Excel: 18 + 10 hộp + 4 túi'),
  ('MU-040', 'MC R7 (slot 0,18)', 'MU', 'túi', null),
  ('MU-041', 'MC Saphia', 'MU', 'bộ', null),
  ('MU-042', 'MC sứ', 'MU', 'bộ', null),
  ('MU-043', 'MC Vector 0,22', 'MU', 'bộ', null),
  ('MU-044', 'MC Bio Max', 'MU', 'bộ', null),
  ('MU-045', 'MC KL Metal', 'MU', 'bộ', null),
  ('MU-046', 'MC KL 0,22', 'MU', 'bộ', null),
  ('MU-047', 'MC KL 0,18', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel · Ghi chú Excel: 76 bộ + 125'),
  ('MU-048', 'MC mặt lưỡi', 'MU', 'bộ', null),
  ('MU-049', 'MIM Bite turbos', 'MU', 'túi', null),
  ('MU-050', 'MC mặt lưỡi trái Sam', 'MU', 'túi', null),
  ('MU-051', 'MC mặt lưỡi phải Sam', 'MU', 'túi', null),
  ('MU-052', 'M cài mini MBT 0,22', 'MU', 'hộp', null),
  ('MU-053', 'Ốc nong 3 chiều', 'MU', 'cái', null),
  ('MU-054', 'Ốc nong bé dưới', 'MU', 'cái', null),
  ('MU-055', 'Ốc nong to trên', 'MU', 'cái', null),
  ('MU-056', 'Chỉ thép 0,2', 'MU', 'cuộn', null),
  ('MU-057', 'Dây thép 8', 'MU', 'cuộn', null),
  ('MU-058', 'Dây thép 7', 'MU', 'cuộn', null),
  ('MU-059', 'Dây thép 9', 'MU', 'cuộn', null),
  ('MU-060', 'Thiếc hàn', 'MU', 'cuộn', null),
  ('MU-061', 'Chỉ thép', 'MU', 'cuộn', null),
  ('MU-062', 'Banh miệng trắng to', 'MU', 'cái', null),
  ('MU-063', 'Banh miệng trắng bé', 'MU', 'cái', null),
  ('MU-064', 'Banh môi kéo to', 'MU', 'cái', null),
  ('MU-065', 'Banh môi kéo bé', 'MU', 'cái', null),
  ('MU-066', 'Treo truyền dịch', 'MU', 'cái', null),
  ('MU-067', 'Banh miệng chặn lưỡi to', 'MU', 'cái', null),
  ('MU-068', 'Banh miệng chặn lưỡi nhỏ', 'MU', 'cái', null),
  ('MU-069', 'Vén môi bé', 'MU', 'cái', null),
  ('MU-070', 'Banh cao su', 'MU', 'cái', null),
  ('MU-071', 'Thanh đen chụp ảnh', 'MU', 'bộ', null),
  ('MU-072', 'Chỉ thép 0,2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-073', 'Chỉ thép 0,3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-074', 'Matrix nhựa', 'MU', 'hộp', null),
  ('MU-075', 'Ống luồn dây cung', 'MU', 'cuộn', null),
  ('MU-076', 'Button kéo R ngầm', 'MU', 'gói', null),
  ('MU-077', 'Nút chặn đẩy lưỡi KL', 'MU', 'gói', null),
  ('MU-078', 'Lò xo 9 đầu to bé', 'MU', 'gói', null),
  ('MU-079', 'Lò xo 9 đầu vừa bé', 'MU', 'gói', null),
  ('MU-080', 'Lò xo 9 đầu nhỏ nhỏ', 'MU', 'gói', null),
  ('MU-081', 'Lò xo 6 đầu to nhỏ', 'MU', 'gói', null),
  ('MU-082', 'Lò xo 6 đầu nhỏ bé', 'MU', 'gói', null),
  ('MU-083', 'Lò xo đẩy', 'MU', 'gói', null),
  ('MU-084', 'Lò xo 3 đầu nhỏ nhỏ', 'MU', 'gói', null),
  ('MU-085', 'Lò xo 0,10 x 6 mm', 'MU', 'gói', null),
  ('MU-086', 'Lò xo 0,10 x 9 mm', 'MU', 'gói', null),
  ('MU-087', 'Lò xo 9 mm 2 đầu nhỏ', 'MU', 'gói', null),
  ('MU-088', 'Lò xo 6 mm đầu to, đầu nhỏ', 'MU', 'gói', null),
  ('MU-089', 'Lò xo 6 mm 2 đầu nhỏ', 'MU', 'gói', null),
  ('MU-090', 'Ống mini stop 0,5', 'MU', 'gói', null),
  ('MU-091', 'Stop khó chặn vuông', 'MU', 'gói', null),
  ('MU-092', 'Hook ngắn thẳng 2,2 mm', 'MU', 'gói', null),
  ('MU-093', 'Hook móc trái 5,5 mm', 'MU', 'gói', null),
  ('MU-094', 'Hook móc phải 5,5 mm', 'MU', 'gói', null),
  ('MU-095', 'Button rúm', 'MU', 'gói', null),
  ('MU-096', 'Button đế tròn 2 móc', 'MU', 'gói', null),
  ('MU-097', 'Button đế vuông 2 móc', 'MU', 'gói', null),
  ('MU-098', 'Button kéo R ngầm', 'MU', 'gói', null),
  ('MU-099', 'Nút chặn', 'MU', 'gói', null),
  ('MU-100', 'Lá xẻ kẽ', 'MU', 'gói', null),
  ('MU-101', 'Hook móc dán trái - phải', 'MU', 'gói', null),
  ('MU-102', 'Hook trượt thẳng 1,8', 'MU', 'gói', null),
  ('MU-103', 'Hook móc trượt', 'MU', 'gói', null),
  ('MU-104', 'Chỉnh torque đơn 16x22', 'MU', 'gói', null),
  ('MU-105', 'Chỉnh torque đơn 17x25', 'MU', 'gói', null),
  ('MU-106', 'Art small', 'MU', 'gói', null),
  ('MU-107', 'Art lower', 'MU', 'gói', null),
  ('MU-108', 'Art big', 'MU', 'gói', null),
  ('MU-109', 'Lá Matrix kim loại', 'MU', 'gói', null),
  ('MU-110', 'Đá gắn R', 'MU', 'gói', null),
  ('MU-111', 'Dao trả sáp', 'MU', 'cái', null),
  ('MU-112', 'Que ấn 2 đầu to', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-113', 'Thìa nhựa đánh agilat', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-114', 'Kìm nhỏ R8 dưới', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-115', 'Bóc tách to', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-116', 'Que hàn tạm', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-117', 'Bơm tiêm áp lực', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-118', 'Que ấn 2 đầu nhỏ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-119', 'Kìm chữ C', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-120', 'Kìm tweed', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-121', 'Cán dao vàng', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-122', 'Cán dao trắng', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-123', 'Banh đen', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-124', 'Bẩy cong', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-125', 'Bẩy inox thẳng', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-126', 'Nạo nhọn', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-127', 'Máy đánh tủy', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-128', 'Bộ nâng xoang hở', 'MU', 'bộ', null),
  ('MU-129', 'Bộ cắm mini vis', 'MU', 'bộ', null),
  ('MU-130', 'Ống tai nghe', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-131', 'Bông bạch tuyết', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-132', 'Dây truyền máy cấy IP2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-133', 'Khay khám', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-134', 'Cán gương', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-135', 'Kẹp gắp', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-136', 'Thám châm', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-137', 'Nạo trơn', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-138', 'Bóc tách nhỏ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-139', 'Nạo ngà', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-140', 'Nạo ổ xương', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-141', 'Nạo bản to', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-142', 'Que ấn 2 đầu to nhỏ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-143', 'Que hàn thẩm mỹ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-144', 'Hộp chữ nhật nhỡ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-145', 'Hộp chữ nhật to', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-146', 'Bơm 10 ml', 'MU', 'thùng', null),
  ('MU-147', 'Bơm 5 ml', 'MU', 'thùng', null),
  ('MU-148', 'Khẩu trang', 'MU', 'hộp', null),
  ('MU-149', 'Bảng so màu cũ', 'MU', 'bộ', null),
  ('MU-150', 'Màng bọc R chống bẩn', 'MU', 'cuộn', null),
  ('MU-151', 'Miếng ép cứng 1,0', 'MU', 'gói', null),
  ('MU-152', 'Máy cắt gutta', 'MU', 'cái', null),
  ('MU-153', 'Sáp lá', 'MU', 'hộp', null),
  ('MU-154', 'Sáp cây', 'MU', 'hộp', null),
  ('MU-155', 'Máy tăm nước ( nhận về từ Móng Cái)', 'MU', 'hộp', null),
  ('MU-156', 'Nước súc miệng Dewas', 'MU', 'thùng', 'NCC: DEWAS'),
  ('MU-157', 'Ốc Osstem TS Titan', 'MU', 'thùng', 'NCC: Dmax Asia'),
  ('MU-158', 'Bát inox', 'MU', 'thùng', 'NCC: Việt Đăng'),
  ('MU-159', 'Chà đài', 'MU', 'thùng', null),
  ('MU-160', 'Chà nụ', 'MU', 'thùng', null),
  ('MU-161', 'Ống hút phẫu thuật', 'MU', 'thùng', null),
  ('MU-162', 'Chỉ nilon 3.0', 'MU', 'hộp', null),
  ('MU-163', 'Chỉ nilon 4,0', 'MU', 'hộp', null),
  ('MU-164', 'Chỉ 5.0', 'MU', 'hộp', null),
  ('MU-165', 'Túi giấy', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-166', 'Cốc giấy', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-167', 'Sylinder', 'MU', 'hộp', null),
  ('MU-168', 'Sidolo', 'MU', 'lọ', null),
  ('MU-169', 'Gang tay', 'MU', 'thùng', null),
  ('MU-170', 'Kim tê 27', 'MU', 'hộp', null),
  ('MU-171', 'Mũi khoan sr-11', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-172', 'Mũi Khoan 198x-14', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-173', 'Nước ngâm dụng cụ', 'MU', 'chai', null),
  ('MU-174', 'Mũi F0 22 ef', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-175', 'Mũi TC 11ef', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-176', 'Mũi pro 3F', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-177', 'Mũi pro 2ef', 'MU', 'vỉ', null),
  ('MU-178', 'Mũi Br 49', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-179', 'Thuốc tê xịt', 'MU', 'lọ', null),
  ('MU-180', 'Thuốc tê', 'MU', 'hộp', null),
  ('MU-181', 'Kim nha 30G', 'MU', 'hộp', null),
  ('MU-182', 'Povidione', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-183', 'Tê đỏ ( hộp)', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-184', 'Băng tan', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-185', 'Gạc vô khuẩn', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-186', 'Bơm tê', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-187', 'Chỉ 30', 'MU', 'hộp', null),
  ('MU-188', 'Miếng ép nha chu', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-189', 'Đầu trộn làm răng tạm', 'MU', 'cái', null),
  ('MU-190', 'Lentolo', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-191', 'Nước muối sinh lý', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-192', 'Bơm 10 ml', 'MU', 'hộp', null),
  ('MU-193', 'muti nghiêng 30 H2', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-194', 'muti nghiêng 30 H3', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-195', 'muti nghiêng 30 H4', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-196', 'muti nghiêng 30 H5', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-197', 'chun liên hàm 1/14 70g', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-198', 'Máng ép nha chu', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-199', 'Ống trụ pank', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-200', 'Bông trộn nhỏ', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-201', 'Xương ( loại 0,5cc)', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-202', 'Màng xương', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel'),
  ('MU-203', 'Tay khoan thay', 'MU', 'cái', 'ĐVT chưa ghi trong file Excel')
) as v(code, name, gcode, unit, note)
join item_groups g on g.code = v.gcode
on conflict (code) do nothing;

do $$
declare r record;
begin
  if exists (select 1 from movements where reason = 'Tồn đầu kỳ từ file Excel') then return; end if;
  for r in
    select i.id as item_id, v.b::smallint as b, v.qty::numeric as qty
    from (values
      ('DC-001', 9, 23),
      ('DC-001', 7, 4),
      ('DC-001', 8, 2),
      ('DC-001', 6, 2),
      ('DC-001', 10, 2),
      ('DC-001', 3, 2),
      ('DC-001', 1, 2),
      ('DC-001', 5, 2),
      ('DC-001', 4, 2),
      ('DC-002', 9, 11),
      ('DC-002', 7, 3),
      ('DC-002', 4, 2),
      ('DC-003', 9, 29),
      ('DC-003', 7, 1),
      ('DC-003', 4, 2),
      ('DC-004', 9, 6),
      ('DC-004', 10, 10),
      ('DC-005', 9, 5),
      ('DC-006', 9, 15),
      ('DC-007', 9, 12),
      ('DC-008', 9, 9),
      ('DC-009', 7, 5),
      ('DC-009', 4, 5),
      ('DC-010', 9, 6),
      ('DC-010', 5, 1),
      ('DC-011', 9, 2),
      ('DC-012', 9, 29),
      ('DC-012', 10, 6),
      ('DC-012', 1, 2),
      ('DC-012', 4, 3),
      ('V5D-001', 9, 20),
      ('V5D-001', 5, 1),
      ('FM-001', 9, 2),
      ('FM-001', 5, 1),
      ('FM-002', 9, 16),
      ('FM-002', 6, 2),
      ('FM-002', 5, 1),
      ('FM-003', 9, 6),
      ('FM-004', 9, 2),
      ('FM-005', 9, 4),
      ('FM-006', 9, 10),
      ('FM-007', 9, 7),
      ('FM-008', 9, 9),
      ('FM-009', 9, 7),
      ('FM-009', 1, 1),
      ('FM-010', 9, 8),
      ('FM-011', 9, 9),
      ('FM-012', 9, 3),
      ('FM-013', 9, 33),
      ('FM-013', 1, 1),
      ('FM-013', 5, 3),
      ('FM-014', 9, 3),
      ('FM-015', 9, 13),
      ('FM-016', 9, 43),
      ('FM-017', 9, 11),
      ('FM-018', 9, 9),
      ('FM-019', 9, 4),
      ('FM-020', 9, 6),
      ('FM-021', 9, 1),
      ('FM-021', 1, 1),
      ('FM-022', 9, 6),
      ('FM-023', 9, 7),
      ('FM-024', 9, 1),
      ('FM-025', 9, 15),
      ('FM-026', 9, 14),
      ('FM-027', 9, 4),
      ('FM-028', 9, 8),
      ('FM-029', 9, 8),
      ('FM-030', 9, 17),
      ('FM-031', 9, 3),
      ('FM-032', 9, 21),
      ('FM-033', 9, 2),
      ('FM-034', 9, 2),
      ('FM-035', 9, 9),
      ('FM-036', 9, 11),
      ('FM-037', 9, 22),
      ('FM-038', 9, 2),
      ('FM-039', 9, 3),
      ('FM-040', 9, 10),
      ('FM-041', 9, 3),
      ('FM-042', 9, 13),
      ('FM-043', 9, 13),
      ('FM-044', 9, 3),
      ('FM-045', 9, 19),
      ('FM-046', 9, 13),
      ('FM-047', 9, 3),
      ('FM-048', 9, 1),
      ('FM-049', 9, 1),
      ('FM-050', 9, 7),
      ('FM-051', 9, 1),
      ('FM-052', 9, 1),
      ('FM-053', 9, 1),
      ('FM-054', 9, 32),
      ('FM-055', 9, 7),
      ('FM-056', 9, 8),
      ('FM-057', 9, 1),
      ('FM-058', 9, 7),
      ('FM-059', 9, 50),
      ('FM-060', 9, 50),
      ('FM-061', 9, 14),
      ('FM-061', 4, 2),
      ('FM-062', 9, 14),
      ('FM-062', 4, 2),
      ('FM-063', 9, 2),
      ('FM-064', 9, 8),
      ('FM-065', 9, 2),
      ('FM-066', 9, 4),
      ('FM-067', 9, 11),
      ('FM-068', 9, 6),
      ('FM-068', 8, 2),
      ('FM-068', 4, 5),
      ('FM-069', 9, 1),
      ('FM-070', 9, 28),
      ('FM-071', 9, 6),
      ('FM-072', 9, 2),
      ('FM-073', 9, 4),
      ('FM-074', 9, 4),
      ('FM-075', 9, 25),
      ('FM-076', 9, 3),
      ('FM-077', 9, 17),
      ('FM-078', 9, 4),
      ('FM-079', 9, 35),
      ('FM-080', 9, 76),
      ('FM-081', 9, 1),
      ('FM-081', 8, 1),
      ('FM-082', 9, 2),
      ('FM-083', 9, 1),
      ('FM-084', 9, 8),
      ('FM-084', 4, 5),
      ('FM-085', 9, 36),
      ('FM-086', 9, 2),
      ('FM-087', 9, 1),
      ('FM-088', 9, 13),
      ('FM-089', 9, 36),
      ('FM-090', 9, 1),
      ('FM-091', 9, 20),
      ('FM-091', 5, 1),
      ('FM-091', 4, 2),
      ('FM-092', 9, 84),
      ('FM-093', 9, 3),
      ('FM-094', 9, 3),
      ('FM-095', 9, 2),
      ('FM-096', 9, 90),
      ('FM-097', 9, 1),
      ('FM-098', 9, 4),
      ('FM-099', 9, 2),
      ('FM-100', 3, 10),
      ('FM-100', 1, 5),
      ('V5D-002', 9, 2),
      ('V5D-003', 9, 3),
      ('V5D-003', 7, 1),
      ('V5D-003', 4, 1),
      ('V5D-004', 9, 2),
      ('V5D-005', 9, 4),
      ('V5D-005', 4, 1),
      ('V5D-006', 9, 3),
      ('V5D-007', 9, 4),
      ('V5D-008', 9, 1),
      ('V5D-009', 9, 8),
      ('V5D-009', 5, 1),
      ('V5D-010', 9, 3),
      ('V5D-010', 7, 1),
      ('V5D-010', 4, 1),
      ('V5D-011', 9, 4),
      ('V5D-012', 9, 2),
      ('V5D-013', 9, 55),
      ('V5D-013', 1, 5),
      ('V5D-014', 9, 20),
      ('V5D-015', 9, 9),
      ('V5D-015', 5, 3),
      ('FT-001', 9, 20),
      ('FT-001', 7, 2),
      ('FT-001', 1, 1),
      ('FT-001', 5, 3),
      ('FT-001', 4, 2),
      ('FT-002', 9, 18),
      ('FT-002', 7, 2),
      ('FT-002', 1, 1),
      ('FT-002', 5, 5),
      ('FT-002', 4, 2),
      ('FT-003', 9, 23),
      ('FT-004', 9, 28),
      ('FT-005', 9, 27),
      ('FT-006', 9, 21),
      ('FT-007', 9, 25),
      ('FT-008', 9, 5),
      ('FT-009', 9, 14),
      ('FT-010', 9, 10),
      ('FT-011', 9, 17),
      ('FT-012', 9, 7),
      ('FT-013', 9, 22),
      ('FT-014', 9, 24),
      ('FT-015', 9, 15),
      ('FT-016', 9, 18),
      ('FT-017', 9, 21),
      ('FT-018', 9, 34),
      ('FT-019', 9, 15),
      ('FT-020', 9, 9),
      ('FT-021', 9, 8),
      ('FT-022', 9, 5),
      ('FT-022', 5, 5),
      ('FT-023', 9, 5),
      ('FT-023', 5, 3),
      ('FT-024', 9, 1),
      ('TTR-001', 9, 24),
      ('TTR-002', 9, 10),
      ('TTR-003', 9, 13),
      ('GU-001', 9, 17),
      ('GU-001', 5, 1),
      ('GU-001', 4, 1),
      ('GU-002', 9, 32),
      ('GU-002', 5, 1),
      ('GU-002', 4, 1),
      ('GU-003', 9, 13),
      ('GU-003', 4, 1),
      ('GU-004', 9, 20),
      ('GU-005', 9, 15),
      ('GU-006', 9, 25),
      ('GU-007', 9, 31),
      ('GU-008', 9, 5),
      ('GU-009', 9, 5),
      ('GU-009', 5, 1),
      ('GU-010', 9, 7),
      ('GU-010', 5, 3),
      ('GU-011', 10, 2),
      ('GU-011', 4, 3),
      ('DCU-001', 5, 2),
      ('DCU-001', 4, 10),
      ('DCU-002', 9, 15),
      ('DCU-003', 9, 9),
      ('DCU-003', 5, 5),
      ('DCU-003', 4, 1),
      ('DCU-004', 9, 15),
      ('DCU-005', 9, 10),
      ('DCU-005', 5, 5),
      ('DCU-006', 9, 12),
      ('DCU-007', 9, 13),
      ('DCU-008', 9, 1),
      ('DCU-009', 9, 1),
      ('DCU-010', 9, 1),
      ('DCU-011', 9, 1),
      ('DCU-012', 9, 1),
      ('DCU-013', 9, 3),
      ('DCU-014', 9, 5),
      ('DCU-014', 5, 1),
      ('DCU-015', 9, 5),
      ('DCU-016', 9, 5),
      ('DCU-017', 9, 3),
      ('DCU-017', 5, 2),
      ('DCU-018', 9, 10),
      ('DCU-018', 5, 2),
      ('DCU-019', 9, 5),
      ('DCU-020', 9, 10),
      ('DCU-021', 9, 3),
      ('DCU-021', 5, 1),
      ('DCU-022', 9, 9),
      ('DCU-023', 9, 10),
      ('DCU-024', 9, 7),
      ('DCU-025', 9, 7),
      ('DCU-026', 9, 5),
      ('DCU-027', 9, 7),
      ('DCU-028', 10, 20),
      ('DCU-029', 9, 150),
      ('DCU-030', 9, 10),
      ('DCU-031', 9, 10),
      ('DCU-032', 9, 10),
      ('DCU-033', 9, 30),
      ('DCU-034', 9, 40),
      ('DCU-035', 9, 10),
      ('DCU-036', 9, 46),
      ('DCU-037', 9, 50),
      ('DCU-038', 9, 50),
      ('DCU-039', 9, 2),
      ('DCU-040', 9, 1),
      ('DCU-041', 9, 1),
      ('DCU-042', 9, 2),
      ('DCU-043', 9, 2),
      ('DCU-044', 9, 1),
      ('DCU-045', 9, 3),
      ('DCU-046', 9, 7),
      ('DCU-047', 9, 1),
      ('DCU-048', 9, 13),
      ('DCU-049', 9, 2),
      ('DCU-050', 9, 1),
      ('DCU-051', 9, 2),
      ('DCU-052', 9, 2),
      ('DCU-053', 9, 5),
      ('DCU-054', 9, 1),
      ('DCU-055', 9, 18),
      ('DCU-056', 9, 5),
      ('DCU-057', 9, 13),
      ('DCU-058', 9, 11),
      ('DCU-059', 9, 4),
      ('DCU-060', 9, 4),
      ('DCU-061', 9, 3),
      ('DCU-062', 9, 3),
      ('DCU-063', 9, 1),
      ('DCU-064', 9, 2),
      ('DCU-065', 9, 1),
      ('DCU-066', 9, 2),
      ('DCU-067', 9, 2),
      ('DCU-068', 9, 4),
      ('DCU-069', 9, 7),
      ('DCU-070', 9, 7),
      ('DCU-071', 9, 5),
      ('DCU-072', 9, 6),
      ('DCU-073', 8, 1),
      ('DCU-073', 5, 5),
      ('DCU-073', 4, 1),
      ('DCU-074', 9, 7),
      ('DCU-075', 9, 7),
      ('DCU-076', 9, 8),
      ('DCU-077', 9, 5),
      ('DCU-078', 9, 4),
      ('CO-001', 9, 9),
      ('CO-002', 9, 12),
      ('CO-003', 9, 21),
      ('CO-004', 9, 190),
      ('CO-005', 9, 10),
      ('CO-006', 9, 26),
      ('CO-007', 9, 110),
      ('CO-008', 9, 32),
      ('CO-009', 9, 28),
      ('CO-010', 9, 5),
      ('CO-011', 9, 1),
      ('CO-012', 9, 7),
      ('CO-013', 9, 190),
      ('CO-014', 9, 60),
      ('CO-014', 5, 10),
      ('CO-015', 9, 50),
      ('CO-015', 8, 5),
      ('CO-016', 9, 46),
      ('CO-017', 9, 30),
      ('CO-018', 9, 42),
      ('CO-019', 9, 30),
      ('CO-020', 9, 33),
      ('CO-021', 9, 20),
      ('CO-022', 9, 9),
      ('CO-023', 9, 9),
      ('CO-024', 9, 7),
      ('CO-025', 9, 4),
      ('CO-026', 9, 2),
      ('CO-027', 9, 35),
      ('CO-028', 9, 37),
      ('CO-029', 9, 11),
      ('CO-030', 9, 1),
      ('CO-031', 9, 2),
      ('CO-032', 9, 1),
      ('AN-001', 9, 1),
      ('AN-002', 9, 3),
      ('AB-001', 9, 2),
      ('AB-002', 9, 3),
      ('AB-003', 9, 1),
      ('AB-004', 9, 1),
      ('AB-005', 9, 4),
      ('AB-006', 9, 1),
      ('AB-007', 9, 1),
      ('AB-008', 9, 1),
      ('AB-009', 9, 1),
      ('AB-010', 9, 1),
      ('AB-011', 9, 14),
      ('AB-012', 9, 3),
      ('AB-013', 9, 2),
      ('AB-014', 9, 1),
      ('AB-015', 9, 6),
      ('AB-016', 9, 1),
      ('AB-017', 9, 2),
      ('AB-018', 9, 2),
      ('AB-019', 9, 2),
      ('AB-020', 9, 2),
      ('AB-021', 9, 1),
      ('AB-022', 9, 1),
      ('AB-023', 9, 1),
      ('AB-024', 9, 1),
      ('CN-001', 9, 2),
      ('CN-002', 9, 2),
      ('CN-003', 9, 4),
      ('CN-004', 9, 1),
      ('CN-005', 9, 40),
      ('CN-006', 9, 5),
      ('CN-007', 9, 5),
      ('CN-008', 9, 5),
      ('CN-009', 9, 5),
      ('CN-010', 9, 69),
      ('CN-011', 9, 24),
      ('HE-001', 9, 3),
      ('HE-002', 9, 3),
      ('HE-003', 9, 6),
      ('HE-004', 9, 3),
      ('HE-005', 9, 1),
      ('HE-006', 9, 1),
      ('HE-007', 5, 10),
      ('HE-008', 9, 27),
      ('HE-009', 9, 77),
      ('HE-010', 9, 41),
      ('HE-011', 9, 13),
      ('HE-012', 9, 20),
      ('HE-013', 9, 2),
      ('HE-014', 9, 30),
      ('HE-015', 9, 10),
      ('HE-016', 9, 2),
      ('HE-017', 9, 15),
      ('HE-018', 9, 15),
      ('HE-019', 9, 10),
      ('HE-020', 9, 14),
      ('HE-021', 9, 28),
      ('HE-022', 9, 2),
      ('HE-023', 9, 3),
      ('HE-024', 9, 2),
      ('HE-025', 9, 49),
      ('HE-026', 9, 17),
      ('HE-027', 9, 64),
      ('HE-028', 9, 20),
      ('HE-029', 9, 20),
      ('HE-029', 6, 10),
      ('HE-030', 9, 60),
      ('HE-031', 9, 55),
      ('HE-032', 9, 67),
      ('HE-033', 9, 51),
      ('HE-034', 9, 5),
      ('HE-035', 9, 5),
      ('HE-036', 9, 35),
      ('HE-037', 9, 20),
      ('HE-038', 9, 36),
      ('HE-039', 9, 2),
      ('HE-040', 9, 1),
      ('HE-041', 9, 8),
      ('HE-042', 9, 8),
      ('HE-043', 9, 8),
      ('HE-044', 9, 15),
      ('HE-045', 9, 17),
      ('HE-046', 9, 500),
      ('HE-047', 9, 12),
      ('HE-048', 9, 29),
      ('HE-049', 9, 5),
      ('HE-050', 9, 5),
      ('HE-051', 9, 13),
      ('HE-052', 9, 11),
      ('HE-053', 9, 2),
      ('HE-054', 9, 23),
      ('HE-055', 9, 35),
      ('HE-056', 9, 7),
      ('TMY-001', 9, 30),
      ('TMY-002', 6, 10),
      ('TMY-003', 9, 64),
      ('TMY-003', 1, 5),
      ('TMY-004', 9, 8),
      ('TMY-004', 5, 5),
      ('TMY-005', 9, 30),
      ('TMY-005', 6, 10),
      ('TMY-006', 9, 6),
      ('TMY-006', 6, 10),
      ('TMY-007', 9, 41),
      ('TMY-008', 9, 16),
      ('TMY-009', 9, 75),
      ('TMY-010', 9, 46),
      ('TMY-011', 9, 62),
      ('TMY-012', 9, 60),
      ('TMY-012', 1, 2),
      ('TMY-013', 9, 9),
      ('TMY-014', 9, 4),
      ('TMY-015', 9, 18),
      ('TCO-001', 9, 14),
      ('TCO-001', 8, 10),
      ('TCO-002', 9, 232),
      ('TCO-002', 1, 5),
      ('TCO-003', 9, 500),
      ('TCO-004', 9, 1126),
      ('TCO-004', 10, 10),
      ('TCO-004', 1, 3),
      ('TCO-004', 5, 18),
      ('TCO-005', 9, 978),
      ('TCO-005', 8, 10),
      ('TCO-005', 1, 5),
      ('TCO-005', 5, 7),
      ('TCO-006', 9, 85),
      ('TCO-006', 8, 10),
      ('TCO-006', 1, 5),
      ('TCO-007', 9, 950),
      ('TCO-007', 8, 10),
      ('TCO-007', 6, 20),
      ('TCO-007', 1, 10),
      ('TCO-007', 4, 10),
      ('TCO-008', 9, 960),
      ('TCO-008', 8, 10),
      ('TCO-008', 6, 20),
      ('TCO-008', 4, 10),
      ('TCO-009', 9, 488),
      ('TCO-009', 6, 10),
      ('TCO-009', 1, 2),
      ('TCO-010', 9, 111),
      ('TCO-011', 9, 57),
      ('TCO-012', 9, 111),
      ('TCO-013', 9, 79),
      ('TCO-014', 9, 14),
      ('TCO-015', 9, 34),
      ('TCO-016', 9, 6),
      ('TCO-017', 9, 10),
      ('TBI-001', 9, 37),
      ('TBI-002', 6, 10),
      ('TBI-003', 9, 2),
      ('TBI-004', 9, 18),
      ('TBI-005', 9, 30),
      ('TBI-006', 9, 2),
      ('TBI-007', 9, 1),
      ('SIC-001', 9, 2),
      ('SIC-002', 9, 2),
      ('SIC-003', 9, 7),
      ('SIC-004', 9, 7),
      ('SIC-005', 9, 6),
      ('SIC-006', 9, 11),
      ('SIC-007', 9, 16),
      ('SIC-008', 9, 22),
      ('SIC-009', 9, 32),
      ('SIC-010', 9, 9),
      ('SIC-011', 9, 2),
      ('TRA-001', 9, 5),
      ('TRA-002', 9, 1),
      ('TRA-003', 9, 1),
      ('TNE-001', 9, 1),
      ('TNE-002', 9, 9),
      ('TNE-003', 9, 3),
      ('TNE-004', 9, 2),
      ('TNE-005', 9, 4),
      ('TNE-006', 9, 2),
      ('TNE-007', 9, 1),
      ('TNE-008', 9, 4),
      ('TNE-009', 9, 2),
      ('TNE-010', 9, 8),
      ('TNE-011', 9, 11),
      ('TNE-012', 9, 4),
      ('TNE-013', 9, 8),
      ('TNE-014', 4, 1),
      ('TNE-015', 4, 1),
      ('TNE-016', 9, 4),
      ('TNE-017', 9, 3),
      ('TNE-018', 9, 1),
      ('TNE-018', 5, 1),
      ('TNE-018', 4, 1),
      ('TNE-019', 9, 1),
      ('TNE-019', 1, 1),
      ('TNE-019', 5, 1),
      ('TNE-019', 4, 1),
      ('TNE-020', 9, 6),
      ('TNE-020', 1, 1),
      ('TNE-020', 4, 1),
      ('TNE-021', 9, 3),
      ('TNE-022', 9, 4),
      ('TNE-023', 9, 3),
      ('TNE-024', 9, 10),
      ('TNE-025', 9, 1),
      ('TNE-026', 9, 5),
      ('TNE-027', 4, 50),
      ('TNE-028', 4, 100),
      ('TH-001', 9, 2),
      ('TH-002', 9, 4),
      ('TH-003', 9, 6),
      ('TH-004', 9, 1),
      ('TH-004', 7, 1),
      ('TH-005', 9, 3),
      ('TH-006', 9, 7),
      ('TH-007', 9, 15),
      ('TH-007', 7, 2),
      ('TH-008', 9, 2),
      ('TH-008', 8, 1),
      ('TH-009', 5, 5),
      ('TH-009', 4, 6),
      ('TH-010', 9, 13),
      ('TH-011', 9, 57),
      ('TH-012', 9, 25),
      ('TH-013', 9, 1),
      ('TH-014', 9, 4),
      ('TH-015', 9, 2),
      ('TH-016', 9, 9),
      ('TH-017', 9, 20),
      ('DCP-001', 9, 40),
      ('DCP-001', 1, 5),
      ('DCP-002', 9, 1),
      ('DCP-003', 9, 15),
      ('DCP-004', 9, 13),
      ('DCP-004', 6, 3),
      ('DCP-004', 5, 3),
      ('DCP-004', 4, 1),
      ('DCP-005', 9, 2),
      ('DCP-006', 9, 2),
      ('DCP-007', 9, 16),
      ('DCP-008', 9, 11),
      ('DCP-009', 9, 6),
      ('DCP-010', 9, 14),
      ('DCP-010', 7, 2),
      ('DCP-010', 8, 2),
      ('DCP-010', 10, 4),
      ('DCP-010', 5, 6),
      ('DCP-010', 4, 2),
      ('DCP-011', 9, 31),
      ('DCP-011', 7, 2),
      ('DCP-011', 4, 2),
      ('DCP-012', 9, 24),
      ('DCP-012', 6, 6),
      ('DCP-012', 5, 5),
      ('DCP-012', 4, 2),
      ('DCP-013', 9, 11),
      ('DCP-014', 7, 2),
      ('DCP-014', 8, 2),
      ('DCP-014', 4, 2),
      ('TTU-001', 9, 77),
      ('TTU-001', 1, 5),
      ('TTU-002', 9, 106),
      ('TTU-002', 1, 5),
      ('TTU-003', 9, 14),
      ('DK-001', 9, 24),
      ('DK-001', 5, 2),
      ('DK-002', 9, 8),
      ('DK-003', 9, 160),
      ('DK-003', 7, 20),
      ('DK-003', 10, 30),
      ('DK-003', 5, 30),
      ('DK-004', 9, 5),
      ('DK-004', 7, 10),
      ('DK-004', 6, 28),
      ('DK-004', 5, 15),
      ('DK-005', 9, 59),
      ('DK-005', 1, 5),
      ('DK-006', 9, 135),
      ('DK-006', 5, 20),
      ('DK-007', 9, 2),
      ('DK-008', 9, 6),
      ('DK-009', 9, 4),
      ('CH-001', 9, 113),
      ('CH-001', 5, 1),
      ('CH-002', 9, 33),
      ('CH-002', 10, 2),
      ('CH-003', 9, 1),
      ('CH-003', 8, 4),
      ('CH-004', 9, 10),
      ('CH-005', 9, 39),
      ('CH-006', 9, 17),
      ('CH-007', 9, 7),
      ('CH-008', 9, 17),
      ('CH-009', 9, 25),
      ('CH-009', 8, 2),
      ('CH-010', 9, 41),
      ('CH-011', 9, 22),
      ('CH-012', 9, 6),
      ('CH-013', 9, 86),
      ('CH-014', 9, 15),
      ('CH-015', 9, 7),
      ('CH-016', 9, 18),
      ('CH-017', 9, 8),
      ('CH-018', 8, 1),
      ('CH-018', 6, 2),
      ('CH-019', 6, 2),
      ('CH-020', 9, 3),
      ('CH-021', 9, 6),
      ('CH-022', 9, 81),
      ('CH-023', 9, 117),
      ('CH-024', 9, 3),
      ('CH-024', 5, 1),
      ('CH-025', 9, 1),
      ('CH-026', 9, 67),
      ('CH-027', 9, 42),
      ('CH-028', 9, 1),
      ('CH-029', 9, 1),
      ('CH-029', 10, 1),
      ('CH-030', 9, 3),
      ('CH-031', 9, 4),
      ('CH-032', 9, 8),
      ('CH-033', 9, 10),
      ('CH-034', 9, 2),
      ('DH-001', 9, 44),
      ('DH-001', 8, 3),
      ('DH-001', 5, 5),
      ('DH-001', 4, 2),
      ('V4N-001', 9, 7),
      ('V4N-002', 9, 3),
      ('V4N-002', 4, 1),
      ('V4N-003', 9, 2),
      ('V4N-004', 9, 7),
      ('V4N-004', 5, 5),
      ('V4N-004', 4, 2),
      ('V4N-005', 9, 3),
      ('V4N-005', 8, 1),
      ('V4N-006', 9, 5),
      ('V4N-007', 9, 28),
      ('V4N-007', 8, 2),
      ('V4N-007', 10, 2),
      ('V4N-007', 1, 1),
      ('V4N-008', 9, 17),
      ('V4N-008', 8, 2),
      ('V4N-008', 10, 2),
      ('V4N-009', 9, 23),
      ('V4N-009', 5, 3),
      ('V4N-009', 4, 2),
      ('V4N-010', 9, 25),
      ('V4N-010', 5, 3),
      ('V4N-011', 9, 45),
      ('V4N-011', 5, 2),
      ('V4N-012', 9, 40),
      ('V4N-013', 9, 28),
      ('V4N-013', 6, 4),
      ('V4N-013', 10, 2),
      ('V4N-013', 4, 4),
      ('V4N-014', 9, 21),
      ('V4N-014', 6, 4),
      ('V4N-014', 10, 2),
      ('V4N-014', 3, 6),
      ('V4N-014', 1, 1),
      ('V4N-014', 4, 2),
      ('V4N-015', 8, 4),
      ('V4N-015', 6, 8),
      ('V4N-015', 10, 8),
      ('V4N-015', 3, 6),
      ('V4N-016', 9, 15),
      ('V4N-016', 1, 3),
      ('V4N-017', 9, 28),
      ('V4N-017', 5, 2),
      ('V4N-018', 9, 590),
      ('V4N-018', 8, 30),
      ('V4N-018', 6, 30),
      ('V4N-018', 5, 60),
      ('V4N-018', 4, 30),
      ('V4N-019', 9, 2),
      ('V4N-020', 9, 2),
      ('V4N-021', 9, 3),
      ('V4N-021', 4, 2),
      ('V4N-022', 8, 1),
      ('V4N-022', 5, 2),
      ('V4N-022', 4, 2),
      ('V4N-023', 9, 12),
      ('V4N-023', 5, 3),
      ('V4N-024', 9, 15),
      ('V4N-024', 8, 1),
      ('V4N-024', 10, 1),
      ('V4N-024', 4, 1),
      ('V4N-025', 9, 6),
      ('V4N-026', 9, 36),
      ('V4N-027', 9, 6),
      ('V4N-028', 9, 4),
      ('V4N-029', 9, 5),
      ('V4N-029', 11, 1),
      ('V4N-030', 7, 1),
      ('V4N-030', 10, 10),
      ('V3N-001', 9, 15),
      ('V3N-001', 10, 1),
      ('V3N-001', 4, 1),
      ('V3N-002', 9, 2),
      ('V3N-002', 10, 1),
      ('V3N-003', 9, 22),
      ('V3N-003', 5, 2),
      ('V3N-003', 4, 2),
      ('V3N-004', 9, 1),
      ('V3N-004', 7, 1),
      ('V3N-004', 8, 2),
      ('V3N-004', 6, 4),
      ('V3N-004', 10, 2),
      ('V3N-004', 5, 4),
      ('V3N-004', 4, 3),
      ('V3N-005', 9, 3),
      ('V3N-005', 7, 1),
      ('V3N-005', 8, 1),
      ('V3N-005', 6, 3),
      ('V3N-005', 3, 1),
      ('V3N-005', 5, 4),
      ('V3N-005', 4, 2),
      ('V3N-006', 9, 4),
      ('V3N-006', 7, 1),
      ('V3N-006', 10, 2),
      ('V3N-006', 5, 2),
      ('V3N-006', 4, 3),
      ('V3N-007', 9, 5),
      ('V3N-007', 8, 1),
      ('V3N-007', 5, 4),
      ('V3N-008', 9, 6),
      ('V3N-008', 8, 2),
      ('V3N-008', 5, 2),
      ('V3N-009', 9, 10),
      ('V3N-010', 9, 1),
      ('V3N-011', 9, 40),
      ('V3N-012', 9, 13),
      ('T2-001', 9, 3),
      ('T2-002', 9, 4),
      ('T2-003', 9, 27),
      ('T2-004', 9, 41),
      ('T2-005', 9, 7),
      ('T2-006', 9, 115),
      ('T2-007', 9, 9),
      ('T2-008', 9, 3),
      ('T2-009', 9, 2),
      ('T2-010', 9, 4),
      ('T2-011', 9, 3),
      ('T2-012', 9, 1),
      ('T2-013', 9, 1),
      ('T2-014', 9, 2),
      ('T2-015', 6, 2),
      ('T2-016', 9, 5),
      ('T2-017', 9, 3),
      ('T2-018', 9, 7),
      ('T2-019', 9, 1),
      ('T2-020', 9, 2),
      ('T2-021', 9, 22),
      ('T2-022', 9, 1),
      ('T2-023', 9, 8),
      ('T2-024', 9, 8),
      ('T2-025', 9, 1),
      ('T2-026', 9, 6),
      ('T2-027', 9, 1),
      ('T2-028', 9, 7),
      ('T2-029', 9, 8),
      ('T2-030', 9, 4),
      ('T2-031', 9, 3),
      ('T2-032', 9, 1),
      ('T2-033', 9, 4),
      ('T2-034', 9, 3),
      ('T2-035', 9, 1),
      ('T2-036', 9, 4),
      ('T2-037', 9, 21),
      ('T2-038', 9, 2),
      ('MU-001', 9, 13),
      ('MU-002', 9, 20),
      ('MU-003', 9, 35),
      ('MU-003', 5, 10),
      ('MU-004', 9, 53),
      ('MU-005', 9, 29),
      ('MU-006', 9, 10),
      ('MU-007', 9, 20),
      ('MU-008', 9, 3),
      ('MU-008', 5, 10),
      ('MU-009', 9, 5),
      ('MU-009', 5, 7),
      ('MU-010', 10, 10),
      ('MU-011', 9, 3),
      ('MU-012', 9, 4),
      ('MU-013', 9, 5),
      ('MU-014', 9, 4),
      ('MU-015', 9, 2),
      ('MU-016', 9, 2),
      ('MU-017', 9, 1),
      ('MU-018', 9, 62),
      ('MU-019', 9, 40),
      ('MU-020', 9, 30),
      ('MU-021', 9, 14),
      ('MU-021', 5, 10),
      ('MU-022', 9, 19),
      ('MU-023', 9, 50),
      ('MU-023', 10, 10),
      ('MU-024', 10, 10),
      ('MU-024', 5, 10),
      ('MU-025', 10, 10),
      ('MU-026', 9, 14),
      ('MU-027', 9, 12),
      ('MU-028', 9, 2),
      ('MU-029', 9, 22),
      ('MU-030', 9, 42),
      ('MU-031', 9, 38),
      ('MU-032', 9, 3),
      ('MU-033', 9, 10),
      ('MU-034', 9, 3),
      ('MU-035', 9, 22),
      ('MU-036', 9, 15),
      ('MU-037', 9, 6),
      ('MU-040', 9, 41),
      ('MU-041', 9, 14),
      ('MU-042', 9, 6),
      ('MU-043', 9, 2),
      ('MU-044', 9, 9),
      ('MU-045', 9, 5),
      ('MU-046', 9, 9),
      ('MU-048', 9, 13),
      ('MU-049', 9, 5),
      ('MU-050', 9, 9),
      ('MU-051', 9, 9),
      ('MU-052', 9, 8),
      ('MU-053', 9, 3),
      ('MU-054', 9, 26),
      ('MU-054', 5, 5),
      ('MU-055', 9, 24),
      ('MU-056', 9, 2),
      ('MU-057', 9, 3),
      ('MU-058', 9, 6),
      ('MU-059', 9, 2),
      ('MU-060', 9, 3),
      ('MU-061', 9, 2),
      ('MU-062', 9, 30),
      ('MU-063', 9, 6),
      ('MU-064', 9, 30),
      ('MU-065', 9, 8),
      ('MU-066', 9, 3),
      ('MU-067', 9, 5),
      ('MU-068', 9, 5),
      ('MU-069', 9, 2),
      ('MU-070', 9, 53),
      ('MU-071', 9, 2),
      ('MU-072', 9, 2),
      ('MU-073', 9, 1),
      ('MU-074', 9, 1),
      ('MU-075', 9, 2),
      ('MU-076', 9, 7),
      ('MU-077', 9, 17),
      ('MU-078', 9, 19),
      ('MU-079', 9, 19),
      ('MU-080', 9, 5),
      ('MU-081', 9, 14),
      ('MU-082', 9, 21),
      ('MU-083', 9, 3),
      ('MU-084', 9, 7),
      ('MU-085', 9, 4),
      ('MU-086', 9, 1),
      ('MU-087', 9, 6),
      ('MU-088', 9, 3),
      ('MU-089', 9, 7),
      ('MU-090', 9, 4),
      ('MU-090', 4, 1),
      ('MU-091', 9, 12),
      ('MU-092', 9, 12),
      ('MU-092', 5, 1),
      ('MU-093', 9, 81),
      ('MU-094', 9, 80),
      ('MU-095', 9, 17),
      ('MU-096', 9, 35),
      ('MU-097', 9, 20),
      ('MU-098', 9, 1),
      ('MU-099', 9, 6),
      ('MU-100', 9, 7),
      ('MU-100', 4, 2),
      ('MU-101', 9, 2),
      ('MU-102', 9, 2),
      ('MU-103', 9, 6),
      ('MU-104', 9, 7),
      ('MU-105', 9, 15),
      ('MU-106', 9, 8),
      ('MU-107', 9, 2),
      ('MU-108', 9, 9),
      ('MU-109', 9, 2),
      ('MU-110', 9, 1),
      ('MU-111', 9, 1),
      ('MU-112', 9, 6),
      ('MU-113', 9, 4),
      ('MU-114', 9, 1),
      ('MU-115', 9, 14),
      ('MU-116', 9, 5),
      ('MU-117', 9, 2),
      ('MU-118', 9, 8),
      ('MU-119', 9, 1),
      ('MU-120', 9, 1),
      ('MU-121', 9, 8),
      ('MU-122', 9, 95),
      ('MU-123', 9, 2),
      ('MU-124', 9, 6),
      ('MU-125', 9, 3),
      ('MU-126', 9, 5),
      ('MU-127', 9, 1),
      ('MU-128', 9, 1),
      ('MU-129', 9, 1),
      ('MU-130', 9, 1),
      ('MU-131', 9, 2),
      ('MU-132', 9, 1),
      ('MU-133', 9, 17),
      ('MU-134', 9, 67),
      ('MU-135', 9, 47),
      ('MU-136', 7, 10),
      ('MU-136', 4, 10),
      ('MU-137', 9, 85),
      ('MU-138', 9, 33),
      ('MU-139', 9, 16),
      ('MU-140', 9, 25),
      ('MU-141', 9, 6),
      ('MU-142', 9, 8),
      ('MU-143', 9, 1),
      ('MU-144', 9, 5),
      ('MU-145', 9, 1),
      ('MU-146', 9, 1),
      ('MU-146', 6, 2),
      ('MU-146', 10, 2),
      ('MU-146', 5, 1),
      ('MU-146', 4, 1),
      ('MU-147', 9, 3),
      ('MU-147', 10, 1),
      ('MU-147', 4, 1),
      ('MU-148', 8, 1),
      ('MU-148', 5, 5),
      ('MU-148', 4, 2),
      ('MU-149', 9, 2),
      ('MU-150', 9, 2),
      ('MU-151', 9, 10),
      ('MU-152', 9, 1),
      ('MU-153', 9, 4),
      ('MU-154', 9, 62),
      ('MU-155', 9, 16),
      ('MU-155', 5, 10),
      ('MU-156', 1, 20),
      ('MU-156', 5, 10),
      ('MU-156', 4, 3),
      ('MU-157', 9, 100),
      ('MU-158', 1, 3),
      ('MU-159', 4, 5),
      ('MU-160', 4, 5),
      ('MU-161', 9, 45),
      ('MU-161', 6, 2),
      ('MU-161', 4, 3),
      ('MU-162', 9, 5),
      ('MU-162', 7, 2),
      ('MU-162', 10, 3),
      ('MU-162', 5, 5),
      ('MU-162', 4, 5),
      ('MU-163', 9, 17),
      ('MU-163', 10, 1),
      ('MU-163', 5, 2),
      ('MU-164', 7, 2),
      ('MU-164', 4, 2),
      ('MU-165', 6, 50),
      ('MU-166', 7, 10),
      ('MU-166', 5, 37),
      ('MU-166', 4, 15),
      ('MU-167', 8, 4),
      ('MU-168', 8, 20),
      ('MU-168', 6, 30),
      ('MU-168', 4, 20),
      ('MU-169', 7, 1),
      ('MU-169', 8, 1),
      ('MU-169', 6, 2),
      ('MU-169', 3, 1),
      ('MU-169', 1, 6),
      ('MU-170', 8, 2),
      ('MU-170', 4, 2),
      ('MU-171', 8, 3),
      ('MU-171', 5, 3),
      ('MU-171', 4, 2),
      ('MU-172', 8, 4),
      ('MU-173', 8, 1),
      ('MU-173', 5, 1),
      ('MU-174', 10, 2),
      ('MU-175', 10, 2),
      ('MU-176', 10, 4),
      ('MU-176', 5, 4),
      ('MU-177', 10, 2),
      ('MU-177', 5, 4),
      ('MU-177', 4, 5),
      ('MU-178', 10, 4),
      ('MU-178', 5, 4),
      ('MU-179', 1, 1),
      ('MU-179', 5, 1),
      ('MU-180', 6, 2),
      ('MU-180', 10, 1),
      ('MU-180', 1, 5),
      ('MU-181', 6, 2),
      ('MU-181', 1, 1),
      ('MU-182', 1, 5),
      ('MU-183', 9, 85),
      ('MU-183', 7, 4),
      ('MU-183', 5, 3),
      ('MU-183', 4, 8),
      ('MU-184', 1, 1),
      ('MU-185', 9, 240),
      ('MU-185', 7, 10),
      ('MU-185', 4, 50),
      ('MU-186', 6, 5),
      ('MU-187', 6, 5),
      ('MU-188', 6, 2),
      ('MU-189', 6, 70),
      ('MU-190', 6, 2),
      ('MU-191', 6, 2),
      ('MU-192', 6, 1),
      ('MU-194', 10, 10),
      ('MU-195', 10, 10),
      ('MU-196', 10, 10),
      ('MU-197', 10, 2),
      ('MU-199', 7, 4),
      ('MU-200', 7, 2),
      ('MU-201', 9, 8),
      ('MU-201', 6, 1),
      ('MU-201', 4, 2),
      ('MU-202', 9, 11),
      ('MU-202', 6, 1)
    ) as v(code, b, qty) join items i on i.code = v.code
  loop
    perform app.add_stock(r.b, r.item_id, null, null, r.qty, 'adjust', app.today(), 'Tồn đầu kỳ từ file Excel', null, null);
  end loop;
end $$;
