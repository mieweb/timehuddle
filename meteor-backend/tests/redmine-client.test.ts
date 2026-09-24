/**
 * Unit tests for redmine-client (server/redmine-client.js) timeouts.
 *
 * These pin the two rules that keep a slow Redmine from being reported as a
 * broken one:
 *   - our own request timeout is recognised as a timeout, and nothing else is,
 *   - the issue list gets a longer limit than ordinary requests.
 *
 * And the per-user instance rules behind `REDMINE_ALLOW_CUSTOM_URL`:
 *   - a user-supplied URL is accepted only as a plain http(s) URL,
 *   - a stored URL counts only while the flag is on,
 *   - every request goes to the account's own instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getCurrentUser,
  isRedmineTimeout,
  linkedRedmineBaseUrl,
  listIssues,
  normalizeRedmineUrl,
} from '../server/redmine-client';

const account = { apiKey: 'key', baseUrl: 'https://redmine.test' };

/** Set (or, for undefined, delete) env vars for one test; returns a restore fn. */
function withEnv(vars: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  return () => apply(saved);
}

describe('isRedmineTimeout', () => {
  it('recognises the error AbortSignal.timeout throws', () => {
    expect(isRedmineTimeout(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true);
  });

  it('does not mistake other failures for a timeout', () => {
    expect(isRedmineTimeout(Object.assign(new Error('Redmine request failed (500)'), { status: 500 }))).toBe(
      false,
    );
    expect(isRedmineTimeout(new TypeError('fetch failed'))).toBe(false);
    expect(isRedmineTimeout(undefined)).toBe(false);
  });
});

describe('request timeouts', () => {
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ issues: [], user: { id: 1 } }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    timeoutSpy.mockRestore();
  });

  it('gives the issue list 30 seconds', async () => {
    await listIssues(account, { scope: 'all' });
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it('keeps ordinary requests at 8 seconds', async () => {
    await getCurrentUser(account);
    expect(timeoutSpy).toHaveBeenCalledWith(8000);
  });
});

describe('normalizeRedmineUrl', () => {
  it('trims whitespace and trailing slashes, keeping a sub-path', () => {
    expect(normalizeRedmineUrl('  https://redmine.test/  ')).toBe('https://redmine.test');
    expect(normalizeRedmineUrl('http://localhost:3002/redmine//')).toBe('http://localhost:3002/redmine');
  });

  it('rejects anything but a plain http(s) URL', () => {
    for (const raw of [
      '',
      'redmine.test',
      'ftp://redmine.test',
      'file:///etc/passwd',
      'https://user:pass@redmine.test',
      'https://redmine.test/?key=1',
      'https://redmine.test/#top',
      42,
      null,
    ]) {
      expect(normalizeRedmineUrl(raw)).toBeNull();
    }
  });
});

describe('linkedRedmineBaseUrl', () => {
  let restore: () => void;
  afterEach(() => restore());

  it('uses the stored URL while custom URLs are allowed', () => {
    restore = withEnv({ REDMINE_BASE_URL: 'https://default.test', REDMINE_ALLOW_CUSTOM_URL: 'true' });
    expect(linkedRedmineBaseUrl('https://custom.test')).toBe('https://custom.test');
    expect(linkedRedmineBaseUrl(undefined)).toBe('https://default.test');
  });

  it('ignores a stored URL once the flag is off', () => {
    restore = withEnv({ REDMINE_BASE_URL: 'https://default.test', REDMINE_ALLOW_CUSTOM_URL: undefined });
    expect(linkedRedmineBaseUrl('https://custom.test')).toBe('https://default.test');
  });
});

describe('request routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends each request to the account's own instance with its key", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await getCurrentUser({ apiKey: 'other-key', baseUrl: 'https://other.test/sub' });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://other.test/sub/users/current.json');
    expect((init.headers as Record<string, string>)['X-Redmine-API-Key']).toBe('other-key');
  });

  it('refuses to send a request without a base URL', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(getCurrentUser({ apiKey: 'key', baseUrl: null })).rejects.toThrow(/base URL/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
