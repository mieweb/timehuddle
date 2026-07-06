import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      // Map Capacitor modules to empty stubs for web builds
      '@capacitor/device': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/push-notifications': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/core': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/share': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
    },
  },

  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:3100',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.API_TARGET ?? 'http://localhost:3100',
        changeOrigin: true,
      },
      '/v1': {
        target: process.env.API_TARGET ?? 'http://localhost:3100',
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
