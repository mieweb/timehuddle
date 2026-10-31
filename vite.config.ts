import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

import { watchPreview, watchVideoId, withPreview } from './scripts/watch-preview.mjs';

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

// A video's page (/watch/:videoId) answers with its link-preview tags, so a
// pasted link gets a card (scripts/watch-preview.mjs). In development the dev
// server writes them; a build records the backend's and the app's public
// addresses in dist/server-config.json for scripts/serve-frontend.mjs, which
// writes them there.
function watchPreviews(): Plugin {
  let backendUrl = 'http://localhost:3100';
  let builtBackendUrl: string | undefined;
  let builtAppUrl: string | undefined;
  return {
    name: 'watch-previews',
    configResolved(config) {
      builtBackendUrl = config.env.VITE_TIMECORE_URL;
      builtAppUrl = config.env.VITE_PUBLIC_APP_URL;
      backendUrl = process.env.API_TARGET ?? builtBackendUrl ?? backendUrl;
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        const videoId =
          ctx.server && ctx.originalUrl ? watchVideoId(ctx.originalUrl.split('?')[0]) : null;
        if (!videoId) return html;
        const preview = await watchPreview(videoId, { backendUrl }).catch(() => null);
        const origin = ctx.server?.resolvedUrls?.local[0] ?? 'http://localhost:3000/';
        return preview
          ? withPreview(html, preview, new URL(ctx.originalUrl!, origin).toString())
          : html;
      },
    },
    closeBundle() {
      const out = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(out)) return;
      fs.writeFileSync(
        path.join(out, 'server-config.json'),
        JSON.stringify({ backendUrl: builtBackendUrl ?? null, appUrl: builtAppUrl ?? null }),
      );
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
      '@capacitor/filesystem': path.resolve(__dirname, 'src/lib/capacitor-stubs.ts'),
    };

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), kerebronWasmAssets(), watchPreviews()],
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },

  resolve: {
    // Force a single React instance — a duplicate react/react-dom copy from
    // any dependency breaks hooks ("Invalid hook call" / useReducer of null).
    dedupe: ['react', 'react-dom'],
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      // @mieweb/ui's barrel keeps CountryCodeDropdown alive, dragging 566 KB of
      // libphonenumber into the login-page entry chunk. The app uses no phone/country picker.
      // Remove once https://github.com/mieweb/ui/issues/561 is fixed upstream.
      'google-libphonenumber': path.resolve(__dirname, 'src/lib/libphonenumber-stub.ts'),
      // Kerebron's AdvancedEditorKit always bundles its ProseMirror dev panel (166 KB),
      // which only a developer toggling it from the editor would ever open.
      'prosemirror-dev-toolkit': path.resolve(__dirname, 'src/lib/prosemirror-dev-toolkit-stub.ts'),
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
