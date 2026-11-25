export type Branch = { id: number; code: string; name: string; sort_order: number };
export type Group = { id: number; code: string; name: string; sort_order: number };

export type Profile = {
  id: string; email: string; full_name: string; department_id: number | null; branch_id: number | null;
  active: boolean; department_name?: string | null; branch_name?: string | null;
};

export type Session = {
  profile: Profile | null; permissions: string[]; branches: Branch[]; groups: Group[]; today: string;
};

export type Lot = { id: number; lot_no: string; expiry_date: string | null; qty: number };

export type StockRow = {
  id: number; code: string; name: string; unit: string; purchase_unit: string | null; purchase_factor: number;
  group_id: number | null; group_name: string | null; track_lot: boolean; min_qty: number; min_is_custom: boolean;
  qty: number; usable_qty: number; nearest_expiry: string | null; lots: Lot[];
};

export type Item = {
  id: number; code: string; name: string; group_id: number | null; group_name: string | null; unit: string;
  purchase_unit: string | null; purchase_factor: number; track_lot: boolean; default_min_qty: number;
  note: string | null; active: boolean; mins: Record<string, number>;
};

export type MatrixRow = {
  id: number; code: string; name: string; unit: string; group_id: number | null; group_name: string | null;
  by_branch: Record<string, { qty: number; usable: number; min: number }>;
};

export type TransferStatus = 'pending' | 'approved' | 'shipped' | 'received' | 'rejected' | 'cancelled';
export type TransferLine = {
  id: number; item_id: number; item_code: string; item_name: string; unit: string;
  qty_requested: number; qty_approved: number | null; qty_received: number | null;
  /** còn dùng được ở chi nhánh cấp (chỉ có khi phiếu chưa gửi) */
  src_usable?: number | null;
  lots: { lot_no: string; expiry_date: string | null; qty: number }[];
};
export type Transfer = {
  id: number; code: string; from_branch_id: number; to_branch_id: number; from_branch_name: string; to_branch_name: string;
  status: TransferStatus; note: string | null; reject_reason: string | null; receive_note: string | null;
  requested_at: string; approved_at: string | null; shipped_at: string | null; received_at: string | null; closed_at: string | null;
  requested_by_name: string | null; approved_by_name: string | null; shipped_by_name: string | null;
  received_by_name: string | null; closed_by_name: string | null; lines: TransferLine[];
  kind: 'request' | 'push'; has_shortage: boolean; awaiting_stock?: boolean;
};

export type UsageDoc = {
  id: number; branch_id: number; branch_name: string; usage_date: string; note: string | null; created_at: string;
  created_date: string; created_by_name: string | null; voided_at: string | null; voided_by_name: string | null;
  void_reason: string | null;
  lines: { id: number; item_id: number; item_code: string; item_name: string; unit: string; qty: number; reason: string;
           lots: { lot_no: string; expiry_date: string | null; qty: number }[] }[];
};

export type ReceiptDoc = {
  id: number; branch_id: number; branch_name: string; receipt_date: string; source: string; supplier: string | null;
  note: string | null; created_at: string; created_by_name: string | null;
  updated_at: string | null; updated_by_name: string | null;
  lines: { id: number; item_id: number; item_code: string; item_name: string; unit: string; qty: number;
           input_qty: number; input_unit: string; lot_no: string; expiry_date: string | null }[];
};

export type Stocktake = {
  id: number; branch_id: number; branch_name: string; status: 'draft' | 'submitted' | 'approved' | 'cancelled';
  note: string | null; group_id: number | null; group_name: string | null; created_at: string; created_by_name: string | null;
  submitted_at: string | null; submitted_by_name: string | null; approved_at: string | null; approved_by_name: string | null;
  line_count?: number; counted_count?: number; diff_count?: number;
  lines?: { id: number; item_id: number; item_code: string; item_name: string; unit: string; group_name: string | null;
            track_lot: boolean; lot_no: string; expiry_date: string | null; system_qty: number; counted_qty: number | null;
            note: string | null }[];
};
