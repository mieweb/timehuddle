/**
 * Unit tests for pulse-cors-core (server/pulse-cors-core.js): which origins
 * every route lets in, and the headers they get — the ones a `<video>` or a
 * captions `<track>` in a native app's WebView needs to seek with `Range`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CORS_ALLOW_HEADERS,
  CORS_EXPOSE_HEADERS,
  NATIVE_APP_ORIGINS,
  baseDomainOf,
  corsDecision,
  createCorsMiddleware,
  createOriginPolicy,
  isPrivateLanHost,
} from '../server/pulse-cors-core';

const listOf = (header: string) => header.split(',').map((s) => s.trim().toLowerCase());

/** A connect response that records what was set. */
function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    status: 0,
    ended: false,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    writeHead(status: number) {
      this.status = status;
    },
    end() {
      this.ended = true;
    },
  };
}

describe('createOriginPolicy', () => {
  const { isOriginAllowed } = createOriginPolicy({
    corsOrigins: 'https://app.example.com',
    rootUrl: 'https://timecore.os.mieweb.org',
    isProduction: true,
  });

  it("lets in the native apps' WebViews: Capacitor iOS and Android, and legacy Ionic", () => {
    expect(isOriginAllowed('capacitor://localhost')).toBe(true);
    expect(isOriginAllowed('https://localhost')).toBe(true);
    expect(isOriginAllowed('ionic://localhost')).toBe(true);
    expect([...NATIVE_APP_ORIGINS]).toEqual(['capacitor://localhost', 'https://localhost', 'ionic://localhost']);
  });

  it('lets in CORS_ORIGINS, the preview domains and ROOT_URL base domain', () => {
    expect(isOriginAllowed('https://app.example.com')).toBe(true);
    expect(isOriginAllowed('https://pr-12.os.mieweb.org')).toBe(true);
    expect(isOriginAllowed('https://os.mieweb.org')).toBe(true);
  });

  it('refuses an unknown origin, a lookalike and no origin', () => {
    expect(isOriginAllowed('https://evil.example')).toBe(false);
    expect(isOriginAllowed('https://os.mieweb.org.evil.example')).toBe(false);
    expect(isOriginAllowed('https://evilos.mieweb.org')).toBe(false);
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
    expect(isOriginAllowed('capacitor://evil')).toBe(false);
    expect(isOriginAllowed('not a url')).toBe(false);
    expect(isOriginAllowed(undefined)).toBe(false);
    expect(isOriginAllowed('')).toBe(false);
  });

  it('lets in private-LAN origins outside production only', () => {
    const dev = createOriginPolicy({ isProduction: false }).isOriginAllowed;
    expect(dev('http://10.3.95.139:3000')).toBe(true);
    expect(dev('http://localhost:3000')).toBe(true);
    expect(dev('http://8.8.8.8:3000')).toBe(false);
    expect(createOriginPolicy({}).isOriginAllowed('http://10.3.95.139:3000')).toBe(false);
  });

  it("lets in everything for CORS_ORIGINS='*'", () => {
    expect(createOriginPolicy({ corsOrigins: '*' }).isOriginAllowed('https://anything.example')).toBe(true);
  });

  it('reports what it read, for the startup log', () => {
    expect(createOriginPolicy({ corsOrigins: 'https://a.example', rootUrl: 'https://x.os.mieweb.org' })).toMatchObject({
      corsOrigins: 'https://a.example',
      baseDomain: 'os.mieweb.org',
    });
  });
});

describe('baseDomainOf and isPrivateLanHost', () => {
  it("keeps ROOT_URL's last three labels, never just two", () => {
    expect(baseDomainOf('https://timecore-dev.os.mieweb.org')).toBe('os.mieweb.org');
    expect(baseDomainOf('http://localhost:3100')).toBe('');
    expect(baseDomainOf('')).toBe('');
  });

  it('knows the RFC1918 ranges and loopback', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.5', '172.16.0.1', '172.31.255.255']) {
      expect(isPrivateLanHost(h)).toBe(true);
    }
    for (const h of ['172.32.0.1', '8.8.8.8', 'example.com']) expect(isPrivateLanHost(h)).toBe(false);
  });
});

describe('corsDecision', () => {
  const { isOriginAllowed } = createOriginPolicy({ isProduction: true });

  it('gives the Capacitor origin a ranged GET of a video or captions, with the range headers readable', () => {
    for (const url of ['/pulsevault/artifacts/0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59', '/pulse/captions/x']) {
      const d = corsDecision({ method: 'GET', url, origin: 'capacitor://localhost' }, isOriginAllowed);
      expect(d.skip).toBe(false);
      expect(d.preflight).toBe(false);
      expect(d.headers).toMatchObject({
        'Access-Control-Allow-Origin': 'capacitor://localhost',
        'Access-Control-Allow-Credentials': 'true',
      });
      expect(listOf(d.headers!['Access-Control-Allow-Methods'])).toEqual(expect.arrayContaining(['get', 'head']));
      expect(listOf(d.headers!['Access-Control-Allow-Headers'])).toContain('range');
      expect(listOf(d.headers!['Access-Control-Expose-Headers'])).toEqual(
        expect.arrayContaining(['content-range', 'accept-ranges', 'content-length']),
      );
    }
  });

  it('answers a preflight with the allowed headers, Range and the TUS ones', () => {
    const d = corsDecision({ method: 'OPTIONS', url: '/pulse/captions/x', origin: 'https://localhost' }, isOriginAllowed);
    expect(d.preflight).toBe(true);
    expect(d.headers!['Access-Control-Max-Age']).toBe('86400');
    expect(listOf(CORS_ALLOW_HEADERS)).toEqual(
      expect.arrayContaining(['range', 'tus-resumable', 'upload-offset', 'authorization', 'content-type']),
    );
    expect(listOf(CORS_EXPOSE_HEADERS)).toEqual(expect.arrayContaining(['location', 'upload-offset']));
  });

  it('gives an unknown origin no CORS headers', () => {
    const d = corsDecision({ method: 'GET', url: '/pulse/captions/x', origin: 'https://evil.example' }, isOriginAllowed);
    expect(d.headers).toBeNull();
  });

  it('leaves /uploads/tus to answer its own CORS', () => {
    const d = corsDecision({ method: 'OPTIONS', url: '/uploads/tus/abc', origin: 'capacitor://localhost' }, isOriginAllowed);
    expect(d.skip).toBe(true);
  });
});

describe('createCorsMiddleware', () => {
  const middleware = createCorsMiddleware(createOriginPolicy({ isProduction: true }).isOriginAllowed);

  it('ends a preflight with a 204 carrying the headers', () => {
    const res = fakeRes();
    const next = vi.fn();
    middleware({ method: 'OPTIONS', url: '/pulse/captions/x', headers: { origin: 'capacitor://localhost' } }, res, next);
    expect(res.status).toBe(204);
    expect(res.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Access-Control-Allow-Origin']).toBe('capacitor://localhost');
  });

  it('passes a GET on with the headers set', () => {
    const res = fakeRes();
    const next = vi.fn();
    middleware({ method: 'GET', url: '/pulsevault/artifacts/x', headers: { origin: 'https://localhost', range: 'bytes=0-' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost');
  });

  it('passes an unknown origin on with no CORS headers, and still ends its preflight', () => {
    const res = fakeRes();
    const next = vi.fn();
    middleware({ method: 'GET', url: '/pulse/captions/x', headers: { origin: 'https://evil.example' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.headers).toEqual({});
    const pre = fakeRes();
    middleware({ method: 'OPTIONS', url: '/pulse/captions/x', headers: { origin: 'https://evil.example' } }, pre, vi.fn());
    expect(pre.status).toBe(204);
    expect(pre.headers).toEqual({});
  });

  it('leaves /uploads/tus alone', () => {
    const res = fakeRes();
    const next = vi.fn();
    middleware({ method: 'OPTIONS', url: '/uploads/tus/x', headers: { origin: 'capacitor://localhost' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).toBe(0);
    expect(res.headers).toEqual({});
  });
});
