#!/usr/bin/env node
/**
 * Serves the built frontend (`dist/`) as `serve -s dist` does — `dist/serve.json`
 * (cache headers for the hashed assets), compression, ETags, and index.html for
 * every path the app owns — and writes a video's link-preview tags into that
 * page for `/watch/:videoId` (see watch-preview.mjs), so a link pasted into
 * Slack, iMessage or WhatsApp shows the video's name and cover.
 *
 *   node scripts/serve-frontend.mjs            # port 3000, all interfaces
 *   PORT=80 node scripts/serve-frontend.mjs
 *
 * The backend's and the app's public addresses come from the build
 * (dist/server-config.json, from VITE_TIMECORE_URL and VITE_PUBLIC_APP_URL);
 * TIMECORE_URL and PUBLIC_APP_URL override them.
 */
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import compression from 'compression';
import handler from 'serve-handler';

import { watchPreview, watchVideoId, withPreview } from './watch-preview.mjs';

const compress = promisify(compression());

/** `dist/<name>` as JSON, or `{}` when it's missing or unreadable. */
async function readJson(root, name) {
  return readFile(path.join(root, name), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({}));
}

/**
 * The frontend's server, not yet listening.
 *
 * @param {{ root: string, backendUrl: string, appUrl?: string | null, serveConfig?: object }} options
 *   appUrl: the app's public origin, for a preview's own address (`og:url`); without it the tag is
 *   left out — never taken from the request's headers, which a client can set.
 */
export function createFrontendServer({ root, backendUrl, appUrl = null, serveConfig = {} }) {
  const config = {
    ...serveConfig,
    public: root,
    etag: true,
    // `serve -s`: anything that isn't a file is the app's own route.
    rewrites: [
      { source: '**', destination: '/index.html' },
      ...(Array.isArray(serveConfig.rewrites) ? serveConfig.rewrites : []),
    ],
  };

  /** index.html, with the video's preview tags when it has any. */
  const watchPage = async (pathname, videoId) => {
    const html = await readFile(path.join(root, 'index.html'), 'utf8');
    const preview = await watchPreview(videoId, { backendUrl }).catch(() => null);
    const pageUrl = appUrl ? new URL(pathname, appUrl).toString() : null;
    return preview ? withPreview(html, preview, pageUrl) : html;
  };

  return http.createServer(async (req, res) => {
    try {
      await compress(req, res);
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const videoId = watchVideoId(pathname);
      if (videoId && (req.method === 'GET' || req.method === 'HEAD')) {
        const body = await watchPage(pathname, videoId);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          // A rename or a new cover should reach the next card.
          'Cache-Control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      await handler(req, res, config);
    } catch (error) {
      // A request the URL parser or a handler chokes on gets a 400/500, never
      // a crash: this process is the whole frontend.
      const malformed = error instanceof TypeError && /URL/i.test(error.message);
      if (!malformed) console.error('[serve-frontend] request failed:', error);
      if (!res.headersSent) res.writeHead(malformed ? 400 : 500);
      res.end();
    }
  });
}

/** Run as a script: serve `dist/` on PORT (3000) and HOST (all interfaces). */
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const built = await readJson(root, 'server-config.json');
  const backendUrl = process.env.TIMECORE_URL || built.backendUrl || 'http://localhost:3100';
  const appUrl = process.env.PUBLIC_APP_URL || built.appUrl || null;
  const server = createFrontendServer({
    root,
    backendUrl,
    appUrl,
    serveConfig: await readJson(root, 'serve.json'),
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  server.listen(port, host, () => {
    console.log(`[serve-frontend] dist on http://${host}:${port}, previews from ${backendUrl}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
