import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'imports/ui'),
      '@lib': path.resolve(__dirname, 'imports/lib'),
    },
  },

  server: {
    port: 3000,
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
