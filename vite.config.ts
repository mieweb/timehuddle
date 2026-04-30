import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@lib': path.resolve(__dirname, 'src/lib'),
    },
  },

  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
