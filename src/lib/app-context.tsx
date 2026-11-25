import { createContext, useContext } from 'react';
import type { Backend } from './backend';
import type { Branch, Group, Session } from './types';

export type AppCtx = {
  backend: Backend;
  session: Session;
  has: (perm: string) => boolean;
  branches: Branch[];
  groups: Group[];
  today: string;
  /** chi nhánh đang xem (thanh trên cùng) */
  branchId: number;
  setBranchId: (id: number) => void;
  /** được thao tác (nhập/xuất/điều chuyển) trên chi nhánh này không */
  canAct: (branchId: number) => boolean;
  canViewAll: boolean;
  toast: (msg: string, tone?: 'success' | 'danger' | 'info') => void;
  refreshKey: number;
  /** báo đã ghi dữ liệu (fn = tên hàm vừa gọi) → các trang đang mở tải lại */
  bump: (fn?: string) => void;
  go: (page: string) => void;
  /** tải lại thông tin phiên (sau khi đổi tên nhóm, chi nhánh…) */
  reloadSession: () => Promise<void>;
};

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
