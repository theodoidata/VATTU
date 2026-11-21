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
