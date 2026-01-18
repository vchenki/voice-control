
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 确保 process.env.API_KEY 在浏览器端可用（由 Vercel 注入）
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
  },
});
