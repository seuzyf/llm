import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
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
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // 使用绝对路径和多种通配符，确保在 Windows 环境下也能生效
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
