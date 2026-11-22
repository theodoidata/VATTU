// Truyền dữ liệu giữa các trang khi bấm chuyển trang (vd: từ Tổng quan → Tồn kho đã lọc)
export const handoff: {
  stockFilter?: 'alert' | 'below' | 'expiry';
  /** bấm thông báo → mở thẳng phiếu */
  openTransferId?: number;
  openStocktakeId?: number;
  transferDraft?: { from_branch_id?: number; items: { item_id: number; qty: number }[] };
} = {};
