import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

// Serve @kerebron/wasm's assets/ at /kerebron-wasm — RichEditor (Kerebron)
// fetches tree-sitter grammars and the ODT wasm from there at runtime.
function kerebronWasmAssets(): Plugin {
  const assetsDir = path.resolve(__dirname, 'node_modules/@kerebron/wasm/assets');
  const contentType = (file: string) =>
    file.endsWith('.wasm')
      ? 'application/wasm'
      : file.endsWith('.json')
        ? 'application/json'
        : 'application/octet-stream';
  return {
    name: 'kerebron-wasm-assets',
    configureServer(server) {
      server.middlewares.use('/kerebron-wasm', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const filePath = path.normalize(path.join(assetsDir, rel));
        // Path-traversal guard: only serve files inside the assets dir.
        if (!filePath.startsWith(assetsDir + path.sep)) return next();
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return next();
        res.setHeader('Content-Type', contentType(filePath));
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      // Production build: ship the assets alongside the bundle (vite preview
      // and static hosting then serve /kerebron-wasm from dist/).
      const out = path.resolve(__dirname, 'dist/kerebron-wasm');
      if (fs.existsSync(assetsDir)) fs.cpSync(assetsDir, out, { recursive: true });
    },
  };
}

// When running inside a Capacitor WebView (live-reload or production bundle),
// we must use the real @capacitor/* packages so native APIs work.
// Only stub them out for pure web builds.
const isCapacitorBuild = !!process.env.CAPACITOR_SERVER_URL || !!process.env.CAPACITOR;

const capacitorStubs = isCapacitorBuild
  ? {}
  : {
      '@capacitor/device': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/push-notifications': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/core': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
      '@capacitor/share': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
    };

export default defineConfig({
  plugins: [react(), kerebronWasmAssets()],

  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      ...capacitorStubs,
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
      '/pulsevault': {
        target: process.env.API_TARGET ?? 'http://localhost:3100',
        // changeOrigin: false (the default) — @mieweb/pulsevault's TUS layer
        // builds its `Location` header from the request's Host header. With
        // changeOrigin:true that Host becomes localhost:3100, so the browser's
        // follow-up PATCH/HEAD requests would go direct to 3100 (bypassing this
        // proxy) and hit real cross-origin CORS instead of the proxied same-origin path.
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
