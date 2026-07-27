import react from '@vitejs/plugin-react';
import path from 'path';
import zlib from 'zlib';
import { defineConfig, type Plugin } from 'vite';

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

/** Gzip dev-server responses.
 *
 * Vite's dev server sends text assets uncompressed, which is free over
 * localhost but not when a physical device pulls the whole module graph
 * across Wi-Fi (`npm run dev:ios`). This app's cold load was 38.7 MB; gzip
 * takes it to 12 MB.
 *
 * Most of that bulk is dependency sourcemaps, which Vite inlines into every
 * pre-bundled dep it serves — 30.7 MB of maps against 18.3 MB of real code.
 * They cannot be turned off: `optimizeDeps.rolldownOptions` deliberately omits
 * `sourcemap` because changing it breaks dep optimization. Compressing is the
 * available lever, and base64'd JSON maps happen to gzip extremely well.
 *
 * Level 1 keeps compression cheap enough that it never becomes the new
 * bottleneck — the win here is bytes on the wire, not ratio.
 */
function devCompression(): Plugin {
  const COMPRESSIBLE = /\b(javascript|json|css|html|svg)\b/;
  return {
    name: 'timehuddle:dev-compression',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next();

        const rawWrite = res.write.bind(res);
        const rawEnd = res.end.bind(res);
        let gzip: zlib.Gzip | null = null;
        let decided = false;

        // Content-Type is only known once the handler writes, so decide lazily.
        const stream = () => {
          if (decided) return gzip;
          decided = true;
          if (!COMPRESSIBLE.test(String(res.getHeader('content-type') ?? ''))) return null;
          res.removeHeader('Content-Length'); // length refers to the identity encoding
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          gzip = zlib.createGzip({ level: 1 });
          gzip.on('data', (chunk) => rawWrite(chunk));
          gzip.on('end', () => rawEnd());
          return gzip;
        };

        res.write = ((chunk: never, ...rest: never[]) => {
          const gz = stream();
          return gz ? gz.write(chunk) : rawWrite(chunk, ...rest);
        }) as typeof res.write;

        res.end = ((chunk?: never, ...rest: never[]) => {
          const gz = stream();
          if (!gz) return rawEnd(chunk, ...rest);
          if (chunk && typeof chunk !== 'function') gzip?.write(chunk);
          gzip?.end();
          return res;
        }) as typeof res.end;

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devCompression()],

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
