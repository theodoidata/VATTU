import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // NEXT_PUBLIC_*: tên biến do tích hợp Supabase ↔ Vercel tự tạo (chỉ URL + anon key là công khai)
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { chunkSizeWarningLimit: 1500 },
});
