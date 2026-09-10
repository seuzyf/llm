import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/chat/', 
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000, 
      allowedHosts: ['aiplatform.make.huawei.com'], // 👈 新增：将你的域名加入允许访问的白名单
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/logs/**', 
          '**/uploads/**',
          path.resolve(__dirname, 'logs') + '/**',
          path.resolve(__dirname, 'uploads') + '/**'
        ]
      }
    },
  };
});
