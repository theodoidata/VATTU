// Lớp gọi dữ liệu: Supabase thật hoặc bản demo chạy trong trình duyệt.
// Cả hai đều gọi CÙNG các hàm SQL (supabase/sql/02_functions.sql).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Backend {
  mode: 'supabase' | 'demo';
  rpc<T = any>(fn: string, p?: Record<string, unknown>): Promise<T>;
}

const env = import.meta.env;
const url = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const key = (env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined;

export const supabaseConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, { auth: { persistSession: true } })
  : null;

export const supabaseBackend: Backend = {
  mode: 'supabase',
  async rpc(fn, p = {}) {
    if (!supabase) throw new Error('Chưa cấu hình Supabase.');
    const { data, error } = await supabase.rpc(fn, { p });
    if (error) throw new Error(cleanError(error.message));
    return data;
  },
};

export function cleanError(msg: string) {
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Mất kết nối mạng. Vui lòng thử lại.';
  if (/JWT|not authenticated/i.test(msg)) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  return msg;
}

// ---------------- DEMO ----------------
let demoPromise: Promise<{ rpc: (uid: string, fn: string, p: unknown) => Promise<any> }> | null = null;

function loadDemo() {
  if (!demoPromise) {
    demoPromise = (async () => {
      const [{ PGlite }, shim, s1, s2, s3, s5, seed] = await Promise.all([
        import('@electric-sql/pglite'),
        import('../demo/shim.sql?raw'),
        import('../../supabase/sql/01_schema.sql?raw'),
        import('../../supabase/sql/02_functions.sql?raw'),
        import('../../supabase/sql/03_seed.sql?raw'),
        import('../../supabase/sql/05_import_excel.sql?raw'),
        import('../demo/demo_seed.sql?raw'),
      ]);
      const db = new PGlite();
      for (const sql of [shim, s1, s2, s3, s5, seed]) await db.exec(sql.default);
      let queue = Promise.resolve();
      const rpc = (uid: string, fn: string, p: unknown) => {
        const run = async () => {
          if (!/^[a-z_]+$/.test(fn)) throw new Error('Hàm không hợp lệ');
          await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
          const r = await db.query<{ r: unknown }>(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(p ?? {})]);
          return r.rows[0]?.r;
        };
        const next = queue.then(run, run);
        queue = next.then(() => undefined, () => undefined);
        return next;
      };
      return { rpc };
    })();
  }
  return demoPromise;
}

export const DEMO_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', label: 'BGĐ — Nguyễn Văn An' },
  { id: '00000000-0000-0000-0000-000000000002', label: 'Quản lý CN Hạ Long — Trần Thị Bình' },
  { id: '00000000-0000-0000-0000-000000000003', label: 'Kho / Phụ tá Hạ Long — Lê Minh Châu' },
  { id: '00000000-0000-0000-0000-000000000004', label: 'Bác sĩ Hạ Long — BS. Đỗ Quang Hải' },
  { id: '00000000-0000-0000-0000-000000000005', label: 'Quản lý CN Mạo Khê — Phạm Thu Dung' },
  { id: '00000000-0000-0000-0000-000000000006', label: 'Kho / Phụ tá Mạo Khê — Hoàng Văn Em' },
  { id: '00000000-0000-0000-0000-000000000007', label: 'Quản lý Kho tổng — Vũ Thị Giang' },
  { id: '00000000-0000-0000-0000-000000000008', label: 'Nhân viên mới (chờ kích hoạt)' },
];

export function demoBackend(getUid: () => string): Backend {
  return {
    mode: 'demo',
    async rpc(fn, p = {}) {
      const demo = await loadDemo();
      try { return await demo.rpc(getUid(), fn, p); }
      catch (e) { throw new Error((e as Error).message); }
    },
  };
}

export const preloadDemo = () => { void loadDemo(); };
