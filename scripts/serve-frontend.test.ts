// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFrontendServer } from './serve-frontend.mjs';

const VIDEO = '2fe388d4-d08c-4f0c-a91d-454dc50771fe';
const SERVE_JSON = {
  headers: [
    {
      source: 'assets/**',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

let root: string;
let backend: http.Server;
let backendUrl: string;
let videoName = 'Standup';

/** Listen on a free port; its origin. */
async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A raw request, so a malformed path reaches the server as sent. */
function rawGet(
  origin: string,
  requestPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: requestPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/** The frontend over `root`, started for one test. */
async function frontend(appUrl: string | null = null) {
  const server = createFrontendServer({ root, backendUrl, appUrl, serveConfig: SERVE_JSON });
  const origin = await listen(server);
  return { origin, close: () => new Promise((r) => server.close(r)) };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'serve-frontend-'));
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><title>TimeHuddle</title></head><body><div id="root"></div></body></html>',
  );
  await mkdir(path.join(root, 'assets'));
  await writeFile(
    path.join(root, 'assets', 'app.js'),
    `console.log(${JSON.stringify('x'.repeat(4000))});`,
  );
  // A stand-in backend: the video's details, its cover and its file.
  backend = http.createServer((req, res) => {
    if (req.url === '/api/videos_publicInfo') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          result: { videoId: VIDEO, name: videoName, addedAt: null, author: null },
        }),
      );
    } else if (req.url?.endsWith('/poster')) {
      res.writeHead(206, { 'Content-Type': 'image/jpeg' }).end('x');
    } else {
      res.writeHead(206, { 'Content-Type': 'video/mp4' }).end('x');
    }
  });
  backendUrl = await listen(backend);
});

afterAll(async () => {
  await new Promise((r) => backend.close(r));
  await rm(root, { recursive: true, force: true });
});

describe('serve-frontend', () => {
  it('answers a malformed request with 400 and keeps serving', async () => {
    const { origin, close } = await frontend();
    try {
      for (const bad of ['//%zz', '//[', 'http://[']) {
        expect((await rawGet(origin, bad)).status).toBe(400);
      }
      expect((await rawGet(origin, '/')).status).toBe(200);
    } finally {
      await close();
    }
  });

  it('serves as `serve -s dist` did: cached, compressed, tagged assets and the app for any route', async () => {
    const { origin, close } = await frontend();
    try {
      const asset = await rawGet(origin, '/assets/app.js', { 'Accept-Encoding': 'gzip' });
      expect(asset.status).toBe(200);
      expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(asset.headers['content-encoding']).toBe('gzip');
      expect(asset.headers.etag).toBeTruthy();
      const route = await rawGet(origin, '/app/tickets/123');
      expect(route.status).toBe(200);
      expect(route.body).toContain('<div id="root">');
    } finally {
      await close();
    }
  });

  it("cards a watch page at the app's own address, whatever host the request claims", async () => {
    const { origin, close } = await frontend('https://huddle.example.org');
    try {
      const page = await rawGet(origin, `/watch/${VIDEO}`, {
        'X-Forwarded-Host': 'evil.example',
        'X-Forwarded-Proto': 'https',
      });
      expect(page.body).toContain('<title>Standup · TimeHuddle</title>');
      expect(page.body).toContain(
        `<meta property="og:url" content="https://huddle.example.org/watch/${VIDEO}" />`,
      );
      expect(page.body).not.toContain('evil.example');
    } finally {
      await close();
    }
  });

  it("leaves the card's address out when the app's isn't configured", async () => {
    const { origin, close } = await frontend(null);
    try {
      const page = await rawGet(origin, `/watch/${VIDEO}`, { Host: 'evil.example' });
      expect(page.body).toContain('og:title');
      expect(page.body).not.toContain('og:url');
    } finally {
      await close();
    }
  });

  it('keeps a `$` in a name as text, not a replacement pattern', async () => {
    videoName = "a$'b $& c$`d";
    const { origin, close } = await frontend();
    try {
      const page = await rawGet(origin, `/watch/${VIDEO}`);
      expect(page.body.match(/<!doctype/gi)).toHaveLength(1);
      expect(page.body).toContain('<title>a$&#39;b $&amp; c$`d · TimeHuddle</title>');
    } finally {
      videoName = 'Standup';
      await close();
    }
  });
});
