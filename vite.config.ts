import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端仅在浏览器本地运行求解器；此处不配置任何后端代理。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 8080,
  },
});
